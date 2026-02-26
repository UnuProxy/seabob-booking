'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import type { Booking, User } from '@/types';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import clsx from 'clsx';
import { Activity, AlertTriangle, Clock3, PlugZap } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';

const ONLINE_WINDOW_MINUTES = 10;

type PartnerMetrics = {
  partner: User;
  totalBookings: number;
  paidBookings: number;
  pendingBookings: number;
  failedPaymentAttempts: number;
  failedBookings: number;
  lastBookingAt: Date | null;
  lastPaymentFailedAt: Date | null;
  isConnected: boolean;
};

const getDateValue = (value: unknown): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'object' && value !== null && 'toDate' in value) {
    const maybe = value as { toDate?: () => Date };
    if (typeof maybe.toDate === 'function') return maybe.toDate();
  }
  const parsed = new Date(value as string | number);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatDateTime = (value: unknown) => {
  const date = getDateValue(value);
  if (!date) return 'Sin dato';
  return format(date, 'dd MMM yyyy, HH:mm', { locale: es });
};

export default function ActivityPage() {
  const { user } = useAuthStore();
  const [partners, setPartners] = useState<User[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [bookingsLoading, setBookingsLoading] = useState(true);
  const [nowTs, setNowTs] = useState(0);

  useEffect(() => {
    const updateNow = () => setNowTs(Date.now());
    updateNow();
    const intervalId = setInterval(updateNow, 60 * 1000);
    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'users'), where('rol', 'in', ['broker', 'agency']));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const users = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })) as User[];
        users.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es', { sensitivity: 'base' }));
        setPartners(users);
        setUsersLoading(false);
      },
      (error) => {
        console.error('Error loading partners activity:', error);
        setUsersLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, 'bookings'),
      (snapshot) => {
        const data = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })) as Booking[];
        setBookings(data);
        setBookingsLoading(false);
      },
      (error) => {
        console.error('Error loading bookings activity:', error);
        setBookingsLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  const analytics = useMemo(() => {
    const onlineThreshold = nowTs - ONLINE_WINDOW_MINUTES * 60 * 1000;

    const partnerMap = new Map<string, PartnerMetrics>();
    partners.forEach((partner) => {
      const lastSeen = getDateValue(partner.last_seen_at);
      const isConnected = Boolean(lastSeen && lastSeen.getTime() >= onlineThreshold);
      partnerMap.set(partner.id, {
        partner,
        totalBookings: 0,
        paidBookings: 0,
        pendingBookings: 0,
        failedPaymentAttempts: 0,
        failedBookings: 0,
        lastBookingAt: null,
        lastPaymentFailedAt: null,
        isConnected,
      });
    });

    const failedRows: Array<{
      bookingId: string;
      numeroReserva: string;
      partnerName: string;
      customerName: string;
      amount: number;
      attempts: number;
      failedAt: Date | null;
      code: string;
      message: string;
      estado: string;
    }> = [];
    const partnerBookingRows: Array<{
      bookingId: string;
      numeroReserva: string;
      partnerName: string;
      customerName: string;
      amount: number;
      estado: string;
      createdAt: Date | null;
      pagoRealizado: boolean;
    }> = [];

    bookings.forEach((booking) => {
      const partnerId = booking.broker_id || booking.agency_id;
      if (!partnerId) return;

      const metrics = partnerMap.get(partnerId);
      if (!metrics) return;

      metrics.totalBookings += 1;
      if (booking.pago_realizado) {
        metrics.paidBookings += 1;
      } else {
        metrics.pendingBookings += 1;
      }

      const createdAt = getDateValue(booking.creado_en);
      if (createdAt && (!metrics.lastBookingAt || createdAt > metrics.lastBookingAt)) {
        metrics.lastBookingAt = createdAt;
      }

      partnerBookingRows.push({
        bookingId: booking.id,
        numeroReserva: booking.numero_reserva || booking.id,
        partnerName: metrics.partner.nombre || metrics.partner.email,
        customerName: booking.cliente?.nombre || 'Sin nombre',
        amount: Number(booking.precio_total || 0),
        estado: booking.estado || 'pendiente',
        createdAt,
        pagoRealizado: Boolean(booking.pago_realizado),
      });

      const attempts = Number(booking.stripe_payment_failed_attempts || 0);
      const failedAt = getDateValue(booking.stripe_last_payment_failed_at);
      if (attempts > 0) {
        metrics.failedPaymentAttempts += attempts;
        metrics.failedBookings += 1;
        if (failedAt && (!metrics.lastPaymentFailedAt || failedAt > metrics.lastPaymentFailedAt)) {
          metrics.lastPaymentFailedAt = failedAt;
        }

        failedRows.push({
          bookingId: booking.id,
          numeroReserva: booking.numero_reserva || booking.id,
          partnerName: metrics.partner.nombre || metrics.partner.email,
          customerName: booking.cliente?.nombre || 'Sin nombre',
          amount: Number(booking.precio_total || 0),
          attempts,
          failedAt,
          code: booking.stripe_last_payment_failed_code || '-',
          message: booking.stripe_last_payment_failed_message || '-',
          estado: booking.estado || 'pendiente',
        });
      }
    });

    const metrics = Array.from(partnerMap.values()).sort((a, b) => {
      if (a.failedPaymentAttempts !== b.failedPaymentAttempts) {
        return b.failedPaymentAttempts - a.failedPaymentAttempts;
      }
      return b.totalBookings - a.totalBookings;
    });

    failedRows.sort((a, b) => {
      const aTs = a.failedAt?.getTime() || 0;
      const bTs = b.failedAt?.getTime() || 0;
      if (aTs !== bTs) return bTs - aTs;
      return b.attempts - a.attempts;
    });
    partnerBookingRows.sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));

    const totals = {
      partners: metrics.length,
      connected: metrics.filter((item) => item.isConnected).length,
      failedPartners: metrics.filter((item) => item.failedPaymentAttempts > 0).length,
      failedAttempts: metrics.reduce((sum, item) => sum + item.failedPaymentAttempts, 0),
    };

    return { metrics, failedRows, partnerBookingRows, totals };
  }, [bookings, partners, nowTs]);

  if (usersLoading || bookingsLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="h-11 w-11 animate-spin rounded-full border-4 border-slate-200 border-t-blue-600" />
        <p className="mt-4 text-sm text-slate-500">Cargando actividad...</p>
      </div>
    );
  }

  if (user?.rol !== 'admin') {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 px-6 py-5 text-rose-700">
        Solo administradores pueden acceder a Activity.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Activity</h1>
        <p className="text-slate-500 mt-1">
          Seguimiento de brokers/agencias: conexión, reservas y fallos de pago en Stripe.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Partners</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{analytics.totals.partners}</p>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-xs uppercase tracking-wide text-emerald-700">Conectados ahora</p>
          <p className="text-2xl font-bold text-emerald-800 mt-1">{analytics.totals.connected}</p>
          <p className="text-xs text-emerald-700 mt-1">Ventana: {ONLINE_WINDOW_MINUTES} min</p>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-xs uppercase tracking-wide text-amber-700">Partners con fallos</p>
          <p className="text-2xl font-bold text-amber-800 mt-1">{analytics.totals.failedPartners}</p>
        </div>
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
          <p className="text-xs uppercase tracking-wide text-rose-700">Intentos fallidos Stripe</p>
          <p className="text-2xl font-bold text-rose-800 mt-1">{analytics.totals.failedAttempts}</p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <h2 className="text-lg font-semibold text-slate-900">Actividad por Partner</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-6 py-3 text-left font-semibold">Partner</th>
                <th className="px-6 py-3 text-left font-semibold">Conexión</th>
                <th className="px-6 py-3 text-left font-semibold">Reservas</th>
                <th className="px-6 py-3 text-left font-semibold">Pagadas</th>
                <th className="px-6 py-3 text-left font-semibold">Pendientes</th>
                <th className="px-6 py-3 text-left font-semibold">Fallos Stripe</th>
                <th className="px-6 py-3 text-left font-semibold">Últ. fallo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {analytics.metrics.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-10 text-center text-slate-500">
                    No hay brokers/agencias para mostrar.
                  </td>
                </tr>
              ) : (
                analytics.metrics.map((item) => (
                  <tr key={item.partner.id} className="hover:bg-slate-50/70">
                    <td className="px-6 py-4">
                      <p className="font-semibold text-slate-900">{item.partner.nombre || 'Sin nombre'}</p>
                      <p className="text-xs text-slate-500">{item.partner.email}</p>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={clsx(
                          'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold',
                          item.isConnected
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            : 'border-slate-200 bg-slate-100 text-slate-600'
                        )}
                      >
                        {item.isConnected ? <PlugZap size={12} /> : <Clock3 size={12} />}
                        {item.isConnected ? 'Conectado' : 'Desconectado'}
                      </span>
                      <p className="text-xs text-slate-500 mt-1">
                        Últ. login: {formatDateTime(item.partner.last_login_at)}
                      </p>
                      <p className="text-xs text-slate-500">Últ. seen: {formatDateTime(item.partner.last_seen_at)}</p>
                    </td>
                    <td className="px-6 py-4 font-semibold text-slate-800">{item.totalBookings}</td>
                    <td className="px-6 py-4 text-emerald-700 font-semibold">{item.paidBookings}</td>
                    <td className="px-6 py-4 text-amber-700 font-semibold">{item.pendingBookings}</td>
                    <td className="px-6 py-4">
                      <p className="font-semibold text-rose-700">{item.failedPaymentAttempts}</p>
                      <p className="text-xs text-slate-500">{item.failedBookings} reservas</p>
                    </td>
                    <td className="px-6 py-4 text-slate-600">
                      {item.lastPaymentFailedAt
                        ? format(item.lastPaymentFailedAt, 'dd MMM yyyy, HH:mm', { locale: es })
                        : 'Sin fallos'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-2">
          <Activity size={18} className="text-slate-700" />
          <h2 className="text-lg font-semibold text-slate-900">Fallos Stripe por Reserva</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-6 py-3 text-left font-semibold">Reserva</th>
                <th className="px-6 py-3 text-left font-semibold">Partner</th>
                <th className="px-6 py-3 text-left font-semibold">Cliente</th>
                <th className="px-6 py-3 text-left font-semibold">Intentos</th>
                <th className="px-6 py-3 text-left font-semibold">Código</th>
                <th className="px-6 py-3 text-left font-semibold">Mensaje</th>
                <th className="px-6 py-3 text-left font-semibold">Fecha</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {analytics.failedRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-10 text-center text-slate-500">
                    No hay fallos de pago Stripe registrados.
                  </td>
                </tr>
              ) : (
                analytics.failedRows.slice(0, 100).map((row) => (
                  <tr key={row.bookingId} className="hover:bg-slate-50/70">
                    <td className="px-6 py-4">
                      <p className="font-semibold text-slate-900">{row.numeroReserva}</p>
                      <p className="text-xs text-slate-500">
                        €{row.amount.toLocaleString('es-ES', { minimumFractionDigits: 2 })}
                      </p>
                    </td>
                    <td className="px-6 py-4 text-slate-700">{row.partnerName}</td>
                    <td className="px-6 py-4 text-slate-700">{row.customerName}</td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700">
                        <AlertTriangle size={12} />
                        {row.attempts}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-xs font-mono text-slate-700">{row.code}</td>
                    <td className="px-6 py-4 text-slate-600 max-w-md truncate" title={row.message}>
                      {row.message}
                    </td>
                    <td className="px-6 py-4 text-slate-600">{formatDateTime(row.failedAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <h2 className="text-lg font-semibold text-slate-900">Reservas por Partner (recientes)</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-6 py-3 text-left font-semibold">Reserva</th>
                <th className="px-6 py-3 text-left font-semibold">Partner</th>
                <th className="px-6 py-3 text-left font-semibold">Cliente</th>
                <th className="px-6 py-3 text-left font-semibold">Estado</th>
                <th className="px-6 py-3 text-left font-semibold">Pago</th>
                <th className="px-6 py-3 text-left font-semibold">Creada</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {analytics.partnerBookingRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-10 text-center text-slate-500">
                    No hay reservas creadas por brokers/agencias.
                  </td>
                </tr>
              ) : (
                analytics.partnerBookingRows.slice(0, 100).map((row) => (
                  <tr key={row.bookingId} className="hover:bg-slate-50/70">
                    <td className="px-6 py-4">
                      <p className="font-semibold text-slate-900">{row.numeroReserva}</p>
                      <p className="text-xs text-slate-500">
                        €{row.amount.toLocaleString('es-ES', { minimumFractionDigits: 2 })}
                      </p>
                    </td>
                    <td className="px-6 py-4 text-slate-700">{row.partnerName}</td>
                    <td className="px-6 py-4 text-slate-700">{row.customerName}</td>
                    <td className="px-6 py-4 text-slate-700">{row.estado}</td>
                    <td className="px-6 py-4">
                      <span
                        className={clsx(
                          'inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold',
                          row.pagoRealizado
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            : 'border-amber-200 bg-amber-50 text-amber-700'
                        )}
                      >
                        {row.pagoRealizado ? 'Pagado' : 'Pendiente'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-slate-600">{formatDateTime(row.createdAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
