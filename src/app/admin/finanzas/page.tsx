'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  CreditCard,
  Euro,
  Receipt,
  TrendingUp,
  UserRound,
  Users,
  Wallet,
} from 'lucide-react';
import { db } from '@/lib/firebase/config';
import { useAuthStore } from '@/store/authStore';
import type { Booking, PaymentMethod, User } from '@/types';

type MethodTotals = Record<PaymentMethod, { count: number; amount: number }>;

type ChannelKey = 'direct' | 'broker' | 'agency' | 'colaborador';

type ChannelTotals = Record<
  ChannelKey,
  { label: string; count: number; gross: number; net: number }
>;

const getDate = (value: unknown): Date => {
  if (!value) return new Date();
  if (
    typeof value === 'object' &&
    value !== null &&
    'toDate' in value &&
    typeof (value as { toDate?: () => Date }).toDate === 'function'
  ) {
    return (value as { toDate: () => Date }).toDate();
  }
  if (value instanceof Date) return value;
  return new Date(value as string | number);
};

const formatCurrency = (value: number) =>
  value.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });

const formatDate = (value: unknown) =>
  new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(getDate(value));

const toDateInputValue = (value: unknown) => {
  const date = getDate(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export default function FinanzasPage() {
  const { user } = useAuthStore();
  const router = useRouter();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [users, setUsers] = useState<Record<string, User>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    if (user.rol !== 'admin') {
      router.push('/admin/dashboard');
      return;
    }

    const unsubscribeBookings = onSnapshot(
      collection(db, 'bookings'),
      (snapshot) => {
        const data = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        })) as Booking[];
        setBookings(data);
        setLoading(false);
      },
      (error) => {
        console.error('Error fetching finances:', error);
        setLoading(false);
      }
    );

    const unsubscribeUsers = onSnapshot(
      collection(db, 'users'),
      (snapshot) => {
        const map: Record<string, User> = {};
        snapshot.docs.forEach((doc) => {
          map[doc.id] = { id: doc.id, ...doc.data() } as User;
        });
        setUsers(map);
      },
      (error) => {
        console.error('Error fetching users for finances:', error);
      }
    );

    return () => {
      unsubscribeBookings();
      unsubscribeUsers();
    };
  }, [router, user]);

  const finance = useMemo(() => {
    const methodTotals: MethodTotals = {
      stripe: { count: 0, amount: 0 },
      transferencia: { count: 0, amount: 0 },
      tarjeta: { count: 0, amount: 0 },
      otro: { count: 0, amount: 0 },
    };

    const channelTotals: ChannelTotals = {
      direct: { label: 'Cliente directo', count: 0, gross: 0, net: 0 },
      broker: { label: 'Broker', count: 0, gross: 0, net: 0 },
      agency: { label: 'Agencia', count: 0, gross: 0, net: 0 },
      colaborador: { label: 'Colaborador', count: 0, gross: 0, net: 0 },
    };

    let grossPaid = 0;
    let refundedAmount = 0;
    let pendingCount = 0;
    let pendingAmount = 0;
    let commissionPending = 0;
    const pendingBookings: Booking[] = [];
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const getOwnerInfo = (booking: Booking) => {
      const partnerId = booking.broker_id || booking.agency_id || booking.colaborador_id;
      const partner = partnerId ? users[partnerId] : undefined;
      const ownerName = partner?.empresa_nombre || partner?.nombre || 'SEABOB Center Ibiza';
      const ownerType = booking.broker_id
        ? 'Broker'
        : booking.agency_id
          ? 'Agencia'
          : booking.colaborador_id
            ? 'Colaborador'
            : 'Directo';

      return { ownerName, ownerType };
    };

    const overdueUnpaid = bookings
      .filter((booking) => !booking.pago_realizado && booking.estado !== 'cancelada')
      .map((booking) => {
        const dueDate = getDate(booking.fecha_inicio);
        dueDate.setHours(0, 0, 0, 0);
        const daysOverdue = Math.floor((startOfToday.getTime() - dueDate.getTime()) / DAY_MS);
        const { ownerName, ownerType } = getOwnerInfo(booking);

        return {
          booking,
          dueDate,
          daysOverdue,
          ownerName,
          ownerType,
        };
      })
      .filter((item) => item.daysOverdue > 0)
      .sort((a, b) => {
        if (b.daysOverdue !== a.daysOverdue) return b.daysOverdue - a.daysOverdue;
        return (b.booking.precio_total || 0) - (a.booking.precio_total || 0);
      });

    const recentOverdue = overdueUnpaid.filter((item) => item.daysOverdue <= 3);
    const longOverdue = overdueUnpaid.filter((item) => item.daysOverdue > 3);

    bookings.forEach((booking) => {
      const total = booking.precio_total || 0;
      const refund = booking.reembolso_realizado ? booking.reembolso_monto || 0 : 0;

      if (!booking.pago_realizado && booking.estado === 'pendiente' && !booking.expirado) {
        pendingCount += 1;
        pendingAmount += total;
        pendingBookings.push(booking);
      }

      if (booking.pago_realizado) {
        grossPaid += total;
        const rawMethod = booking.pago_metodo as string | undefined;
        const method = rawMethod && rawMethod in methodTotals ? (rawMethod as PaymentMethod) : 'otro';
        methodTotals[method].count += 1;
        methodTotals[method].amount += total;
      }

      if (refund > 0) {
        refundedAmount += refund;
      }

      if (booking.pago_realizado && !booking.reembolso_realizado) {
        const pending = (booking.comision_total || 0) - (booking.comision_pagada || 0);
        if (pending > 0) {
          commissionPending += pending;
        }
      }

      let channel: ChannelKey = 'direct';
      if (booking.broker_id) channel = 'broker';
      else if (booking.agency_id) channel = 'agency';
      else if (booking.colaborador_id) channel = 'colaborador';

      channelTotals[channel].count += 1;

      if (booking.pago_realizado) {
        channelTotals[channel].gross += total;
        channelTotals[channel].net += total - refund;
      }
    });

    pendingBookings.sort(
      (a, b) => (b.precio_total || 0) - (a.precio_total || 0)
    );

    return {
      grossPaid,
      refundedAmount,
      netRevenue: grossPaid - refundedAmount,
      pendingCount,
      pendingAmount,
      commissionPending,
      methodTotals,
      channelTotals,
      pendingBookings: pendingBookings.slice(0, 5),
      unpaidTracker: {
        totalCount: overdueUnpaid.length,
        totalAmount: overdueUnpaid.reduce((sum, item) => sum + (item.booking.precio_total || 0), 0),
        recentCount: recentOverdue.length,
        recentAmount: recentOverdue.reduce((sum, item) => sum + (item.booking.precio_total || 0), 0),
        longCount: longOverdue.length,
        longAmount: longOverdue.reduce((sum, item) => sum + (item.booking.precio_total || 0), 0),
        recentItems: recentOverdue,
        longItems: longOverdue,
      },
    };
  }, [bookings, users]);

  if (!user) return null;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-slate-200 border-t-blue-600"></div>
      </div>
    );
  }

  const methodCards = [
    {
      key: 'stripe',
      label: 'Stripe',
      icon: CreditCard,
      tone: 'border-indigo-100 bg-indigo-50 text-indigo-700',
    },
    {
      key: 'tarjeta',
      label: 'Tarjeta manual',
      icon: Euro,
      tone: 'border-amber-100 bg-amber-50 text-amber-700',
    },
  ] as const;

  const channelCards = [
    { key: 'direct', icon: UserRound },
    { key: 'broker', icon: Users },
    { key: 'agency', icon: Users },
    { key: 'colaborador', icon: Users },
  ] as const;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Finanzas</h1>
          <p className="text-slate-600">
            Resumen financiero en tiempo real para decisiones rapidas.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
          <span className="h-2 w-2 rounded-full bg-emerald-400"></span>
          Actualizado
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500 font-semibold">
                Pendiente de cobro
              </p>
              <p className="text-2xl font-bold text-amber-600 mt-2">
                {formatCurrency(finance.pendingAmount)}
              </p>
            </div>
            <div className="h-11 w-11 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center">
              <Wallet size={20} />
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-3">
            {finance.pendingCount} reservas sin pago
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500 font-semibold">
                Ingresos
              </p>
              <p className="text-2xl font-bold text-emerald-600 mt-2">
                {formatCurrency(finance.netRevenue)}
              </p>
            </div>
            <div className="h-11 w-11 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center">
              <TrendingUp size={20} />
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-3">Confirmados menos reembolsos</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500 font-semibold">
                Reembolsos
              </p>
              <p className="text-2xl font-bold text-rose-600 mt-2">
                {formatCurrency(finance.refundedAmount)}
              </p>
            </div>
            <div className="h-11 w-11 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center">
              <Receipt size={20} />
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-3">Pagos devueltos</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500 font-semibold">
                Comisiones pendientes
              </p>
              <p className="text-2xl font-bold text-indigo-600 mt-2">
                {formatCurrency(finance.commissionPending)}
              </p>
            </div>
            <div className="h-11 w-11 rounded-xl bg-indigo-100 text-indigo-600 flex items-center justify-center">
              <Users size={20} />
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-3">Solo reservas pagadas</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Pagos por metodo</h2>
              <p className="text-sm text-slate-500">No incluye reembolsos.</p>
            </div>
          </div>
          <div className="space-y-3">
            {methodCards.map((method) => {
              const totals = finance.methodTotals[method.key];
              const Icon = method.icon;
              return (
                <div
                  key={method.key}
                  className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`h-10 w-10 rounded-lg flex items-center justify-center ${method.tone}`}
                    >
                      <Icon size={18} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        {method.label}
                      </p>
                      <p className="text-xs text-slate-500">{totals.count} pagos</p>
                    </div>
                  </div>
                  <p className="text-sm font-bold text-slate-900">
                    {formatCurrency(totals.amount)}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Ingresos por canal</h2>
              <p className="text-sm text-slate-500">Netos despues de reembolsos.</p>
            </div>
          </div>
          <div className="space-y-3">
            {channelCards.map((channel) => {
              const totals = finance.channelTotals[channel.key];
              const Icon = channel.icon;
              return (
                <div
                  key={channel.key}
                  className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-slate-200 text-slate-600 flex items-center justify-center">
                      <Icon size={18} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        {totals.label}
                      </p>
                      <p className="text-xs text-slate-500">
                        {totals.count} reservas
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-slate-900">
                      {formatCurrency(totals.net)}
                    </p>
                    <p className="text-xs text-slate-500">
                      Bruto: {formatCurrency(totals.gross)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Pendientes prioritarios</h2>
            <p className="text-sm text-slate-500">
              Reservas sin pago ordenadas por importe.
            </p>
          </div>
        </div>
        {finance.pendingBookings.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
            No hay reservas pendientes de pago.
          </div>
        ) : (
          <div className="space-y-3">
            {finance.pendingBookings.map((booking) => (
              <div
                key={booking.id}
                className="flex flex-col gap-3 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    {booking.numero_reserva} · {booking.cliente?.nombre || 'Cliente'}
                  </p>
                  <p className="text-xs text-slate-500">
                    Inicio: {formatDate(booking.fecha_inicio)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-amber-600">
                    {formatCurrency(booking.precio_total || 0)}
                  </p>
                  <p className="text-xs text-slate-500">Pendiente</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between mb-5">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Control de impagos vencidos</h2>
            <p className="text-sm text-slate-500">
              Solo reservas no pagadas con fecha de servicio ya vencida.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="uppercase tracking-wide text-slate-500 font-semibold">Total vencidas</p>
              <p className="font-bold text-slate-900 mt-1">
                {finance.unpaidTracker.totalCount} · {formatCurrency(finance.unpaidTracker.totalAmount)}
              </p>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              <p className="uppercase tracking-wide text-amber-700 font-semibold">Ultimos 3 dias</p>
              <p className="font-bold text-amber-800 mt-1">
                {finance.unpaidTracker.recentCount} · {formatCurrency(finance.unpaidTracker.recentAmount)}
              </p>
            </div>
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2">
              <p className="uppercase tracking-wide text-rose-700 font-semibold">Mas de 3 dias</p>
              <p className="font-bold text-rose-800 mt-1">
                {finance.unpaidTracker.longCount} · {formatCurrency(finance.unpaidTracker.longAmount)}
              </p>
            </div>
          </div>
        </div>

        {finance.unpaidTracker.totalCount === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
            No hay impagos vencidos actualmente.
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-rose-100 bg-rose-50/40 p-4">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle size={16} className="text-rose-600" />
                <h3 className="text-sm font-bold text-rose-900">Vencidas hace mas de 3 dias</h3>
              </div>
              {finance.unpaidTracker.longItems.length === 0 ? (
                <p className="text-sm text-slate-500">Sin reservas en este tramo.</p>
              ) : (
                <div className="space-y-2">
                  {finance.unpaidTracker.longItems.map((item) => (
                    <div key={item.booking.id} className="rounded-lg border border-rose-100 bg-white px-3 py-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900 truncate">
                            {item.booking.numero_reserva} · {item.booking.cliente?.nombre || 'Cliente'}
                          </p>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {item.booking.cliente?.email || 'Sin email'}
                          </p>
                          <p className="text-xs text-slate-600 mt-1 inline-flex items-center gap-1">
                            <Building2 size={12} />
                            {item.ownerName} · {item.ownerType}
                          </p>
                          <p className="text-xs text-rose-700 mt-1 inline-flex items-center gap-1">
                            <CalendarClock size={12} />
                            Vence: {formatDate(item.dueDate)} · {item.daysOverdue} dias
                          </p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-sm font-bold text-rose-700">
                            {formatCurrency(item.booking.precio_total || 0)}
                          </p>
                          <Link
                            href={`/admin/reservas?bookingRef=${encodeURIComponent(item.booking.numero_reserva)}&serviceDate=${toDateInputValue(item.booking.fecha_inicio)}`}
                            className="mt-1 inline-flex text-xs font-semibold text-blue-700 hover:text-blue-800 underline underline-offset-2"
                          >
                            Ver reserva
                          </Link>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-amber-100 bg-amber-50/40 p-4">
              <div className="flex items-center gap-2 mb-3">
                <CalendarClock size={16} className="text-amber-600" />
                <h3 className="text-sm font-bold text-amber-900">Vencidas en los ultimos 3 dias</h3>
              </div>
              {finance.unpaidTracker.recentItems.length === 0 ? (
                <p className="text-sm text-slate-500">Sin reservas en este tramo.</p>
              ) : (
                <div className="space-y-2">
                  {finance.unpaidTracker.recentItems.map((item) => (
                    <div key={item.booking.id} className="rounded-lg border border-amber-100 bg-white px-3 py-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900 truncate">
                            {item.booking.numero_reserva} · {item.booking.cliente?.nombre || 'Cliente'}
                          </p>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {item.booking.cliente?.email || 'Sin email'}
                          </p>
                          <p className="text-xs text-slate-600 mt-1 inline-flex items-center gap-1">
                            <Building2 size={12} />
                            {item.ownerName} · {item.ownerType}
                          </p>
                          <p className="text-xs text-amber-700 mt-1 inline-flex items-center gap-1">
                            <CalendarClock size={12} />
                            Vence: {formatDate(item.dueDate)} · {item.daysOverdue} dias
                          </p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-sm font-bold text-amber-700">
                            {formatCurrency(item.booking.precio_total || 0)}
                          </p>
                          <Link
                            href={`/admin/reservas?bookingRef=${encodeURIComponent(item.booking.numero_reserva)}&serviceDate=${toDateInputValue(item.booking.fecha_inicio)}`}
                            className="mt-1 inline-flex text-xs font-semibold text-blue-700 hover:text-blue-800 underline underline-offset-2"
                          >
                            Ver reserva
                          </Link>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
