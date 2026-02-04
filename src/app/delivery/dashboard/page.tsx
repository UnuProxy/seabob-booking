'use client';

import { useMemo } from 'react';
import { format, addDays, isWithinInterval, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { CalendarDays, MapPin, Phone, PackageCheck } from 'lucide-react';
import Link from 'next/link';
import clsx from 'clsx';
import type { Booking } from '@/types';
import { useDeliveryBookings } from '@/lib/firebase/hooks/useDeliveryBookings';

const LOCATION_LABELS: Record<string, string> = {
  marina_ibiza: 'Marina Ibiza',
  marina_botafoch: 'Marina Botafoch',
  club_nautico: 'Club Náutico',
  otro: 'Otro',
};

const getDateValue = (value: string) => {
  const parsed = parseISO(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const getItemsLabel = (booking: Booking) =>
  booking.items
    ?.map((item) => `${item.cantidad || 0}x ${item.producto_nombre || 'Producto'}`)
    .join(', ') || 'Sin productos';

export default function DeliveryDashboard() {
  const { bookings, loading, todayStr } = useDeliveryBookings();

  const upcomingBookings = useMemo(() => {
    return bookings.filter(
      (booking) =>
        booking.estado !== 'cancelada' &&
        booking.estado !== 'expirada' &&
        !booking.expirado
    );
  }, [bookings]);

  const todayDate = useMemo(() => parseISO(todayStr), [todayStr]);

  const stats = useMemo(() => {
    const today = upcomingBookings.filter((booking) => booking.fecha_inicio === todayStr);
    const nextWeek = upcomingBookings.filter((booking) => {
      const date = getDateValue(booking.fecha_inicio);
      if (!date) return false;
      return isWithinInterval(date, { start: todayDate, end: addDays(todayDate, 7) });
    });
    return {
      todayCount: today.length,
      nextWeekCount: nextWeek.length,
    };
  }, [todayDate, todayStr, upcomingBookings]);

  const nextDeliveries = useMemo(() => upcomingBookings.slice(0, 5), [upcomingBookings]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        <p className="text-gray-500 mt-4">Cargando entregas...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 mb-2">Dashboard de Entregas</h1>
          <p className="text-slate-600">
            Revisa las reservas confirmadas y pendientes para organizar las entregas.
          </p>
        </div>
        <Link href="/delivery/reservas" className="btn-primary w-fit">
          Ver todas las entregas
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500 font-semibold">
                Entregas hoy
              </p>
              <p className="text-3xl font-bold text-blue-700 mt-2">{stats.todayCount}</p>
              <p className="text-sm text-slate-500 mt-1">{format(todayDate, 'dd MMM yyyy', { locale: es })}</p>
            </div>
            <div className="h-12 w-12 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center">
              <CalendarDays size={22} />
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500 font-semibold">
                Próximos 7 días
              </p>
              <p className="text-3xl font-bold text-emerald-700 mt-2">{stats.nextWeekCount}</p>
              <p className="text-sm text-slate-500 mt-1">Planifica rutas y horarios</p>
            </div>
            <div className="h-12 w-12 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center">
              <PackageCheck size={22} />
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Próximas entregas</h2>
            <p className="text-sm text-slate-500">Las siguientes reservas programadas.</p>
          </div>
        </div>

        {nextDeliveries.length === 0 ? (
          <div className="text-center py-12 text-slate-500">
            No hay entregas programadas para los próximos días.
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {nextDeliveries.map((booking) => {
              const date = getDateValue(booking.fecha_inicio);
              const location = booking.ubicacion_entrega
                ? LOCATION_LABELS[booking.ubicacion_entrega] || booking.ubicacion_entrega
                : 'Sin ubicación';
              return (
                <div
                  key={booking.id}
                  className="border border-slate-200 rounded-2xl p-5 flex flex-col gap-4"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        {date ? format(date, 'dd MMM yyyy', { locale: es }) : booking.fecha_inicio}
                        {booking.hora_entrega ? ` · ${booking.hora_entrega}` : ''}
                      </p>
                      <p className="text-xs text-slate-500">{booking.numero_reserva}</p>
                    </div>
                    <span
                      className={clsx(
                        'inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold border',
                        booking.pago_realizado
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border-amber-200 bg-amber-50 text-amber-700'
                      )}
                    >
                      {booking.pago_realizado ? 'Pagado' : 'Pendiente'}
                    </span>
                  </div>

                  <div className="text-sm text-slate-600">
                    <div className="flex items-center gap-2">
                      <MapPin size={16} className="text-blue-600" />
                      <span>
                        {location}
                        {booking.nombre_barco ? ` · ${booking.nombre_barco}` : ''}
                        {booking.numero_amarre ? ` · Amarre ${booking.numero_amarre}` : ''}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <Phone size={16} className="text-blue-600" />
                      <span>{booking.cliente?.telefono || 'Sin teléfono'}</span>
                    </div>
                  </div>

                  <div className="text-sm text-slate-700 font-semibold">
                    {getItemsLabel(booking)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
