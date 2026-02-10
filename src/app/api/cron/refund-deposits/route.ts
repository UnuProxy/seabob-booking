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

const CRON_SECRET = process.env.CRON_SECRET;

const isAuthorizedRequest = (request: NextRequest) => {
  const authHeader = request.headers.get('authorization');
  const tokenParam = request.nextUrl.searchParams.get('token');
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';

  if (CRON_SECRET) {
    return (
      isVercelCron ||
      authHeader === `Bearer ${CRON_SECRET}` ||
      tokenParam === CRON_SECRET
    );
  }

  return isVercelCron;
};

const getDateValue = (value: unknown): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'object' && value !== null && 'toDate' in value) {
    const maybe = value as { toDate?: () => Date };
    if (typeof maybe.toDate === 'function') return maybe.toDate();
  }
  const parsed = new Date(value as string | number);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const isRefundReady = (booking: Booking, now: Date) => {
  if (booking.deposito_auto_reembolso_pausado) return false;
  if (booking.deposito_reembolso_estado === 'pending' || booking.stripe_deposito_refund_id) return false;

  const scheduledAt = getDateValue(booking.deposito_auto_reembolso_en);
  if (scheduledAt) return scheduledAt.getTime() <= now.getTime();

  const paidAt = getDateValue(booking.pago_realizado_en);
  if (!paidAt) return false;
  const dueAt = new Date(paidAt.getTime() + 24 * 60 * 60 * 1000);
  return dueAt.getTime() <= now.getTime();
};

export async function GET(request: NextRequest) {
  if (!isAuthorizedRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!stripe) {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 });
  }

  try {
    const adminDb = getAdminDb();
    const now = new Date();

    const snapshot = await adminDb
      .collection('bookings')
      .where('deposito_reembolsado', '==', false)
      .get();

    let checked = 0;
    let refunded = 0;
    let skipped = 0;

    for (const docSnap of snapshot.docs) {
      const booking = { id: docSnap.id, ...docSnap.data() } as Booking;
      checked += 1;

      const depositTotal = Number(booking.deposito_total || 0);
      if (depositTotal <= 0) {
        skipped += 1;
        continue;
      }
      if (!booking.pago_realizado || booking.pago_metodo !== 'stripe') {
        skipped += 1;
        continue;
      }
      if (!booking.stripe_payment_intent_id) {
        skipped += 1;
        continue;
      }
      if (!isRefundReady(booking, now)) {
        skipped += 1;
        continue;
      }

      const amount = Math.round(depositTotal * 100);
      if (amount <= 0) {
        skipped += 1;
        continue;
      }

      try {
        const idempotencyKey = `deposit_refund_${booking.id}_${amount}`;
        const refund = await stripe.refunds.create(
          {
            payment_intent: booking.stripe_payment_intent_id,
            amount,
            reason: 'requested_by_customer',
            metadata: {
              booking_id: booking.id,
              refund_type: 'deposit',
            },
          },
          { idempotencyKey }
        );

        await adminDb.collection('bookings').doc(booking.id).update({
          deposito_reembolsado: refund.status === 'succeeded',
          deposito_reembolsado_en: refund.status === 'succeeded' ? FieldValue.serverTimestamp() : null,
          deposito_reembolso_iniciado_en: FieldValue.serverTimestamp(),
          deposito_reembolso_estado: refund.status || 'unknown',
          deposito_reembolso_error: (refund as unknown as { failure_reason?: string }).failure_reason || null,
          stripe_deposito_refund_id: refund.id,
          updated_at: FieldValue.serverTimestamp(),
        });

        refunded += 1;
      } catch (err) {
        console.error('Deposit refund failed for booking', booking.id, err);
      }
    }

    return NextResponse.json({
      success: true,
      checked,
      refunded,
      skipped,
    });
  } catch (error) {
    console.error('Cron refund error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
