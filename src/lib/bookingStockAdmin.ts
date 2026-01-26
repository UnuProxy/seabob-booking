import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { eachDayOfInterval, format } from 'date-fns';
import { getAdminDb } from '@/lib/firebase/admin';
import type { Booking } from '@/types';

const getDate = (value: any): Date => {
  if (!value) return new Date();
  if (value instanceof Date) return value;
  if (value instanceof Timestamp) return value.toDate();
  if (value?.toDate) return value.toDate();
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? new Date() : parsed;
};

export async function releaseBookingStockOnceAdmin(bookingId: string, actor = 'system') {
  const adminDb = getAdminDb();
  await adminDb.runTransaction(async (tx) => {
    const bookingRef = adminDb.collection('bookings').doc(bookingId);
    const bookingSnap = await tx.get(bookingRef);

    if (!bookingSnap.exists) {
      throw new Error('Booking not found');
    }

    const booking = bookingSnap.data() as Booking;
    if (booking.stock_released) {
      return;
    }

    if (booking.items?.length) {
      const start = getDate(booking.fecha_inicio);
      const end = getDate(booking.fecha_fin);
      const days = eachDayOfInterval({ start, end });

      for (const day of days) {
        const dateStr = format(day, 'yyyy-MM-dd');
        for (const item of booking.items) {
          if (!item.producto_id || !item.cantidad) continue;
          const stockRef = adminDb.collection('daily_stock').doc(`${dateStr}_${item.producto_id}`);
          tx.set(
            stockRef,
            {
              fecha: dateStr,
              producto_id: item.producto_id,
              cantidad_reservada: FieldValue.increment(-1 * item.cantidad),
              actualizado_por: actor,
              timestamp: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        }
      }
    }

    tx.update(bookingRef, {
      stock_released: true,
      stock_released_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    });
  });
}
