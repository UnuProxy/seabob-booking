'use client';

import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { collection, query, orderBy, onSnapshot, doc, where, getDocs, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { Booking, Product, User } from '@/types';
import { BookingForm } from '@/components/bookings/BookingForm';
import { NauticalLicenseManager } from '@/components/bookings/NauticalLicenseManager';
import { PaymentRefundManager } from '@/components/bookings/PaymentRefundManager';
import { BOOKING_FORM_MODAL_OPEN_KEY, clearBookingDraftStorage } from '@/lib/bookingDraft';
import { ensureBookingAccessToken, getAdminContractPath, getPublicContractUrl } from '@/lib/bookingAccess';
import { shouldAutoExpireBooking } from '@/lib/bookingExpiration';
import { useAuthStore } from '@/store/authStore';
import { releaseBookingStockOnce } from '@/lib/bookingStock';
import { getBookingDeliveryFee, getDeliveryLocationLabel } from '@/lib/deliveryLocations';
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
  MoreHorizontal,
  Link2,
  Filter,
} from 'lucide-react';
import { addWeeks, endOfWeek, format, parseISO, startOfWeek, subWeeks } from 'date-fns';
import { es } from 'date-fns/locale';
import clsx from 'clsx';
import { useSearchParams } from 'next/navigation';

const WEEK_OPTIONS = { weekStartsOn: 1 as const };

const resolveWeekStart = (value?: string) => {
  if (!value) {
    return startOfWeek(new Date(), WEEK_OPTIONS);
  }

  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return startOfWeek(new Date(), WEEK_OPTIONS);
  }

  return startOfWeek(parsed, WEEK_OPTIONS);
};

function AdminBookingActionsMenu({
  booking,
  isOpen,
  onToggle,
  onClose,
  onViewDetails,
  onPayment,
  onCopyPayment,
  onCopyContract,
  onOpenContract,
  onCancel,
}: {
  booking: Booking;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  onViewDetails: () => void;
  onPayment: () => void;
  onCopyPayment: () => void;
  onCopyContract: () => void;
  onOpenContract: () => void;
  onCancel: () => void;
}) {
  const canCancel = booking.estado !== 'cancelada';
  const canGeneratePaymentLink = !booking.pago_realizado && booking.estado !== 'cancelada' && booking.estado !== 'expirada';
  const rootRef = useRef<HTMLDivElement | null>(null);
  const desktopMenuRef = useRef<HTMLDivElement | null>(null);
  const [openUpward, setOpenUpward] = useState(false);

  useLayoutEffect(() => {
    if (!isOpen) {
      setOpenUpward(false);
      return;
    }

    const updatePosition = () => {
      if (window.innerWidth < 768) {
        setOpenUpward(false);
        return;
      }

      const root = rootRef.current;
      const menu = desktopMenuRef.current;
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
        className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
        aria-label="Acciones"
        aria-expanded={isOpen}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
      >
        <MoreHorizontal className="h-5 w-5" strokeWidth={1.75} />
      </button>
      {isOpen ? (
        <>
          <button
            type="button"
            aria-label="Cerrar menu de acciones"
            className="fixed inset-0 z-40 bg-slate-900/20 md:hidden"
            onClick={onClose}
          />
          <div
            className="fixed inset-x-4 bottom-4 z-50 rounded-2xl bg-white py-2 shadow-2xl ring-1 ring-slate-200/80 md:hidden"
            role="menu"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 pb-2 pt-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
              Acciones
            </div>
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-slate-700 hover:bg-slate-50"
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
              className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-slate-700 hover:bg-slate-50"
              onClick={() => {
                onClose();
                onPayment();
              }}
            >
              <CreditCard className="h-4 w-4 opacity-70" />
              {booking.pago_realizado ? 'Gestionar pago' : 'Cobrar'}
            </button>
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-slate-700 hover:bg-slate-50"
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
              className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-slate-700 hover:bg-slate-50"
              onClick={() => {
                onClose();
                onCopyContract();
              }}
            >
              <Share2 className="h-4 w-4 opacity-70" />
              Copiar enlace
            </button>
            {canGeneratePaymentLink ? (
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-slate-700 hover:bg-slate-50"
                onClick={() => {
                  onClose();
                  onCopyPayment();
                }}
              >
                <CreditCard className="h-4 w-4 opacity-70" />
                Copiar enlace pago
              </button>
            ) : null}
            {canCancel ? (
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-rose-700 hover:bg-rose-50"
                onClick={() => {
                  onClose();
                  onCancel();
                }}
              >
                <Ban className="h-4 w-4 opacity-80" />
                Cancelar reserva
              </button>
            ) : null}
          </div>
          <div
            ref={desktopMenuRef}
            className={clsx(
              'absolute right-0 z-40 hidden w-52 rounded-lg bg-white py-1 shadow-lg ring-1 ring-slate-200/80 md:block',
              openUpward ? 'bottom-full mb-1' : 'top-full mt-1'
            )}
            role="menu"
            onClick={(e) => e.stopPropagation()}
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
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
              onClick={() => {
                onClose();
                onPayment();
              }}
            >
              <CreditCard className="h-4 w-4 opacity-70" />
              {booking.pago_realizado ? 'Gestionar pago' : 'Cobrar'}
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
              Copiar enlace
            </button>
            {canGeneratePaymentLink ? (
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                onClick={() => {
                  onClose();
                  onCopyPayment();
                }}
              >
                <CreditCard className="h-4 w-4 opacity-70" />
                Copiar enlace pago
              </button>
            ) : null}
            {canCancel ? (
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-rose-700 hover:bg-rose-50"
                onClick={() => {
                  onClose();
                  onCancel();
                }}
              >
                <Ban className="h-4 w-4 opacity-80" />
                Cancelar reserva
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

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
  const [timeFilter, setTimeFilter] = useState<'selectedWeek' | 'all'>(
    hasInitialDeepLink ? 'all' : 'selectedWeek'
  );
  const [selectedWeekStart, setSelectedWeekStart] = useState(() => resolveWeekStart(initialServiceDate));
  const [dateFrom, setDateFrom] = useState(initialServiceDate);
  const [dateTo, setDateTo] = useState(initialServiceDate);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [expandedBookings, setExpandedBookings] = useState<Record<string, boolean>>({});
  const [isModalOpen, setIsModalOpen] = useState(shouldOpenNewBooking);
  const [prefillProductId, setPrefillProductId] = useState(shouldOpenNewBooking ? initialSelectedProductId : '');
  const [viewingBooking, setViewingBooking] = useState<Booking | null>(null);
  const [paymentManaging, setPaymentManaging] = useState<Booking | null>(null);
  const [openActionMenuId, setOpenActionMenuId] = useState<string | null>(null);

  useEffect(() => {
    const bookingRefParam = searchParams.get('bookingRef')?.trim() ?? '';
    const serviceDateParam = searchParams.get('serviceDate')?.trim() ?? '';

    const syncId = window.setTimeout(() => {
      const hasDeepLink = Boolean(bookingRefParam || serviceDateParam);
      setSearchTerm(bookingRefParam);
      setStatusFilter('all');
      setPaymentFilter('all');
      setTimeFilter(hasDeepLink ? 'all' : 'selectedWeek');
      setSelectedWeekStart(resolveWeekStart(serviceDateParam));
      setDateFrom(serviceDateParam);
      setDateTo(serviceDateParam);
    }, 0);

    return () => window.clearTimeout(syncId);
  }, [searchParams]);

  useEffect(() => {
    if (!openActionMenuId) return;
    const close = () => setOpenActionMenuId(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [openActionMenuId]);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const onChange = () => {
      if (mq.matches) setShowAdvancedFilters(false);
    };
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

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
      await navigator.clipboard.writeText(url);
      alert('Enlace del contrato copiado al portapapeles');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo generar el enlace del contrato';
      alert(message);
    }
  };

  const ensurePaymentLink = async (booking: Booking) => {
    if (booking.pago_realizado) {
      throw new Error('La reserva ya esta pagada.');
    }

    if (booking.estado === 'cancelada' || booking.estado === 'expirada') {
      throw new Error('No se puede generar un cobro para esta reserva.');
    }

    if (booking.stripe_payment_link) {
      return booking.stripe_payment_link;
    }

    const { token } = await ensureContractLink(booking);
    const response = await fetch('/api/stripe/create-checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        bookingId: booking.id,
        token,
      }),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok || typeof data?.url !== 'string' || !data.url) {
      throw new Error(
        typeof data?.error === 'string' ? data.error : 'No se pudo generar el enlace de pago'
      );
    }

    patchBooking(booking.id, {
      token_acceso: token,
      stripe_payment_link: data.url,
      stripe_checkout_session_id: typeof data?.sessionId === 'string' ? data.sessionId : booking.stripe_checkout_session_id,
    });

    return data.url as string;
  };

  const copyPaymentLink = async (booking: Booking) => {
    try {
      const url = await ensurePaymentLink(booking);
      await navigator.clipboard.writeText(url);
      alert('Enlace de pago copiado al portapapeles');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo generar el enlace de pago';
      alert(message);
    }
  };

  const openContractTab = (booking: Booking) => {
    const url = getAdminContractPath(booking.id, booking.token_acceso);
    window.open(url, '_blank', 'noopener,noreferrer');
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
    return getDeliveryLocationLabel(booking.ubicacion_entrega, booking.ubicacion_entrega_detalle) || 'No especificado';
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
      return users[booking.broker_id].empresa_nombre || users[booking.broker_id].nombre || 'Broker desconocido';
    }
    if (booking.agency_id && users[booking.agency_id]) {
      return users[booking.agency_id].empresa_nombre || users[booking.agency_id].nombre || 'Agencia desconocida';
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
    const selectedWeekEnd = endOfWeek(selectedWeekStart, WEEK_OPTIONS);
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
        booking.partner_internal_note,
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
        : bookingEnd >= selectedWeekStart && bookingStart <= selectedWeekEnd;

    return matchesSearch && matchesStatus && matchesPayment && matchesTime;
  }).sort((a, b) => {
    const startDiff = getDate(b.fecha_inicio).getTime() - getDate(a.fecha_inicio).getTime();
    if (startDiff !== 0) return startDiff;
    return getDate(b.creado_en).getTime() - getDate(a.creado_en).getTime();
  });

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
      case 'confirmada':
        return <CheckCircle2 size={14} className="shrink-0" />;
      case 'pendiente':
        return <Clock size={14} className="shrink-0" />;
      case 'completada':
        return <FileCheck size={14} className="shrink-0" />;
      case 'cancelada':
        return <XCircle size={14} className="shrink-0" />;
      case 'expirada':
        return <Clock size={14} className="shrink-0" />;
      default:
        return <Clock size={14} className="shrink-0" />;
    }
  };

  const resetFilters = () => {
    setSearchTerm('');
    setStatusFilter('all');
    setPaymentFilter('all');
    setTimeFilter('selectedWeek');
    setSelectedWeekStart(startOfWeek(new Date(), WEEK_OPTIONS));
    setDateFrom('');
    setDateTo('');
  };

  const isExpiredBooking = (booking: Booking) =>
    booking.estado === 'expirada' || Boolean(booking.expirado);

  const getPaymentBadgeData = (booking: Booking) => {
    if (booking.reembolso_realizado) {
      return {
        label: 'Reembolsado',
        className: 'bg-rose-50 text-rose-800 ring-1 ring-rose-200/80',
        icon: <XCircle size={12} className="shrink-0" />,
      };
    }

    if (booking.pago_realizado) {
      return {
        label: 'Pagado',
        className: 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200/80',
        icon: <CheckCircle2 size={12} className="shrink-0" />,
      };
    }

    if (isExpiredBooking(booking)) {
      return {
        label: 'Expirada',
        className: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200/80',
        icon: <Clock size={12} className="shrink-0" />,
      };
    }

    return {
      label: 'Pend. pago',
      className: 'bg-amber-50 text-amber-900 ring-1 ring-amber-200/80',
      icon: <Clock size={12} className="shrink-0" />,
    };
  };

  const applyTopFilter = (preset: 'selectedWeek' | 'unpaidSelectedWeek' | 'confirmedSelectedWeek' | 'paidSelectedWeek') => {
    setSearchTerm('');
    setDateFrom('');
    setDateTo('');
    setTimeFilter('selectedWeek');
    setStatusFilter('all');
    setPaymentFilter('all');

    if (preset === 'selectedWeek') {
      return;
    }

    if (preset === 'unpaidSelectedWeek') {
      setPaymentFilter('unpaid');
      return;
    }

    if (preset === 'confirmedSelectedWeek') {
      setStatusFilter('confirmada');
      return;
    }

    setPaymentFilter('paid');
  };

  const todayStart = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
  const todayEnd = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate(), 23, 59, 59, 999);
  const selectedWeekEnd = endOfWeek(selectedWeekStart, WEEK_OPTIONS);
  const selectedWeekBookings = bookings.filter((booking) => {
    const start = getDate(booking.fecha_inicio);
    const end = getDate(booking.fecha_fin);
    return end >= selectedWeekStart && start <= selectedWeekEnd;
  });
  const selectedWeekUnpaid = selectedWeekBookings.filter((booking) => !booking.pago_realizado).length;
  const selectedWeekConfirmed = selectedWeekBookings.filter((booking) => booking.estado === 'confirmada').length;
  const selectedWeekPaidRevenue = selectedWeekBookings
    .filter((booking) => booking.pago_realizado && !booking.reembolso_realizado)
    .reduce((sum, booking) => sum + (booking.precio_total || 0), 0);
  const isCurrentWeekSelected = selectedWeekStart.getTime() === startOfWeek(new Date(), WEEK_OPTIONS).getTime();
  const hasActiveFilters = Boolean(
    searchTerm.trim() ||
      statusFilter !== 'all' ||
      paymentFilter !== 'all' ||
      timeFilter !== 'selectedWeek' ||
      dateFrom ||
      dateTo
  );
  const activeTopPreset =
    !dateFrom &&
    !dateTo &&
    !searchTerm.trim() &&
    timeFilter === 'selectedWeek' &&
    statusFilter === 'all' &&
    paymentFilter === 'all'
      ? 'selectedWeek'
      : !dateFrom &&
          !dateTo &&
          !searchTerm.trim() &&
          timeFilter === 'selectedWeek' &&
          statusFilter === 'all' &&
          paymentFilter === 'unpaid'
        ? 'unpaidSelectedWeek'
        : !dateFrom &&
            !dateTo &&
            !searchTerm.trim() &&
            timeFilter === 'selectedWeek' &&
            statusFilter === 'confirmada' &&
            paymentFilter === 'all'
          ? 'confirmedSelectedWeek'
          : !dateFrom &&
              !dateTo &&
              !searchTerm.trim() &&
              timeFilter === 'selectedWeek' &&
              statusFilter === 'all' &&
              paymentFilter === 'paid'
            ? 'paidSelectedWeek'
            : null;
  const selectedWeekLabel = `${format(selectedWeekStart, 'dd MMM', { locale: es })} - ${format(
    selectedWeekEnd,
    'dd MMM yyyy',
    { locale: es }
  )}`;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        <p className="text-gray-500 mt-4">Cargando reservas...</p>
      </div>
    );
  }

  return (
      <div className="w-full min-w-0 space-y-4 md:space-y-8">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="flex w-full items-start justify-between gap-3 md:block md:w-auto">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl md:text-3xl">Reservas</h1>
            <p className="mt-1 hidden text-sm text-slate-500 sm:block">Listado y gestión de todas las reservas.</p>
          </div>
          <button
            type="button"
            onClick={() => openNewBookingModal()}
            className="flex shrink-0 items-center justify-center rounded-lg bg-slate-900 p-2.5 text-white transition hover:bg-slate-800 md:hidden"
            aria-label="Nueva reserva"
          >
            <Plus size={20} strokeWidth={2.25} />
          </button>
        </div>

        <button
          type="button"
          onClick={() => openNewBookingModal()}
          className="hidden items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 md:inline-flex"
        >
          <Plus size={18} strokeWidth={2.25} />
          Nueva reserva
        </button>
      </div>

      {!dateFrom && !dateTo ? (
        <div className="flex flex-col gap-3 rounded-xl bg-white p-4 ring-1 ring-slate-200/70 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-blue-50 p-2.5 text-blue-600 ring-1 ring-blue-200/70">
              <CalendarDays size={18} />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Semana visible</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <p className="rounded-full bg-blue-600 px-3 py-1 text-sm font-semibold text-white shadow-sm">
                  {selectedWeekLabel}
                </p>
                {isCurrentWeekSelected ? (
                  <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-800">
                    Actual
                  </span>
                ) : null}
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Navega semana a semana para revisar todas las reservas sin cambiar filtros manualmente.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedWeekStart((current) => startOfWeek(subWeeks(current, 1), WEEK_OPTIONS))}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Semana anterior
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedWeekStart(startOfWeek(new Date(), WEEK_OPTIONS));
                setTimeFilter('selectedWeek');
              }}
              className={clsx(
                'rounded-lg border px-3 py-2 text-sm font-medium transition',
                isCurrentWeekSelected
                  ? 'border-blue-300 bg-blue-50 text-blue-700'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              )}
            >
              Esta semana
            </button>
            <button
              type="button"
              onClick={() => setSelectedWeekStart((current) => startOfWeek(addWeeks(current, 1), WEEK_OPTIONS))}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Semana siguiente
            </button>
          </div>
        </div>
      ) : null}

      {/* Quick Overview — desktop/tablet only; keeps mobile focused on the list */}
      <div className="hidden gap-3 sm:grid sm:grid-cols-2 sm:gap-3 lg:grid-cols-4">
        <button
          type="button"
          onClick={() => applyTopFilter('selectedWeek')}
          className={clsx(
            'rounded-xl bg-white p-3.5 text-left ring-1 ring-slate-200/70 transition hover:bg-slate-50/80',
            activeTopPreset === 'selectedWeek' ? 'ring-2 ring-blue-300/80 bg-blue-50/30' : ''
          )}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] sm:text-xs uppercase text-gray-500 font-semibold">Reservas semana visible</p>
              <p className="text-xl sm:text-2xl font-bold text-gray-900 mt-0.5 sm:mt-1">{selectedWeekBookings.length}</p>
            </div>
            <div className="rounded-lg bg-blue-50 p-2 text-blue-600 sm:p-2.5">
              <Calendar size={17} />
            </div>
          </div>
        </button>
        <button
          type="button"
          onClick={() => applyTopFilter('unpaidSelectedWeek')}
          className={clsx(
            'rounded-xl bg-white p-3.5 text-left ring-1 ring-slate-200/70 transition hover:bg-slate-50/80',
            activeTopPreset === 'unpaidSelectedWeek' ? 'ring-2 ring-amber-300/80 bg-amber-50/20' : ''
          )}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] sm:text-xs uppercase text-gray-500 font-semibold">Sin pago semana visible</p>
              <p className="text-xl sm:text-2xl font-bold text-gray-900 mt-0.5 sm:mt-1">{selectedWeekUnpaid}</p>
            </div>
            <div className="rounded-lg bg-amber-50 p-2 text-amber-600 sm:p-2.5">
              <Clock size={17} />
            </div>
          </div>
        </button>
        <button
          type="button"
          onClick={() => applyTopFilter('confirmedSelectedWeek')}
          className={clsx(
            'rounded-xl bg-white p-3.5 text-left ring-1 ring-slate-200/70 transition hover:bg-slate-50/80',
            activeTopPreset === 'confirmedSelectedWeek' ? 'ring-2 ring-emerald-300/80 bg-emerald-50/20' : ''
          )}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] sm:text-xs uppercase text-gray-500 font-semibold">Confirmadas semana visible</p>
              <p className="text-xl sm:text-2xl font-bold text-gray-900 mt-0.5 sm:mt-1">{selectedWeekConfirmed}</p>
            </div>
            <div className="rounded-lg bg-emerald-50 p-2 text-emerald-600 sm:p-2.5">
              <CheckCircle2 size={17} />
            </div>
          </div>
        </button>
        <button
          type="button"
          onClick={() => applyTopFilter('paidSelectedWeek')}
          className={clsx(
            'rounded-xl bg-white p-3.5 text-left ring-1 ring-slate-200/70 transition hover:bg-slate-50/80',
            activeTopPreset === 'paidSelectedWeek' ? 'ring-2 ring-slate-400/60 bg-slate-50/50' : ''
          )}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] sm:text-xs uppercase text-gray-500 font-semibold">Ingresos semana visible</p>
              <p className="text-xl sm:text-2xl font-bold text-gray-900 mt-0.5 sm:mt-1">
                €{selectedWeekPaidRevenue.toLocaleString('es-ES', { minimumFractionDigits: 2 })}
              </p>
            </div>
            <div className="rounded-lg bg-slate-900 p-2 text-white sm:p-2.5">
              <Euro size={17} />
            </div>
          </div>
        </button>
      </div>

      {/* Filters & Search */}
      <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200/70 md:p-4">
        <div className="flex flex-col gap-2 md:gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex w-full items-center gap-2 lg:contents">
            <div className="relative min-w-0 flex-1 lg:flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Buscar reserva, cliente, agente…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full rounded-lg bg-slate-50 py-2.5 pl-10 pr-3 text-sm text-slate-900 outline-none ring-1 ring-slate-200/80 transition placeholder:text-slate-400 focus:bg-white focus:ring-slate-300"
              />
            </div>
            <div className="flex shrink-0 items-center gap-1.5 md:gap-2">
              <button
                type="button"
                onClick={() => setShowAdvancedFilters((prev) => !prev)}
                className={clsx(
                  'flex h-10 w-10 items-center justify-center rounded-lg transition md:hidden',
                  showAdvancedFilters
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 ring-1 ring-slate-200/80 hover:bg-slate-50'
                )}
                aria-label={showAdvancedFilters ? 'Ocultar filtros' : 'Filtros'}
                aria-expanded={showAdvancedFilters}
              >
                <Filter className="h-5 w-5" strokeWidth={1.75} />
              </button>
              <button
                type="button"
                onClick={() => setShowAdvancedFilters((prev) => !prev)}
                className={clsx(
                  'hidden rounded-lg px-3 py-2 text-sm font-medium transition md:inline-flex',
                  showAdvancedFilters
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 ring-1 ring-slate-200/80 hover:bg-slate-50'
                )}
              >
                {showAdvancedFilters ? 'Ocultar filtros' : 'Filtros'}
              </button>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="px-2 text-xs text-slate-500 underline-offset-4 hover:text-slate-800 hover:underline md:text-sm"
                >
                  Limpiar
                </button>
              )}
            </div>
          </div>
        </div>

        {showAdvancedFilters && (
          <div className="mt-4 grid grid-cols-1 gap-3 border-t border-slate-100 pt-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="flex flex-col gap-2 w-full min-w-0">
              <label className="text-xs font-semibold text-gray-500 uppercase" htmlFor="timeFilter">
                Rango
              </label>
              <select
                id="timeFilter"
                value={timeFilter}
                onChange={(event) => setTimeFilter(event.target.value as 'selectedWeek' | 'all')}
                className="w-full min-w-0 rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-800 ring-1 ring-slate-200/80 focus:outline-none focus:ring-slate-300"
              >
                <option value="selectedWeek">Semana visible</option>
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
                className="w-full min-w-0 rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-800 ring-1 ring-slate-200/80 focus:outline-none focus:ring-slate-300"
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
                className="w-full min-w-0 rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-800 ring-1 ring-slate-200/80 focus:outline-none focus:ring-slate-300"
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
                  className="w-full min-w-0 rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-800 ring-1 ring-slate-200/80 focus:outline-none focus:ring-slate-300"
                />
                <span className="text-xs font-semibold text-slate-400">a</span>
                <input
                  id="dateTo"
                  type="date"
                  value={dateTo}
                  onChange={(event) => setDateTo(event.target.value)}
                  className="w-full min-w-0 rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-800 ring-1 ring-slate-200/80 focus:outline-none focus:ring-slate-300"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bookings List */}
      <div className="overflow-visible rounded-xl bg-white ring-1 ring-slate-200/70">
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
                const isExpired = isExpiredBooking(booking);
                const paymentBadge = getPaymentBadgeData(booking);
                const isExpanded = Boolean(expandedBookings[booking.id]);
                const agentName = getAgentName(booking);
                const agentType = getAgentType(booking);
                const highlightAgent = agentType === 'Broker' || agentType === 'Agencia';
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
                        'space-y-3 rounded-xl bg-white p-4 ring-1 ring-slate-200/60',
                        isToday && 'bg-blue-50/25 ring-blue-200/50',
                        isExpired && 'opacity-65 saturate-50'
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Referencia</div>
                          <div className="font-mono text-sm font-semibold text-slate-900">{booking.numero_reserva}</div>
                          <div className="mt-1 text-xs text-slate-500">
                            {formatBookingServiceDateRange(booking)}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-start gap-1">
                          <div className="flex flex-col items-end gap-2">
                            <span
                              className={clsx(
                                'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium',
                                getStatusColor(booking.estado)
                              )}
                            >
                              {getStatusIcon(booking.estado)}
                              <span className="capitalize">{booking.estado}</span>
                            </span>
                            {isToday && (
                              <span className="inline-flex items-center gap-1 rounded-md bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-800">
                                Hoy
                              </span>
                            )}
                          </div>
                          <AdminBookingActionsMenu
                            booking={booking}
                            isOpen={openActionMenuId === booking.id}
                            onToggle={() =>
                              setOpenActionMenuId((id) => (id === booking.id ? null : booking.id))
                            }
                            onClose={() => setOpenActionMenuId(null)}
                            onViewDetails={() => setViewingBooking(booking)}
                            onPayment={() => setPaymentManaging(booking)}
                            onCopyPayment={() => void copyPaymentLink(booking)}
                            onCopyContract={() => void copyContractLink(booking)}
                            onOpenContract={() => openContractTab(booking)}
                            onCancel={() => void handleCancelBooking(booking)}
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <div className="text-xs uppercase text-gray-500 font-semibold">Cliente</div>
                          <div className="text-gray-900 font-medium">{booking.cliente.nombre}</div>
                          <div className="text-xs text-gray-500">{booking.cliente.email}</div>
                          {highlightAgent ? (
                            <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-violet-100 px-2.5 py-1 text-[11px] font-semibold text-violet-800 ring-1 ring-violet-200/80">
                              <Briefcase size={12} />
                              {agentType}: {agentName}
                            </div>
                          ) : null}
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
                              ) : isExpired ? (
                                <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-slate-100 text-slate-600 text-xs font-semibold px-2 py-0.5">
                                  <Clock size={12} />
                                  Expirada
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
                const agentType = getAgentType(booking);
                const highlightAgent = agentType === 'Broker' || agentType === 'Agencia';
                const productsSummary = getProductsSummary(booking);
                const isExpired = isExpiredBooking(booking);
                const paymentBadge = getPaymentBadgeData(booking);

                return (
                  <div key={booking.id}>
                    {isFirstOfDateGroup && (
                      <div
                        className={clsx(
                          'border-t border-slate-100/80 bg-slate-50/50 px-4 py-2',
                          index === 0 && 'border-t-0'
                        )}
                      >
                        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                          {getBookingSectionLabel(booking)}
                        </p>
                      </div>
                    )}
                    <article
                      className={clsx(
                        'border-t border-slate-100/80 px-4 py-3',
                        isFirstOfDateGroup && 'border-t-0',
                        isToday && 'bg-blue-50/35',
                        isExpired && 'opacity-65 saturate-50'
                      )}
                    >
                      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:gap-5">
                        <div className="min-w-0 space-y-1">
                          <p className="truncate text-[15px] font-semibold tracking-tight text-slate-900">
                            {booking.cliente.nombre}
                          </p>
                          <p className="truncate text-sm text-slate-500">{booking.cliente.email}</p>
                          {highlightAgent ? (
                            <div className="pt-1">
                              <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-100 px-2.5 py-1 text-[11px] font-semibold text-violet-800 ring-1 ring-violet-200/80">
                                <Briefcase size={12} />
                                {agentType}: {agentName}
                              </span>
                            </div>
                          ) : null}
                          <p className="text-xs text-slate-400">
                            <span className="font-mono text-slate-500">{booking.numero_reserva}</span>
                            <span className="mx-1.5 text-slate-300" aria-hidden>
                              ·
                            </span>
                            Creada: {format(getDate(booking.creado_en), 'd MMM yyyy', { locale: es })}
                          </p>
                          <p className="text-sm text-slate-600">{formatBookingServiceDateRange(booking)}</p>
                          <div className="truncate text-sm text-slate-500">
                            {getLocationLabel(booking)}
                            {booking.hora_entrega ? ` · ${booking.hora_entrega}` : ''}
                          </div>
                          <div className="truncate text-sm text-slate-500">
                            {agentName} · {productsSummary}
                          </div>
                          {isToday && (
                            <span className="inline-flex items-center gap-1 rounded-md bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-800">
                              Hoy
                            </span>
                          )}
                        </div>

                        <div className="flex flex-col gap-1.5 lg:min-w-[168px] lg:items-end">
                          <div className="flex flex-wrap items-center gap-1.5 lg:justify-end">
                            <span
                              className={clsx(
                                'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium',
                                getStatusColor(booking.estado)
                              )}
                            >
                              {getStatusIcon(booking.estado)}
                              <span className="capitalize">{booking.estado}</span>
                            </span>
                            <span
                              className={clsx(
                                'inline-flex rounded-md px-2 py-0.5 text-[11px] font-semibold',
                                paymentBadge.className
                              )}
                            >
                              <span className="inline-flex items-center gap-1">
                                {paymentBadge.icon}
                                {paymentBadge.label}
                              </span>
                            </span>
                          </div>
                          <p className="text-lg font-semibold tabular-nums tracking-tight text-slate-900 lg:text-right">
                            €{booking.precio_total.toLocaleString('es-ES', { minimumFractionDigits: 2 })}
                          </p>
                        </div>

                        <AdminBookingActionsMenu
                          booking={booking}
                          isOpen={openActionMenuId === booking.id}
                          onToggle={() =>
                            setOpenActionMenuId((id) => (id === booking.id ? null : booking.id))
                          }
                          onClose={() => setOpenActionMenuId(null)}
                          onViewDetails={() => setViewingBooking(booking)}
                          onPayment={() => setPaymentManaging(booking)}
                          onCopyPayment={() => void copyPaymentLink(booking)}
                          onCopyContract={() => void copyContractLink(booking)}
                          onOpenContract={() => openContractTab(booking)}
                          onCancel={() => void handleCancelBooking(booking)}
                        />
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
      return users[booking.broker_id].empresa_nombre || users[booking.broker_id].nombre || 'Broker desconocido';
    }
    if (booking.agency_id && users[booking.agency_id]) {
      return users[booking.agency_id].empresa_nombre || users[booking.agency_id].nombre || 'Agencia desconocida';
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
    getDeliveryLocationLabel(booking.ubicacion_entrega, booking.ubicacion_entrega_detalle) || 'No especificado';
  const [clientName, setClientName] = useState(booking.cliente.nombre || '');
  const [clientEmail, setClientEmail] = useState(booking.cliente.email || '');
  const [clientPhone, setClientPhone] = useState(booking.cliente.telefono || '');
  const [savingClient, setSavingClient] = useState(false);
  const [clientFeedback, setClientFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    setClientName(booking.cliente.nombre || '');
    setClientEmail(booking.cliente.email || '');
    setClientPhone(booking.cliente.telefono || '');
    setClientFeedback(null);
  }, [booking]);

  const hasClientChanges =
    clientName !== (booking.cliente.nombre || '') ||
    clientEmail !== (booking.cliente.email || '') ||
    clientPhone !== (booking.cliente.telefono || '');

  const saveClientDetails = async () => {
    const nextName = clientName.trim();
    const nextEmail = clientEmail.trim();
    const nextPhone = clientPhone.trim();

    if (!nextName) {
      setClientFeedback({ type: 'error', message: 'El nombre del cliente es obligatorio.' });
      return;
    }

    setSavingClient(true);
    setClientFeedback(null);

    try {
      await updateDoc(doc(db, 'bookings', booking.id), {
        cliente: {
          ...booking.cliente,
          nombre: nextName,
          email: nextEmail,
          telefono: nextPhone,
          whatsapp: nextPhone,
        },
        updated_at: serverTimestamp(),
      });

      setClientName(nextName);
      setClientEmail(nextEmail);
      setClientPhone(nextPhone);
      setClientFeedback({ type: 'success', message: 'Cliente actualizado correctamente.' });
    } catch (error) {
      console.error('Error updating booking client:', error);
      setClientFeedback({ type: 'error', message: 'No se pudo guardar el cliente.' });
    } finally {
      setSavingClient(false);
    }
  };

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
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <UserIcon size={20} className="text-blue-600" />
                Cliente
              </h3>
              <button
                type="button"
                onClick={() => void saveClientDetails()}
                disabled={!hasClientChanges || savingClient}
                className="btn-outline text-xs disabled:cursor-not-allowed disabled:opacity-50"
              >
                {savingClient ? 'Guardando...' : 'Guardar cliente'}
              </button>
            </div>
            <div className="bg-gray-50 rounded-xl p-4 grid grid-cols-2 gap-4">
              <div>
                <span className="text-xs text-gray-500 uppercase font-semibold">Nombre</span>
                <input
                  type="text"
                  value={clientName}
                  onChange={(event) => {
                    setClientName(event.target.value);
                    if (clientFeedback) setClientFeedback(null);
                  }}
                  className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-gray-900"
                />
              </div>
              <div>
                <span className="text-xs text-gray-500 uppercase font-semibold">Email</span>
                <input
                  type="email"
                  value={clientEmail}
                  onChange={(event) => {
                    setClientEmail(event.target.value);
                    if (clientFeedback) setClientFeedback(null);
                  }}
                  className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-gray-900"
                  placeholder="Sin email"
                />
              </div>
              <div>
                <span className="text-xs text-gray-500 uppercase font-semibold">Teléfono</span>
                <input
                  type="text"
                  value={clientPhone}
                  onChange={(event) => {
                    setClientPhone(event.target.value);
                    if (clientFeedback) setClientFeedback(null);
                  }}
                  className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-gray-900"
                  placeholder="Sin teléfono"
                />
              </div>
              {clientFeedback && (
                <div
                  className={clsx(
                    'col-span-2 rounded-lg border px-3 py-2 text-sm',
                    clientFeedback.type === 'success'
                      ? 'border-green-200 bg-green-50 text-green-700'
                      : 'border-red-200 bg-red-50 text-red-700'
                  )}
                >
                  {clientFeedback.message}
                </div>
              )}
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
                        {item.nautical_license_required ? 'Obligatorio licencia náutica' : ''}
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
                {getBookingDeliveryFee(booking) > 0 && (
                  <div className="flex justify-between items-center text-sm text-gray-600">
                    <span>Entrega</span>
                    <span>€{getBookingDeliveryFee(booking).toLocaleString('es-ES', { minimumFractionDigits: 2 })}</span>
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

          {booking.partner_internal_note && (
            <section>
              <h3 className="text-lg font-bold text-gray-900 mb-3">Nota interna del broker/agencia</h3>
              <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
                <p className="whitespace-pre-wrap text-gray-700">{booking.partner_internal_note}</p>
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
