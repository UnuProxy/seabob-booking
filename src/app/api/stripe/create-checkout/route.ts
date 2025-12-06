import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    // Stripe not configured yet; short-circuit to avoid build failures.
    return NextResponse.json(
      { error: 'Stripe not configured' },
      { status: 503 }
    );
  } catch (error: any) {
    console.error('Stripe error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create payment link' },
      { status: 500 }
    );
  }
}
