import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase/admin';
import { getBookingClientTotals } from '@/lib/bookingClientPricing';
import { shouldAutoExpireBooking } from '@/lib/bookingExpiration';
import type { Booking, Product } from '@/types';

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

    const productIds = Array.from(
      new Set((booking.items || []).map((item) => item.producto_id).filter(Boolean))
    );
    const productsById: Record<string, Product> = {};

    await Promise.all(
      productIds.map(async (productId) => {
        const productSnap = await adminDb.collection('products').doc(productId).get();
        if (productSnap.exists) {
          productsById[productId] = {
            id: productSnap.id,
            ...productSnap.data(),
          } as Product;
        }
      })
    );

    const clientTotals = getBookingClientTotals(
      booking.items || [],
      (productId) => productsById[productId],
      booking.fecha_inicio,
      booking.fecha_fin
    );

    const computedTotal = Number(clientTotals.total || 0);
    const deliveryTotal = Number(booking.delivery_total || 0);
    const totalDue = computedTotal > 0 ? computedTotal + deliveryTotal : Number(booking.precio_total || 0);
    if (!Number.isFinite(totalDue) || totalDue <= 0) {
      return NextResponse.json({ error: 'Invalid booking amount' }, { status: 400 });
    }

    const rentalAmount = Math.round(totalDue * 100);

    const resolvedEmail = booking.cliente?.email?.trim();
    const resolvedName = booking.cliente?.nombre;
    const normalizedCustomerEmail =
      resolvedEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(resolvedEmail) ? resolvedEmail : null;
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
    const bookingPartnerId = booking.broker_id || booking.agency_id || '';
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
      shouldAutoExpireBooking(booking) && rawExpirationDate && !isNaN(rawExpirationDate.getTime())
        ? rawExpirationDate
        : null;

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

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'], // Card payment (Apple Pay & Google Pay show automatically when available)
      line_items: lineItems,
      ...(normalizedCustomerEmail ? { customer_email: normalizedCustomerEmail } : {}),
      metadata: {
        booking_id: bookingId,
        customer_name: resolvedName || '',
        booking_token: bookingToken,
      },
      payment_intent_data: {
        metadata: {
          booking_id: bookingId,
          partner_id: bookingPartnerId,
        },
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
