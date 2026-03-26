'use client';

import { useState, useEffect, useMemo } from 'react';
import { collection, query, orderBy, onSnapshot, where, getDocs, updateDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { Booking, Product } from '@/types';
import { BookingForm } from '@/components/bookings/BookingForm';
import { NauticalLicenseManager } from '@/components/bookings/NauticalLicenseManager';
import { BOOKING_FORM_MODAL_OPEN_KEY, clearBookingDraftStorage } from '@/lib/bookingDraft';
import { useAuthStore } from '@/store/authStore';
import { releaseBookingStockOnce } from '@/lib/bookingStock';
import { useSearchParams } from 'next/navigation';
import {
  Plus,
  Search,
  CheckCircle2,
  Clock,
  XCircle,
  FileCheck,
  Eye,
  Share2,
  Euro,
  Loader2,
  Ban,
  Calendar,
  CreditCard,
  MoreHorizontal,
  Link2,
} from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import clsx from 'clsx';

function getDate(dateValue: unknown): Date {
  if (!dateValue) return new Date();
  if (dateValue instanceof Date) return dateValue;
  if (
    typeof dateValue === 'object' &&
    dateValue !== null &&
    'toDate' in dateValue &&
    typeof (dateValue as { toDate?: () => Date }).toDate === 'function'
  ) {
    return (dateValue as { toDate: () => Date }).toDate();
  }
  if (typeof dateValue === 'string') return new Date(dateValue);
  if (typeof dateValue === 'number') return new Date(dateValue);
  return new Date();
}

export default function BrokerReservasPage() {
  const { user } = useAuthStore();
  const searchParams = useSearchParams();
  const initialSelectedProductId = searchParams.get('productId')?.trim() ?? '';
  const shouldOpenNewBooking = searchParams.get('new') === 'true';
  const initialViewingBookingId = searchParams.get('id')?.trim() ?? '';
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [products, setProducts] = useState<Record<string, Product>>({});
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [startDateFilter, setStartDateFilter] = useState('');
  const [endDateFilter, setEndDateFilter] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(shouldOpenNewBooking);
  const [prefillProductId, setPrefillProductId] = useState(shouldOpenNewBooking ? initialSelectedProductId : '');
  const [viewingBookingId, setViewingBookingId] = useState(initialViewingBookingId);
  const [chargingBookingId, setChargingBookingId] = useState<string | null>(null);
  const [openActionMenuId, setOpenActionMenuId] = useState<string | null>(null);

  async function expireBookingIfNeeded(booking: Booking) {
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
  }

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

  const openContractTab = (booking: Booking) => {
    if (!booking.token_acceso) {
      alert('Esta reserva no tiene enlace de contrato.');
      return;
    }
    const url = `${window.location.origin}/contract/${booking.id}?t=${booking.token_acceso}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const openOrCreatePayment = async (booking: Booking) => {
    if (booking.pago_realizado) return;
    if (booking.requires_payment === false) {
      alert('Esta reserva no requiere pago online.');
      return;
    }
    if (booking.stripe_payment_link) {
      window.open(booking.stripe_payment_link, '_blank', 'noopener,noreferrer');
      return;
    }
    setChargingBookingId(booking.id);
    try {
      const res = await fetch('/api/stripe/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingId: booking.id,
          token: booking.token_acceso || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(typeof data?.error === 'string' ? data.error : 'No se pudo generar el enlace de pago');
        return;
      }
      if (data?.url) {
        window.open(data.url, '_blank', 'noopener,noreferrer');
      } else {
        alert('No se recibió enlace de pago');
      }
    } catch {
      alert('Error al generar el enlace de pago');
    } finally {
      setChargingBookingId(null);
    }
  };

  const handleCancelBooking = async (booking: Booking) => {
    if (!confirm(`¿Estás seguro de que deseas cancelar la reserva ${booking.numero_reserva}?\n\nEsto cambiará el estado a "cancelada" pero mantendrá el registro.`)) {
      return;
    }

    try {
      await releaseBookingStockOnce(booking.id, user?.id || 'broker_panel');
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

  const bookingStats = useMemo(() => {
    const list = filteredBookings;
    return {
      total: list.length,
      pendientes: list.filter((b) => b.estado === 'pendiente').length,
      confirmadas: list.filter((b) => b.estado === 'confirmada').length,
      canceladas: list.filter((b) => b.estado === 'cancelada').length,
    };
  }, [filteredBookings]);

  useEffect(() => {
    if (!openActionMenuId) return;
    const close = () => setOpenActionMenuId(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [openActionMenuId]);

  const viewingBooking = viewingBookingId
    ? bookings.find((booking) => booking.id === viewingBookingId) || null
    : null;

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'confirmada':
        return 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200/80';
      case 'pendiente':
        return 'bg-amber-50 text-amber-900 ring-1 ring-amber-200/80';
      case 'completada':
        return 'bg-sky-50 text-sky-800 ring-1 ring-sky-200/80';
      case 'cancelada':
        return 'bg-rose-50 text-rose-800 ring-1 ring-rose-200/80';
      case 'expirada':
        return 'bg-slate-100 text-slate-700 ring-1 ring-slate-200/80';
      default:
        return 'bg-slate-100 text-slate-700 ring-1 ring-slate-200/80';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'confirmada': return <CheckCircle2 size={14} className="shrink-0" />;
      case 'pendiente': return <Clock size={14} className="shrink-0" />;
      case 'completada': return <FileCheck size={14} className="shrink-0" />;
      case 'cancelada': return <XCircle size={14} className="shrink-0" />;
      case 'expirada': return <Clock size={14} className="shrink-0" />;
      default: return <Clock size={14} className="shrink-0" />;
    }
  };

  const getStatusLabel = (status: string) => {
    const map: Record<string, string> = {
      pendiente: 'Pendiente',
      confirmada: 'Confirmada',
      cancelada: 'Cancelada',
      completada: 'Completada',
      expirada: 'Expirada',
    };
    return map[status] || status;
  };

  const resetFilters = () => {
    setSearchTerm('');
    setStartDateFilter('');
    setEndDateFilter('');
    setStatusFilter('all');
  };

  const formatMoney = (n: number) =>
    n.toLocaleString('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 });

  const ubicacionLabel = (booking: Booking) => {
    switch (booking.ubicacion_entrega) {
      case 'marina_ibiza':
        return 'Marina Ibiza';
      case 'marina_botafoch':
        return 'Marina Botafoch';
      case 'club_nautico':
        return 'Club Náutico Ibiza';
      case 'otro':
        return booking.ubicacion_entrega_detalle?.trim() || 'Otro';
      default:
        return typeof booking.ubicacion_entrega === 'string' && booking.ubicacion_entrega
          ? booking.ubicacion_entrega
          : '';
    }
  };

  const bookingGroups = useMemo(() => {
    const map = new Map<string, Booking[]>();
    for (const b of filteredBookings) {
      const d0 = getDate(b.fecha_inicio);
      const key = format(d0, 'yyyy-MM-dd');
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(b);
    }
    const sortedKeys = [...map.keys()].sort();
    return sortedKeys.map((key) => {
      const list = [...(map.get(key) || [])];
      list.sort((a, b) => {
        const ta = (a.hora_entrega || '').localeCompare(b.hora_entrega || '');
        if (ta !== 0) return ta;
        return getDate(b.creado_en).getTime() - getDate(a.creado_en).getTime();
      });
      return { key, day: getDate(list[0].fecha_inicio), bookings: list };
    });
  }, [filteredBookings]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <Loader2 className="animate-spin text-blue-600 mb-4" size={48} />
        <p className="text-gray-500">Cargando reservas...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">Mis reservas</h1>
          <p className="mt-1 max-w-lg text-sm text-slate-500">Gestiona y consulta las reservas creadas.</p>
        </div>
        <button
          type="button"
          onClick={() => openNewBookingModal()}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800"
        >
          <Plus size={17} strokeWidth={2.25} />
          Nueva reserva
        </button>
      </div>

      <div className="rounded-xl bg-white p-4 ring-1 ring-slate-200/70 sm:p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-4">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              placeholder="Buscar reserva o cliente..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-lg bg-slate-50 py-2.5 pl-10 pr-3 text-sm text-slate-900 outline-none ring-1 ring-slate-200/80 transition placeholder:text-slate-400 focus:bg-white focus:ring-slate-300"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap">
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200/80 sm:flex-initial sm:min-w-[260px]">
              <Calendar className="h-4 w-4 shrink-0 text-slate-400" />
              <input
                type="date"
                value={startDateFilter}
                onChange={(e) => setStartDateFilter(e.target.value)}
                className="min-w-0 flex-1 border-0 bg-transparent p-0 text-xs text-slate-700 outline-none sm:text-sm"
                aria-label="Fecha desde"
              />
              <span className="shrink-0 text-slate-300">–</span>
              <input
                type="date"
                value={endDateFilter}
                onChange={(e) => setEndDateFilter(e.target.value)}
                className="min-w-0 flex-1 border-0 bg-transparent p-0 text-xs text-slate-700 outline-none sm:text-sm"
                aria-label="Fecha hasta"
              />
            </div>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg bg-white px-3 py-2.5 text-sm font-medium text-slate-800 outline-none ring-1 ring-slate-200/80 focus:ring-slate-300"
              aria-label="Estado"
            >
              <option value="all">Todos los estados</option>
              <option value="pendiente">Pendiente</option>
              <option value="confirmada">Confirmada</option>
              <option value="completada">Completada</option>
              <option value="cancelada">Cancelada</option>
              <option value="expirada">Expirada</option>
            </select>

            <button
              type="button"
              onClick={resetFilters}
              className="px-2 text-sm text-slate-500 underline-offset-4 hover:text-slate-800 hover:underline"
            >
              Limpiar
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-3">
        {[
          { label: 'Total', value: bookingStats.total, dot: 'bg-slate-400' },
          { label: 'Pendientes', value: bookingStats.pendientes, dot: 'bg-amber-500' },
          { label: 'Confirmadas', value: bookingStats.confirmadas, dot: 'bg-emerald-500' },
          { label: 'Canceladas', value: bookingStats.canceladas, dot: 'bg-rose-500' },
        ].map((card) => (
          <div
            key={card.label}
            className="rounded-xl bg-white px-4 py-3.5 ring-1 ring-slate-200/70"
          >
            <div className="flex items-center gap-2">
              <span className={`h-1.5 w-1.5 rounded-full ${card.dot}`} aria-hidden />
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{card.label}</p>
            </div>
            <p className="mt-1 text-xl font-semibold tabular-nums tracking-tight text-slate-900">{card.value}</p>
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl bg-white ring-1 ring-slate-200/70">
        {filteredBookings.length === 0 ? (
          <div className="px-6 py-14 text-center text-sm text-slate-500">
            {bookings.length === 0
              ? 'No hay reservas aún. Crea tu primera reserva para comenzar.'
              : 'No se encontraron reservas con los filtros aplicados.'}
          </div>
        ) : (
          <div>
            {bookingGroups.map((group) => (
              <div key={group.key}>
                <div className="border-b border-slate-100/80 bg-slate-50/50 px-4 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                    {format(group.day, 'EEEE, d MMM yyyy', { locale: es }).toUpperCase()}
                  </p>
                </div>
                <ul className="divide-y divide-slate-100/80">
                  {group.bookings.map((booking) => {
                    const paid = Boolean(booking.pago_realizado);
                    const showPendingPay =
                      !paid && booking.requires_payment !== false && booking.estado !== 'expirada';
                    const place = ubicacionLabel(booking);
                    const timePart = booking.hora_entrega?.trim();
                    const placeTime =
                      place && timePart ? `${place} · ${timePart}` : place || timePart || '';
                    const item = booking.items[0];
                    const product = item ? products[item.producto_id] : undefined;
                    const productMeta = item
                      ? `${product?.nombre || 'Producto'} · ${item.cantidad} uds`
                      : '—';
                    const canCharge =
                      !paid &&
                      booking.requires_payment !== false &&
                      booking.estado !== 'cancelada' &&
                      booking.estado !== 'expirada';
                    const isCharging = chargingBookingId === booking.id;
                    const canCancel = booking.estado !== 'cancelada' && booking.estado !== 'expirada';
                    const menuOpen = openActionMenuId === booking.id;

                    return (
                      <li key={booking.id}>
                        <div className="flex flex-col gap-3 px-4 py-3.5 transition-colors hover:bg-slate-50/40 lg:flex-row lg:items-center lg:gap-6 lg:py-3">
                          <div className="min-w-0 flex-1">
                            <p className="text-[15px] font-semibold tracking-tight text-slate-900">
                              {booking.cliente.nombre}
                            </p>
                            {booking.cliente.email ? (
                              <p className="mt-0.5 text-xs text-slate-500">{booking.cliente.email}</p>
                            ) : null}
                            <p className="mt-1 text-xs text-slate-400">
                              <span className="text-slate-500">{booking.numero_reserva}</span>
                              <span className="mx-1.5 text-slate-300" aria-hidden>
                                ·
                              </span>
                              Creada{' '}
                              {format(getDate(booking.creado_en), 'd MMM yyyy', { locale: es })}
                            </p>
                            {placeTime ? (
                              <p className="mt-1.5 text-xs text-slate-500">{placeTime}</p>
                            ) : null}
                            <p
                              className={clsx(
                                'text-xs text-slate-400',
                                placeTime ? 'mt-0.5' : 'mt-1.5'
                              )}
                            >
                              {productMeta}
                            </p>
                          </div>

                          <div className="flex items-center justify-between gap-3 border-t border-slate-100/80 pt-3 lg:w-auto lg:shrink-0 lg:justify-end lg:border-t-0 lg:pt-0">
                            <div className="flex min-w-0 flex-1 flex-col gap-1.5 lg:flex-initial lg:items-end">
                              <div className="flex flex-wrap items-center gap-1.5 lg:justify-end">
                                <span
                                  className={clsx(
                                    'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium',
                                    getStatusColor(booking.estado)
                                  )}
                                >
                                  {getStatusIcon(booking.estado)}
                                  {getStatusLabel(booking.estado)}
                                </span>
                                {showPendingPay ? (
                                  <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-900 ring-1 ring-amber-200/70">
                                    <Clock size={11} className="shrink-0" />
                                    Pend. pago
                                  </span>
                                ) : null}
                                {paid ? (
                                  <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800 ring-1 ring-emerald-200/70">
                                    <CheckCircle2 size={11} className="shrink-0" />
                                    Pagado
                                  </span>
                                ) : null}
                              </div>
                              <p className="text-base font-semibold tabular-nums tracking-tight text-slate-900 lg:text-right">
                                {formatMoney(Number(booking.precio_total) || 0)}
                              </p>
                            </div>

                            <div className="relative shrink-0">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setOpenActionMenuId((id) => (id === booking.id ? null : booking.id));
                                }}
                                className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
                                aria-label="Acciones"
                                aria-expanded={menuOpen}
                              >
                                <MoreHorizontal className="h-5 w-5" strokeWidth={1.75} />
                              </button>
                              {menuOpen ? (
                                <div
                                  className="absolute right-0 top-full z-30 mt-1 w-52 rounded-lg bg-white py-1 shadow-lg ring-1 ring-slate-200/80"
                                  onClick={(e) => e.stopPropagation()}
                                  role="menu"
                                >
                                  <button
                                    type="button"
                                    role="menuitem"
                                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                                    onClick={() => {
                                      setOpenActionMenuId(null);
                                      setViewingBookingId(booking.id);
                                    }}
                                  >
                                    <Eye className="h-4 w-4 opacity-70" />
                                    Ver detalles
                                  </button>
                                  <button
                                    type="button"
                                    role="menuitem"
                                    disabled={!canCharge || isCharging}
                                    className={clsx(
                                      'flex w-full items-center gap-2 px-3 py-2 text-left text-sm',
                                      canCharge && !isCharging
                                        ? 'text-slate-700 hover:bg-slate-50'
                                        : 'cursor-not-allowed text-slate-400'
                                    )}
                                    onClick={() => {
                                      if (!canCharge || isCharging) return;
                                      setOpenActionMenuId(null);
                                      void openOrCreatePayment(booking);
                                    }}
                                  >
                                    {isCharging ? (
                                      <Loader2 className="h-4 w-4 animate-spin opacity-70" />
                                    ) : (
                                      <CreditCard className="h-4 w-4 opacity-70" />
                                    )}
                                    Cobrar
                                  </button>
                                  <button
                                    type="button"
                                    role="menuitem"
                                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                                    onClick={() => {
                                      setOpenActionMenuId(null);
                                      openContractTab(booking);
                                    }}
                                  >
                                    <Link2 className="h-4 w-4 opacity-70" />
                                    Abrir contrato
                                  </button>
                                  <button
                                    type="button"
                                    role="menuitem"
                                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                                    onClick={() => {
                                      setOpenActionMenuId(null);
                                      copyContractLink(booking);
                                    }}
                                  >
                                    <Share2 className="h-4 w-4 opacity-70" />
                                    Copiar enlace
                                  </button>
                                  {canCancel ? (
                                    <button
                                      type="button"
                                      role="menuitem"
                                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-rose-700 hover:bg-rose-50"
                                      onClick={() => {
                                        setOpenActionMenuId(null);
                                        void handleCancelBooking(booking);
                                      }}
                                    >
                                      <Ban className="h-4 w-4 opacity-80" />
                                      Cancelar reserva
                                    </button>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Booking Form Modal */}
      {isModalOpen && (
        <BookingForm
          onClose={closeNewBookingModal}
          initialSelectedProductId={prefillProductId}
        />
      )}

      {/* Booking Details Modal */}
      {viewingBooking && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
              <h2 className="text-2xl font-bold text-slate-900">Detalles de la Reserva</h2>
              <button
                onClick={() => setViewingBookingId('')}
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
                  <span
                    className={clsx(
                      'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium',
                      getStatusColor(viewingBooking.estado)
                    )}
                  >
                    {getStatusIcon(viewingBooking.estado)}
                    {getStatusLabel(viewingBooking.estado)}
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
                        <div>
                          <span className="text-sm text-slate-800">{product?.nombre || 'Producto desconocido'} x{item.cantidad}</span>
                          {(item.instructor_requested || item.fuel_requested || item.nautical_license_required) && (
                            <div className="text-xs text-slate-500 mt-1">
                              {item.instructor_requested ? 'Monitor incluido' : ''}
                              {item.instructor_requested && item.fuel_requested ? ' · ' : ''}
                              {item.fuel_requested ? 'Fuel incluido' : ''}
                              {(item.instructor_requested || item.fuel_requested) && item.nautical_license_required ? ' · ' : ''}
                              {item.nautical_license_required ? 'Obligatorio licencia náutica' : ''}
                            </div>
                          )}
                        </div>
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
                    viewingBooking.ubicacion_entrega === 'club_nautico' ? 'Club Náutico Ibiza' :
                    viewingBooking.ubicacion_entrega === 'otro' ? (viewingBooking.ubicacion_entrega_detalle || 'Otro') :
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
                  <div className="text-sm text-slate-500 space-y-1 mb-1">
                    <div>Alquiler: €{Number(viewingBooking.precio_alquiler || viewingBooking.precio_total || 0).toFixed(2)}</div>
                    {Number(viewingBooking.instructor_total || 0) > 0 && (
                      <div>Monitor: €{Number(viewingBooking.instructor_total || 0).toFixed(2)}</div>
                    )}
                    {Number(viewingBooking.fuel_total || 0) > 0 && (
                      <div>Fuel: €{Number(viewingBooking.fuel_total || 0).toFixed(2)}</div>
                    )}
                  </div>
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

              <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => copyContractLink(viewingBooking)}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Share2 className="h-4 w-4" />
                  Copiar enlace contrato
                </button>
                {viewingBooking.estado !== 'cancelada' && viewingBooking.estado !== 'expirada' ? (
                  <button
                    type="button"
                    onClick={() => handleCancelBooking(viewingBooking)}
                    className="inline-flex items-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-800 hover:bg-rose-100"
                  >
                    <Ban className="h-4 w-4" />
                    Cancelar reserva
                  </button>
                ) : null}
              </div>

              <NauticalLicenseManager booking={viewingBooking} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
