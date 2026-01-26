import { NextRequest, NextResponse } from 'next/server';
import { FieldPath, FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
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

        const expectedAmount = Math.round((bookingData.precio_total || 0) * 100);
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

      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge;
        
        console.log(`🔄 Refund processed for payment intent: ${charge.payment_intent}`);
        console.log(`   Refund amount: ${charge.amount_refunded / 100} ${charge.currency.toUpperCase()}`);
        
        // Find booking by payment intent ID and auto-update refund
        if (charge.payment_intent) {
          try {
            const snapshot = await adminDb
              .collection('bookings')
              .where('stripe_payment_intent_id', '==', charge.payment_intent.toString())
              .get();
            
            if (!snapshot.empty) {
              const bookingDoc = snapshot.docs[0];
              const bookingRef = adminDb.collection('bookings').doc(bookingDoc.id);
              const existingBooking = bookingDoc.data() as Booking;

              if (existingBooking.reembolso_realizado) {
                console.log(`ℹ️ Booking ${bookingDoc.id} already refunded - skipping update`);
                break;
              }
              
              await bookingRef.update({
                reembolso_realizado: true,
                reembolso_monto: charge.amount_refunded / 100,
                reembolso_fecha: FieldValue.serverTimestamp(),
                reembolso_metodo: 'stripe',
                reembolso_motivo: 'Reembolso procesado automáticamente por Stripe',
                reembolso_referencia: charge.id,
                stripe_refund_id: charge.id,
                estado: 'cancelada',
                updated_at: FieldValue.serverTimestamp(),
              });
              
              try {
                await releaseBookingStockOnceAdmin(bookingDoc.id, 'stripe_webhook');
              } catch (releaseError) {
                console.error('Error releasing stock after refund:', releaseError);
              }
              
              console.log(`✅ Booking ${bookingDoc.id} auto-updated with refund`);
            } else {
              console.log(`⚠️ No booking found with payment_intent: ${charge.payment_intent}`);
            }
          } catch (error) {
            console.error('Error auto-updating refund:', error);
          }
        }
        
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
