import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { format } from 'date-fns';
import { db } from '@/lib/firebase/config';
import type { Booking } from '@/types';

export function useDeliveryBookings() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const todayStr = useMemo(() => format(new Date(), 'yyyy-MM-dd'), []);

  useEffect(() => {
    const q = query(
      collection(db, 'bookings'),
      where('fecha_inicio', '>=', todayStr),
      orderBy('fecha_inicio', 'asc')
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as Booking[];
        setBookings(data);
        setLoading(false);
      },
      (error) => {
        console.error('Error fetching delivery bookings:', error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [todayStr]);

  return { bookings, loading, todayStr };
}
