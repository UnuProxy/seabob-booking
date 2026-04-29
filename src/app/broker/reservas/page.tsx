'use client';

import { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { collection, query, orderBy, onSnapshot, where, getDocs, updateDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { Booking, Product } from '@/types';
import { BookingForm } from '@/components/bookings/BookingForm';
import { NauticalLicenseManager } from '@/components/bookings/NauticalLicenseManager';
import { BOOKING_FORM_MODAL_OPEN_KEY, clearBookingDraftStorage } from '@/lib/bookingDraft';
import { ensureBookingAccessToken, getPublicContractUrl, getPublicPaymentUrl } from '@/lib/bookingAccess';
import { shouldAutoExpireBooking } from '@/lib/bookingExpiration';
import { useAuthStore } from '@/store/authStore';
import { releaseBookingStockOnce } from '@/lib/bookingStock';
import { useSearchParams } from 'next/navigation';
import { getBookingDeliveryFee, getDeliveryLocationLabel } from '@/lib/deliveryLocations';
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

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', 'true');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      textarea.style.pointerEvents = 'none';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      textarea.setSelectionRange(0, textarea.value.length);
      const copied = document.execCommand('copy');
      document.body.removeChild(textarea);
      return copied;
    } catch {
      return false;
    }
  }
}

function BrokerBookingActionsMenu({
  isOpen,
  onToggle,
  onClose,
  canCharge,
  isCharging,
  onViewDetails,
  onCopyPayment,
  onOpenContract,
  onCopyContract,
}: {
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  canCharge: boolean;
  isCharging: boolean;
  onViewDetails: () => void;
  onCopyPayment: () => void;
  onOpenContract: () => void;
  onCopyContract: () => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [openUpward, setOpenUpward] = useState(false);

  useLayoutEffect(() => {
    if (!isOpen) {
      setOpenUpward(false);
      return;
    }

    const updatePosition = () => {
      const root = rootRef.current;
      const menu = menuRef.current;
      if (!root || !menu) return;

      const triggerRect = root.getBoundingClientRect();
      const menuHeight = menu.offsetHeight;
      const spaceBelow = window.innerHeight - triggerRect.bottom;
      const spaceAbove = triggerRect.top;

      setOpenUpward(spaceBelow < menuHeight + 12 && spaceAbove > spaceBelow);
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen]);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
        aria-label="Acciones"
        aria-expanded={isOpen}
      >
        <MoreHorizontal className="h-5 w-5" strokeWidth={1.75} />
      </button>
      {isOpen ? (
        <div
          ref={menuRef}
          className={clsx(
            'absolute right-0 z-30 w-60 rounded-lg bg-white py-1 shadow-lg ring-1 ring-slate-200/80',
            openUpward ? 'bottom-full mb-1' : 'top-full mt-1'
          )}
          onClick={(e) => e.stopPropagation()}
          role="menu"
        >
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
            onClick={() => {
              onClose();
              onViewDetails();
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
              canCharge && !isCharging ? 'text-slate-700 hover:bg-slate-50' : 'cursor-not-allowed text-slate-400'
            )}
            onClick={() => {
              if (!canCharge || isCharging) return;
              onClose();
              onCopyPayment();
            }}
          >
            {isCharging ? (
              <Loader2 className="h-4 w-4 animate-spin opacity-70" />
            ) : (
              <CreditCard className="h-4 w-4 opacity-70" />
            )}
            Copiar enlace pago
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
            onClick={() => {
              onClose();
              onOpenContract();
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
              onClose();
              onCopyContract();
            }}
          >
            <Share2 className="h-4 w-4 opacity-70" />
            Copiar enlace contrato
          </button>
        </div>
      ) : null}
    </div>
  );
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
  const [partnerInternalNote, setPartnerInternalNote] = useState('');
  const [savingPartnerNote, setSavingPartnerNote] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  async function expireBookingIfNeeded(booking: Booking) {
    if (!shouldAutoExpireBooking(booking)) return;
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

  const patchBooking = (bookingId: string, patch: Partial<Booking>) => {
    setBookings((current) =>
      current.map((item) => (item.id === bookingId ? { ...item, ...patch } : item))
    );
  };

  const ensureContractLink = async (booking: Booking) => {
    if (booking.token_acceso) {
      return {
        token: booking.token_acceso,
        url: getPublicContractUrl(window.location.origin, booking.id, booking.token_acceso),
      };
    }

    const { token } = await ensureBookingAccessToken(booking.id);
    patchBooking(booking.id, { token_acceso: token });

    return {
      token,
      url: getPublicContractUrl(window.location.origin, booking.id, token),
    };
  };

  const copyContractLink = async (booking: Booking) => {
    try {
      const { url } = await ensureContractLink(booking);
      const copied = await copyToClipboard(url);
      if (copied) {
        showFeedback('success', 'Enlace del contrato copiado');
      } else {
        window.prompt('Copia manualmente el enlace del contrato:', url);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo generar el enlace del contrato';
      showFeedback('error', message);
    }
  };

  const openContractTab = async (booking: Booking) => {
    try {
      const { url } = await ensureContractLink(booking);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo generar el enlace del contrato';
      showFeedback('error', message);
    }
  };

  const openOrCreatePayment = async (booking: Booking) => {
    if (booking.pago_realizado) return;
    if (booking.estado === 'cancelada' || booking.estado === 'expirada') return;
    setChargingBookingId(booking.id);
    try {
      const { token } = await ensureContractLink(booking);
      const res = await fetch('/api/stripe/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingId: booking.id,
          token,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showFeedback(
          'error',
          typeof data?.error === 'string' ? data.error : 'No se pudo generar el enlace de pago'
        );
        return;
      }
      if (data?.url) {
        patchBooking(booking.id, {
          token_acceso: token,
          stripe_payment_link: data.url,
          stripe_checkout_session_id: data.sessionId,
        });
        const paymentUrl = getPublicPaymentUrl(window.location.origin, booking.id, token);
        const copied = await copyToClipboard(paymentUrl);
        if (copied) {
          showFeedback('success', 'Enlace de pago generado y copiado');
        } else {
          window.prompt('Copia manualmente el enlace de pago:', paymentUrl);
        }
      } else {
        showFeedback('error', 'No se recibió enlace de pago');
      }
    } catch {
      showFeedback('error', 'Error al generar el enlace de pago');
    } finally {
      setChargingBookingId(null);
    }
  };

  const savePartnerNote = async () => {
    if (!viewingBooking || savingPartnerNote) return;

    const nextNote = partnerInternalNote.trim();
    if ((viewingBooking.partner_internal_note || '') === nextNote) {
      showFeedback('success', 'La nota ya estaba actualizada');
      return;
    }

    setSavingPartnerNote(true);
    try {
      await updateDoc(doc(db, 'bookings', viewingBooking.id), {
        partner_internal_note: nextNote,
        updated_at: serverTimestamp(),
      });
      patchBooking(viewingBooking.id, { partner_internal_note: nextNote });
      showFeedback('success', nextNote ? 'Nota guardada para el proveedor' : 'Nota eliminada');
    } catch {
      showFeedback('error', 'No se pudo guardar la nota');
    } finally {
      setSavingPartnerNote(false);
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
      booking.cliente.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (booking.creado_por_nombre || '').toLowerCase().includes(searchTerm.toLowerCase());
    
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

  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(null), 2600);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  const viewingBooking = viewingBookingId
    ? bookings.find((booking) => booking.id === viewingBookingId) || null
    : null;

  const showFeedback = (type: 'success' | 'error', message: string) => {
    setFeedback({ type, message });
  };

  useEffect(() => {
    setPartnerInternalNote(viewingBooking?.partner_internal_note || '');
  }, [viewingBooking?.id, viewingBooking?.partner_internal_note]);

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

  const ubicacionLabel = (booking: Booking) =>
    getDeliveryLocationLabel(booking.ubicacion_entrega, booking.ubicacion_entrega_detalle);

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
      {feedback ? (
        <div className="fixed right-4 top-4 z-60">
          <div
            className={clsx(
              'rounded-xl px-4 py-3 text-sm font-medium shadow-lg ring-1 backdrop-blur',
              feedback.type === 'success'
                ? 'bg-emerald-50/95 text-emerald-800 ring-emerald-200'
                : 'bg-rose-50/95 text-rose-800 ring-rose-200'
            )}
          >
            {feedback.message}
          </div>
        </div>
      ) : null}

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

      <div className="overflow-visible rounded-xl bg-white ring-1 ring-slate-200/70">
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
                      booking.estado !== 'cancelada' &&
                      booking.estado !== 'expirada';
                    const isCharging = chargingBookingId === booking.id;
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
                            {booking.creado_por_nombre ? (
                              <p className="mt-1 text-xs font-medium text-slate-500">
                                Creada por: {booking.creado_por_nombre}
                              </p>
                            ) : null}
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

                            <BrokerBookingActionsMenu
                              isOpen={menuOpen}
                              onToggle={() => setOpenActionMenuId((id) => (id === booking.id ? null : booking.id))}
                              onClose={() => setOpenActionMenuId(null)}
                              canCharge={canCharge}
                              isCharging={isCharging}
                              onViewDetails={() => setViewingBookingId(booking.id)}
                              onCopyPayment={() => void openOrCreatePayment(booking)}
                              onOpenContract={() => void openContractTab(booking)}
                              onCopyContract={() => void copyContractLink(booking)}
                            />
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
                {viewingBooking.creado_por_nombre ? (
                  <div>
                    <label className="text-xs font-semibold text-slate-500 uppercase">Creada por</label>
                    <p className="text-lg font-bold text-slate-900">{viewingBooking.creado_por_nombre}</p>
                  </div>
                ) : null}
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase mb-2 block">Cliente</label>
                <div className="bg-slate-50 rounded-lg p-4 space-y-2 text-slate-800">
                  <p className="text-sm"><span className="font-semibold text-slate-700">Nombre:</span> {viewingBooking.cliente.nombre}</p>
                  <p className="text-sm"><span className="font-semibold text-slate-700">Email:</span> {viewingBooking.cliente.email}</p>
                  <p className="text-sm"><span className="font-semibold text-slate-700">Teléfono:</span> {viewingBooking.cliente.telefono}</p>
                  <p className="text-sm"><span className="font-semibold text-slate-700">Passport / ID:</span> {viewingBooking.cliente.documento_identidad || 'Sin documento'}</p>
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
                    getDeliveryLocationLabel(viewingBooking.ubicacion_entrega, viewingBooking.ubicacion_entrega_detalle) || 'No especificado'
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
                    {getBookingDeliveryFee(viewingBooking) > 0 && (
                      <div>Entrega: €{getBookingDeliveryFee(viewingBooking).toFixed(2)}</div>
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

              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <label className="text-sm font-bold uppercase tracking-wide text-slate-800">
                    Nota interna para proveedor
                  </label>
                  <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-800">
                    Solo interno
                  </span>
                </div>
                <div className="rounded-xl border-2 border-amber-200 bg-linear-to-br from-amber-50 to-white p-5 shadow-sm">
                  <div className="mb-3 rounded-lg border border-amber-200 bg-amber-100/70 px-3 py-2 text-sm font-medium text-amber-900">
                    Usa este espacio para dejar instrucciones, contexto o avisos importantes para el equipo del proveedor.
                  </div>
                  <textarea
                    value={partnerInternalNote}
                    onChange={(event) => setPartnerInternalNote(event.target.value)}
                    rows={4}
                    placeholder="Añade aquí cualquier instrucción o comentario para el equipo interno..."
                    className="w-full resize-y rounded-xl border border-amber-200 bg-white px-4 py-3 text-sm text-slate-800 shadow-sm outline-none placeholder:text-slate-400 focus:border-amber-300 focus:ring-2 focus:ring-amber-200"
                  />
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <p className="text-xs font-medium text-slate-600">
                      Esta nota solo la ve el proveedor en el panel interno.
                    </p>
                    <button
                      type="button"
                      onClick={() => void savePartnerNote()}
                      disabled={savingPartnerNote}
                      className="inline-flex items-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {savingPartnerNote ? 'Guardando...' : 'Guardar nota'}
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => void copyContractLink(viewingBooking)}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Share2 className="h-4 w-4" />
                  Copiar enlace contrato
                </button>
                {!viewingBooking.pago_realizado &&
                viewingBooking.estado !== 'cancelada' &&
                viewingBooking.estado !== 'expirada' ? (
                  <button
                    type="button"
                    onClick={() => void openOrCreatePayment(viewingBooking)}
                    className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    {chargingBookingId === viewingBooking.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <CreditCard className="h-4 w-4" />
                    )}
                    Copiar enlace pago
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
