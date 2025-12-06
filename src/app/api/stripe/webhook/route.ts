import { NextRequest, NextResponse } from 'next/server';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';

export async function POST(request: NextRequest) {
  try {
    // Stripe not configured yet; short-circuit to avoid build failures.
    return NextResponse.json(
      { error: 'Stripe not configured' },
      { status: 503 }
    );
  } catch (err: any) {
    console.error('Webhook error:', err?.message || err);
    return NextResponse.json(
      { error: `Webhook Error: ${err.message}` },
      { status: 400 }
    );
  }
}
