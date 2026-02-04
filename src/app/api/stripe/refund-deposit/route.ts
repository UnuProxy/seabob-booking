import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase/admin';
import type { Booking } from '@/types';

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

    const adminDb = getAdminDb();
    const { bookingId } = await request.json();

    if (!bookingId) {
      return NextResponse.json({ error: 'Missing bookingId' }, { status: 400 });
    }

    const bookingRef = adminDb.collection('bookings').doc(bookingId);
    const bookingSnap = await bookingRef.get();
    if (!bookingSnap.exists) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }

    const booking = bookingSnap.data() as Booking;
    const depositTotal = Number(booking.deposito_total || 0);

    if (depositTotal <= 0) {
      return NextResponse.json({ error: 'No deposit to refund' }, { status: 409 });
    }
    if (booking.deposito_reembolsado) {
      return NextResponse.json({ error: 'Deposit already refunded' }, { status: 409 });
    }
    if (!booking.pago_realizado || booking.pago_metodo !== 'stripe') {
      return NextResponse.json({ error: 'Deposit refund requires Stripe payment' }, { status: 409 });
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

    const refundAmount = toCents(depositTotal);
    const idempotencyKey = `deposit_refund_${bookingId}_${refundAmount}`;

    const refund = await stripe.refunds.create(
      {
        payment_intent: paymentIntentId,
        amount: refundAmount,
        reason: 'requested_by_customer',
        metadata: {
          booking_id: bookingId,
          refund_type: 'deposit',
        },
      },
      { idempotencyKey }
    );

    await bookingRef.update({
      deposito_reembolsado: true,
      deposito_reembolsado_en: FieldValue.serverTimestamp(),
      stripe_deposito_refund_id: refund.id,
      updated_at: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ refunded: true, refundId: refund.id });
  } catch (error: any) {
    console.error('Stripe deposit refund error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to refund deposit' },
      { status: 500 }
    );
  }
}
