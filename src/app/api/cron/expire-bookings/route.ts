import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase/admin';
import { Booking } from '@/types';
import { releaseBookingStockOnceAdmin } from '@/lib/bookingStockAdmin';

const CRON_SECRET = process.env.CRON_SECRET;

const isAuthorizedRequest = (request: NextRequest) => {
  const authHeader = request.headers.get('authorization');
  const tokenParam = request.nextUrl.searchParams.get('token');
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';

  if (CRON_SECRET) {
    return (
      isVercelCron ||
      authHeader === `Bearer ${CRON_SECRET}` ||
      tokenParam === CRON_SECRET
    );
  }

  // If no secret configured, only allow Vercel cron by default
  return isVercelCron;
};

const getDate = (timestamp: any): Date => {
  if (!timestamp) return new Date();
  if (timestamp && typeof timestamp.toDate === 'function') {
    return timestamp.toDate();
  }
  if (timestamp instanceof Date) return timestamp;
  const date = new Date(timestamp);
  return isNaN(date.getTime()) ? new Date() : date;
};

export async function GET(request: NextRequest) {
  if (!isAuthorizedRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const adminDb = getAdminDb();
    const now = new Date();
    // Fetch pending bookings and filter by expiration time
    const snapshot = await adminDb
      .collection('bookings')
      .where('estado', '==', 'pendiente')
      .get();

    let expiredCount = 0;
    let releasedStockCount = 0;

    for (const docSnap of snapshot.docs) {
      const booking = { id: docSnap.id, ...docSnap.data() } as Booking;

      if (!booking.expiracion) continue;
      if (booking.expirado || booking.estado === 'expirada') continue;
      if (booking.pago_realizado || booking.acuerdo_firmado) continue;

      const expirationDate = getDate(booking.expiracion);
      if (now <= expirationDate) continue;

      // Mark booking as expired and release stock
      try {
        await adminDb.collection('bookings').doc(booking.id).update({
          estado: 'expirada',
          expirado: true,
          updated_at: FieldValue.serverTimestamp(),
        });
        expiredCount += 1;

        await releaseBookingStockOnceAdmin(booking.id, 'system_cron');
        releasedStockCount += 1;
      } catch (err) {
        console.error('Error expiring booking:', booking.id, err);
      }
    }

    return NextResponse.json({
      success: true,
      expiredCount,
      releasedStockCount,
      checked: snapshot.size,
    });
  } catch (error) {
    console.error('Cron error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
