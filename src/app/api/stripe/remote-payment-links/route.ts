import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminDb } from '@/lib/firebase/admin';

export const runtime = 'nodejs';

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
    return { ok: true as const, uid: decoded.uid, role: caller.rol as 'admin' | 'colaborador' };
  } catch {
    return { ok: false as const, status: 401, message: 'Invalid token.' };
  }
}

const toIso = (value: unknown) => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (
    typeof value === 'object' &&
    value !== null &&
    'toDate' in value &&
    typeof (value as { toDate?: () => Date }).toDate === 'function'
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  const parsed = new Date(value as string | number);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

export async function GET(req: NextRequest) {
  const staff = await requireStaff(req);
  if (!staff.ok) {
    return NextResponse.json({ error: staff.message }, { status: staff.status });
  }

  try {
    const snapshot = await getAdminDb()
      .collection('remote_payment_links')
      .orderBy('created_at', 'desc')
      .limit(200)
      .get();

    const links = snapshot.docs.map((docSnap) => {
      const data = docSnap.data();
      return {
        id: docSnap.id,
        checkout_session_id: data.checkout_session_id || docSnap.id,
        payment_url: data.payment_url || null,
        amount: typeof data.amount === 'number' ? data.amount : 0,
        amount_paid: typeof data.amount_paid === 'number' ? data.amount_paid : null,
        currency: data.currency || 'eur',
        subject: data.subject || '',
        status: data.status || 'pending',
        created_by: data.created_by || null,
        created_at: toIso(data.created_at),
        paid_at: toIso(data.paid_at),
      };
    });

    return NextResponse.json({ links });
  } catch (error) {
    console.error('remote-payment-links GET failed:', error);
    return NextResponse.json({ error: 'Could not load payment links.' }, { status: 500 });
  }
}
