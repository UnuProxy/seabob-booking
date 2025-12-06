import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

let stripeClient: Stripe | null = null;

const getStripe = () => {
  if (stripeClient) return stripeClient;
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) throw new Error('STRIPE_SECRET_KEY is missing');
  stripeClient = new Stripe(secret);
  return stripeClient;
};

export async function POST(request: NextRequest) {
  try {
    const { bookingId, amount, currency = 'eur', clientEmail, clientName, bookingRef } = await request.json();

    if (!bookingId || !amount) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Create Stripe Checkout Session
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: currency.toLowerCase(),
            product_data: {
              name: `Reserva ${bookingRef || bookingId}`,
              description: `Pago de alquiler SeaBob - Reserva ${bookingRef || bookingId}`,
            },
            unit_amount: Math.round(amount * 100), // Convert to cents
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${request.nextUrl.origin}/contract/${bookingId}?t=${request.nextUrl.searchParams.get('token')}&payment=success`,
      cancel_url: `${request.nextUrl.origin}/contract/${bookingId}?t=${request.nextUrl.searchParams.get('token')}&payment=cancelled`,
      customer_email: clientEmail,
      metadata: {
        booking_id: bookingId,
        booking_ref: bookingRef || bookingId,
      },
    });

    return NextResponse.json({
      checkout_url: session.url,
      session_id: session.id,
    });
  } catch (error: any) {
    console.error('Stripe error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create payment link' },
      { status: 500 }
    );
  }
}
