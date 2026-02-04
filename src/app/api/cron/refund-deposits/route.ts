import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { FieldValue } from 'firebase-admin/firestore';
import { format, subDays, parseISO } from 'date-fns';
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

const isRefundReady = (booking: Booking, cutoffDate: string) => {
  if (!booking.fecha_fin) return false;
  const endDate = parseISO(booking.fecha_fin);
  if (Number.isNaN(endDate.getTime())) return false;
  return booking.fecha_fin <= cutoffDate;
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
    const cutoffDate = format(subDays(new Date(), 1), 'yyyy-MM-dd');

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
      if (booking.reembolso_realizado) {
        skipped += 1;
        continue;
      }
      if (!booking.stripe_payment_intent_id) {
        skipped += 1;
        continue;
      }
      if (!isRefundReady(booking, cutoffDate)) {
        skipped += 1;
        continue;
      }

      const amount = Math.round(depositTotal * 100);
      if (amount <= 0) {
        skipped += 1;
        continue;
      }

      try {
        const refund = await stripe.refunds.create({
          payment_intent: booking.stripe_payment_intent_id,
          amount,
          reason: 'requested_by_customer',
          metadata: {
            booking_id: booking.id,
            refund_type: 'deposit',
          },
        });

        await adminDb.collection('bookings').doc(booking.id).update({
          deposito_reembolsado: true,
          deposito_reembolsado_en: FieldValue.serverTimestamp(),
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
      cutoffDate,
    });
  } catch (error) {
    console.error('Cron refund error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
