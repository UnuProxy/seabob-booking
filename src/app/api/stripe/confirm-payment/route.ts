import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';

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

    const bookingRef = doc(db, 'bookings', bookingId);
    const bookingSnap = await getDoc(bookingRef);
    if (!bookingSnap.exists()) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }

    const booking = bookingSnap.data() as Record<string, any>;
    if (booking.token_acceso && token && booking.token_acceso !== token) {
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

    const paymentIntentId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id;

    await updateDoc(bookingRef, {
      pago_realizado: true,
      pago_realizado_en: serverTimestamp(),
      pago_metodo: 'stripe',
      pago_referencia: paymentIntentId || session.id,
      stripe_payment_intent_id: paymentIntentId,
      stripe_checkout_session_id: session.id,
      estado: 'confirmada',
      confirmado_en: serverTimestamp(),
      updated_at: serverTimestamp(),
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
