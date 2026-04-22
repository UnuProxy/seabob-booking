import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminAuth, getAdminDb } from '@/lib/firebase/admin';
import type { Booking, User } from '@/types';

export const runtime = 'nodejs';

async function requireAuthorizedCaller(req: NextRequest) {
  const authHeader = req.headers.get('authorization') || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return { ok: false as const, status: 401, message: 'Missing Authorization header.' };
  }

  try {
    const decoded = await getAdminAuth().verifyIdToken(match[1]);
    const callerSnap = await getAdminDb().collection('users').doc(decoded.uid).get();
    const caller = callerSnap.exists ? ({ id: callerSnap.id, ...callerSnap.data() } as User) : null;

    if (!caller || !caller.activo) {
      return { ok: false as const, status: 403, message: 'Forbidden.' };
    }

    if (!['admin', 'colaborador', 'broker', 'agency'].includes(caller.rol)) {
      return { ok: false as const, status: 403, message: 'Forbidden.' };
    }

    return { ok: true as const, caller };
  } catch {
    return { ok: false as const, status: 401, message: 'Invalid token.' };
  }
}

function canManageBookingAccess(caller: User, booking: Booking) {
  if (caller.rol === 'admin' || caller.rol === 'colaborador') {
    return true;
  }

  return (
    booking.broker_id === caller.id ||
    booking.agency_id === caller.id ||
    booking.creado_por === caller.id
  );
}

export async function POST(req: NextRequest) {
  const authResult = await requireAuthorizedCaller(req);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.message }, { status: authResult.status });
  }

  const body = (await req.json().catch(() => null)) as { bookingId?: unknown } | null;
  const bookingId = typeof body?.bookingId === 'string' ? body.bookingId.trim() : '';

  if (!bookingId) {
    return NextResponse.json({ error: 'Missing bookingId.' }, { status: 400 });
  }

  const adminDb = getAdminDb();
  const bookingRef = adminDb.collection('bookings').doc(bookingId);
  const bookingSnap = await bookingRef.get();

  if (!bookingSnap.exists) {
    return NextResponse.json({ error: 'Booking not found.' }, { status: 404 });
  }

  const booking = { id: bookingSnap.id, ...bookingSnap.data() } as Booking;
  if (!canManageBookingAccess(authResult.caller, booking)) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  }

  const token = booking.token_acceso || randomBytes(24).toString('hex');

  if (!booking.token_acceso) {
    await bookingRef.update({
      token_acceso: token,
      updated_at: FieldValue.serverTimestamp(),
    });
  }

  return NextResponse.json({
    bookingId,
    token,
    generated: !booking.token_acceso,
  });
}
