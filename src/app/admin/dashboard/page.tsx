'use client';

import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { useAuthStore } from '@/store/authStore';
import { Booking } from '@/types';

export default function DashboardPage() {
  const { user } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    todayBookings: 0,
    pendingCount: 0,
    pendingAmount: 0,
    netRevenue: 0,
    refundedAmount: 0,
    commissionPending: 0,
  });

  useEffect(() => {
    if (!user) return;

    const bookingsRef = collection(db, 'bookings');
    const bookingsQuery =
      user.rol === 'admin'
        ? bookingsRef
        : query(bookingsRef, where('creado_por', '==', user.id));

    const unsubscribe = onSnapshot(
      bookingsQuery,
      (snapshot) => {
        const bookings = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        })) as Booking[];

        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

        let todayBookings = 0;
        let pendingCount = 0;
        let pendingAmount = 0;
        let grossPaid = 0;
        let refundedAmount = 0;
        let commissionPending = 0;

        const getDate = (value: unknown): Date => {
          if (!value) return new Date();
          if (value instanceof Date) return value;
          if (
            typeof value === 'object' &&
            value !== null &&
            'toDate' in value &&
            typeof (value as { toDate?: () => Date }).toDate === 'function'
          ) {
            return (value as { toDate: () => Date }).toDate();
          }
          return new Date(value as string | number);
        };

        bookings.forEach((booking) => {
          const start = getDate(booking.fecha_inicio);
          const end = getDate(booking.fecha_fin);
          const isToday = end >= todayStart && start <= todayEnd;

          if (isToday) {
            todayBookings += 1;
          }

          if (!booking.pago_realizado && booking.estado === 'pendiente' && !booking.expirado) {
            pendingCount += 1;
            pendingAmount += booking.precio_total || 0;
          }

          if (booking.pago_realizado) {
            grossPaid += booking.precio_total || 0;
          }

          if (booking.reembolso_realizado) {
            refundedAmount += booking.reembolso_monto || 0;
          }

          if (booking.pago_realizado && !booking.reembolso_realizado) {
            const pending = (booking.comision_total || 0) - (booking.comision_pagada || 0);
            if (pending > 0) {
              commissionPending += pending;
            }
          }
        });

        const netRevenue = grossPaid - refundedAmount;

        setStats({
          todayBookings,
          pendingCount,
          pendingAmount,
          netRevenue,
          refundedAmount,
          commissionPending,
        });
        setLoading(false);
      },
      (error) => {
        console.error('Error fetching dashboard data:', error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user]);

  const formatCurrency = (amount: number) =>
    amount.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-800 mb-6">Dashboard</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 mb-8">
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <h3 className="text-gray-500 text-sm font-medium uppercase">Reservas de Hoy</h3>
          <p className="text-3xl font-bold text-gray-900 mt-2">{stats.todayBookings}</p>
        </div>
        
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <h3 className="text-gray-500 text-sm font-medium uppercase">Pendiente de Cobro</h3>
          <p className="text-3xl font-bold text-amber-600 mt-2">{formatCurrency(stats.pendingAmount)}</p>
          <p className="text-xs text-gray-500 mt-1">{stats.pendingCount} reservas sin pago</p>
        </div>
        
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <h3 className="text-gray-500 text-sm font-medium uppercase">Ingresos Netos</h3>
          <p className="text-3xl font-bold text-green-600 mt-2">{formatCurrency(stats.netRevenue)}</p>
          <p className="text-xs text-gray-500 mt-1">Reembolsos: {formatCurrency(stats.refundedAmount)}</p>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <h3 className="text-gray-500 text-sm font-medium uppercase">Comisiones Pendientes</h3>
          <p className="text-3xl font-bold text-blue-600 mt-2">{formatCurrency(stats.commissionPending)}</p>
          <p className="text-xs text-gray-500 mt-1">Solo reservas pagadas sin reembolso</p>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-xl font-semibold mb-4 text-gray-800">Bienvenido, {user?.nombre}</h2>
        <p className="text-gray-600">
          {loading
            ? 'Actualizando indicadores financieros...'
            : 'Selecciona una opción del menú lateral para comenzar a gestionar el inventario y las reservas.'}
        </p>
      </div>
    </div>
  );
}
