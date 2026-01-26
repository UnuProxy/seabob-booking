import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import type { Booking } from '@/types';
import { releaseBookingStockOnceAdmin } from '@/lib/bookingStockAdmin';

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2025-11-17.clover',
    })
  : null;

function toCents(amount: number) {
  return Math.round(amount * 100);
}

export async function POST(request: NextRequest) {
  try {
    if (!stripe) {
      return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 });
    }

    const { bookingId, amount, reason } = await request.json();

    if (!bookingId || typeof amount !== 'number') {
      return NextResponse.json(
        { error: 'Missing required fields: bookingId and amount' },
        { status: 400 }
      );
    }

    const bookingRef = adminDb.collection('bookings').doc(bookingId);
    const bookingSnap = await bookingRef.get();
    if (!bookingSnap.exists) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }

    const booking = bookingSnap.data() as Booking;
    if (booking.reembolso_realizado) {
      return NextResponse.json({ error: 'Booking already refunded' }, { status: 409 });
    }

    if (!booking.pago_realizado) {
      return NextResponse.json(
        { error: 'Booking is not marked as paid' },
        { status: 409 }
      );
    }

    let paymentIntentId = booking.stripe_payment_intent_id || '';
    if (!paymentIntentId && booking.stripe_checkout_session_id) {
      const session = await stripe.checkout.sessions.retrieve(
        booking.stripe_checkout_session_id
      );
      paymentIntentId =
        typeof session.payment_intent === 'string'
          ? session.payment_intent
          : session.payment_intent?.id || '';
    }

    if (!paymentIntentId) {
      return NextResponse.json(
        { error: 'Stripe payment intent not available for this booking' },
        { status: 409 }
      );
    }

    const refundAmount = Number(amount);
    if (!Number.isFinite(refundAmount) || refundAmount <= 0 || refundAmount > booking.precio_total) {
      return NextResponse.json({ error: 'Invalid refund amount' }, { status: 400 });
    }

    const idempotencyKey = `refund_${bookingId}_${toCents(refundAmount)}`;
    const refund = await stripe.refunds.create(
      {
        payment_intent: paymentIntentId,
        amount: toCents(refundAmount),
        reason: reason ? 'requested_by_customer' : undefined,
        metadata: {
          booking_id: bookingId,
        },
      },
      { idempotencyKey }
    );

    await bookingRef.update({
      reembolso_realizado: true,
      reembolso_monto: refundAmount,
      reembolso_fecha: FieldValue.serverTimestamp(),
      reembolso_metodo: 'stripe',
      reembolso_motivo: reason || 'Reembolso procesado en Stripe',
      reembolso_referencia: refund.id,
      stripe_refund_id: refund.id,
      ...(paymentIntentId && paymentIntentId !== booking.stripe_payment_intent_id
        ? { stripe_payment_intent_id: paymentIntentId }
        : {}),
      estado: 'cancelada',
      updated_at: FieldValue.serverTimestamp(),
    });

    try {
      await releaseBookingStockOnceAdmin(bookingId, 'stripe_refund');
    } catch (releaseError) {
      console.error('Error releasing stock after refund:', releaseError);
    }

    return NextResponse.json({ refunded: true, refundId: refund.id });
  } catch (error: any) {
    console.error('Stripe refund error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create Stripe refund' },
      { status: 500 }
    );
  }
}
