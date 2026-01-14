'use client';

import { useState, useEffect } from 'react';
import { collection, query, orderBy, onSnapshot, where, getDocs, updateDoc, deleteDoc, doc, serverTimestamp, writeBatch, increment } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { Booking, Product, User } from '@/types';
import { BookingForm } from '@/components/bookings/BookingForm';
import { useAuthStore } from '@/store/authStore';
import { useSearchParams } from 'next/navigation';
import { 
  CalendarDays, 
  Plus, 
  Search, 
  Filter, 
  CheckCircle2, 
  Clock, 
  XCircle, 
  FileCheck,
  Eye,
  Share2,
  Euro,
  Loader2,
  Trash2,
  Ban
} from 'lucide-react';
import { format, eachDayOfInterval } from 'date-fns';
import { es } from 'date-fns/locale';
import clsx from 'clsx';

function getDate(dateValue: any): Date {
  if (!dateValue) return new Date();
  if (dateValue instanceof Date) return dateValue;
  if (dateValue?.toDate) return dateValue.toDate();
  if (typeof dateValue === 'string') return new Date(dateValue);
  if (typeof dateValue === 'number') return new Date(dateValue);
  return new Date();
}

export default function BrokerReservasPage() {
  const { user } = useAuthStore();
  const searchParams = useSearchParams();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [products, setProducts] = useState<Record<string, Product>>({});
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [startDateFilter, setStartDateFilter] = useState('');
  const [endDateFilter, setEndDateFilter] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [viewingBooking, setViewingBooking] = useState<Booking | null>(null);

  // Check if we should open the form modal
  useEffect(() => {
    if (searchParams.get('new') === 'true') {
      setIsModalOpen(true);
    }
    if (searchParams.get('id')) {
      // Fetch and show booking details
      const bookingId = searchParams.get('id');
      const booking = bookings.find(b => b.id === bookingId);
      if (booking) {
        setViewingBooking(booking);
      }
    }
  }, [searchParams, bookings]);

  // Fetch products for reference
  useEffect(() => {
    const fetchProducts = async () => {
      try {
        const q = query(collection(db, 'products'), where('activo', '==', true));
        const snapshot = await getDocs(q);
        const productMap: Record<string, Product> = {};
        snapshot.docs.forEach(doc => {
          productMap[doc.id] = { id: doc.id, ...doc.data() } as Product;
        });
        setProducts(productMap);
      } catch (error) {
        console.error('Error fetching products:', error);
      }
    };
    fetchProducts();
  }, []);

  // Real-time bookings for this broker/agency
  useEffect(() => {
    if (!user) return;

    const fieldName = user.rol === 'broker' ? 'broker_id' : 'agency_id';
    const bookingsRef = collection(db, 'bookings');
    
    // Try with orderBy first
    const q = query(
      bookingsRef,
      where(fieldName, '==', user.id),
      orderBy('creado_en', 'desc')
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const bookingsData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as Booking[];
        setBookings(bookingsData);
        setLoading(false);
      },
      (error) => {
        // If index error, try without orderBy
        if (error.code === 'failed-precondition') {
          const q2 = query(
            bookingsRef,
            where(fieldName, '==', user.id)
          );
          getDocs(q2).then(snapshot => {
            const bookingsData = snapshot.docs.map(doc => ({
              id: doc.id,
              ...doc.data()
            })) as Booking[];
            // Sort manually
            bookingsData.sort((a, b) => {
              const dateA = getDate(a.creado_en);
              const dateB = getDate(b.creado_en);
              return dateB.getTime() - dateA.getTime();
            });
            setBookings(bookingsData);
            setLoading(false);
          }).catch(err => {
            console.error('Error fetching bookings:', err);
            setLoading(false);
          });
        } else {
          console.error('Error fetching bookings:', error);
          setLoading(false);
        }
      }
    );

    return () => unsubscribe();
  }, [user]);

  // Auto-expire bookings that exceeded their hold window
  useEffect(() => {
    if (!bookings.length) return;
    bookings.forEach((booking) => {
      expireBookingIfNeeded(booking);
    });
  }, [bookings]);

  const copyContractLink = (booking: Booking) => {
    if (!booking.token_acceso) {
      alert('Esta reserva no tiene enlace público generado.');
      return;
    }
    const url = `${window.location.origin}/contract/${booking.id}?t=${booking.token_acceso}`;
    navigator.clipboard.writeText(url);
    alert('Enlace del contrato copiado al portapapeles');
  };

  const adjustStockReservation = async (bookingToUpdate: Booking, delta: number) => {
    if (!bookingToUpdate?.items?.length) return;
    const start = getDate(bookingToUpdate.fecha_inicio);
    const end = getDate(bookingToUpdate.fecha_fin);
    const days = eachDayOfInterval({ start, end });
    const batch = writeBatch(db);

    days.forEach((day) => {
      const dateStr = format(day, 'yyyy-MM-dd');
      bookingToUpdate.items.forEach((item) => {
        const stockRef = doc(db, 'daily_stock', `${dateStr}_${item.producto_id}`);
        batch.set(
          stockRef,
          {
            fecha: dateStr,
            producto_id: item.producto_id,
            cantidad_reservada: increment(delta * item.cantidad),
            actualizado_por: user?.id || 'system',
            timestamp: serverTimestamp(),
          },
          { merge: true }
        );
      });
    });

    await batch.commit();
  };

  const expireBookingIfNeeded = async (booking: Booking) => {
    if (!booking.expiracion) return;
    if (booking.pago_realizado || booking.acuerdo_firmado) return;
    if (booking.expirado || booking.estado === 'expirada') return;

    const expirationDate = getDate(booking.expiracion);
    if (new Date() <= expirationDate) return;

    try {
      await updateDoc(doc(db, 'bookings', booking.id), {
        estado: 'expirada',
        expirado: true,
        updated_at: serverTimestamp(),
      });
      await adjustStockReservation(booking, -1);
    } catch (error) {
      console.error('Error expiring booking:', error);
    }
  };

  const handleCancelBooking = async (booking: Booking) => {
    if (!confirm(`¿Estás seguro de que deseas cancelar la reserva ${booking.numero_reserva}?\n\nEsto cambiará el estado a "cancelada" pero mantendrá el registro.`)) {
      return;
    }

    try {
      if (booking.estado !== 'expirada') {
        await adjustStockReservation(booking, -1);
      }
      await updateDoc(doc(db, 'bookings', booking.id), {
        estado: 'cancelada',
        updated_at: serverTimestamp()
      });
      alert('Reserva cancelada correctamente');
    } catch (error) {
      console.error('Error canceling booking:', error);
      alert('Error al cancelar la reserva');
    }
  };

  const handleDeleteBooking = async (booking: Booking) => {
    if (!confirm(`⚠️ ¿Estás ABSOLUTAMENTE seguro de que deseas ELIMINAR permanentemente la reserva ${booking.numero_reserva}?\n\n✗ Esta acción NO se puede deshacer\n✗ Se perderá todo el historial\n✗ No se puede recuperar\n\n¿Continuar?`)) {
      return;
    }

    // Double confirmation for safety
    if (!confirm(`ÚLTIMA CONFIRMACIÓN:\n\nEliminar reserva ${booking.numero_reserva} de ${booking.cliente.nombre}\nTotal: €${booking.precio_total}\n\n¿Eliminar definitivamente?`)) {
      return;
    }

    try {
      if (booking.estado !== 'expirada') {
        await adjustStockReservation(booking, -1);
      }
      await deleteDoc(doc(db, 'bookings', booking.id));
      alert('Reserva eliminada permanentemente');
    } catch (error) {
      console.error('Error deleting booking:', error);
      alert('Error al eliminar la reserva');
    }
  };

  const filteredBookings = bookings.filter(booking => {
    const bookingStart = getDate(booking.fecha_inicio);
    const bookingEnd = getDate(booking.fecha_fin);
    const filterStart = startDateFilter ? new Date(`${startDateFilter}T00:00:00`) : null;
    const filterEnd = endDateFilter ? new Date(`${endDateFilter}T23:59:59`) : null;

    const matchesSearch = 
      booking.cliente.nombre.toLowerCase().includes(searchTerm.toLowerCase()) ||
      booking.numero_reserva.toLowerCase().includes(searchTerm.toLowerCase()) ||
      booking.cliente.email.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesStatus = statusFilter === 'all' || booking.estado === statusFilter;

    const matchesDateRange =
      (!filterStart || bookingEnd >= filterStart) &&
      (!filterEnd || bookingStart <= filterEnd);

    return matchesSearch && matchesStatus && matchesDateRange;
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'confirmada': return 'bg-green-100 text-green-700 border-green-200';
      case 'pendiente': return 'bg-yellow-100 text-yellow-700 border-yellow-200';
      case 'completada': return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'cancelada': return 'bg-red-100 text-red-700 border-red-200';
      case 'expirada': return 'bg-orange-100 text-orange-700 border-orange-200';
      default: return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'confirmada': return <CheckCircle2 size={16} />;
      case 'pendiente': return <Clock size={16} />;
      case 'completada': return <FileCheck size={16} />;
      case 'cancelada': return <XCircle size={16} />;
      case 'expirada': return <Clock size={16} />;
      default: return <Clock size={16} />;
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <Loader2 className="animate-spin text-blue-600 mb-4" size={48} />
        <p className="text-gray-500">Cargando reservas...</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 mb-2">Mis Reservas</h1>
          <p className="text-slate-600">Gestiona las reservas que has creado.</p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="btn-primary"
        >
          <Plus size={20} />
          Nueva Reserva
        </button>
      </div>

      {/* Search and Filter */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-6">
        <div className="flex flex-col lg:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" size={20} />
            <input
              type="text"
              placeholder="Buscar por cliente, email o número de reserva..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>

          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-slate-500 uppercase">Desde</label>
              <input
                type="date"
                value={startDateFilter}
                onChange={(e) => setStartDateFilter(e.target.value)}
                className="px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-slate-500 uppercase">Hasta</label>
              <input
                type="date"
                value={endDateFilter}
                onChange={(e) => setEndDateFilter(e.target.value)}
                className="px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm"
              />
            </div>
            {(startDateFilter || endDateFilter) && (
              <button
                type="button"
                onClick={() => {
                  setStartDateFilter('');
                  setEndDateFilter('');
                }}
                className="btn-ghost text-sm"
              >
                Limpiar fechas
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Filter className="text-slate-400" size={20} />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            >
              <option value="all">Todos los estados</option>
              <option value="pendiente">Pendiente</option>
              <option value="confirmada">Confirmada</option>
              <option value="completada">Completada</option>
              <option value="cancelada">Cancelada</option>
              <option value="expirada">Expirada</option>
            </select>
          </div>
        </div>
      </div>

      {/* Bookings Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Reserva</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Cliente</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Fechas</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Productos</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Total</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Estado</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Firmado</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Pagado</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredBookings.map((booking) => (
                <tr key={booking.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-slate-900">{booking.numero_reserva}</div>
                    <div className="text-xs text-slate-500">
                      {format(getDate(booking.creado_en), 'dd MMM yyyy', { locale: es })}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-slate-900">{booking.cliente.nombre}</div>
                    <div className="text-xs text-slate-500">{booking.cliente.email}</div>
                    <div className="text-xs text-slate-500">{booking.cliente.telefono}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-slate-900">
                      {format(getDate(booking.fecha_inicio), 'dd MMM', { locale: es })} - {format(getDate(booking.fecha_fin), 'dd MMM', { locale: es })}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm text-slate-900">
                      {booking.items.map((item, idx) => {
                        const product = products[item.producto_id];
                        return (
                          <div key={idx} className="text-xs">
                            {product?.nombre || 'Producto desconocido'} x{item.cantidad}
                          </div>
                        );
                      })}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-1 text-sm font-semibold text-slate-900">
                      <Euro size={14} />
                      {booking.precio_total.toFixed(2)}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={clsx(
                      "px-3 py-1 rounded-full text-xs font-medium border flex items-center gap-1 w-fit",
                      getStatusColor(booking.estado)
                    )}>
                      {getStatusIcon(booking.estado)}
                      {booking.estado}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {booking.terminos_aceptados ? (
                      <span className="text-green-600 text-sm">✓ Firmado</span>
                    ) : (
                      <span className="text-slate-400 text-sm">Pendiente</span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {booking.pago_realizado ? (
                      <span className="text-green-600 text-sm">✓ Pagado</span>
                    ) : (
                      <span className="text-slate-400 text-sm">Pendiente</span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => copyContractLink(booking)}
                        className="btn-icon text-slate-600 hover:bg-emerald-50 hover:text-emerald-600"
                        title="Compartir enlace"
                      >
                        <Share2 size={18} />
                      </button>
                      <button
                        onClick={() => setViewingBooking(booking)}
                        className="btn-icon text-slate-600 hover:bg-blue-50 hover:text-blue-600"
                        title="Ver detalles"
                      >
                        <Eye size={18} />
                      </button>
                      {booking.estado !== 'cancelada' && booking.estado !== 'expirada' && (
                        <button
                          onClick={() => handleCancelBooking(booking)}
                          className="btn-icon text-slate-600 hover:bg-orange-50 hover:text-orange-600"
                          title="Cancelar reserva"
                        >
                          <Ban size={18} />
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteBooking(booking)}
                        className="btn-icon text-slate-600 hover:bg-red-50 hover:text-red-600"
                        title="Eliminar reserva"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredBookings.length === 0 && (
            <div className="px-6 py-12 text-center text-slate-500">
              {bookings.length === 0 
                ? 'No hay reservas aún. Crea tu primera reserva para comenzar.'
                : 'No se encontraron reservas con los filtros aplicados.'}
            </div>
          )}
        </div>
      </div>

      {/* Booking Form Modal */}
      {isModalOpen && (
        <BookingForm
          onClose={() => setIsModalOpen(false)}
          onSuccess={() => {
            setIsModalOpen(false);
            // Refresh will happen automatically via real-time listener
          }}
        />
      )}

      {/* Booking Details Modal */}
      {viewingBooking && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
              <h2 className="text-2xl font-bold text-slate-900">Detalles de la Reserva</h2>
              <button
                onClick={() => setViewingBooking(null)}
                className="btn-icon text-slate-500 hover:text-slate-700 hover:bg-slate-100"
              >
                <XCircle size={24} />
              </button>
            </div>
            <div className="p-6 space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-slate-500 uppercase">Número de Reserva</label>
                  <p className="text-lg font-bold text-slate-900">{viewingBooking.numero_reserva}</p>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 uppercase">Estado</label>
                  <span className={clsx(
                    "inline-block px-3 py-1 rounded-full text-sm font-medium border",
                    getStatusColor(viewingBooking.estado)
                  )}>
                    {viewingBooking.estado}
                  </span>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase mb-2 block">Cliente</label>
                <div className="bg-slate-50 rounded-lg p-4 space-y-2 text-slate-800">
                  <p className="text-sm"><span className="font-semibold text-slate-700">Nombre:</span> {viewingBooking.cliente.nombre}</p>
                  <p className="text-sm"><span className="font-semibold text-slate-700">Email:</span> {viewingBooking.cliente.email}</p>
                  <p className="text-sm"><span className="font-semibold text-slate-700">Teléfono:</span> {viewingBooking.cliente.telefono}</p>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase mb-2 block">Productos</label>
                <div className="bg-slate-50 rounded-lg p-4 space-y-2 text-slate-800">
                  {viewingBooking.items.map((item, idx) => {
                    const product = products[item.producto_id];
                    return (
                      <div key={idx} className="flex justify-between">
                        <span className="text-sm text-slate-800">{product?.nombre || 'Producto desconocido'} x{item.cantidad}</span>
                        <span className="text-sm font-semibold text-slate-700">{item.tipo_alquiler === 'dia' ? `${item.duracion} día(s)` : `${item.duracion} hora(s)`}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase mb-2 block">Detalles de Entrega</label>
                <div className="bg-slate-50 rounded-lg p-4 space-y-2 text-slate-800">
                  <p className="text-sm"><span className="font-semibold text-slate-700">Ubicación:</span> {
                    viewingBooking.ubicacion_entrega === 'marina_ibiza' ? 'Marina Ibiza' :
                    viewingBooking.ubicacion_entrega === 'marina_botafoch' ? 'Marina Botafoch' :
                    viewingBooking.ubicacion_entrega === 'club_nautico' ? 'Club Náutico' :
                    viewingBooking.ubicacion_entrega || 'No especificado'
                  }</p>
                  {viewingBooking.nombre_barco && (
                    <p className="text-sm"><span className="font-semibold text-slate-700">Barco:</span> {viewingBooking.nombre_barco}</p>
                  )}
                  {viewingBooking.numero_amarre && (
                    <p className="text-sm"><span className="font-semibold text-slate-700">Amarre:</span> {viewingBooking.numero_amarre}</p>
                  )}
                  {viewingBooking.hora_entrega && (
                    <p className="text-sm"><span className="font-semibold text-slate-700">Hora:</span> {viewingBooking.hora_entrega}</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-slate-500 uppercase">Total</label>
                  <p className="text-2xl font-bold text-slate-900 flex items-center gap-1">
                    <Euro size={24} />
                    {viewingBooking.precio_total.toFixed(2)}
                  </p>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 uppercase">Fechas</label>
                  <p className="text-sm text-slate-900">
                    {format(getDate(viewingBooking.fecha_inicio), 'dd MMM yyyy', { locale: es })} - {format(getDate(viewingBooking.fecha_fin), 'dd MMM yyyy', { locale: es })}
                  </p>
                </div>
              </div>

              {viewingBooking.notas && (
                <div>
                  <label className="text-xs font-semibold text-slate-500 uppercase mb-2 block">Notas</label>
                  <p className="text-sm text-slate-700 bg-slate-50 rounded-lg p-4">{viewingBooking.notas}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
