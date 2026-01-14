'use client';

import { useState, useEffect } from 'react';
import { collection, query, orderBy, onSnapshot, deleteDoc, doc, where, getDocs, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { Booking, Product, User } from '@/types';
import { BookingForm } from '@/components/bookings/BookingForm';
import { PaymentRefundManager } from '@/components/bookings/PaymentRefundManager';
import { 
  CalendarDays, 
  Plus, 
  Search, 
  Filter, 
  MoreVertical, 
  CheckCircle2, 
  Clock, 
  XCircle, 
  FileCheck,
  Trash2,
  Eye,
  Share2,
  PenTool,
  CreditCard,
  User as UserIcon,
  Briefcase,
  X,
  ShoppingBag,
  Calendar,
  Copy,
  Euro,
  Ban
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import clsx from 'clsx';

export default function BookingsPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [products, setProducts] = useState<Record<string, Product>>({});
  const [users, setUsers] = useState<Record<string, User>>({});
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [paymentFilter, setPaymentFilter] = useState<'all' | 'paid' | 'unpaid' | 'refunded'>('all');
  const [timeFilter, setTimeFilter] = useState<'today' | 'upcoming' | 'all'>('today');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [viewingBooking, setViewingBooking] = useState<Booking | null>(null);
  const [paymentManaging, setPaymentManaging] = useState<Booking | null>(null);

  // Fetch products for reference
  useEffect(() => {
    const fetchProducts = async () => {
      const q = query(collection(db, 'products'));
      const snapshot = await getDocs(q);
      const productMap: Record<string, Product> = {};
      snapshot.docs.forEach(doc => {
        productMap[doc.id] = { id: doc.id, ...doc.data() } as Product;
      });
      setProducts(productMap);
    };
    fetchProducts();
  }, []);

  // Fetch users (brokers, agencies, collaborators) for reference
  useEffect(() => {
    const fetchUsers = async () => {
      const q = query(collection(db, 'users'));
      const snapshot = await getDocs(q);
      const userMap: Record<string, User> = {};
      snapshot.docs.forEach(doc => {
        userMap[doc.id] = { id: doc.id, ...doc.data() } as User;
      });
      setUsers(userMap);
    };
    fetchUsers();
  }, []);

  // Real-time bookings
  useEffect(() => {
    const q = query(collection(db, 'bookings'), orderBy('creado_en', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const bookingsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Booking[];
      setBookings(bookingsData);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const handleCancelBooking = async (booking: Booking) => {
    if (!confirm(`¿Estás seguro de que deseas cancelar la reserva ${booking.numero_reserva}?\n\nEsto cambiará el estado a "cancelada" pero mantendrá el registro.`)) {
      return;
    }

    try {
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

  const handleDelete = async (id: string, booking: Booking) => {
    if (!confirm(`⚠️ ¿Estás ABSOLUTAMENTE seguro de que deseas ELIMINAR permanentemente la reserva ${booking.numero_reserva}?\n\n✗ Esta acción NO se puede deshacer\n✗ Se perderá todo el historial\n✗ No se puede recuperar\n\n¿Continuar?`)) {
      return;
    }

    // Double confirmation for safety
    if (!confirm(`ÚLTIMA CONFIRMACIÓN:\n\nEliminar reserva ${booking.numero_reserva} de ${booking.cliente.nombre}\nTotal: €${booking.precio_total}\n\n¿Eliminar definitivamente?`)) {
      return;
    }

    try {
      await deleteDoc(doc(db, 'bookings', id));
      alert('Reserva eliminada permanentemente');
    } catch (error) {
      console.error('Error deleting booking:', error);
      alert('Error al eliminar la reserva');
    }
  };

  const copyContractLink = (booking: Booking) => {
    if (!booking.token_acceso) {
        alert('Esta reserva no tiene enlace público generado.');
        return;
    }
    const url = `${window.location.origin}/contract/${booking.id}?t=${booking.token_acceso}`;
    navigator.clipboard.writeText(url);
    alert('Enlace del contrato copiado al portapapeles');
  };

  const copyText = (text: string, label: string) => {
    if (!text) {
      alert('No hay información para copiar.');
      return;
    }
    navigator.clipboard.writeText(text);
    alert(`${label} copiado al portapapeles`);
  };

  const getLocationLabel = (booking: Booking) => {
    if (!booking.ubicacion_entrega) return 'No especificado';
    if (booking.ubicacion_entrega === 'marina_ibiza') return 'Marina Ibiza';
    if (booking.ubicacion_entrega === 'marina_botafoch') return 'Marina Botafoch';
    if (booking.ubicacion_entrega === 'club_nautico') return 'Club Náutico';
    return booking.ubicacion_entrega;
  };

  const getDeliverySummary = (booking: Booking) => {
    const parts = [
      `Ubicación: ${getLocationLabel(booking)}`,
      booking.hora_entrega ? `Hora: ${booking.hora_entrega}` : '',
      booking.nombre_barco ? `Barco: ${booking.nombre_barco}` : '',
      booking.numero_amarre ? `Amarre: ${booking.numero_amarre}` : '',
    ].filter(Boolean);
    return parts.join(' | ');
  };

  const getProductsSummary = (booking: Booking) => {
    return booking.items
      .map((item) => {
        const name = products[item.producto_id]?.nombre || `Producto ${item.producto_id}`;
        return `x${item.cantidad} ${name}`;
      })
      .join(', ');
  };

  // Helper to safely convert Firestore timestamp to Date
  const getDate = (timestamp: any): Date => {
    if (!timestamp) return new Date();
    
    // Firestore Timestamp
    if (timestamp && typeof timestamp.toDate === 'function') {
      return timestamp.toDate();
    }
    
    // Already a Date
    if (timestamp instanceof Date) {
      return timestamp;
    }
    
    // String or number
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) {
      return new Date(); // Fallback to current date if invalid
    }
    
    return date;
  };

  const filteredBookings = bookings.filter(booking => {
    const bookingStart = getDate(booking.fecha_inicio);
    const bookingEnd = getDate(booking.fecha_fin);
    const todayStart = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
    const todayEnd = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate(), 23, 59, 59, 999);

    const matchesSearch = 
      booking.cliente.nombre.toLowerCase().includes(searchTerm.toLowerCase()) ||
      booking.numero_reserva.toLowerCase().includes(searchTerm.toLowerCase()) ||
      booking.cliente.email.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesStatus = statusFilter === 'all' || booking.estado === statusFilter;

    const matchesPayment = 
      paymentFilter === 'all' ||
      (paymentFilter === 'paid' && booking.pago_realizado && !booking.reembolso_realizado) ||
      (paymentFilter === 'unpaid' && !booking.pago_realizado) ||
      (paymentFilter === 'refunded' && booking.reembolso_realizado);

    const matchesTime =
      timeFilter === 'all'
        ? true
        : timeFilter === 'today'
          ? bookingEnd >= todayStart && bookingStart <= todayEnd
          : bookingStart > todayEnd;

    return matchesSearch && matchesStatus && matchesPayment && matchesTime;
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'confirmada': return 'bg-green-100 text-green-700 border-green-200';
      case 'pendiente': return 'bg-yellow-100 text-yellow-700 border-yellow-200';
      case 'completada': return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'cancelada': return 'bg-red-100 text-red-700 border-red-200';
      default: return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'confirmada': return <CheckCircle2 size={16} />;
      case 'pendiente': return <Clock size={16} />;
      case 'completada': return <FileCheck size={16} />;
      case 'cancelada': return <XCircle size={16} />;
      default: return <Clock size={16} />;
    }
  };

  // Helper to get agent name
  const getAgentName = (booking: Booking): string => {
    if (booking.broker_id && users[booking.broker_id]) {
      return users[booking.broker_id].nombre || 'Broker desconocido';
    }
    if (booking.agency_id && users[booking.agency_id]) {
      return users[booking.agency_id].nombre || 'Agencia desconocida';
    }
    if (booking.colaborador_id && users[booking.colaborador_id]) {
      return users[booking.colaborador_id].nombre || 'Colaborador desconocido';
    }
    if (booking.creado_por && users[booking.creado_por]) {
      const creator = users[booking.creado_por];
      if (creator.rol === 'admin') return 'Admin';
      return creator.nombre || 'Usuario desconocido';
    }
    return 'Directo';
  };

  // Helper to get agent type
  const getAgentType = (booking: Booking): string => {
    if (booking.broker_id) return 'Broker';
    if (booking.agency_id) return 'Agencia';
    if (booking.colaborador_id) return 'Colaborador';
    if (booking.creado_por && users[booking.creado_por]) {
      return users[booking.creado_por].rol === 'admin' ? 'Admin' : 'Usuario';
    }
    return 'Directo';
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        <p className="text-gray-500 mt-4">Cargando reservas...</p>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 sm:gap-4 mb-6 sm:mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 mb-2">Reservas</h1>
          <p className="text-gray-500">Gestiona y supervisa todas las reservas del sistema.</p>
        </div>
        
        <button 
          onClick={() => setIsModalOpen(true)}
          className="btn-primary w-full sm:w-auto"
        >
          <Plus size={20} />
          <span>Nueva Reserva</span>
        </button>
      </div>

      {/* Quick Overview */}
      <div className="grid gap-3 sm:gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        {(() => {
          const todayStart = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
          const todayEnd = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate(), 23, 59, 59, 999);
          const todaysBookings = bookings.filter((booking) => {
            const start = getDate(booking.fecha_inicio);
            const end = getDate(booking.fecha_fin);
            return end >= todayStart && start <= todayEnd;
          });
          const todayTotal = todaysBookings.reduce((sum, booking) => sum + (booking.precio_total || 0), 0);
          const todayPending = todaysBookings.filter((booking) => booking.estado === 'pendiente').length;
          const todayConfirmed = todaysBookings.filter((booking) => booking.estado === 'confirmada').length;
          return (
            <>
              <div className="bg-white border border-gray-200 rounded-2xl p-3 sm:p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase text-gray-500 font-semibold">Reservas de Hoy</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">{todaysBookings.length}</p>
                  </div>
                  <div className="p-3 rounded-xl bg-blue-50 text-blue-600">
                    <Calendar size={20} />
                  </div>
                </div>
              </div>
              <div className="bg-white border border-gray-200 rounded-2xl p-3 sm:p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase text-gray-500 font-semibold">Pendientes Hoy</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">{todayPending}</p>
                  </div>
                  <div className="p-3 rounded-xl bg-yellow-50 text-yellow-600">
                    <Clock size={20} />
                  </div>
                </div>
              </div>
              <div className="bg-white border border-gray-200 rounded-2xl p-3 sm:p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase text-gray-500 font-semibold">Confirmadas Hoy</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">{todayConfirmed}</p>
                  </div>
                  <div className="p-3 rounded-xl bg-green-50 text-green-600">
                    <CheckCircle2 size={20} />
                  </div>
                </div>
              </div>
              <div className="bg-white border border-gray-200 rounded-2xl p-3 sm:p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase text-gray-500 font-semibold">Ingresos Hoy</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">€{todayTotal.toLocaleString('es-ES', { minimumFractionDigits: 2 })}</p>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-900 text-white">
                    <Euro size={20} />
                  </div>
                </div>
              </div>
            </>
          );
        })()}
      </div>

      {/* Filters & Search */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 mb-6 flex flex-col lg:flex-row gap-4 items-stretch lg:items-center justify-between">
        <div className="relative w-full lg:w-96">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
          <input
            type="text"
            placeholder="Buscar por nombre, referencia o email..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-gray-50 focus:bg-white transition-all"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
          {(['today', 'upcoming', 'all'] as const).map((range) => (
            <button
              key={range}
              onClick={() => setTimeFilter(range)}
              className={clsx(
                "whitespace-nowrap",
                timeFilter === range ? "btn-primary" : "btn-outline"
              )}
            >
              {range === 'today' ? 'Hoy' : range === 'upcoming' ? 'Próximas' : 'Todas'}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
          {['all', 'pendiente', 'confirmada', 'completada', 'cancelada'].map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={clsx(
                "whitespace-nowrap capitalize",
                statusFilter === status 
                  ? "btn-primary"
                  : "btn-outline"
              )}
            >
              {status === 'all' ? 'Todos' : status}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
          <div className="text-xs font-semibold text-gray-500 uppercase mr-1">Pago:</div>
          {[
            { value: 'all', label: 'Todos', icon: Filter },
            { value: 'paid', label: 'Pagado', icon: CheckCircle2 },
            { value: 'unpaid', label: 'Pendiente', icon: Clock },
            { value: 'refunded', label: 'Reembolsado', icon: XCircle }
          ].map(({value, label, icon: Icon}) => (
            <button
              key={value}
              onClick={() => setPaymentFilter(value as any)}
              className={clsx(
                "whitespace-nowrap flex items-center gap-1.5",
                paymentFilter === value 
                  ? "btn-primary"
                  : "btn-outline"
              )}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Bookings List */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {filteredBookings.length > 0 ? (
          <>
            {/* Mobile Cards */}
            <div className="md:hidden divide-y divide-gray-100">
              {filteredBookings.map((booking) => {
                const todayStart = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
                const todayEnd = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate(), 23, 59, 59, 999);
                const bookingStart = getDate(booking.fecha_inicio);
                const bookingEnd = getDate(booking.fecha_fin);
                const isToday = bookingEnd >= todayStart && bookingStart <= todayEnd;
                return (
                  <div key={booking.id} className={clsx("p-4 space-y-3", isToday && "bg-blue-50/40")}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-xs uppercase text-gray-500 font-semibold">Referencia</div>
                        <div className="font-mono text-sm font-semibold text-gray-900">{booking.numero_reserva}</div>
                        <div className="text-xs text-gray-500 mt-1">
                          {format(getDate(booking.creado_en), 'dd MMM yyyy', { locale: es })}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <span className={clsx(
                          "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border",
                          getStatusColor(booking.estado)
                        )}>
                          {getStatusIcon(booking.estado)}
                          <span className="capitalize">{booking.estado}</span>
                        </span>
                        {isToday && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 text-blue-700 text-xs font-semibold px-2 py-0.5">
                            Hoy
                          </span>
                        )}
                        {booking.reembolso_realizado ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-red-100 text-red-700 text-xs font-semibold px-2 py-0.5">
                            <XCircle size={12} />
                            Reembolsado
                          </span>
                        ) : booking.pago_realizado ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-green-100 text-green-700 text-xs font-semibold px-2 py-0.5">
                            <CheckCircle2 size={12} />
                            Pagado
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 text-orange-700 text-xs font-semibold px-2 py-0.5">
                            <Clock size={12} />
                            Pend. Pago
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <div className="text-xs uppercase text-gray-500 font-semibold">Cliente</div>
                        <div className="text-gray-900 font-medium">{booking.cliente.nombre}</div>
                        <div className="text-xs text-gray-500">{booking.cliente.email}</div>
                      </div>
                      <div>
                        <div className="text-xs uppercase text-gray-500 font-semibold">Agente</div>
                        <div className="text-gray-900 font-medium">{getAgentName(booking)}</div>
                        <div className="text-xs text-gray-500">{getAgentType(booking)}</div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <div className="text-xs uppercase text-gray-500 font-semibold">Fechas</div>
                        <div className="text-gray-900">
                          {format(parseISO(booking.fecha_inicio), 'dd MMM', { locale: es })} - {format(parseISO(booking.fecha_fin), 'dd MMM', { locale: es })}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs uppercase text-gray-500 font-semibold">Total</div>
                        <div className="text-gray-900 font-semibold">€{booking.precio_total.toLocaleString('es-ES', { minimumFractionDigits: 2 })}</div>
                      </div>
                    </div>

                    <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-3 text-sm">
                      <div className="flex items-center justify-between">
                        <div className="text-xs uppercase text-gray-500 font-semibold">Entrega</div>
                        <button
                          onClick={() => copyText(getDeliverySummary(booking), 'Entrega')}
                          className="btn-icon text-slate-400 hover:text-blue-600 hover:bg-blue-50"
                          title="Copiar entrega"
                        >
                          <Copy size={16} />
                        </button>
                      </div>
                      <div className="text-gray-900 font-medium">{getLocationLabel(booking)}</div>
                      <div className="text-xs text-gray-500">
                        {booking.hora_entrega ? `Hora: ${booking.hora_entrega}` : 'Hora: no indicada'}
                      </div>
                      <div className="text-xs text-gray-500">
                        {booking.nombre_barco ? `Barco: ${booking.nombre_barco}` : 'Barco: no indicado'}
                      </div>
                      <div className="text-xs text-gray-500">
                        {booking.numero_amarre ? `Amarre: ${booking.numero_amarre}` : 'Amarre: no indicado'}
                      </div>
                    </div>

                    <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 text-sm">
                      <div className="flex items-center justify-between">
                        <div className="text-xs uppercase text-gray-500 font-semibold">Productos</div>
                        <button
                          onClick={() => copyText(getProductsSummary(booking), 'Productos')}
                          className="btn-ghost text-xs text-blue-700"
                        >
                          <Copy size={14} />
                          Copiar
                        </button>
                      </div>
                      <div className="space-y-1 mt-1">
                        {booking.items.map((item, idx) => (
                          <div key={idx} className="text-sm text-gray-700 flex items-center gap-2">
                            <span className="bg-white px-1.5 py-0.5 rounded text-xs font-mono font-medium border border-gray-200">x{item.cantidad}</span>
                            <span className="truncate" title={products[item.producto_id]?.nombre}>
                              {products[item.producto_id]?.nombre || 'Producto desconocido'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-xs text-gray-500">
                      <div className="flex items-center gap-2">
                        {booking.acuerdo_firmado ? (
                          <>
                            <CheckCircle2 size={14} className="text-green-600" />
                            Firmado
                          </>
                        ) : (
                          <>
                            <XCircle size={14} className="text-gray-400" />
                            Firma pendiente
                          </>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {booking.pago_realizado ? (
                          <>
                            <CheckCircle2 size={14} className="text-green-600" />
                            Pagado
                          </>
                        ) : (
                          <>
                            <Clock size={14} className="text-yellow-600" />
                            Pago pendiente
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pt-2">
                      <button 
                        onClick={() => copyContractLink(booking)}
                        className="btn-ghost text-sm text-emerald-700"
                      >
                        <Share2 size={16} />
                        Contrato
                      </button>
                      <button 
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setViewingBooking(booking);
                        }}
                        className="btn-ghost text-sm text-blue-700" 
                      >
                        <Eye size={16} />
                        Detalles
                      </button>
                      <button 
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setPaymentManaging(booking);
                        }}
                        className={clsx(
                          "btn-ghost text-sm",
                          booking.pago_realizado ? "text-green-700" : "text-orange-600"
                        )}
                      >
                        <CreditCard size={16} />
                        {booking.pago_realizado ? 'Pago' : 'Cobrar'}
                      </button>
                      {booking.estado !== 'cancelada' && (
                        <button 
                          onClick={() => handleCancelBooking(booking)}
                          className="btn-ghost text-sm text-orange-600"
                        >
                          <Ban size={16} />
                          Cancelar
                        </button>
                      )}
                      <button 
                        onClick={() => handleDelete(booking.id, booking)}
                        className="btn-ghost text-sm text-rose-600"
                      >
                        <Trash2 size={16} />
                        Eliminar
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Referencia</th>
                  <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Cliente</th>
                  <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Agente</th>
                  <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Fechas</th>
                  <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Entrega</th>
                  <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Productos</th>
                  <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Estado</th>
                  <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Firmado</th>
                  <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Pagado</th>
                  <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Total</th>
                  <th className="px-6 py-4 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredBookings.map((booking) => {
                  const todayStart = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
                  const todayEnd = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate(), 23, 59, 59, 999);
                  const bookingStart = getDate(booking.fecha_inicio);
                  const bookingEnd = getDate(booking.fecha_fin);
                  const isToday = bookingEnd >= todayStart && bookingStart <= todayEnd;
                  return (
                  <tr key={booking.id} className={clsx("hover:bg-gray-50/50 transition-colors group", isToday && "bg-blue-50/30")}>
                    <td className="px-6 py-4">
                      <span className="font-mono text-sm font-medium text-gray-900">{booking.numero_reserva}</span>
                      <div className="text-xs text-gray-500 mt-1">
                        {format(getDate(booking.creado_en), 'dd MMM yyyy', { locale: es })}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-900">{booking.cliente.nombre}</div>
                      <div className="text-sm text-gray-500">{booking.cliente.email}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <div className={clsx(
                          "p-1.5 rounded-lg",
                          getAgentType(booking) === 'Broker' ? "bg-orange-100 text-orange-600" :
                          getAgentType(booking) === 'Agencia' ? "bg-purple-100 text-purple-600" :
                          "bg-gray-100 text-gray-600"
                        )}>
                          {getAgentType(booking) === 'Broker' || getAgentType(booking) === 'Agencia' ? 
                            <Briefcase size={14} /> : <UserIcon size={14} />}
                        </div>
                        <div>
                          <div className="text-sm font-medium text-gray-900">{getAgentName(booking)}</div>
                          <div className="text-xs text-gray-500">{getAgentType(booking)}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1 text-sm">
                        <span className="text-gray-900">
                          {format(parseISO(booking.fecha_inicio), 'dd MMM', { locale: es })}
                        </span>
                        <span className="text-gray-400 text-xs">hasta</span>
                        <span className="text-gray-900">
                          {format(parseISO(booking.fecha_fin), 'dd MMM', { locale: es })}
                        </span>
                        {isToday && (
                          <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-blue-100 text-blue-700 text-xs font-semibold px-2 py-0.5 w-fit">
                            Hoy
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="space-y-2 text-sm text-gray-700">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-gray-900">{getLocationLabel(booking)}</span>
                          <button
                            onClick={() => copyText(getDeliverySummary(booking), 'Entrega')}
                            className="btn-icon text-slate-400 hover:text-blue-600 hover:bg-blue-50"
                            title="Copiar entrega"
                          >
                            <Copy size={16} />
                          </button>
                        </div>
                        <div className="text-xs text-gray-500">
                          {booking.hora_entrega ? `Hora: ${booking.hora_entrega}` : 'Hora: no indicada'}
                        </div>
                        <div className="text-xs text-gray-500">
                          {booking.nombre_barco ? `Barco: ${booking.nombre_barco}` : 'Barco: no indicado'}
                        </div>
                        <div className="text-xs text-gray-500">
                          {booking.numero_amarre ? `Amarre: ${booking.numero_amarre}` : 'Amarre: no indicado'}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="space-y-2">
                        {booking.items.slice(0, 2).map((item, idx) => (
                          <div key={idx} className="text-sm text-gray-700 flex items-center gap-2">
                            <span className="bg-gray-100 px-1.5 py-0.5 rounded text-xs font-mono font-medium">x{item.cantidad}</span>
                            <span className="truncate max-w-[160px]" title={products[item.producto_id]?.nombre}>
                              {products[item.producto_id]?.nombre || 'Producto desconocido'}
                            </span>
                          </div>
                        ))}
                        {booking.items.length > 2 && (
                          <span className="text-xs text-gray-400">+{booking.items.length - 2} más</span>
                        )}
                        <button
                          onClick={() => copyText(getProductsSummary(booking), 'Productos')}
                          className="btn-ghost text-xs text-blue-700"
                        >
                          <Copy size={14} />
                          Copiar productos
                        </button>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={clsx(
                        "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border",
                        getStatusColor(booking.estado)
                      )}>
                        {getStatusIcon(booking.estado)}
                        <span className="capitalize">{booking.estado}</span>
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {booking.acuerdo_firmado ? (
                        <div className="flex items-center gap-2">
                          <div className="bg-green-100 p-1.5 rounded-lg">
                            <PenTool size={14} className="text-green-600" />
                          </div>
                          <div>
                            <div className="text-xs font-medium text-green-700">Firmado</div>
                            {booking.terminos_aceptados_en && (
                              <div className="text-xs text-gray-500">
                                {format(getDate(booking.terminos_aceptados_en), 'dd MMM', { locale: es })}
                              </div>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <div className="bg-gray-100 p-1.5 rounded-lg">
                            <PenTool size={14} className="text-gray-400" />
                          </div>
                          <span className="text-xs text-gray-500">Pendiente</span>
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {booking.reembolso_realizado ? (
                        <div className="flex items-center gap-2">
                          <div className="bg-red-100 p-1.5 rounded-lg">
                            <XCircle size={14} className="text-red-600" />
                          </div>
                          <div>
                            <div className="text-xs font-medium text-red-700">Reembolsado</div>
                            {booking.reembolso_fecha && (
                              <div className="text-xs text-gray-500">
                                {format(getDate(booking.reembolso_fecha), 'dd MMM', { locale: es })}
                              </div>
                            )}
                            {booking.reembolso_monto && (
                              <div className="text-xs text-red-600 font-semibold">
                                €{booking.reembolso_monto.toFixed(0)}
                              </div>
                            )}
                          </div>
                        </div>
                      ) : booking.pago_realizado ? (
                        <div className="flex items-center gap-2">
                          <div className="bg-green-100 p-1.5 rounded-lg">
                            <CheckCircle2 size={14} className="text-green-600" />
                          </div>
                          <div>
                            <div className="text-xs font-medium text-green-700">Pagado</div>
                            {booking.pago_realizado_en && (
                              <div className="text-xs text-gray-500">
                                {format(getDate(booking.pago_realizado_en), 'dd MMM', { locale: es })}
                              </div>
                            )}
                            {booking.pago_metodo && (
                              <div className="text-xs text-green-600 capitalize">
                                {booking.pago_metodo}
                              </div>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <div className="bg-orange-100 p-1.5 rounded-lg">
                            <Clock size={14} className="text-orange-600" />
                          </div>
                          <span className="text-xs text-orange-700 font-medium">Pendiente</span>
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 font-medium text-gray-900">
                      €{booking.precio_total.toLocaleString('es-ES', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button 
                          onClick={() => copyContractLink(booking)}
                          className="btn-icon text-slate-400 hover:text-emerald-600 hover:bg-emerald-50"
                          title="Copiar enlace del contrato"
                        >
                          <Share2 size={18} />
                        </button>
                        <button 
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setViewingBooking(booking);
                          }}
                          className="btn-icon text-slate-400 hover:text-blue-600 hover:bg-blue-50" 
                          title="Ver detalles"
                        >
                          <Eye size={18} />
                        </button>
                        <button 
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setPaymentManaging(booking);
                          }}
                          className={clsx(
                            "btn-icon",
                            booking.pago_realizado 
                              ? "text-green-600 hover:text-green-700 hover:bg-green-50" 
                              : "text-orange-600 hover:text-orange-700 hover:bg-orange-50"
                          )}
                          title={booking.pago_realizado ? "Gestionar pago" : "Registrar pago"}
                        >
                          <CreditCard size={18} />
                        </button>
                        {booking.estado !== 'cancelada' && (
                          <button 
                            onClick={() => handleCancelBooking(booking)}
                            className="btn-icon text-slate-400 hover:text-orange-600 hover:bg-orange-50" 
                            title="Cancelar reserva"
                          >
                            <Ban size={18} />
                          </button>
                        )}
                        <button 
                          onClick={() => handleDelete(booking.id, booking)}
                          className="btn-icon text-slate-400 hover:text-rose-600 hover:bg-rose-50" 
                          title="Eliminar reserva"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )})}
              </tbody>
            </table>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-center px-4">
            <div className="bg-gray-100 p-4 rounded-full mb-4">
              <CalendarDays size={32} className="text-gray-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-1">No hay reservas encontradas</h3>
            <p className="text-gray-500 max-w-sm mx-auto mb-6">
              {searchTerm || statusFilter !== 'all' || timeFilter !== 'today'
                ? 'Intenta ajustar los filtros o términos de búsqueda.' 
                : 'No hay reservas para hoy.'}
            </p>
            {(searchTerm || statusFilter !== 'all' || timeFilter !== 'today') && (
              <button 
                onClick={() => {
                  setSearchTerm('');
                  setStatusFilter('all');
                  setTimeFilter('today');
                }}
                className="btn-ghost text-blue-700"
              >
                Limpiar filtros
              </button>
            )}
          </div>
        )}
      </div>

      {/* New Booking Modal */}
      {isModalOpen && (
        <BookingForm 
          onClose={() => setIsModalOpen(false)}
          onSuccess={() => {
            // The snapshot listener will automatically update the list
            setIsModalOpen(false);
          }}
        />
      )}

      {/* Booking Details Modal */}
      {viewingBooking && (
        <BookingDetailsModal 
          booking={viewingBooking}
          products={products}
          users={users}
          onClose={() => setViewingBooking(null)}
        />
      )}

      {/* Payment & Refund Management Modal */}
      {paymentManaging && (
        <PaymentRefundManager
          booking={paymentManaging}
          onClose={() => setPaymentManaging(null)}
          onUpdate={() => {
            // The snapshot listener will automatically update the list
            setPaymentManaging(null);
          }}
        />
      )}
    </div>
  );
}

// Booking Details Modal Component
function BookingDetailsModal({ 
  booking, 
  products, 
  users,
  onClose 
}: { 
  booking: Booking; 
  products: Record<string, Product>;
  users: Record<string, User>;
  onClose: () => void;
}) {
  const getDate = (timestamp: any): Date => {
    if (!timestamp) return new Date();
    if (timestamp && typeof timestamp.toDate === 'function') {
      return timestamp.toDate();
    }
    if (timestamp instanceof Date) {
      return timestamp;
    }
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) {
      return new Date();
    }
    return date;
  };

  const getAgentName = (booking: Booking): string => {
    if (booking.broker_id && users[booking.broker_id]) {
      return users[booking.broker_id].nombre || 'Broker desconocido';
    }
    if (booking.agency_id && users[booking.agency_id]) {
      return users[booking.agency_id].nombre || 'Agencia desconocida';
    }
    if (booking.colaborador_id && users[booking.colaborador_id]) {
      return users[booking.colaborador_id].nombre || 'Colaborador desconocido';
    }
    if (booking.creado_por && users[booking.creado_por]) {
      const creator = users[booking.creado_por];
      if (creator.rol === 'admin') return 'Admin';
      return creator.nombre || 'Usuario desconocido';
    }
    return 'Directo';
  };

  const getAgentType = (booking: Booking): string => {
    if (booking.broker_id) return 'Broker';
    if (booking.agency_id) return 'Agencia';
    if (booking.colaborador_id) return 'Colaborador';
    if (booking.creado_por && users[booking.creado_por]) {
      return users[booking.creado_por].rol === 'admin' ? 'Admin' : 'Usuario';
    }
    return 'Directo';
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-slate-50 rounded-t-2xl shrink-0">
          <div>
            <h2 className="text-2xl font-bold text-gray-800">Detalles de la Reserva</h2>
            <p className="text-gray-500 text-sm mt-1">Referencia: {booking.numero_reserva}</p>
          </div>
          <button
            onClick={onClose}
            className="btn-icon text-slate-500 hover:text-slate-700 hover:bg-slate-200"
          >
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {/* Client Info */}
          <section>
            <h3 className="text-lg font-bold text-gray-900 mb-3 flex items-center gap-2">
              <UserIcon size={20} className="text-blue-600" />
              Cliente
            </h3>
            <div className="bg-gray-50 rounded-xl p-4 grid grid-cols-2 gap-4">
              <div>
                <span className="text-xs text-gray-500 uppercase font-semibold">Nombre</span>
                <div className="text-gray-900 font-medium">{booking.cliente.nombre}</div>
              </div>
              <div>
                <span className="text-xs text-gray-500 uppercase font-semibold">Email</span>
                <div className="text-gray-900 font-medium">{booking.cliente.email}</div>
              </div>
              <div>
                <span className="text-xs text-gray-500 uppercase font-semibold">Teléfono</span>
                <div className="text-gray-900 font-medium">{booking.cliente.telefono || 'N/A'}</div>
              </div>
            </div>
          </section>

          {/* Agent Info */}
          <section>
            <h3 className="text-lg font-bold text-gray-900 mb-3 flex items-center gap-2">
              <Briefcase size={20} className="text-blue-600" />
              Agente
            </h3>
            <div className="bg-gray-50 rounded-xl p-4">
              <div className="flex items-center gap-3">
                <div className={clsx(
                  "p-2 rounded-lg",
                  getAgentType(booking) === 'Broker' ? "bg-orange-100 text-orange-600" :
                  getAgentType(booking) === 'Agencia' ? "bg-purple-100 text-purple-600" :
                  "bg-gray-100 text-gray-600"
                )}>
                  {getAgentType(booking) === 'Broker' || getAgentType(booking) === 'Agencia' ? 
                    <Briefcase size={16} /> : <UserIcon size={16} />}
                </div>
                <div>
                  <div className="font-bold text-gray-900">{getAgentName(booking)}</div>
                  <div className="text-sm text-gray-500">{getAgentType(booking)}</div>
                </div>
              </div>
            </div>
          </section>

          {/* Dates & Delivery */}
          <section>
            <h3 className="text-lg font-bold text-gray-900 mb-3 flex items-center gap-2">
              <Calendar size={20} className="text-blue-600" />
              Fechas y Entrega
            </h3>
            <div className="bg-gray-50 rounded-xl p-4 grid grid-cols-2 gap-4">
              <div>
                <span className="text-xs text-gray-500 uppercase font-semibold">Fecha Inicio</span>
                <div className="text-gray-900 font-medium">{format(parseISO(booking.fecha_inicio), 'dd MMM yyyy', { locale: es })}</div>
              </div>
              <div>
                <span className="text-xs text-gray-500 uppercase font-semibold">Fecha Fin</span>
                <div className="text-gray-900 font-medium">{format(parseISO(booking.fecha_fin), 'dd MMM yyyy', { locale: es })}</div>
              </div>
              {booking.ubicacion_entrega && (
                <div>
                  <span className="text-xs text-gray-500 uppercase font-semibold">Ubicación</span>
                  <div className="text-gray-900 font-medium">
                    {booking.ubicacion_entrega === 'marina_ibiza' ? 'Marina Ibiza' : 
                     booking.ubicacion_entrega === 'marina_botafoch' ? 'Marina Botafoch' : 
                     booking.ubicacion_entrega === 'club_nautico' ? 'Club Náutico' : 'Otro'}
                  </div>
                </div>
              )}
              {booking.hora_entrega && (
                <div>
                  <span className="text-xs text-gray-500 uppercase font-semibold">Hora de Entrega</span>
                  <div className="text-gray-900 font-medium font-mono">{booking.hora_entrega}</div>
                </div>
              )}
              {booking.nombre_barco && (
                <div>
                  <span className="text-xs text-gray-500 uppercase font-semibold">Barco</span>
                  <div className="text-gray-900 font-medium">{booking.nombre_barco}</div>
                </div>
              )}
              {booking.numero_amarre && (
                <div>
                  <span className="text-xs text-gray-500 uppercase font-semibold">Amarre</span>
                  <div className="text-gray-900 font-medium">{booking.numero_amarre}</div>
                </div>
              )}
            </div>
          </section>

          {/* Items */}
          <section>
            <h3 className="text-lg font-bold text-gray-900 mb-3 flex items-center gap-2">
              <ShoppingBag size={20} className="text-blue-600" />
              Productos
            </h3>
            <div className="bg-gray-50 rounded-xl p-4 space-y-2">
              {booking.items.map((item, idx) => (
                <div key={idx} className="flex justify-between items-center py-2 border-b border-gray-200 last:border-0">
                  <div>
                    <div className="font-medium text-gray-900">
                      {products[item.producto_id]?.nombre || `Producto ${item.producto_id}`}
                    </div>
                    <div className="text-sm text-gray-500">Cantidad: {item.cantidad}</div>
                  </div>
                </div>
              ))}
              <div className="pt-2 border-t-2 border-gray-300 flex justify-between items-center">
                <span className="font-bold text-gray-900">Total</span>
                <span className="font-bold text-xl text-gray-900">€{booking.precio_total.toLocaleString('es-ES', { minimumFractionDigits: 2 })}</span>
              </div>
            </div>
          </section>

          {/* Status & Actions */}
          <section>
            <h3 className="text-lg font-bold text-gray-900 mb-3">Estado y Acciones</h3>
            <div className="bg-gray-50 rounded-xl p-4 grid grid-cols-3 gap-4">
              <div>
                <span className="text-xs text-gray-500 uppercase font-semibold">Estado</span>
                <div className="mt-1">
                  <span className={clsx(
                    "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border",
                    booking.estado === 'confirmada' ? 'bg-green-100 text-green-700 border-green-200' :
                    booking.estado === 'pendiente' ? 'bg-yellow-100 text-yellow-700 border-yellow-200' :
                    booking.estado === 'completada' ? 'bg-blue-100 text-blue-700 border-blue-200' :
                    'bg-red-100 text-red-700 border-red-200'
                  )}>
                    {booking.estado}
                  </span>
                </div>
              </div>
              <div>
                <span className="text-xs text-gray-500 uppercase font-semibold">Firmado</span>
                <div className="mt-1">
                  {booking.acuerdo_firmado ? (
                    <span className="inline-flex items-center gap-1 text-green-700 font-medium">
                      <CheckCircle2 size={16} />
                      Sí
                    </span>
                  ) : (
                    <span className="text-gray-500">No</span>
                  )}
                </div>
              </div>
              <div>
                <span className="text-xs text-gray-500 uppercase font-semibold">Pagado</span>
                <div className="mt-1">
                  {booking.pago_realizado ? (
                    <span className="inline-flex items-center gap-1 text-green-700 font-medium">
                      <CheckCircle2 size={16} />
                      Sí
                    </span>
                  ) : (
                    <span className="text-gray-500">No</span>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* Payment & Refund History */}
          {(booking.pago_realizado || booking.reembolso_realizado) && (
            <section>
              <h3 className="text-lg font-bold text-gray-900 mb-3 flex items-center gap-2">
                <CreditCard size={20} className="text-blue-600" />
                Historial de Pagos y Reembolsos
              </h3>
              <div className="space-y-3">
                {/* Payment Info */}
                {booking.pago_realizado && (
                  <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <CheckCircle2 className="text-green-600" size={20} />
                      <span className="font-bold text-green-900">Pago Recibido</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <span className="text-green-700 font-semibold">Monto:</span>
                        <p className="text-green-900 font-bold">€{booking.precio_total.toFixed(2)}</p>
                      </div>
                      {booking.pago_metodo && (
                        <div>
                          <span className="text-green-700 font-semibold">Método:</span>
                          <p className="text-green-900 capitalize">{booking.pago_metodo}</p>
                        </div>
                      )}
                      {booking.pago_realizado_en && (
                        <div>
                          <span className="text-green-700 font-semibold">Fecha:</span>
                          <p className="text-green-900">
                            {format(getDate(booking.pago_realizado_en), 'dd/MM/yyyy HH:mm', { locale: es })}
                          </p>
                        </div>
                      )}
                      {booking.pago_referencia && (
                        <div>
                          <span className="text-green-700 font-semibold">Referencia:</span>
                          <p className="text-green-900 font-mono text-xs">{booking.pago_referencia}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Refund Info */}
                {booking.reembolso_realizado && (
                  <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <XCircle className="text-red-600" size={20} />
                      <span className="font-bold text-red-900">Reembolso Procesado</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      {booking.reembolso_monto && (
                        <div>
                          <span className="text-red-700 font-semibold">Monto:</span>
                          <p className="text-red-900 font-bold">€{booking.reembolso_monto.toFixed(2)}</p>
                        </div>
                      )}
                      {booking.reembolso_metodo && (
                        <div>
                          <span className="text-red-700 font-semibold">Método:</span>
                          <p className="text-red-900 capitalize">{booking.reembolso_metodo}</p>
                        </div>
                      )}
                      {booking.reembolso_fecha && (
                        <div>
                          <span className="text-red-700 font-semibold">Fecha:</span>
                          <p className="text-red-900">
                            {format(getDate(booking.reembolso_fecha), 'dd/MM/yyyy HH:mm', { locale: es })}
                          </p>
                        </div>
                      )}
                      {booking.reembolso_referencia && (
                        <div>
                          <span className="text-red-700 font-semibold">Referencia:</span>
                          <p className="text-red-900 font-mono text-xs">{booking.reembolso_referencia}</p>
                        </div>
                      )}
                      {booking.reembolso_motivo && (
                        <div className="col-span-2">
                          <span className="text-red-700 font-semibold">Motivo:</span>
                          <p className="text-red-900">{booking.reembolso_motivo}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Notes */}
          {booking.notas && (
            <section>
              <h3 className="text-lg font-bold text-gray-900 mb-3">Notas</h3>
              <div className="bg-gray-50 rounded-xl p-4">
                <p className="text-gray-700">{booking.notas}</p>
              </div>
            </section>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-gray-100 bg-gray-50 rounded-b-2xl shrink-0">
          <button onClick={onClose} className="btn-primary w-full py-3">
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
