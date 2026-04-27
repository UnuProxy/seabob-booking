import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase/admin';
import type { Booking } from '@/types';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const bookingId = typeof id === 'string' ? id.trim() : '';
  const token = request.nextUrl.searchParams.get('t')?.trim() || '';

  if (!bookingId || !token) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  const bookingSnap = await getAdminDb().collection('bookings').doc(bookingId).get();
  if (!bookingSnap.exists) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  const booking = { id: bookingSnap.id, ...bookingSnap.data() } as Booking;
  if (!booking.token_acceso || booking.token_acceso !== token) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  if (booking.pago_realizado) {
    return NextResponse.redirect(new URL(`/contract/${bookingId}?t=${encodeURIComponent(token)}`, request.url));
  }

  if (booking.stripe_payment_link) {
    return NextResponse.redirect(booking.stripe_payment_link);
  }

  return NextResponse.redirect(new URL(`/contract/${bookingId}?t=${encodeURIComponent(token)}`, request.url));
}
