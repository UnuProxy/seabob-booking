'use client';

import { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { CalendarDays, MapPin, Phone, Search } from 'lucide-react';
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

export default function DeliveryReservasPage() {
  const { bookings, loading } = useDeliveryBookings();
  const [searchTerm, setSearchTerm] = useState('');

  const filteredBookings = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return bookings
      .filter(
        (booking) =>
          booking.estado !== 'cancelada' &&
          booking.estado !== 'expirada' &&
          !booking.expirado
      )
      .filter((booking) => {
        if (!term) return true;
        const haystack = [
          booking.numero_reserva,
          booking.cliente?.nombre,
          booking.cliente?.telefono,
          booking.nombre_barco,
          booking.numero_amarre,
          booking.ubicacion_entrega,
          booking.items?.map((item) => item.producto_nombre).join(' '),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(term);
      });
  }, [bookings, searchTerm]);

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
          <h1 className="text-3xl font-bold text-slate-900 mb-2">Entregas</h1>
          <p className="text-slate-600">
            Listado de reservas activas para el equipo de entregas.
          </p>
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input
            type="text"
            placeholder="Buscar por cliente, barco o reserva..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 pl-10 text-sm text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {filteredBookings.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center text-slate-500">
          No hay entregas pendientes con esos criterios.
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {filteredBookings.map((booking) => {
            const date = getDateValue(booking.fecha_inicio);
            const location = booking.ubicacion_entrega
              ? LOCATION_LABELS[booking.ubicacion_entrega] || booking.ubicacion_entrega
              : 'Sin ubicación';
            return (
              <div
                key={booking.id}
                className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex flex-col gap-4"
              >
                <div className="flex items-start justify-between gap-4">
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

                <div className="text-sm text-slate-700 font-semibold">
                  {getItemsLabel(booking)}
                </div>

                <div className="space-y-2 text-sm text-slate-600">
                  <div className="flex items-center gap-2">
                    <MapPin size={16} className="text-blue-600" />
                    <span>
                      {location}
                      {booking.nombre_barco ? ` · ${booking.nombre_barco}` : ''}
                      {booking.numero_amarre ? ` · Amarre ${booking.numero_amarre}` : ''}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Phone size={16} className="text-blue-600" />
                    <span>{booking.cliente?.telefono || 'Sin teléfono'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CalendarDays size={16} className="text-blue-600" />
                    <span>
                      {booking.fecha_inicio} → {booking.fecha_fin}
                    </span>
                  </div>
                </div>

                <div className="text-xs text-slate-500">
                  Cliente: {booking.cliente?.nombre || 'Sin nombre'}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
