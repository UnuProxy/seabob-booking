import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

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

    const {
      bookingId,
      amount,
      currency = 'eur',
      customerEmail,
      customerName,
      clientEmail,
      clientName,
      expiresAt,
      token,
    } = await request.json();

    if (!bookingId || !amount) {
      return NextResponse.json(
        { error: 'Missing required fields: bookingId and amount' },
        { status: 400 }
      );
    }

    const resolvedEmail = customerEmail || clientEmail;
    const resolvedName = customerName || clientName;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const tokenParam = token ? `?t=${encodeURIComponent(token)}` : '';
    const paymentParam = token ? '&' : '?';

    // Create Checkout Session
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'], // Card payment (Apple Pay & Google Pay show automatically when available)
      line_items: [
        {
          price_data: {
            currency: 'eur', // Force EUR only (no GBP or other currencies)
            product_data: {
              name: `Reserva SeaBob #${bookingId}`,
              description: 'Alquiler de SeaBob',
            },
            unit_amount: Math.round(amount * 100), // Convert to cents
          },
          quantity: 1,
        },
      ],
      customer_email: resolvedEmail,
      metadata: {
        booking_id: bookingId,
        customer_name: resolvedName || '',
        booking_token: token || '',
      },
      locale: 'auto', // Auto-detect locale (will show EUR properly)
      ...(expiresAt && typeof expiresAt === 'number'
        ? { expires_at: Math.max(expiresAt, Math.floor(Date.now() / 1000) + 60) }
        : {}),
      success_url: `${appUrl}/contract/${bookingId}${tokenParam}${paymentParam}payment=success`,
      cancel_url: `${appUrl}/contract/${bookingId}${tokenParam}${paymentParam}payment=cancelled`,
      // Enable automatic tax calculation if configured
      // automatic_tax: { enabled: true },
    });

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
