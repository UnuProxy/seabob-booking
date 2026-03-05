import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminAuth, getAdminDb } from '@/lib/firebase/admin';

export const runtime = 'nodejs';

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2025-11-17.clover',
    })
  : null;

async function requireStaff(req: NextRequest) {
  const authHeader = req.headers.get('authorization') || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return { ok: false as const, status: 401, message: 'Missing Authorization header.' };
  }

  try {
    const decoded = await getAdminAuth().verifyIdToken(match[1]);
    const callerSnap = await getAdminDb().collection('users').doc(decoded.uid).get();
    const caller = callerSnap.exists ? callerSnap.data() : null;
    if (!caller || (caller.rol !== 'admin' && caller.rol !== 'colaborador')) {
      return { ok: false as const, status: 403, message: 'Forbidden.' };
    }
    return { ok: true as const, uid: decoded.uid };
  } catch {
    return { ok: false as const, status: 401, message: 'Invalid token.' };
  }
}

export async function POST(req: NextRequest) {
  const staff = await requireStaff(req);
  if (!staff.ok) {
    return NextResponse.json({ error: staff.message }, { status: staff.status });
  }

  if (!stripe) {
    return NextResponse.json(
      { error: 'Stripe not configured. Please set STRIPE_SECRET_KEY.' },
      { status: 503 }
    );
  }

  const body = (await req.json().catch(() => null)) as
    | { amount?: unknown; subject?: unknown }
    | null;

  const subject = typeof body?.subject === 'string' ? body.subject.trim() : '';
  const amountRaw =
    typeof body?.amount === 'number'
      ? body.amount
      : typeof body?.amount === 'string'
        ? Number(body.amount)
        : NaN;
  const amountCents = Number.isFinite(amountRaw) ? Math.round(amountRaw * 100) : 0;

  if (!subject || subject.length < 3) {
    return NextResponse.json({ error: 'Subject must contain at least 3 characters.' }, { status: 400 });
  }

  if (!Number.isFinite(amountRaw) || amountCents < 50) {
    return NextResponse.json({ error: 'Amount must be at least 0.50 EUR.' }, { status: 400 });
  }

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    req.headers.get('origin') ||
    (() => {
      const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
      if (!host) return null;
      const proto = req.headers.get('x-forwarded-proto') || 'https';
      return `${proto}://${host}`;
    })() ||
    'http://localhost:3000';

  const amountLabel = (amountCents / 100).toFixed(2);
  const subjectParam = encodeURIComponent(subject);
  const amountParam = encodeURIComponent(amountLabel);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'eur',
            product_data: {
              name: subject,
              description: 'Pago remoto',
            },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],
      metadata: {
        payment_type: 'manual_remote',
        created_by: staff.uid,
        subject,
      },
      payment_intent_data: {
        metadata: {
          payment_type: 'manual_remote',
          created_by: staff.uid,
          subject,
        },
      },
      locale: 'auto',
      success_url: `${appUrl}/payment/success?status=success&subject=${subjectParam}&amount=${amountParam}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/payment/success?status=cancelled&subject=${subjectParam}&amount=${amountParam}`,
    });

    await getAdminDb()
      .collection('remote_payment_links')
      .doc(session.id)
      .set(
        {
          checkout_session_id: session.id,
          payment_url: session.url || null,
          amount: amountCents / 100,
          currency: 'eur',
          subject,
          created_by: staff.uid,
          created_at: FieldValue.serverTimestamp(),
          status: 'pending',
        },
        { merge: true }
      );

    return NextResponse.json({
      sessionId: session.id,
      url: session.url,
      amount: amountCents / 100,
      subject,
    });
  } catch (error: unknown) {
    const message =
      typeof error === 'object' && error && 'message' in error && typeof (error as { message?: unknown }).message === 'string'
        ? (error as { message: string }).message
        : 'Could not generate payment link.';
    console.error('create-remote-payment-link failed:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

