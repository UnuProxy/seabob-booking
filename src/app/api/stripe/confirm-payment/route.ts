import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { FieldPath, FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase/admin';
import { calculateCommissionTotal, calculateCommissionTotalWithProducts } from '@/lib/commission';
import type { Booking, Product } from '@/types';

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2025-11-17.clover',
    })
  : null;

export async function POST(request: NextRequest) {
  try {
    if (!stripe) {
      return NextResponse.json(
        { error: 'Stripe not configured' },
        { status: 503 }
      );
    }

    const { bookingId, token } = await request.json();
    if (!bookingId) {
      return NextResponse.json(
        { error: 'Missing bookingId' },
        { status: 400 }
      );
    }

    const adminDb = getAdminDb();
    const bookingRef = adminDb.collection('bookings').doc(bookingId);
    const bookingSnap = await bookingRef.get();
    if (!bookingSnap.exists) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }

    const booking = bookingSnap.data() as Booking;
    if (booking.token_acceso && booking.token_acceso !== token) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 403 });
    }

    if (booking.pago_realizado) {
      return NextResponse.json({ updated: false, alreadyPaid: true });
    }

    if (!booking.stripe_checkout_session_id) {
      return NextResponse.json(
        { error: 'Missing checkout session' },
        { status: 409 }
      );
    }

    const session = await stripe.checkout.sessions.retrieve(
      booking.stripe_checkout_session_id
    );

    if (session.payment_status !== 'paid') {
      return NextResponse.json({ updated: false, paid: false });
    }

    const expectedAmount = Math.round(((booking.precio_total || 0) + (booking.deposito_total || 0)) * 100);
    if (!Number.isFinite(expectedAmount) || expectedAmount <= 0) {
      return NextResponse.json({ error: 'Invalid booking amount' }, { status: 409 });
    }

    if (typeof session.amount_total === 'number' && session.amount_total !== expectedAmount) {
      return NextResponse.json({ error: 'Amount mismatch' }, { status: 409 });
    }

    if (session.currency && session.currency.toLowerCase() !== 'eur') {
      return NextResponse.json({ error: 'Currency mismatch' }, { status: 409 });
    }

    if (session.metadata?.booking_id && session.metadata.booking_id !== bookingId) {
      return NextResponse.json({ error: 'Booking mismatch' }, { status: 409 });
    }

    const paymentIntentId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id;

    const hasPartner = Boolean(booking.broker_id || booking.agency_id);
    let computedCommission = hasPartner ? calculateCommissionTotal(booking) : 0;

    if (hasPartner && computedCommission <= 0 && booking.items?.length) {
      const productIds = Array.from(
        new Set(booking.items.map((item) => item.producto_id).filter(Boolean))
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

      computedCommission = calculateCommissionTotalWithProducts(booking, productsById);
    }

    await bookingRef.update({
      pago_realizado: true,
      pago_realizado_en: FieldValue.serverTimestamp(),
      pago_metodo: 'stripe',
      pago_referencia: paymentIntentId || session.id,
      stripe_payment_intent_id: paymentIntentId,
      stripe_checkout_session_id: session.id,
      estado: 'confirmada',
      confirmado_en: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
      ...(hasPartner && computedCommission > 0 && !(booking.comision_total && booking.comision_total > 0)
        ? { comision_total: computedCommission, comision_pagada: booking.comision_pagada || 0 }
        : {}),
    });

    return NextResponse.json({ updated: true });
  } catch (error: any) {
    console.error('Error confirming Stripe payment:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to confirm payment' },
      { status: 500 }
    );
  }
}
