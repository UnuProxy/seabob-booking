import { doc, increment, runTransaction, serverTimestamp } from 'firebase/firestore';
import { eachDayOfInterval, format } from 'date-fns';
import { db } from '@/lib/firebase/config';
import type { Booking } from '@/types';

const getDate = (timestamp: any): Date => {
  if (!timestamp) return new Date();
  if (timestamp && typeof timestamp.toDate === 'function') {
    return timestamp.toDate();
  }
  if (timestamp instanceof Date) return timestamp;
  const date = new Date(timestamp);
  return isNaN(date.getTime()) ? new Date() : date;
};

export async function releaseBookingStockOnce(bookingId: string, actor = 'system') {
  await runTransaction(db, async (tx) => {
    const bookingRef = doc(db, 'bookings', bookingId);
    const bookingSnap = await tx.get(bookingRef);

    if (!bookingSnap.exists()) {
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
          const stockRef = doc(db, 'daily_stock', `${dateStr}_${item.producto_id}`);
          tx.set(
            stockRef,
            {
              fecha: dateStr,
              producto_id: item.producto_id,
              cantidad_reservada: increment(-1 * item.cantidad),
              actualizado_por: actor,
              timestamp: serverTimestamp(),
            },
            { merge: true }
          );
        }
      }
    }

    tx.update(bookingRef, {
      stock_released: true,
      stock_released_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    });
  });
}
