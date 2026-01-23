'use client';

import { useEffect, useState } from 'react';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { useAuthStore } from '@/store/authStore';
import { Booking } from '@/types';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Plus, Eye, Share2, Calendar, Euro, Wallet, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { usePartnerCommissions } from '@/lib/firebase/hooks/usePartnerCommissions';

function getDate(dateValue: any): Date {
  if (!dateValue) return new Date();
  if (dateValue instanceof Date) return dateValue;
  if (dateValue?.toDate) return dateValue.toDate();
  if (typeof dateValue === 'string') return new Date(dateValue);
  if (typeof dateValue === 'number') return new Date(dateValue);
  return new Date();
}

export default function BrokerDashboard() {
  const { user } = useAuthStore();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    total: 0,
    pendientes: 0,
    confirmadas: 0,
    completadas: 0,
  });
  
  // Fetch commission data
  const {
    pendiente: pendingCommission,
    totalComisiones,
    loading: commissionLoading
  } = usePartnerCommissions(
    user?.id,
    user?.rol as 'broker' | 'agency' | undefined
  );

  useEffect(() => {
    if (!user) return;

    const fetchBookings = async () => {
      try {
        const bookingsRef = collection(db, 'bookings');
        const q = query(
          bookingsRef,
          where(user.rol === 'broker' ? 'broker_id' : 'agency_id', '==', user.id),
          orderBy('creado_en', 'desc')
        );
        
        const snapshot = await getDocs(q);
        const bookingsData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
        })) as Booking[];

        setBookings(bookingsData);
        
        // Calculate stats
        setStats({
          total: bookingsData.length,
          pendientes: bookingsData.filter(b => b.estado === 'pendiente').length,
          confirmadas: bookingsData.filter(b => b.estado === 'confirmada').length,
          completadas: bookingsData.filter(b => b.estado === 'completada').length,
        });
      } catch (error: any) {
        console.error('Error fetching bookings:', error);
        // If index error, try without orderBy
        if (error.code === 'failed-precondition') {
          try {
            const bookingsRef = collection(db, 'bookings');
            const q2 = query(
              bookingsRef,
              where(user.rol === 'broker' ? 'broker_id' : 'agency_id', '==', user.id)
            );
            const snapshot2 = await getDocs(q2);
            const bookingsData2 = snapshot2.docs.map(doc => ({
              id: doc.id,
              ...doc.data(),
            })) as Booking[];
            setBookings(bookingsData2.sort((a, b) => {
              const dateA = getDate(a.creado_en);
              const dateB = getDate(b.creado_en);
              return dateB.getTime() - dateA.getTime();
            }));
            setStats({
              total: bookingsData2.length,
              pendientes: bookingsData2.filter(b => b.estado === 'pendiente').length,
              confirmadas: bookingsData2.filter(b => b.estado === 'confirmada').length,
              completadas: bookingsData2.filter(b => b.estado === 'completada').length,
            });
          } catch (err) {
            console.error('Error fetching bookings without orderBy:', err);
          }
        }
      } finally {
        setLoading(false);
      }
    };

    fetchBookings();
  }, [user]);

  const handleShare = async (booking: Booking) => {
    if (booking.token_acceso) {
      const contractUrl = `${window.location.origin}/contract/${booking.id}?t=${booking.token_acceso}`;
      await navigator.clipboard.writeText(contractUrl);
      alert('Enlace copiado al portapapeles');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-slate-200 border-t-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-slate-600 mt-1">Bienvenido, {user?.nombre}</p>
        </div>
        <Link
          href="/broker/reservas?new=true"
          className="btn-primary"
        >
          <Plus size={20} />
          Nueva Reserva
        </Link>
      </div>

      {/* Commission Banner */}
      {pendingCommission > 0 && (
        <Link 
          href="/broker/comisiones"
          className="block bg-linear-to-r from-amber-500 to-orange-500 rounded-xl p-6 shadow-lg text-white hover:shadow-xl transition-all group"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-white/20 rounded-full">
                <Wallet size={28} />
              </div>
              <div>
                <p className="text-amber-100 font-medium">Comisiones Pendientes de Cobro</p>
                <p className="text-3xl font-bold">€{pendingCommission.toFixed(2)}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-amber-100 group-hover:text-white group-hover:translate-x-1 transition-all">
              <span className="hidden sm:inline">Ver detalles</span>
              <ArrowRight size={20} />
            </div>
          </div>
        </Link>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-600 font-medium">Total Reservas</p>
              <p className="text-3xl font-bold text-slate-900 mt-2">{stats.total}</p>
            </div>
            <div className="h-12 w-12 bg-blue-100 rounded-lg flex items-center justify-center">
              <Calendar className="text-blue-600" size={24} />
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-600 font-medium">Pendientes</p>
              <p className="text-3xl font-bold text-yellow-600 mt-2">{stats.pendientes}</p>
            </div>
            <div className="h-12 w-12 bg-yellow-100 rounded-lg flex items-center justify-center">
              <Calendar className="text-yellow-600" size={24} />
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-600 font-medium">Confirmadas</p>
              <p className="text-3xl font-bold text-green-600 mt-2">{stats.confirmadas}</p>
            </div>
            <div className="h-12 w-12 bg-green-100 rounded-lg flex items-center justify-center">
              <Calendar className="text-green-600" size={24} />
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-600 font-medium">Completadas</p>
              <p className="text-3xl font-bold text-slate-600 mt-2">{stats.completadas}</p>
            </div>
            <div className="h-12 w-12 bg-slate-100 rounded-lg flex items-center justify-center">
              <Calendar className="text-slate-600" size={24} />
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-600 font-medium">Comisiones Totales</p>
              <p className="text-3xl font-bold text-emerald-600 mt-2">€{totalComisiones.toFixed(0)}</p>
            </div>
            <div className="h-12 w-12 bg-emerald-100 rounded-lg flex items-center justify-center">
              <Wallet className="text-emerald-600" size={24} />
            </div>
          </div>
        </div>
      </div>

      {/* Recent Bookings */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200">
          <h2 className="text-xl font-bold text-slate-900">Reservas Recientes</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Reserva</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Cliente</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Fechas</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Total</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Estado</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {bookings.slice(0, 10).map((booking) => (
                <tr key={booking.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-slate-900">{booking.numero_reserva}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-slate-900">{booking.cliente.nombre}</div>
                    <div className="text-xs text-slate-500">{booking.cliente.email}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-slate-900">
                      {format(getDate(booking.fecha_inicio), 'dd MMM', { locale: es })} - {format(getDate(booking.fecha_fin), 'dd MMM', { locale: es })}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-1 text-sm font-semibold text-slate-900">
                      <Euro size={14} />
                      {booking.precio_total.toFixed(2)}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                      booking.estado === 'confirmada' ? 'bg-green-100 text-green-700' :
                      booking.estado === 'pendiente' ? 'bg-yellow-100 text-yellow-700' :
                      booking.estado === 'completada' ? 'bg-blue-100 text-blue-700' :
                      'bg-red-100 text-red-700'
                    }`}>
                      {booking.estado}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleShare(booking)}
                        className="btn-icon text-slate-600 hover:bg-slate-100"
                        title="Compartir enlace"
                      >
                        <Share2 size={18} />
                      </button>
                      <Link
                        href={`/broker/reservas?id=${booking.id}`}
                        className="btn-icon text-slate-600 hover:bg-slate-100"
                        title="Ver detalles"
                      >
                        <Eye size={18} />
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {bookings.length === 0 && (
            <div className="px-6 py-12 text-center text-slate-500">
              No hay reservas aún. Crea tu primera reserva para comenzar.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
