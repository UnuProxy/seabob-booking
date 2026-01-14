import { NextRequest, NextResponse } from 'next/server';
import {
  collection,
  doc,
  getDocs,
  increment,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { Booking } from '@/types';

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
    const now = new Date();
    const bookingsRef = collection(db, 'bookings');

    // Fetch pending bookings and filter by expiration time
    const q = query(bookingsRef, where('estado', '==', 'pendiente'));
    const snapshot = await getDocs(q);

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
        await updateDoc(doc(db, 'bookings', booking.id), {
          estado: 'expirada',
          expirado: true,
          updated_at: serverTimestamp(),
        });
        expiredCount += 1;

        if (booking.items?.length) {
          const start = getDate(booking.fecha_inicio);
          const end = getDate(booking.fecha_fin);
          const days = [];
          for (
            let day = new Date(start);
            day <= end;
            day.setDate(day.getDate() + 1)
          ) {
            days.push(new Date(day));
          }

          const batch = writeBatch(db);
          days.forEach((day) => {
            const dateStr = day.toISOString().split('T')[0];
            booking.items.forEach((item) => {
              const stockRef = doc(db, 'daily_stock', `${dateStr}_${item.producto_id}`);
              batch.set(
                stockRef,
                {
                  fecha: dateStr,
                  producto_id: item.producto_id,
                  cantidad_reservada: increment(-1 * item.cantidad),
                  actualizado_por: 'system_cron',
                  timestamp: serverTimestamp(),
                },
                { merge: true }
              );
            });
          });
          await batch.commit();
          releasedStockCount += 1;
        }
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
