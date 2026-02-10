import { NextRequest, NextResponse } from 'next/server';
import { FieldPath, FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase/admin';
import Stripe from 'stripe';
import { calculateCommissionTotal, calculateCommissionTotalWithProducts } from '@/lib/commission';
import type { Booking, Product } from '@/types';
import { releaseBookingStockOnceAdmin } from '@/lib/bookingStockAdmin';

// Initialize Stripe only if keys are present
const stripe = process.env.STRIPE_SECRET_KEY 
  ? new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2025-11-17.clover',
    })
  : null;

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

export async function POST(request: NextRequest) {
  try {
    // Check if Stripe is configured
    if (!stripe || !webhookSecret) {
      console.log('Stripe not configured - skipping webhook');
      return NextResponse.json(
        { error: 'Stripe not configured' },
        { status: 503 }
      );
    }

    const adminDb = getAdminDb();

    const body = await request.text();
    const signature = request.headers.get('stripe-signature');

    if (!signature) {
      return NextResponse.json(
        { error: 'No signature' },
        { status: 400 }
      );
    }

    // Verify webhook signature
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    } catch (err: any) {
      console.error('⚠️  Webhook signature verification failed:', err.message);
      return NextResponse.json(
        { error: `Webhook Error: ${err.message}` },
        { status: 400 }
      );
    }

    // Handle the event
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        
        // Get booking ID from metadata
        const bookingId = session.metadata?.booking_id;
        if (!bookingId) {
          console.error('No booking_id in session metadata');
          break;
        }

        console.log(`✅ Payment successful for booking: ${bookingId}`);
        console.log(`   Session ID: ${session.id}`);
        console.log(`   Payment Intent: ${session.payment_intent}`);
        console.log(`   Amount: ${session.amount_total ? session.amount_total / 100 : 0} ${session.currency?.toUpperCase()}`);

        // Update booking in Firestore
        const bookingRef = adminDb.collection('bookings').doc(bookingId);
        
        // Check if booking exists
        const bookingSnap = await bookingRef.get();
        if (!bookingSnap.exists) {
          console.error(`Booking ${bookingId} not found`);
          break;
        }

        const bookingData = bookingSnap.data() as Booking;
        if (bookingData.pago_realizado) {
          console.log(`ℹ️ Booking ${bookingId} already marked as paid - skipping update`);
          break;
        }

        const expectedAmount = Math.round(((bookingData.precio_total || 0) + (bookingData.deposito_total || 0)) * 100);
        if (!Number.isFinite(expectedAmount) || expectedAmount <= 0) {
          console.error(`Invalid booking amount for ${bookingId}`);
          break;
        }

        if (typeof session.amount_total === 'number' && session.amount_total !== expectedAmount) {
          console.error(`Amount mismatch for booking ${bookingId}`);
          break;
        }

        if (session.currency && session.currency.toLowerCase() !== 'eur') {
          console.error(`Currency mismatch for booking ${bookingId}`);
          break;
        }

        if (session.metadata?.booking_id && session.metadata.booking_id !== bookingId) {
          console.error(`Booking metadata mismatch for ${bookingId}`);
          break;
        }

        const hasPartner = Boolean(bookingData.broker_id || bookingData.agency_id);
        let computedCommission = hasPartner ? calculateCommissionTotal(bookingData) : 0;

        if (hasPartner && computedCommission <= 0 && bookingData.items?.length) {
          const productIds = Array.from(
            new Set(bookingData.items.map((item) => item.producto_id).filter(Boolean))
          );
          const productsById: Record<string, Product> = {};

          for (let i = 0; i < productIds.length; i += 10) {
            const chunk = productIds.slice(i, i + 10);
            const snapshot = await adminDb
              .collection('products')
              .where(FieldPath.documentId(), 'in', chunk)
              .get();
            snapshot.docs.forEach((docSnap) => {
              productsById[docSnap.id] = { id: docSnap.id, ...docSnap.data() } as Product;
            });
          }

          computedCommission = calculateCommissionTotalWithProducts(bookingData, productsById);
        }

        await bookingRef.update({
          pago_realizado: true,
          pago_realizado_en: FieldValue.serverTimestamp(),
          pago_metodo: 'stripe',
          pago_referencia: session.payment_intent?.toString() || session.id,
          stripe_payment_intent_id: session.payment_intent?.toString(),
          stripe_checkout_session_id: session.id,
          estado: 'confirmada', // Auto-confirm when paid
          confirmado_en: FieldValue.serverTimestamp(),
          updated_at: FieldValue.serverTimestamp(),
          ...(hasPartner && computedCommission > 0 && !(bookingData.comision_total && bookingData.comision_total > 0)
            ? { comision_total: computedCommission, comision_pagada: bookingData.comision_pagada || 0 }
            : {}),
        });

        console.log(`✅ Booking ${bookingId} marked as paid and confirmed`);
        break;
      }

      case 'refund.created':
      case 'refund.updated': {
        const refund = event.data.object as Stripe.Refund;
        const refundType = refund.metadata?.refund_type;
        const metadataBookingId = refund.metadata?.booking_id;

        let bookingId: string | null = metadataBookingId || null;

        // Fallback if metadata is missing (e.g., manual refunds in Stripe dashboard).
        if (!bookingId && refund.payment_intent) {
          const snapshot = await adminDb
            .collection('bookings')
            .where('stripe_payment_intent_id', '==', refund.payment_intent.toString())
            .limit(1)
            .get();
          bookingId = snapshot.empty ? null : snapshot.docs[0].id;
        }

        if (!bookingId) {
          console.log(`⚠️ Refund ${refund.id} received but no booking matched`);
          break;
        }

        const bookingRef = adminDb.collection('bookings').doc(bookingId);
        const bookingSnap = await bookingRef.get();
        if (!bookingSnap.exists) break;
        const existingBooking = bookingSnap.data() as Booking;

        if (refundType === 'deposit') {
          // Deposit refunds should not cancel a booking.
          const status = refund.status || 'unknown';
          await bookingRef.update({
            stripe_deposito_refund_id: refund.id,
            deposito_reembolso_estado: status,
            deposito_reembolso_error: (refund as any).failure_reason || null,
            deposito_reembolso_iniciado_en: existingBooking.deposito_reembolso_iniciado_en || FieldValue.serverTimestamp(),
            deposito_reembolsado: status === 'succeeded',
            deposito_reembolsado_en: status === 'succeeded' ? FieldValue.serverTimestamp() : null,
            updated_at: FieldValue.serverTimestamp(),
          });
          console.log(`✅ Deposit refund updated for booking ${bookingId} (${status})`);
          break;
        }

        // Non-deposit refunds: treat as a booking refund.
        if (existingBooking.reembolso_realizado && existingBooking.stripe_refund_id) {
          // Avoid overwriting if already recorded.
          console.log(`ℹ️ Booking ${bookingId} already has a refund recorded - skipping update`);
          break;
        }

        const status = refund.status || 'unknown';
        if (status !== 'succeeded') {
          console.log(`ℹ️ Refund ${refund.id} for booking ${bookingId} is ${status} - not marking booking refunded yet`);
          break;
        }

        await bookingRef.update({
          reembolso_realizado: true,
          reembolso_monto: (refund.amount || 0) / 100,
          reembolso_fecha: FieldValue.serverTimestamp(),
          reembolso_metodo: 'stripe',
          reembolso_motivo: refund.reason || 'Reembolso procesado automáticamente por Stripe',
          reembolso_referencia: refund.id,
          stripe_refund_id: refund.id,
          estado: 'cancelada',
          updated_at: FieldValue.serverTimestamp(),
        });

        try {
          await releaseBookingStockOnceAdmin(bookingId, 'stripe_refund_webhook');
        } catch (releaseError) {
          console.error('Error releasing stock after refund:', releaseError);
        }

        console.log(`✅ Booking ${bookingId} marked as refunded via refund.updated`);
        break;
      }

      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge;
        
        console.log(`🔄 Refund processed for payment intent: ${charge.payment_intent}`);
        console.log(`   Refund amount: ${charge.amount_refunded / 100} ${charge.currency.toUpperCase()}`);
        // Prefer refund.created/refund.updated to classify deposit vs rental refunds via metadata.
        // We keep this handler for logging only.
        break;
      }

      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        console.log(`💳 Payment intent succeeded: ${paymentIntent.id}`);
        break;
      }

      case 'payment_intent.payment_failed': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        console.error(`❌ Payment intent failed: ${paymentIntent.id}`);
        // Optionally notify admin or customer
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ received: true });

  } catch (err: any) {
    console.error('Webhook error:', err?.message || err);
    return NextResponse.json(
      { error: `Webhook Error: ${err.message}` },
      { status: 400 }
    );
  }
}
