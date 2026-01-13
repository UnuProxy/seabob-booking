'use client';

import { useState, useEffect } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { Booking } from '@/types';

export interface PartnerCommissionData {
  totalComisiones: number;
  totalPagado: number;
  pendiente: number;
  numReservas: number;
  reservasPendientes: Booking[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Hook to fetch commission data for a broker or agency
 */
export function usePartnerCommissions(
  partnerId: string | undefined,
  partnerType: 'broker' | 'agency' | undefined
): PartnerCommissionData {
  const [data, setData] = useState<Omit<PartnerCommissionData, 'loading' | 'error' | 'refetch'>>({
    totalComisiones: 0,
    totalPagado: 0,
    pendiente: 0,
    numReservas: 0,
    reservasPendientes: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCommissions = async () => {
    if (!partnerId || !partnerType) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Query bookings for this partner
      const fieldName = partnerType === 'broker' ? 'broker_id' : 'agency_id';
      const bookingsQuery = query(
        collection(db, 'bookings'),
        where(fieldName, '==', partnerId),
        where('estado', 'in', ['confirmada', 'completada'])
      );

      const snapshot = await getDocs(bookingsQuery);
      const bookings: Booking[] = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as Booking));

      // Calculate totals
      let totalComisiones = 0;
      let totalPagado = 0;
      const reservasPendientes: Booking[] = [];

      bookings.forEach(booking => {
        const comisionTotal = booking.comision_total || 0;
        const comisionPagada = booking.comision_pagada || 0;
        const pendiente = comisionTotal - comisionPagada;

        totalComisiones += comisionTotal;
        totalPagado += comisionPagada;

        if (pendiente > 0) {
          reservasPendientes.push(booking);
        }
      });

      setData({
        totalComisiones,
        totalPagado,
        pendiente: totalComisiones - totalPagado,
        numReservas: bookings.length,
        reservasPendientes: reservasPendientes.sort((a, b) => 
          new Date(b.creado_en as string).getTime() - new Date(a.creado_en as string).getTime()
        ),
      });
    } catch (err: any) {
      console.error('Error fetching commissions:', err);
      setError(err.message || 'Error al cargar comisiones');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCommissions();
  }, [partnerId, partnerType]);

  return {
    ...data,
    loading,
    error,
    refetch: fetchCommissions,
  };
}

/**
 * Calculate commission for a booking based on product commission rates
 */
export function calculateBookingCommissionAmount(
  items: Array<{
    precio_unitario?: number;
    cantidad: number;
    duracion: number;
    comision_percent?: number;
  }>,
  totalPrice: number
): number {
  // If items have individual commission rates, calculate per item
  const hasItemCommissions = items.some(item => item.comision_percent !== undefined);
  
  if (hasItemCommissions) {
    return items.reduce((total, item) => {
      const itemPrice = (item.precio_unitario || 0) * item.cantidad * item.duracion;
      const commissionRate = (item.comision_percent || 0) / 100;
      return total + (itemPrice * commissionRate);
    }, 0);
  }
  
  // Default: no commission if not specified
  return 0;
}

