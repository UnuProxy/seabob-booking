import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase/admin';
import type { Booking } from '@/types';

// Initialize Stripe only if keys are present
const stripe = process.env.STRIPE_SECRET_KEY 
  ? new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2025-11-17.clover',
    })
  : null;

export async function POST(request: NextRequest) {
  try {
    // Check if Stripe is configured
    if (!stripe) {
      return NextResponse.json(
        { error: 'Stripe not configured. Please set STRIPE_SECRET_KEY environment variable.' },
        { status: 503 }
      );
    }

    const { bookingId, token } = await request.json();

    if (!bookingId) {
      return NextResponse.json(
        { error: 'Missing required fields: bookingId' },
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
      return NextResponse.json({ error: 'Booking already paid' }, { status: 409 });
    }

    if (booking.expirado || booking.estado === 'expirada') {
      return NextResponse.json({ error: 'Booking expired' }, { status: 409 });
    }

    const depositTotal = Number(booking.deposito_total || 0);
    const totalDue = (booking.precio_total || 0) + depositTotal;
    if (!Number.isFinite(totalDue) || totalDue <= 0) {
      return NextResponse.json({ error: 'Invalid booking amount' }, { status: 400 });
    }

    const rentalAmount = Math.round((booking.precio_total || 0) * 100);
    const depositAmount = Math.round(depositTotal * 100);

    const resolvedEmail = booking.cliente?.email;
    const resolvedName = booking.cliente?.nombre;
    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      request.headers.get('origin') ||
      (() => {
        const host =
          request.headers.get('x-forwarded-host') || request.headers.get('host');
        if (!host) return null;
        const proto = request.headers.get('x-forwarded-proto') || 'https';
        return `${proto}://${host}`;
      })() ||
      'http://localhost:3000';
    const bookingToken = booking.token_acceso || token || '';
    const tokenParam = bookingToken ? `?t=${encodeURIComponent(bookingToken)}` : '';
    const paymentParam = bookingToken ? '&' : '?';
    const expirationValue = booking.expiracion as unknown;
    const rawExpirationDate =
      expirationValue && typeof (expirationValue as { toDate?: () => Date }).toDate === 'function'
        ? (expirationValue as { toDate: () => Date }).toDate()
        : expirationValue instanceof Date
          ? expirationValue
          : expirationValue
            ? new Date(expirationValue as string)
            : null;
    const expirationDate =
      rawExpirationDate && !isNaN(rawExpirationDate.getTime()) ? rawExpirationDate : null;

    // Create Checkout Session
    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
      {
        price_data: {
          currency: 'eur', // Force EUR only (no GBP or other currencies)
          product_data: {
            name: `Reserva SeaBob #${bookingId}`,
            description: 'Alquiler de SeaBob',
          },
          unit_amount: rentalAmount, // Convert to cents
        },
        quantity: 1,
      },
    ];

    if (depositAmount > 0) {
      lineItems.push({
        price_data: {
          currency: 'eur',
          product_data: {
            name: 'Depósito reembolsable',
            description: 'Se devuelve dentro de 24h si no hay incidencias.',
          },
          unit_amount: depositAmount,
        },
        quantity: 1,
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'], // Card payment (Apple Pay & Google Pay show automatically when available)
      line_items: lineItems,
      customer_email: resolvedEmail,
      metadata: {
        booking_id: bookingId,
        customer_name: resolvedName || '',
        booking_token: bookingToken,
        deposit_amount: depositAmount > 0 ? depositAmount.toString() : '0',
      },
      locale: 'auto', // Auto-detect locale (will show EUR properly)
      ...(expirationDate
        ? { expires_at: Math.max(Math.floor(expirationDate.getTime() / 1000), Math.floor(Date.now() / 1000) + 60) }
        : {}),
      success_url: `${appUrl}/contract/${bookingId}${tokenParam}${paymentParam}payment=success`,
      cancel_url: `${appUrl}/contract/${bookingId}${tokenParam}${paymentParam}payment=cancelled`,
      // Enable automatic tax calculation if configured
      // automatic_tax: { enabled: true },
    });

    if (session.url) {
      await bookingRef.update({
        stripe_checkout_session_id: session.id,
        stripe_payment_link: session.url,
        updated_at: FieldValue.serverTimestamp(),
      });
    }

    return NextResponse.json({
      sessionId: session.id,
      url: session.url,
    });

  } catch (error: any) {
    console.error('Stripe checkout error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create payment link' },
      { status: 500 }
    );
  }
}
