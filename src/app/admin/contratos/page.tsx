'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import type { Booking } from '@/types';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Copy, ExternalLink, FileText } from 'lucide-react';
import clsx from 'clsx';

const statusStyles: Record<string, string> = {
  confirmada: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  pendiente: 'bg-amber-100 text-amber-700 border-amber-200',
  completada: 'bg-blue-100 text-blue-700 border-blue-200',
  cancelada: 'bg-rose-100 text-rose-700 border-rose-200',
};

const getSafeDate = (value: any): Date => {
  if (!value) return new Date();
  if (typeof value?.toDate === 'function') return value.toDate();
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
};

export default function ContractsPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    const q = query(collection(db, 'bookings'), orderBy('creado_en', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as Booking[];
      setBookings(data);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const filteredBookings = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return bookings;

    return bookings.filter((booking) => {
      const nombre = booking.cliente?.nombre?.toLowerCase() || '';
      const email = booking.cliente?.email?.toLowerCase() || '';
      const referencia = booking.numero_reserva?.toLowerCase() || '';
      return nombre.includes(term) || email.includes(term) || referencia.includes(term);
    });
  }, [bookings, searchTerm]);

  const handleCopy = async (booking: Booking) => {
    if (!booking.token_acceso) {
      alert('Esta reserva no tiene enlace publico generado.');
      return;
    }
    const url = `${window.location.origin}/contract/${booking.id}?t=${booking.token_acceso}`;
    await navigator.clipboard.writeText(url);
    alert('Enlace del contrato copiado al portapapeles.');
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        <p className="text-gray-500 mt-4">Cargando contratos...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-800 mb-2">Contratos</h1>
          <p className="text-gray-500">
            Accede a los contratos generados desde las reservas y comparte enlaces cuando sea
            necesario.
          </p>
        </div>

        <div className="w-full md:w-80">
          <input
            type="text"
            placeholder="Buscar por cliente, email o referencia..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 uppercase text-xs tracking-wide">
              <tr>
                <th className="px-6 py-4 text-left font-semibold">Reserva</th>
                <th className="px-6 py-4 text-left font-semibold">Cliente</th>
                <th className="px-6 py-4 text-left font-semibold">Fechas</th>
                <th className="px-6 py-4 text-left font-semibold">Estado</th>
                <th className="px-6 py-4 text-left font-semibold">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredBookings.length === 0 ? (
                <tr>
                  <td className="px-6 py-10 text-center text-slate-500" colSpan={5}>
                    No hay contratos que coincidan con la busqueda.
                  </td>
                </tr>
              ) : (
                filteredBookings.map((booking) => {
                  const contractUrl = booking.token_acceso
                    ? `/contract/${booking.id}?t=${booking.token_acceso}`
                    : null;
                  const statusClass = statusStyles[booking.estado] || 'bg-slate-100 text-slate-600 border-slate-200';

                  return (
                    <tr key={booking.id} className="hover:bg-slate-50/80">
                      <td className="px-6 py-4">
                        <div className="font-semibold text-slate-800">
                          {booking.numero_reserva || booking.id}
                        </div>
                        <div className="text-xs text-slate-400 mt-1">
                          Creado {format(getSafeDate(booking.creado_en), 'dd MMM yyyy', { locale: es })}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-medium text-slate-700">{booking.cliente?.nombre}</div>
                        <div className="text-xs text-slate-400">{booking.cliente?.email}</div>
                      </td>
                      <td className="px-6 py-4 text-slate-600">
                        {format(getSafeDate(booking.fecha_inicio), 'dd MMM', { locale: es })} -{' '}
                        {format(getSafeDate(booking.fecha_fin), 'dd MMM yyyy', { locale: es })}
                      </td>
                      <td className="px-6 py-4">
                        <span className={clsx('inline-flex items-center px-3 py-1 rounded-full border text-xs font-semibold', statusClass)}>
                          {booking.estado}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-2">
                          {contractUrl ? (
                            <a
                              href={contractUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="btn-primary text-xs"
                            >
                              <ExternalLink size={14} />
                              Ver contrato
                            </a>
                          ) : (
                            <span className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-400">
                              <FileText size={14} />
                              Sin enlace
                            </span>
                          )}

                          <button
                            type="button"
                            onClick={() => handleCopy(booking)}
                            className="btn-outline text-xs"
                          >
                            <Copy size={14} />
                            Copiar enlace
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
