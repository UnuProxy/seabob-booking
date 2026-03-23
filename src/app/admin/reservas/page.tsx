'use client';

import { useState, useEffect } from 'react';
import { collection, query, orderBy, onSnapshot, doc, where, getDocs, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { Booking, Product, User } from '@/types';
import { BookingForm } from '@/components/bookings/BookingForm';
import { NauticalLicenseManager } from '@/components/bookings/NauticalLicenseManager';
import { PaymentRefundManager } from '@/components/bookings/PaymentRefundManager';
import { BOOKING_FORM_MODAL_OPEN_KEY, clearBookingDraftStorage } from '@/lib/bookingDraft';
import { useAuthStore } from '@/store/authStore';
import { releaseBookingStockOnce } from '@/lib/bookingStock';
import { 
  CalendarDays, 
  Plus, 
  Search, 
  CheckCircle2, 
  Clock, 
  XCircle, 
  FileCheck,
  Eye,
  Share2,
  CreditCard,
  User as UserIcon,
  Briefcase,
  X,
  ShoppingBag,
  Calendar,
  Copy,
  Euro,
  Ban,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import clsx from 'clsx';
import { useSearchParams } from 'next/navigation';

export default function BookingsPage() {
  const { user } = useAuthStore();
  const searchParams = useSearchParams();
  const initialBookingRef = searchParams.get('bookingRef')?.trim() ?? '';
  const initialServiceDate = searchParams.get('serviceDate')?.trim() ?? '';
  const initialSelectedProductId = searchParams.get('productId')?.trim() ?? '';
  const shouldOpenNewBooking = searchParams.get('new') === 'true';
  const hasInitialDeepLink = Boolean(initialBookingRef || initialServiceDate);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [products, setProducts] = useState<Record<string, Product>>({});
  const [users, setUsers] = useState<Record<string, User>>({});
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState(initialBookingRef);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [paymentFilter, setPaymentFilter] = useState<'all' | 'paid' | 'unpaid' | 'refunded'>('all');
  const [timeFilter, setTimeFilter] = useState<'today' | 'upcoming' | 'all'>(
    hasInitialDeepLink ? 'all' : 'today'
  );
  const [dateFrom, setDateFrom] = useState(initialServiceDate);
  const [dateTo, setDateTo] = useState(initialServiceDate);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [expandedBookings, setExpandedBookings] = useState<Record<string, boolean>>({});
  const [isModalOpen, setIsModalOpen] = useState(shouldOpenNewBooking);
  const [prefillProductId, setPrefillProductId] = useState(shouldOpenNewBooking ? initialSelectedProductId : '');
  const [viewingBooking, setViewingBooking] = useState<Booking | null>(null);
  const [paymentManaging, setPaymentManaging] = useState<Booking | null>(null);

  useEffect(() => {
    const bookingRefParam = searchParams.get('bookingRef')?.trim() ?? '';
    const serviceDateParam = searchParams.get('serviceDate')?.trim() ?? '';

    const syncId = window.setTimeout(() => {
      const hasDeepLink = Boolean(bookingRefParam || serviceDateParam);
      setSearchTerm(bookingRefParam);
      setStatusFilter('all');
      setPaymentFilter('all');
      setTimeFilter(hasDeepLink ? 'all' : 'today');
      setDateFrom(serviceDateParam);
      setDateTo(serviceDateParam);
    }, 0);

    return () => window.clearTimeout(syncId);
  }, [searchParams]);

  useEffect(() => {
    const shouldRestoreModal = window.sessionStorage.getItem(BOOKING_FORM_MODAL_OPEN_KEY) === 'true';
    if (shouldRestoreModal) {
      setIsModalOpen(true);
      setPrefillProductId('');
    }
  }, []);

  useEffect(() => {
    if (isModalOpen) {
      window.sessionStorage.setItem(BOOKING_FORM_MODAL_OPEN_KEY, 'true');
      return;
    }

    window.sessionStorage.removeItem(BOOKING_FORM_MODAL_OPEN_KEY);
  }, [isModalOpen]);

  const openNewBookingModal = (productId = '') => {
    setPrefillProductId(productId);
    setIsModalOpen(true);
  };

  const closeNewBookingModal = () => {
    clearBookingDraftStorage();
    setPrefillProductId('');
    setIsModalOpen(false);
  };

  const getDate = (timestamp: unknown): Date => {
    if (!timestamp) return new Date();

    if (
      typeof timestamp === 'object' &&
      timestamp !== null &&
      'toDate' in timestamp &&
      typeof (timestamp as { toDate?: () => Date }).toDate === 'function'
    ) {
      return (timestamp as { toDate: () => Date }).toDate();
    }

    if (timestamp instanceof Date) {
      return timestamp;
    }

    const date = new Date(timestamp as string | number);
    if (isNaN(date.getTime())) {
      return new Date();
    }

    return date;
  };

  const isSameCalendarDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  const getBookingServiceDateKey = (booking: Booking) =>
    format(getDate(booking.fecha_inicio), 'yyyy-MM-dd');

  const formatBookingServiceDateRange = (booking: Booking) => {
    const start = getDate(booking.fecha_inicio);
    const end = getDate(booking.fecha_fin);

    if (isSameCalendarDay(start, end)) {
      return format(start, 'dd MMM yyyy', { locale: es });
    }

    return `${format(start, 'dd MMM', { locale: es })} - ${format(end, 'dd MMM yyyy', { locale: es })}`;
  };

  const getBookingSectionLabel = (booking: Booking) => {
    const start = getDate(booking.fecha_inicio);
    const today = new Date();
    const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);

    if (isSameCalendarDay(start, today)) {
      return `Hoy · ${format(start, 'dd MMM yyyy', { locale: es })}`;
    }

    if (isSameCalendarDay(start, tomorrow)) {
      return `Mañana · ${format(start, 'dd MMM yyyy', { locale: es })}`;
    }

    return format(start, "EEEE, dd MMM yyyy", { locale: es });
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
      await releaseBookingStockOnce(booking.id, 'system_expiration');
    } catch (error) {
      console.error('Error expiring booking:', error);
    }
  };

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
    if (!user) return;
    if (user.rol !== 'admin') return;

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
  }, [user]);

  // Real-time bookings
  useEffect(() => {
    if (!user) return;

    const bookingsRef = collection(db, 'bookings');
    const bookingsQuery =
      user.rol === 'admin'
        ? query(bookingsRef, orderBy('creado_en', 'desc'))
        : query(bookingsRef, where('creado_por', '==', user.id));

    const unsubscribe = onSnapshot(
      bookingsQuery,
      (snapshot) => {
        const bookingsData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as Booking[];

        if (user.rol !== 'admin') {
          bookingsData.sort((a, b) => getDate(b.creado_en).getTime() - getDate(a.creado_en).getTime());
        }

        setBookings(bookingsData);
        setLoading(false);
      },
      (error) => {
        console.error('Error fetching bookings:', error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user]);

  const handleCancelBooking = async (booking: Booking) => {
    if (!confirm(`¿Estás seguro de que deseas cancelar la reserva ${booking.numero_reserva}?\n\nEsto cambiará el estado a "cancelada" pero mantendrá el registro.`)) {
      return;
    }

    try {
      await releaseBookingStockOnce(booking.id, user?.id || 'admin_panel');
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
    if (booking.ubicacion_entrega === 'otro') {
      return booking.ubicacion_entrega_detalle || 'Otro';
    }
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

  const normalizeSearchValue = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    return String(value)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  };

  const searchTokens = normalizeSearchValue(searchTerm)
    .split(/\s+/)
    .filter(Boolean);

  const filteredBookings = bookings.filter(booking => {
    const bookingStart = getDate(booking.fecha_inicio);
    const bookingEnd = getDate(booking.fecha_fin);
    const todayStart = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
    const todayEnd = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate(), 23, 59, 59, 999);
    const hasDateRange = Boolean(dateFrom || dateTo);
    const rangeStart = dateFrom ? new Date(`${dateFrom}T00:00:00`) : null;
    const rangeEnd = dateTo ? new Date(`${dateTo}T23:59:59`) : null;

    const matchesSearch = (() => {
      if (searchTokens.length === 0) return true;

      const productsText = booking.items
        ?.map((item) => products[item.producto_id]?.nombre || item.producto_nombre || '')
        .filter(Boolean)
        .join(' ');

      const haystack = normalizeSearchValue([
        booking.numero_reserva,
        booking.cliente?.nombre,
        booking.cliente?.email,
        booking.cliente?.telefono,
        booking.cliente?.whatsapp,
        getAgentName(booking),
        getAgentType(booking),
        booking.pago_referencia,
        booking.pago_metodo,
        booking.reembolso_referencia,
        booking.nombre_barco,
        booking.numero_amarre,
        booking.hora_entrega,
        getLocationLabel(booking),
        booking.notas,
        booking.token_acceso,
        productsText,
      ].filter(Boolean).join(' '));

      return searchTokens.every((token) => haystack.includes(token));
    })();
    
    const matchesStatus = statusFilter === 'all' || booking.estado === statusFilter;

    const matchesPayment = 
      paymentFilter === 'all' ||
      (paymentFilter === 'paid' && booking.pago_realizado && !booking.reembolso_realizado) ||
      (paymentFilter === 'unpaid' && !booking.pago_realizado) ||
      (paymentFilter === 'refunded' && booking.reembolso_realizado);

    const matchesTime = hasDateRange
      ? (!rangeStart || bookingEnd >= rangeStart) && (!rangeEnd || bookingStart <= rangeEnd)
      : timeFilter === 'all'
        ? true
        : timeFilter === 'today'
          ? bookingEnd >= todayStart && bookingStart <= todayEnd
          : bookingStart > todayEnd;

    return matchesSearch && matchesStatus && matchesPayment && matchesTime;
  }).sort((a, b) => {
    const startDiff = getDate(b.fecha_inicio).getTime() - getDate(a.fecha_inicio).getTime();
    if (startDiff !== 0) return startDiff;
    return getDate(b.creado_en).getTime() - getDate(a.creado_en).getTime();
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

  const resetFilters = () => {
    setSearchTerm('');
    setStatusFilter('all');
    setPaymentFilter('all');
    setTimeFilter('today');
    setDateFrom('');
    setDateTo('');
  };

  const applyTopFilter = (preset: 'today' | 'unpaidToday' | 'confirmedToday' | 'paidToday') => {
    setSearchTerm('');
    setDateFrom('');
    setDateTo('');
    setTimeFilter('today');

    if (preset === 'today') {
      setStatusFilter('all');
      setPaymentFilter('all');
      return;
    }

    if (preset === 'unpaidToday') {
      setStatusFilter('all');
      setPaymentFilter('unpaid');
      return;
    }

    if (preset === 'confirmedToday') {
      setStatusFilter('confirmada');
      setPaymentFilter('all');
      return;
    }

    setStatusFilter('all');
    setPaymentFilter('paid');
  };

  const todayStart = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
  const todayEnd = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate(), 23, 59, 59, 999);
  const todaysBookings = bookings.filter((booking) => {
    const start = getDate(booking.fecha_inicio);
    const end = getDate(booking.fecha_fin);
    return end >= todayStart && start <= todayEnd;
  });
  const todayUnpaid = todaysBookings.filter((booking) => !booking.pago_realizado).length;
  const todayConfirmed = todaysBookings.filter((booking) => booking.estado === 'confirmada').length;
  const todayPaidRevenue = todaysBookings
    .filter((booking) => booking.pago_realizado && !booking.reembolso_realizado)
    .reduce((sum, booking) => sum + (booking.precio_total || 0), 0);
  const hasActiveFilters = Boolean(
    searchTerm.trim() ||
      statusFilter !== 'all' ||
      paymentFilter !== 'all' ||
      timeFilter !== 'today' ||
      dateFrom ||
      dateTo
  );
  const activeTopPreset =
    !dateFrom &&
    !dateTo &&
    !searchTerm.trim() &&
    timeFilter === 'today' &&
    statusFilter === 'all' &&
    paymentFilter === 'all'
      ? 'today'
      : !dateFrom &&
          !dateTo &&
          !searchTerm.trim() &&
          timeFilter === 'today' &&
          statusFilter === 'all' &&
          paymentFilter === 'unpaid'
        ? 'unpaidToday'
        : !dateFrom &&
            !dateTo &&
            !searchTerm.trim() &&
            timeFilter === 'today' &&
            statusFilter === 'confirmada' &&
            paymentFilter === 'all'
          ? 'confirmedToday'
          : !dateFrom &&
              !dateTo &&
              !searchTerm.trim() &&
              timeFilter === 'today' &&
              statusFilter === 'all' &&
              paymentFilter === 'paid'
            ? 'paidToday'
            : null;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        <p className="text-gray-500 mt-4">Cargando reservas...</p>
      </div>
    );
  }

  return (
      <div className="w-full min-w-0">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 sm:gap-4 mb-6 sm:mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 mb-2">Reservas</h1>
        </div>
        
        <button 
          onClick={() => openNewBookingModal()}
          className="btn-primary w-full sm:w-auto"
        >
          <Plus size={20} />
          <span>Nueva Reserva</span>
        </button>
      </div>

      {/* Quick Overview */}
      <div className="mb-6 flex gap-2 overflow-x-auto pb-1 sm:grid sm:grid-cols-2 sm:gap-4 lg:grid-cols-4 sm:overflow-visible">
        <button
          type="button"
          onClick={() => applyTopFilter('today')}
          className={clsx(
            'min-w-[168px] shrink-0 bg-white border rounded-xl p-2.5 sm:min-w-0 sm:rounded-2xl sm:p-4 shadow-sm text-left transition hover:shadow-md',
            activeTopPreset === 'today' ? 'border-blue-300 ring-2 ring-blue-100' : 'border-gray-200'
          )}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] sm:text-xs uppercase text-gray-500 font-semibold">Reservas de Hoy</p>
              <p className="text-xl sm:text-2xl font-bold text-gray-900 mt-0.5 sm:mt-1">{todaysBookings.length}</p>
            </div>
            <div className="p-2 sm:p-3 rounded-lg sm:rounded-xl bg-blue-50 text-blue-600">
              <Calendar size={18} />
            </div>
          </div>
        </button>
        <button
          type="button"
          onClick={() => applyTopFilter('unpaidToday')}
          className={clsx(
            'min-w-[168px] shrink-0 bg-white border rounded-xl p-2.5 sm:min-w-0 sm:rounded-2xl sm:p-4 shadow-sm text-left transition hover:shadow-md',
            activeTopPreset === 'unpaidToday' ? 'border-amber-300 ring-2 ring-amber-100' : 'border-gray-200'
          )}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] sm:text-xs uppercase text-gray-500 font-semibold">Sin Pago Hoy</p>
              <p className="text-xl sm:text-2xl font-bold text-gray-900 mt-0.5 sm:mt-1">{todayUnpaid}</p>
            </div>
            <div className="p-2 sm:p-3 rounded-lg sm:rounded-xl bg-yellow-50 text-yellow-600">
              <Clock size={18} />
            </div>
          </div>
        </button>
        <button
          type="button"
          onClick={() => applyTopFilter('confirmedToday')}
          className={clsx(
            'min-w-[168px] shrink-0 bg-white border rounded-xl p-2.5 sm:min-w-0 sm:rounded-2xl sm:p-4 shadow-sm text-left transition hover:shadow-md',
            activeTopPreset === 'confirmedToday' ? 'border-green-300 ring-2 ring-green-100' : 'border-gray-200'
          )}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] sm:text-xs uppercase text-gray-500 font-semibold">Confirmadas Hoy</p>
              <p className="text-xl sm:text-2xl font-bold text-gray-900 mt-0.5 sm:mt-1">{todayConfirmed}</p>
            </div>
            <div className="p-2 sm:p-3 rounded-lg sm:rounded-xl bg-green-50 text-green-600">
              <CheckCircle2 size={18} />
            </div>
          </div>
        </button>
        <button
          type="button"
          onClick={() => applyTopFilter('paidToday')}
          className={clsx(
            'min-w-[168px] shrink-0 bg-white border rounded-xl p-2.5 sm:min-w-0 sm:rounded-2xl sm:p-4 shadow-sm text-left transition hover:shadow-md',
            activeTopPreset === 'paidToday' ? 'border-slate-300 ring-2 ring-slate-100' : 'border-gray-200'
          )}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] sm:text-xs uppercase text-gray-500 font-semibold">Ingresos Hoy</p>
              <p className="text-xl sm:text-2xl font-bold text-gray-900 mt-0.5 sm:mt-1">
                €{todayPaidRevenue.toLocaleString('es-ES', { minimumFractionDigits: 2 })}
              </p>
            </div>
            <div className="p-2 sm:p-3 rounded-lg sm:rounded-xl bg-slate-900 text-white">
              <Euro size={18} />
            </div>
          </div>
        </button>
      </div>

      {/* Filters & Search */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 mb-6">
        <div className="flex flex-col lg:flex-row gap-3 lg:items-center lg:justify-between">
          <div className="relative w-full lg:flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
            <input
              type="text"
              placeholder="Buscar por referencia, cliente, agente, email, teléfono..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-gray-50 focus:bg-white transition-all"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowAdvancedFilters((prev) => !prev)}
              className={clsx(
                'inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition',
                showAdvancedFilters
                  ? 'border-blue-200 bg-blue-50 text-blue-700'
                  : 'border-slate-200 text-slate-700 hover:bg-slate-50'
              )}
            >
              {showAdvancedFilters ? 'Ocultar filtros' : 'Filtros avanzados'}
            </button>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Limpiar
              </button>
            )}
          </div>
        </div>

        {showAdvancedFilters && (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <div className="flex flex-col gap-2 w-full min-w-0">
              <label className="text-xs font-semibold text-gray-500 uppercase" htmlFor="timeFilter">
                Rango
              </label>
              <select
                id="timeFilter"
                value={timeFilter}
                onChange={(event) => setTimeFilter(event.target.value as 'today' | 'upcoming' | 'all')}
                className="w-full min-w-0 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="today">Hoy</option>
                <option value="upcoming">Próximas</option>
                <option value="all">Todas</option>
              </select>
            </div>

            <div className="flex flex-col gap-2 w-full min-w-0">
              <label className="text-xs font-semibold text-gray-500 uppercase" htmlFor="statusFilter">
                Estado
              </label>
              <select
                id="statusFilter"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="w-full min-w-0 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="all">Todos</option>
                <option value="pendiente">Pendiente</option>
                <option value="confirmada">Confirmada</option>
                <option value="completada">Completada</option>
                <option value="cancelada">Cancelada</option>
                <option value="expirada">Expirada</option>
              </select>
            </div>

            <div className="flex flex-col gap-2 w-full min-w-0">
              <label className="text-xs font-semibold text-gray-500 uppercase" htmlFor="paymentFilter">
                Pago
              </label>
              <select
                id="paymentFilter"
                value={paymentFilter}
                onChange={(event) => setPaymentFilter(event.target.value as 'all' | 'paid' | 'unpaid' | 'refunded')}
                className="w-full min-w-0 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="all">Todos</option>
                <option value="paid">Pagado</option>
                <option value="unpaid">Pendiente</option>
                <option value="refunded">Reembolsado</option>
              </select>
            </div>

            <div className="flex flex-col gap-2 w-full min-w-0">
              <label className="text-xs font-semibold text-gray-500 uppercase" htmlFor="dateFrom">
                Fechas
              </label>
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 w-full min-w-0">
                <input
                  id="dateFrom"
                  type="date"
                  value={dateFrom}
                  onChange={(event) => setDateFrom(event.target.value)}
                  className="w-full min-w-0 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <span className="text-xs font-semibold text-gray-400">a</span>
                <input
                  id="dateTo"
                  type="date"
                  value={dateTo}
                  onChange={(event) => setDateTo(event.target.value)}
                  className="w-full min-w-0 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bookings List */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {filteredBookings.length > 0 ? (
          <>
            {/* Mobile Cards */}
            <div className="md:hidden space-y-4">
              {filteredBookings.map((booking, index) => {
                const todayStart = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
                const todayEnd = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate(), 23, 59, 59, 999);
                const bookingStart = getDate(booking.fecha_inicio);
                const bookingEnd = getDate(booking.fecha_fin);
                const isToday = bookingEnd >= todayStart && bookingStart <= todayEnd;
                const isExpanded = Boolean(expandedBookings[booking.id]);
                const isFirstOfDateGroup =
                  index === 0 ||
                  getBookingServiceDateKey(booking) !== getBookingServiceDateKey(filteredBookings[index - 1]);
                return (
                  <div key={booking.id} className="space-y-2">
                    {isFirstOfDateGroup && (
                      <div className="px-1 pt-1">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {getBookingSectionLabel(booking)}
                        </p>
                      </div>
                    )}
                    <div
                      className={clsx(
                        "p-4 space-y-3 rounded-2xl border border-gray-200 bg-white shadow-sm",
                        isToday && "border-blue-200 bg-blue-50/30"
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-xs uppercase text-gray-500 font-semibold">Referencia</div>
                          <div className="font-mono text-sm font-semibold text-gray-900">{booking.numero_reserva}</div>
                          <div className="text-xs text-gray-500 mt-1">
                            {formatBookingServiceDateRange(booking)}
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
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <div className="text-xs uppercase text-gray-500 font-semibold">Cliente</div>
                          <div className="text-gray-900 font-medium">{booking.cliente.nombre}</div>
                          <div className="text-xs text-gray-500">{booking.cliente.email}</div>
                        </div>
                        <div>
                          <div className="text-xs uppercase text-gray-500 font-semibold">Total</div>
                          <div className="text-gray-900 font-semibold">
                            €{booking.precio_total.toLocaleString('es-ES', { minimumFractionDigits: 2 })}
                          </div>
                          <div className="text-xs text-gray-500 mt-1">Creada: {format(getDate(booking.creado_en), 'dd MMM yyyy', { locale: es })}</div>
                        </div>
                      </div>

                      {!isExpanded && (
                        <button
                          onClick={() =>
                            setExpandedBookings((prev) => ({
                              ...prev,
                              [booking.id]: !prev[booking.id],
                            }))
                          }
                          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                        >
                          Ver detalles
                        </button>
                      )}

                      {isExpanded && (
                        <>
                          <div className="grid grid-cols-2 gap-3 text-sm">
                            <div>
                              <div className="text-xs uppercase text-gray-500 font-semibold">Agente</div>
                              <div className="text-gray-900 font-medium">{getAgentName(booking)}</div>
                              <div className="text-xs text-gray-500">{getAgentType(booking)}</div>
                            </div>
                            <div>
                              <div className="text-xs uppercase text-gray-500 font-semibold">Pago</div>
                              {booking.reembolso_realizado ? (
                                <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-red-100 text-red-700 text-xs font-semibold px-2 py-0.5">
                                  <XCircle size={12} />
                                  Reembolsado
                                </span>
                              ) : booking.pago_realizado ? (
                                <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-green-100 text-green-700 text-xs font-semibold px-2 py-0.5">
                                  <CheckCircle2 size={12} />
                                  Pagado
                                </span>
                              ) : (
                                <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-orange-100 text-orange-700 text-xs font-semibold px-2 py-0.5">
                                  <Clock size={12} />
                                  Pend. Pago
                                </span>
                              )}
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
                      {booking.estado !== 'cancelada' && booking.estado !== 'expirada' && (
                        <button 
                          onClick={() => handleCancelBooking(booking)}
                          className="btn-ghost text-sm text-orange-600"
                        >
                          <Ban size={16} />
                          Cancelar
                        </button>
                      )}
                          </div>
                          <button
                            onClick={() =>
                              setExpandedBookings((prev) => ({
                                ...prev,
                                [booking.id]: !prev[booking.id],
                              }))
                            }
                            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                          >
                            Ocultar detalles
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop Cards */}
            <div className="hidden md:block">
              {filteredBookings.map((booking, index) => {
                const todayStart = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
                const todayEnd = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate(), 23, 59, 59, 999);
                const bookingStart = getDate(booking.fecha_inicio);
                const bookingEnd = getDate(booking.fecha_fin);
                const isToday = bookingEnd >= todayStart && bookingStart <= todayEnd;
                const isFirstOfDateGroup =
                  index === 0 ||
                  getBookingServiceDateKey(booking) !== getBookingServiceDateKey(filteredBookings[index - 1]);
                const agentName = getAgentName(booking);
                const totalUnits = booking.items.reduce((sum, item) => sum + (item.cantidad || 0), 0);
                const paymentBadgeClass = booking.reembolso_realizado
                  ? 'bg-red-100 text-red-700'
                  : booking.pago_realizado
                    ? 'bg-green-100 text-green-700'
                    : 'bg-amber-100 text-amber-700';
                const paymentBadgeLabel = booking.reembolso_realizado
                  ? 'Reembolsado'
                  : booking.pago_realizado
                    ? 'Pagado'
                    : 'Pend. pago';

                return (
                  <div key={booking.id}>
                    {isFirstOfDateGroup && (
                      <div className={clsx('px-5 py-2 border-t border-slate-200 bg-slate-50/80', index === 0 && 'border-t-0')}>
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {getBookingSectionLabel(booking)}
                        </p>
                      </div>
                    )}
                    <article
                      className={clsx(
                        'px-5 py-3 border-t border-slate-200',
                        isFirstOfDateGroup && 'border-t-0',
                        isToday && 'bg-blue-50/40'
                      )}
                    >
                      <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_1.8fr_auto] gap-3 items-start">
                        <div className="min-w-0 space-y-1">
                          <p className="font-mono text-lg leading-tight text-slate-900 wrap-break-word">{booking.numero_reserva}</p>
                          <p className="text-sm text-slate-500">{formatBookingServiceDateRange(booking)}</p>
                          <p className="text-xs text-slate-400">
                            Creada: {format(getDate(booking.creado_en), 'dd MMM yyyy', { locale: es })}
                          </p>
                          {isToday && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 text-blue-700 text-xs font-semibold px-2 py-0.5">
                              Hoy
                            </span>
                          )}
                        </div>

                        <div className="min-w-0 space-y-1.5">
                          <p className="text-lg leading-tight font-semibold text-slate-900 truncate">{booking.cliente.nombre}</p>
                          <p className="text-sm text-slate-500 truncate">{booking.cliente.email}</p>
                          <div className="text-sm text-slate-700">{formatBookingServiceDateRange(booking)}</div>
                          <div className="text-sm text-slate-500 truncate">
                            {getLocationLabel(booking)}{booking.hora_entrega ? ` · ${booking.hora_entrega}` : ''}
                          </div>
                          <div className="text-sm text-slate-500 truncate">
                            {agentName} · {totalUnits} uds
                          </div>
                        </div>

                        <div className="min-w-[230px] space-y-2 lg:text-right">
                          <div className="flex lg:justify-end items-center gap-2">
                            <span
                              className={clsx(
                                'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border',
                                getStatusColor(booking.estado)
                              )}
                            >
                              {getStatusIcon(booking.estado)}
                              <span className="capitalize">{booking.estado}</span>
                            </span>
                            <span className={clsx('inline-flex rounded-full px-2 py-0.5 text-xs font-semibold', paymentBadgeClass)}>
                              {paymentBadgeLabel}
                            </span>
                          </div>

                          <div>
                            <p className="text-2xl font-semibold text-slate-900">
                              €{booking.precio_total.toLocaleString('es-ES', { minimumFractionDigits: 2 })}
                            </p>
                          </div>

                          <div className="flex flex-wrap gap-1.5 lg:justify-end">
                            <button
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setViewingBooking(booking);
                              }}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                            >
                              <Eye size={14} />
                              Detalles
                            </button>
                            <button
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setPaymentManaging(booking);
                              }}
                              className={clsx(
                                'inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold',
                                booking.pago_realizado
                                  ? 'border border-green-200 text-green-700 hover:bg-green-50'
                                  : 'bg-blue-700 text-white hover:bg-blue-800'
                              )}
                            >
                              <CreditCard size={14} />
                              {booking.pago_realizado ? 'Pago' : 'Cobrar'}
                            </button>
                            <button
                              onClick={() => copyContractLink(booking)}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                            >
                              <Share2 size={14} />
                              Contrato
                            </button>
                            {booking.estado !== 'cancelada' && booking.estado !== 'expirada' && (
                              <button
                                onClick={() => handleCancelBooking(booking)}
                                className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-2 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                              >
                                <Ban size={14} />
                                Cancelar
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </article>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-center px-4">
            <div className="bg-gray-100 p-4 rounded-full mb-4">
              <CalendarDays size={32} className="text-gray-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-1">No hay reservas encontradas</h3>
            <p className="text-gray-500 max-w-sm mx-auto mb-6">
              {hasActiveFilters
                ? 'Intenta ajustar los filtros o términos de búsqueda.' 
                : 'No hay reservas registradas.'}
            </p>
            {hasActiveFilters && (
              <button 
                onClick={resetFilters}
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
          onClose={closeNewBookingModal}
          initialSelectedProductId={prefillProductId}
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
  const getDate = (timestamp: unknown): Date => {
    if (!timestamp) return new Date();
    if (
      typeof timestamp === 'object' &&
      timestamp !== null &&
      'toDate' in timestamp &&
      typeof (timestamp as { toDate?: () => Date }).toDate === 'function'
    ) {
      return (timestamp as { toDate: () => Date }).toDate();
    }
    if (timestamp instanceof Date) {
      return timestamp;
    }
    const date = new Date(timestamp as string | number);
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

  const deliveryLocationLabel =
    booking.ubicacion_entrega === 'marina_ibiza'
      ? 'Marina Ibiza'
      : booking.ubicacion_entrega === 'marina_botafoch'
        ? 'Marina Botafoch'
        : booking.ubicacion_entrega === 'club_nautico'
          ? 'Club Náutico'
          : booking.ubicacion_entrega === 'otro'
            ? (booking.ubicacion_entrega_detalle || 'Otro')
            : booking.ubicacion_entrega || 'No indicado';

  const copyDatesAndDelivery = async () => {
    const text = [
      `Fecha inicio: ${format(parseISO(booking.fecha_inicio), 'dd MMM yyyy', { locale: es })}`,
      `Fecha fin: ${format(parseISO(booking.fecha_fin), 'dd MMM yyyy', { locale: es })}`,
      `Ubicación: ${deliveryLocationLabel}`,
      `Hora entrega: ${booking.hora_entrega || 'No indicada'}`,
      `Barco: ${booking.nombre_barco || 'No indicado'}`,
      `Amarre: ${booking.numero_amarre || 'No indicado'}`,
    ].join('\n');

    try {
      await navigator.clipboard.writeText(text);
      alert('Fechas y entrega copiadas.');
    } catch {
      alert('No se pudo copiar automáticamente.');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-100 flex items-center justify-center p-4 overflow-y-auto">
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
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <Calendar size={20} className="text-blue-600" />
                Fechas y Entrega
              </h3>
              <button
                type="button"
                onClick={copyDatesAndDelivery}
                className="btn-outline text-xs"
                title="Copiar fechas y entrega"
              >
                <Copy size={14} />
                Copiar
              </button>
            </div>
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
                  <div className="text-gray-900 font-medium">{deliveryLocationLabel}</div>
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
                    {(item.instructor_requested || item.fuel_requested || item.nautical_license_required) && (
                      <div className="text-xs text-gray-500 mt-1">
                        {item.instructor_requested ? 'Monitor incluido' : ''}
                        {item.instructor_requested && item.fuel_requested ? ' · ' : ''}
                        {item.fuel_requested ? 'Fuel incluido' : ''}
                        {(item.instructor_requested || item.fuel_requested) && item.nautical_license_required ? ' · ' : ''}
                        {item.nautical_license_required ? 'Requiere licencia náutica' : ''}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <div className="pt-2 border-t-2 border-gray-300 space-y-2">
                <div className="flex justify-between items-center text-sm text-gray-600">
                  <span>Alquiler</span>
                  <span>€{Number(booking.precio_alquiler || booking.precio_total || 0).toLocaleString('es-ES', { minimumFractionDigits: 2 })}</span>
                </div>
                {Number(booking.instructor_total || 0) > 0 && (
                  <div className="flex justify-between items-center text-sm text-gray-600">
                    <span>Monitor</span>
                    <span>€{Number(booking.instructor_total || 0).toLocaleString('es-ES', { minimumFractionDigits: 2 })}</span>
                  </div>
                )}
                {Number(booking.fuel_total || 0) > 0 && (
                  <div className="flex justify-between items-center text-sm text-gray-600">
                    <span>Fuel</span>
                    <span>€{Number(booking.fuel_total || 0).toLocaleString('es-ES', { minimumFractionDigits: 2 })}</span>
                  </div>
                )}
                <div className="flex justify-between items-center">
                  <span className="font-bold text-gray-900">Total</span>
                  <span className="font-bold text-xl text-gray-900">€{booking.precio_total.toLocaleString('es-ES', { minimumFractionDigits: 2 })}</span>
                </div>
              </div>
            </div>
          </section>

          <NauticalLicenseManager booking={booking} />

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
