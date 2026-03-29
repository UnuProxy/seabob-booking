'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  CheckCircle2,
  CreditCard,
  Download,
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
type ChannelTotals = Record<ChannelKey, { label: string; count: number; gross: number; net: number }>;

const DAY_MS = 24 * 60 * 60 * 1000;

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
  const parsed = new Date(value as string | number);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
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

const formatTimeAgo = (value: Date | null, nowTs: number) => {
  if (!value) return 'ahora mismo';
  const diffMinutes = Math.max(0, Math.floor((nowTs - value.getTime()) / 60000));
  if (diffMinutes < 1) return 'ahora mismo';
  if (diffMinutes < 60) return `hace ${diffMinutes} min`;
  const hours = Math.floor(diffMinutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return `hace ${days} d`;
};

const isExpiredBooking = (booking: Booking) =>
  booking.estado === 'expirada' || Boolean(booking.expirado);

export default function FinanzasPage() {
  const { user } = useAuthStore();
  const router = useRouter();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [users, setUsers] = useState<Record<string, User>>({});
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [relativeNow, setRelativeNow] = useState(Date.now());
  const [rangeDays, setRangeDays] = useState(30);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setRelativeNow(Date.now());
    }, 60000);

    return () => window.clearInterval(interval);
  }, []);

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
        setUpdatedAt(new Date());
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
        setUpdatedAt(new Date());
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
    let openCommissionCount = 0;
    let newPendingSinceYesterday = 0;
    let periodNetRevenue = 0;
    let periodRefunded = 0;
    const pendingBookings: Booking[] = [];
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const yesterdayStart = new Date(startOfToday.getTime() - DAY_MS);
    const threeDaysStart = new Date(startOfToday.getTime() - 2 * DAY_MS);
    const rangeStart = new Date(startOfToday.getTime() - (rangeDays - 1) * DAY_MS);

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
      .filter((booking) => !booking.pago_realizado && booking.estado !== 'cancelada' && !isExpiredBooking(booking))
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
      const isExpired = isExpiredBooking(booking);
      const createdAt = getDate(booking.creado_en || booking.fecha_inicio);
      const inRange = createdAt >= rangeStart;

      if (!booking.pago_realizado && booking.estado === 'pendiente' && !isExpired) {
        pendingCount += 1;
        pendingAmount += total;
        pendingBookings.push(booking);
        if (createdAt >= yesterdayStart) {
          newPendingSinceYesterday += 1;
        }
      }

      if (booking.pago_realizado && !isExpired) {
        grossPaid += total;
        const rawMethod = booking.pago_metodo as string | undefined;
        const method = rawMethod && rawMethod in methodTotals ? (rawMethod as PaymentMethod) : 'otro';
        methodTotals[method].count += 1;
        methodTotals[method].amount += total;
        if (inRange) {
          periodNetRevenue += total - refund;
        }
      }

      if (refund > 0) {
        refundedAmount += refund;
        if (inRange) {
          periodRefunded += refund;
        }
      }

      if (booking.pago_realizado && !booking.reembolso_realizado && !isExpired) {
        const pending = (booking.comision_total || 0) - (booking.comision_pagada || 0);
        if (pending > 0) {
          commissionPending += pending;
          openCommissionCount += 1;
        }
      }

      let channel: ChannelKey = 'direct';
      if (booking.broker_id) channel = 'broker';
      else if (booking.agency_id) channel = 'agency';
      else if (booking.colaborador_id) channel = 'colaborador';

      channelTotals[channel].count += 1;

      if (booking.pago_realizado && !isExpired) {
        channelTotals[channel].gross += total;
        channelTotals[channel].net += total - refund;
      }
    });

    pendingBookings.sort((a, b) => (b.precio_total || 0) - (a.precio_total || 0));
    const recentPending = pendingBookings.filter(
      (booking) => getDate(booking.creado_en || booking.fecha_inicio) >= threeDaysStart
    );

    return {
      grossPaid,
      refundedAmount,
      netRevenue: grossPaid - refundedAmount,
      pendingCount,
      pendingAmount,
      commissionPending,
      openCommissionCount,
      newPendingSinceYesterday,
      periodNetRevenue,
      periodRefunded,
      methodTotals,
      channelTotals,
      pendingBookings: pendingBookings.slice(0, 5),
      pendingSummary: {
        totalCount: pendingCount,
        totalAmount: pendingAmount,
        recentCount: recentPending.length,
        recentAmount: recentPending.reduce((sum, item) => sum + (item.precio_total || 0), 0),
      },
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
  }, [bookings, rangeDays, users]);

  const handleExport = () => {
    const lines = [
      ['Metrica', 'Valor'],
      ['Pendiente de cobro', finance.pendingAmount.toFixed(2)],
      ['Reservas pendientes', String(finance.pendingCount)],
      ['Ingresos netos', finance.netRevenue.toFixed(2)],
      ['Reembolsos', finance.refundedAmount.toFixed(2)],
      ['Comisiones pendientes', finance.commissionPending.toFixed(2)],
      ['Impagos vencidos', String(finance.unpaidTracker.totalCount)],
    ];

    const csv = lines.map((line) => line.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `finanzas-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (!user) return null;

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-blue-600"></div>
      </div>
    );
  }

  const methodCards = [
    {
      key: 'stripe',
      label: 'Stripe',
      icon: CreditCard,
      iconTone: 'bg-indigo-50 text-indigo-600 ring-1 ring-inset ring-indigo-100',
    },
    {
      key: 'tarjeta',
      label: 'Tarjeta manual',
      icon: Euro,
      iconTone: 'bg-amber-50 text-amber-600 ring-1 ring-inset ring-amber-100',
    },
  ] as const;

  const channelCards = [
    { key: 'direct', icon: UserRound },
    { key: 'broker', icon: Users },
    { key: 'agency', icon: Users },
    { key: 'colaborador', icon: Users },
  ] as const;

  const rangeLabel = `${rangeDays} dias`;
  const lastUpdatedLabel = `Actualizado ${formatTimeAgo(updatedAt, relativeNow)}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Finanzas</h1>
          <p className="text-sm text-slate-500">
            Resumen financiero en tiempo real para decisiones rapidas.
          </p>
        </div>

        <div className="flex items-center gap-3 text-sm text-slate-500">
          <div className="inline-flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <span>{lastUpdatedLabel}</span>
          </div>
          <button
            type="button"
            onClick={handleExport}
            className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-slate-600 transition hover:bg-white hover:text-slate-900"
          >
            <Download className="h-4 w-4" />
            Exportar
          </button>
        </div>
      </div>

      <div className="rounded-[28px] border border-slate-200/80 bg-white p-3 shadow-sm shadow-slate-200/50 sm:p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="inline-flex items-center gap-2 rounded-2xl border border-emerald-100 bg-emerald-50/70 px-3 py-2 text-sm font-medium text-emerald-700">
            <CheckCircle2 className="h-4 w-4" />
            {lastUpdatedLabel}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={() => document.getElementById('impagados-vencidos')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              className="inline-flex items-center justify-center rounded-2xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
            >
              Ver impagados
            </button>

            <div className="relative">
              <select
                value={rangeDays}
                onChange={(event) => setRangeDays(Number(event.target.value))}
                className="h-11 rounded-2xl border border-slate-200 bg-white pl-4 pr-9 text-sm font-medium text-slate-700 outline-none ring-0 transition focus:border-blue-300"
              >
                <option value={7}>7 dias</option>
                <option value={30}>30 dias</option>
                <option value={90}>90 dias</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-200/50">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                Pendiente de cobro
              </p>
              <p className="text-3xl font-semibold tracking-tight text-amber-600">
                {formatCurrency(finance.pendingAmount)}
              </p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 ring-1 ring-inset ring-amber-100">
              <Wallet className="h-5 w-5" />
            </div>
          </div>
          <p className="mt-3 text-sm font-medium text-slate-700">
            {finance.pendingCount} reservas sin pagar
          </p>
          <p className="mt-1 text-sm text-emerald-600">
            {finance.newPendingSinceYesterday > 0
              ? `+${finance.newPendingSinceYesterday} desde ayer`
              : 'Sin cambios desde ayer'}
          </p>
        </div>

        <div className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-200/50">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                Ingresos
              </p>
              <p className="text-3xl font-semibold tracking-tight text-emerald-600">
                {formatCurrency(finance.netRevenue)}
              </p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 ring-1 ring-inset ring-emerald-100">
              <TrendingUp className="h-5 w-5" />
            </div>
          </div>
          <p className="mt-3 text-sm font-medium text-slate-700">Confirmados menos reembolsos</p>
          <p className="mt-1 text-sm text-emerald-600">
            +{formatCurrency(finance.periodNetRevenue)} en {rangeLabel}
          </p>
        </div>

        <div className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-200/50">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                Reembolsos
              </p>
              <p className="text-3xl font-semibold tracking-tight text-rose-600">
                {formatCurrency(finance.refundedAmount)}
              </p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 text-rose-600 ring-1 ring-inset ring-rose-100">
              <Receipt className="h-5 w-5" />
            </div>
          </div>
          <p className="mt-3 text-sm font-medium text-slate-700">Pagos devueltos</p>
          <p className="mt-1 text-sm text-slate-500">
            {formatCurrency(finance.periodRefunded)} en {rangeLabel}
          </p>
        </div>

        <div className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-200/50">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                Comisiones pendientes
              </p>
              <p className="text-3xl font-semibold tracking-tight text-indigo-600">
                {formatCurrency(finance.commissionPending)}
              </p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 ring-1 ring-inset ring-indigo-100">
              <Users className="h-5 w-5" />
            </div>
          </div>
          <p className="mt-3 text-sm font-medium text-slate-700">Solo reservas pagadas</p>
          <p className="mt-1 text-sm text-slate-500">
            {finance.openCommissionCount} reservas con saldo abierto
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-200/50">
          <div className="mb-4">
            <h2 className="text-xl font-semibold tracking-tight text-slate-950">
              Pendientes prioritarios
            </h2>
            <p className="text-sm text-slate-500">
              Reservas sin pago ordenadas por importe.
            </p>
          </div>

          {finance.pendingBookings.length === 0 ? (
            <div className="rounded-3xl border border-slate-200 bg-slate-50/80 px-5 py-6">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-600">
                  <CheckCircle2 className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-lg font-semibold tracking-tight text-slate-950">
                    No hay reservas pendientes
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    Todo esta al dia en este momento
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {finance.pendingBookings.map((booking) => (
                <div
                  key={booking.id}
                  className="flex flex-col gap-3 rounded-3xl border border-slate-200 bg-slate-50/70 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {booking.numero_reserva} · {booking.cliente?.nombre || 'Cliente'}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Inicio: {formatDate(booking.fecha_inicio)}
                    </p>
                  </div>
                  <div className="text-left sm:text-right">
                    <p className="text-lg font-semibold text-amber-600">
                      {formatCurrency(booking.precio_total || 0)}
                    </p>
                    <p className="text-xs text-slate-500">Pendiente</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-3xl border border-slate-200 bg-white px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                Total pendientes
              </p>
              <p className="mt-2 text-sm text-slate-500">
                {finance.pendingSummary.totalCount} reservas
              </p>
                <p className="mt-1 text-xl font-semibold tracking-tight text-slate-950">
                {formatCurrency(finance.pendingSummary.totalAmount)}
              </p>
            </div>
            <div className="rounded-3xl border border-amber-100 bg-amber-50/60 px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-700">
                Ultimos 3 dias
              </p>
              <p className="mt-2 text-sm text-amber-700/80">
                {finance.pendingSummary.recentCount} reservas
              </p>
                <p className="mt-1 text-xl font-semibold tracking-tight text-amber-900">
                {formatCurrency(finance.pendingSummary.recentAmount)}
              </p>
            </div>
          </div>
        </section>

        <section
          id="impagados-vencidos"
          className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-200/50"
        >
          <div className="mb-4">
            <h2 className="text-xl font-semibold tracking-tight text-slate-950">
              Impagos vencidos
            </h2>
            <p className="text-sm text-slate-500">
              Netos despues de reembolsos.
            </p>
          </div>

          {finance.unpaidTracker.totalCount === 0 ? (
            <div className="rounded-3xl border border-slate-200 bg-slate-50/80 px-5 py-6">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-rose-50 text-rose-600 ring-1 ring-inset ring-rose-100">
                  <CalendarClock className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-lg font-semibold tracking-tight text-slate-950">
                    No hay impagos vencidos
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    Ultima revision: {updatedAt ? `${formatTimeAgo(updatedAt, relativeNow)}` : 'ahora mismo'}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {[...finance.unpaidTracker.longItems, ...finance.unpaidTracker.recentItems].slice(0, 5).map((item) => (
                <div
                  key={item.booking.id}
                  className="rounded-3xl border border-slate-200 bg-slate-50/70 px-4 py-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        {item.booking.numero_reserva} · {item.booking.cliente?.nombre || 'Cliente'}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {item.booking.cliente?.email || 'Sin email'}
                      </p>
                      <p className="mt-2 inline-flex items-center gap-1 text-xs text-slate-600">
                        <Building2 className="h-3.5 w-3.5" />
                        {item.ownerName} · {item.ownerType}
                      </p>
                      <p
                        className={`mt-1 inline-flex items-center gap-1 text-xs ${
                          item.daysOverdue > 3 ? 'text-rose-700' : 'text-amber-700'
                        }`}
                      >
                        {item.daysOverdue > 3 ? (
                          <AlertTriangle className="h-3.5 w-3.5" />
                        ) : (
                          <CalendarClock className="h-3.5 w-3.5" />
                        )}
                        Vence: {formatDate(item.dueDate)} · {item.daysOverdue} dias
                      </p>
                    </div>

                    <div className="shrink-0 text-right">
                      <p className="text-lg font-semibold text-slate-900">
                        {formatCurrency(item.booking.precio_total || 0)}
                      </p>
                      <Link
                        href={`/admin/reservas?bookingRef=${encodeURIComponent(item.booking.numero_reserva)}&serviceDate=${toDateInputValue(item.booking.fecha_inicio)}`}
                        className="mt-1 inline-flex text-xs font-semibold text-blue-700 underline underline-offset-2 hover:text-blue-800"
                      >
                        Ver reserva
                      </Link>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-3xl border border-slate-200 bg-white px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                Total vencidas
              </p>
              <p className="mt-2 text-sm text-slate-500">
                {finance.unpaidTracker.totalCount} reservas
              </p>
              <p className="mt-1 text-xl font-semibold tracking-tight text-slate-950">
                {formatCurrency(finance.unpaidTracker.totalAmount)}
              </p>
            </div>
            <div className="rounded-3xl border border-amber-100 bg-amber-50/60 px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-700">
                Ultimos 3 dias
              </p>
              <p className="mt-2 text-sm text-amber-700/80">
                {finance.unpaidTracker.recentCount} reservas
              </p>
              <p className="mt-1 text-xl font-semibold tracking-tight text-amber-900">
                {formatCurrency(finance.unpaidTracker.recentAmount)}
              </p>
            </div>
          </div>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-200/50">
          <div className="mb-4">
            <h2 className="text-xl font-semibold tracking-tight text-slate-950">
              Pagos por metodo
            </h2>
            <p className="text-sm text-slate-500">No incluye reembolsos.</p>
          </div>

          <div className="space-y-3">
            {methodCards.map((method) => {
              const totals = finance.methodTotals[method.key];
              const Icon = method.icon;

              return (
                <div
                  key={method.key}
                  className="flex items-center justify-between rounded-3xl border border-slate-200 bg-slate-50/70 px-4 py-4"
                >
                  <div className="flex items-center gap-3">
                    <div className={`flex h-11 w-11 items-center justify-center rounded-2xl ${method.iconTone}`}>
                      <Icon className="h-4.5 w-4.5" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{method.label}</p>
                      <p className="text-xs text-slate-500">{totals.count} pagos</p>
                    </div>
                  </div>
                    <p className="text-base font-semibold text-slate-950">
                    {formatCurrency(totals.amount)}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-200/50">
          <div className="mb-4">
            <h2 className="text-xl font-semibold tracking-tight text-slate-950">
              Ingresos por canal
            </h2>
            <p className="text-sm text-slate-500">Netos despues de reembolsos.</p>
          </div>

          <div className="space-y-3">
            {channelCards.map((channel) => {
              const totals = finance.channelTotals[channel.key];
              const Icon = channel.icon;

              return (
                <div
                  key={channel.key}
                  className="flex items-center justify-between rounded-3xl border border-slate-200 bg-slate-50/70 px-4 py-4"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200">
                      <Icon className="h-4.5 w-4.5" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{totals.label}</p>
                      <p className="text-xs text-slate-500">{totals.count} reservas</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-base font-semibold text-slate-950">
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
        </section>
      </div>
    </div>
  );
}
