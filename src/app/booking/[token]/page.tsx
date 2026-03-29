'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  query,
  serverTimestamp,
  updateDoc,
  where,
  runTransaction,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { getProductDailyPrice, getProductVatShortLabel } from '@/lib/productPricing';
import { getTimedBookingExpiration } from '@/lib/bookingExpiration';
import { getBookingClientTotals } from '@/lib/bookingClientPricing';
import {
  DELIVERY_LOCATION_GROUPS,
  getDeliveryLocationFee,
  isDeliveryLocation,
} from '@/lib/deliveryLocations';
import {
  getBookingItemAverageDailyPrice,
  getBookingItemRentalTotal,
  doesBookingItemRequireNauticalLicense,
  getBookingDayCount,
  getBookingItemFuelTotal,
  getBookingItemInstructorTotal,
  hasFuelOption,
  hasInstructorOption,
  supportsEfoilBatteryOption,
} from '@/lib/bookingExtras';
import { BookingItem, BookingLink, Product, User as AppUser } from '@/types';
import { addDays, format, eachDayOfInterval } from 'date-fns';
import {
  Anchor,
  CalendarDays,
  CheckCircle,
  Copy,
  Loader2,
  Mail,
  MapPin,
  Minus,
  Phone,
  Plus,
  Save,
  ShoppingBag,
  User,
  X,
} from 'lucide-react';

export default function PublicBookingPage() {
  const params = useParams();
  const token = params?.token as string;
  const formatPrice = (amount: number) => amount.toLocaleString('es-ES', { maximumFractionDigits: 0 });
  const getErrorMessage = (error: unknown) =>
    typeof error === 'object' && error && 'message' in error ? String((error as { message?: unknown }).message || '') : '';

  const [link, setLink] = useState<BookingLink | null>(null);
  const [creatorUser, setCreatorUser] = useState<AppUser | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [productOptions, setProductOptions] = useState<
    Record<string, { instructor_requested: boolean; fuel_requested: boolean }>
  >({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState<{ contractUrl: string; paymentUrl?: string; requiresPayment: boolean }>({
    contractUrl: '',
    requiresPayment: true,
  });

  // Form State
  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [notes, setNotes] = useState('');

  const now = new Date();
  const isPastCutoff = now.getHours() >= 17;
  const minDate = isPastCutoff ? addDays(now, 1) : now;
  const minDateStr = format(minDate, 'yyyy-MM-dd');
  const [startDate, setStartDate] = useState(minDateStr);
  const [endDate, setEndDate] = useState(minDateStr);
  const [isMultiDay, setIsMultiDay] = useState(false);

  const [deliveryLocation, setDeliveryLocation] = useState<
    | 'marina_ibiza'
    | 'marina_botafoch'
    | 'club_nautico'
    | 'marina_port_ibiza'
    | 'marina_santa_eulalia'
    | 'club_nautic_san_antonio'
    | 'otro'
  >('marina_ibiza');
  const [deliveryTime, setDeliveryTime] = useState('10:00');
  const [boatName, setBoatName] = useState('');
  const [dockingNumber, setDockingNumber] = useState('');

  useEffect(() => {
    if (!token) return;

    const fetchLink = async () => {
      try {
        const linkRef = doc(db, 'booking_links', token);
        const snap = await getDoc(linkRef);

        if (!snap.exists()) {
          setError('Este enlace no es válido.');
          return;
        }

        const data = { id: snap.id, ...snap.data() } as BookingLink;

        if (!data.activo) {
          setError('Este enlace está desactivado.');
          return;
        }

        if (data.uso_unico && data.reservas_creadas > 0) {
          setError('Este enlace ya fue utilizado.');
          return;
        }

        setLink(data);
        setClientName(data.cliente_nombre || '');
        setClientEmail(data.cliente_email || '');
        setClientPhone(data.cliente_telefono || '');

        updateDoc(linkRef, {
          visitas: increment(1),
          ultimo_acceso: serverTimestamp(),
        }).catch(() => null);
      } catch (err) {
        console.error(err);
        setError('No pudimos cargar el enlace. Intenta nuevamente.');
      } finally {
        setLoading(false);
      }
    };

    fetchLink();
  }, [token]);

  useEffect(() => {
    if (!link) return;

    const fetchProducts = async () => {
      try {
        const q = query(collection(db, 'products'), where('activo', '==', true));
        const snapshot = await getDocs(q);
        const productsData = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Product));
        setProducts(productsData);
      } catch (err) {
        console.error('Error fetching products:', err);
        setError('No se pudieron cargar los productos disponibles.');
      }
    };

    fetchProducts();
  }, [link]);

  useEffect(() => {
    if (!link?.creado_por) return;

    const fetchCreator = async () => {
      try {
        const userSnap = await getDoc(doc(db, 'users', link.creado_por as string));
        if (userSnap.exists()) {
          setCreatorUser({ id: userSnap.id, ...userSnap.data() } as AppUser);
        }
      } catch (err) {
        console.error('Error fetching link creator:', err);
      }
    };

    fetchCreator();
  }, [link]);

  useEffect(() => {
    setQuantities((prev) => {
      const next = { ...prev };
      products.forEach((product) => {
        if (product.id && next[product.id] === undefined) {
          next[product.id] = 0;
        }
      });
      return next;
    });

    setProductOptions((prev) => {
      const next = { ...prev };
      products.forEach((product) => {
        if (product.id && next[product.id] === undefined) {
          next[product.id] = {
            instructor_requested: false,
            fuel_requested: false,
          };
        }
      });
      return next;
    });
  }, [products]);

  useEffect(() => {
    if (endDate < startDate) {
      setEndDate(startDate);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    if (!isMultiDay) {
      setEndDate(startDate);
    }
  }, [isMultiDay, startDate]);

  const dayCount = useMemo(() => getBookingDayCount(startDate, endDate), [startDate, endDate]);

  const items: BookingItem[] = useMemo(() => {
    return Object.entries(quantities)
      .filter(([, qty]) => qty > 0)
      .map(([productId, qty]) => ({
        producto_id: productId,
        cantidad: qty,
        tipo_alquiler: 'dia',
        duracion: dayCount,
        instructor_requested: Boolean(productOptions[productId]?.instructor_requested),
        fuel_requested: Boolean(productOptions[productId]?.fuel_requested),
      }));
  }, [quantities, dayCount, productOptions]);

  const rentalTotal = useMemo(() => {
    return items.reduce((acc, item) => {
      const product = products.find((p) => p.id === item.producto_id);
      return acc + getBookingItemRentalTotal(item, product, startDate, endDate);
    }, 0);
  }, [endDate, items, products, startDate]);

  const instructorTotal = useMemo(
    () =>
      items.reduce((acc, item) => {
        const product = products.find((p) => p.id === item.producto_id);
        return acc + getBookingItemInstructorTotal(item, product, dayCount);
      }, 0),
    [items, products, dayCount]
  );

  const fuelTotal = useMemo(
    () =>
      items.reduce((acc, item) => {
        const product = products.find((p) => p.id === item.producto_id);
        return acc + getBookingItemFuelTotal(item, product, dayCount);
      }, 0),
    [items, products, dayCount]
  );

  const total = rentalTotal + instructorTotal + fuelTotal;
  const productsById = useMemo(
    () =>
      Object.fromEntries(
        products
          .filter((product): product is Product & { id: string } => Boolean(product.id))
          .map((product) => [product.id, product])
      ),
    [products]
  );
  const clientTotals = useMemo(
    () => getBookingClientTotals(items, (productId) => productsById[productId], startDate, endDate),
    [endDate, items, productsById, startDate]
  );
  const deliveryTotal = useMemo(() => getDeliveryLocationFee(deliveryLocation), [deliveryLocation]);
  const nauticalLicenseRequired = useMemo(
    () =>
      items.some((item) => {
        const product = products.find((p) => p.id === item.producto_id);
        return doesBookingItemRequireNauticalLicense(item, product);
      }),
    [items, products]
  );
  const vatSummaryLabel = useMemo(() => {
    const selectedProducts = items
      .map((item) => products.find((product) => product.id === item.producto_id))
      .filter((product): product is Product => Boolean(product));

    if (selectedProducts.length === 0) {
      return '';
    }

    if (selectedProducts.every((product) => product.incluir_iva)) {
      return 'Precio con IVA incluido';
    }

    if (selectedProducts.some((product) => product.incluir_iva)) {
      return 'Incluye IVA en los productos marcados';
    }

    return 'Precio sin IVA';
  }, [items, products]);

  const updateQuantity = (productId: string, delta: number) => {
    setQuantities((prev) => {
      const nextValue = Math.max(0, (prev[productId] || 0) + delta);
      return { ...prev, [productId]: nextValue };
    });
  };

  const updateProductOption = (
    productId: string,
    field: 'instructor_requested' | 'fuel_requested',
    value: boolean
  ) => {
    setProductOptions((prev) => ({
      ...prev,
      [productId]: {
        instructor_requested: Boolean(prev[productId]?.instructor_requested),
        fuel_requested: Boolean(prev[productId]?.fuel_requested),
        [field]: value,
      },
    }));
  };

  const validateStockAvailability = async () => {
    if (!items.length) return { ok: true };

    const start = new Date(startDate);
    const end = new Date(endDate);
    const days = eachDayOfInterval({ start, end });

    for (const item of items) {
      let minAvailable = Infinity;

      for (const day of days) {
        const dateStr = format(day, 'yyyy-MM-dd');
        const stockSnap = await getDoc(doc(db, 'daily_stock', `${dateStr}_${item.producto_id}`));

        if (stockSnap.exists()) {
          const stockData = stockSnap.data() as { cantidad_disponible?: number; cantidad_reservada?: number };
          const available =
            (stockData.cantidad_disponible || 0) - (stockData.cantidad_reservada || 0);
          minAvailable = Math.min(minAvailable, available);
        } else {
          minAvailable = 0;
        }
      }

      if (minAvailable === Infinity) minAvailable = 0;

      const product = products.find((p) => p.id === item.producto_id);
      const productName = product?.nombre || 'El producto seleccionado';

      if (minAvailable <= 0) {
        return {
          ok: false,
          message: `❌ ${productName} no tiene stock disponible para las fechas seleccionadas. Por favor, elige otro producto o cambia las fechas.`,
        };
      }

      if (item.cantidad > minAvailable) {
        return {
          ok: false,
          message: `❌ ${productName} solo tiene ${minAvailable} unidad(es) disponible(s), pero solicitaste ${item.cantidad}. Reduce la cantidad o cambia las fechas.`,
        };
      }
    }

    return { ok: true };
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!link) return;
    if (startDate < minDateStr) {
      setError('No se pueden crear reservas para hoy después de las 17:00. Selecciona otra fecha.');
      return;
    }

    if (!clientName.trim() || !clientEmail.trim()) {
      setError('El nombre y el email son obligatorios.');
      return;
    }

    if (items.length === 0) {
      setError('Selecciona al menos un producto.');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const stockValidation = await validateStockAvailability();
      if (!stockValidation.ok) {
        setError(stockValidation.message || 'No hay stock disponible para estas fechas.');
        setSubmitting(false);
        return;
      }

      const ref = `RES-${format(new Date(), 'ddMMyy')}-${Math.floor(Math.random() * 1000)
        .toString()
        .padStart(3, '0')}`;

      const contractToken =
        Math.random().toString(36).substring(2, 15) +
        Math.random().toString(36).substring(2, 15);

      const itemsWithNames = items.map((item) => {
        const product = products.find((p) => p.id === item.producto_id);
        const instructorTotalForItem = getBookingItemInstructorTotal(item, product, dayCount);
        const fuelTotalForItem = getBookingItemFuelTotal(item, product, dayCount);
        return {
          ...item,
          producto_nombre: product?.nombre || item.producto_id,
          precio_unitario:
            item.tipo_alquiler === 'hora'
              ? product?.precio_hora || 0
              : getBookingItemAverageDailyPrice(item, product, startDate, endDate),
          comision_percent: product?.comision || 0,
          deposito_unitario: 0,
          instructor_requested: hasInstructorOption(product) ? Boolean(item.instructor_requested) : false,
          instructor_price_per_day: Number(product?.instructor_price_per_day || 0),
          instructor_incluir_iva: Boolean(product?.instructor_incluir_iva),
          instructor_total: instructorTotalForItem,
          fuel_requested: hasFuelOption(product) ? Boolean(item.fuel_requested) : false,
          fuel_price_per_day: Number(product?.fuel_price_per_day || 0),
          fuel_total: fuelTotalForItem,
          nautical_license_required: doesBookingItemRequireNauticalLicense(item, product),
        };
      });

      let resolvedCreatorUser = creatorUser;
      if (!resolvedCreatorUser && link.creado_por) {
        const creatorSnap = await getDoc(doc(db, 'users', link.creado_por as string));
        if (creatorSnap.exists()) {
          resolvedCreatorUser = { id: creatorSnap.id, ...creatorSnap.data() } as AppUser;
          setCreatorUser(resolvedCreatorUser);
        }
      }

      const getItemSubtotal = (item: BookingItem, product?: Product) => {
        return getBookingItemRentalTotal(item, product, startDate, endDate);
      };

      const commissionPartnerRole =
        resolvedCreatorUser?.rol === 'broker' || resolvedCreatorUser?.rol === 'agency';
      const partnerAllowsBookingWithoutPayment =
        commissionPartnerRole && Boolean(resolvedCreatorUser?.allow_booking_without_payment);
      const requiresPayment = !partnerAllowsBookingWithoutPayment;
      const comisionTotal = commissionPartnerRole
        ? itemsWithNames.reduce((total, item) => {
            const product = products.find((p) => p.id === item.producto_id);
            const itemPrice = getItemSubtotal(item, product);
            const commissionRate = (item.comision_percent || 0) / 100;
            return total + itemPrice * commissionRate;
          }, 0)
        : 0;

      // Broker/agency-created links keep the booking lock for 30m if service is within 24h,
      // otherwise for 24h. Other links keep the default short hold.
      const expiracion = getTimedBookingExpiration(startDate, resolvedCreatorUser?.rol ?? null);

      const bookingTotal = clientTotals.total + deliveryTotal;

      const bookingData = {
        numero_reserva: ref,
        cliente: {
          nombre: clientName.trim(),
          email: clientEmail.trim(),
          telefono: clientPhone.trim(),
          whatsapp: clientPhone.trim(),
        },
        items: itemsWithNames,
        fecha_inicio: startDate,
        fecha_fin: endDate,
        precio_total: bookingTotal,
        precio_alquiler: clientTotals.rentalTotal,
        instructor_total: clientTotals.instructorTotal,
        fuel_total: clientTotals.fuelTotal,
        delivery_total: deliveryTotal,
        nautical_license_required: nauticalLicenseRequired,
        deposito_total: 0,
        estado: 'pendiente',
        acuerdo_firmado: false,
        ubicacion_entrega: deliveryLocation,
        nombre_barco: boatName.trim() || null,
        numero_amarre: dockingNumber.trim() || null,
        hora_entrega: deliveryTime,
        token_acceso: contractToken,
        firma_cliente: null,
        terminos_aceptados: false,
        pago_realizado: false,
        requires_payment: requiresPayment,
        comision_total: comisionTotal,
        comision_pagada: 0,
        expiracion: expiracion,
        expirado: false,
        stock_released: false,
        notas: notes.trim() || null,
        creado_en: serverTimestamp(),
        creado_por: link.creado_por || null,
        public_link_id: link.id,
        origen: 'public_link',
        ...(resolvedCreatorUser?.rol === 'broker' ? { broker_id: resolvedCreatorUser.id } : {}),
        ...(resolvedCreatorUser?.rol === 'agency' ? { agency_id: resolvedCreatorUser.id } : {}),
        ...(resolvedCreatorUser?.rol === 'colaborador' ? { colaborador_id: resolvedCreatorUser.id } : {}),
        ...(!resolvedCreatorUser || resolvedCreatorUser.rol === 'admin' ? { cliente_directo: true } : {}),
      };

      const bookingRef = doc(collection(db, 'bookings'));
      const bookingId = bookingRef.id;

      const stockRequirements = () => {
        const start = new Date(startDate);
        const end = new Date(endDate);
        const days = eachDayOfInterval({ start, end });
        const requirements = new Map<string, { dateStr: string; productId: string; quantity: number }>();

        days.forEach((day) => {
          const dateStr = format(day, 'yyyy-MM-dd');
          itemsWithNames.forEach((item) => {
            if (!item.producto_id) return;
            const key = `${dateStr}_${item.producto_id}`;
            const current = requirements.get(key);
            const nextQty = (current?.quantity || 0) + (item.cantidad || 0);
            requirements.set(key, { dateStr, productId: item.producto_id, quantity: nextQty });
          });
        });

        return Array.from(requirements.values());
      };

      try {
        const requirements = stockRequirements();
        await runTransaction(db, async (tx) => {
          const linkRef = doc(db, 'booking_links', token);
          const linkSnap = await tx.get(linkRef);
          if (!linkSnap.exists()) {
            throw new Error('LINK_INVALID');
          }

          const linkData = linkSnap.data() as BookingLink;
          if (!linkData.activo) {
            throw new Error('LINK_INACTIVE');
          }

          if (linkData.uso_unico && (linkData.usado || (linkData.reservas_creadas || 0) > 0)) {
            throw new Error('LINK_USED');
          }

          for (const req of requirements) {
            const stockRef = doc(db, 'daily_stock', `${req.dateStr}_${req.productId}`);
            const stockSnap = await tx.get(stockRef);
            const stockData = stockSnap.exists()
              ? (stockSnap.data() as { cantidad_disponible?: number; cantidad_reservada?: number })
              : undefined;
            const available =
              (stockData?.cantidad_disponible || 0) - (stockData?.cantidad_reservada || 0);
            if (available <= 0) {
              const productName = products.find((p) => p.id === req.productId)?.nombre || 'El producto seleccionado';
              throw new Error(`STOCK:${productName}:0:${req.quantity}`);
            }
            if (req.quantity > available) {
              const productName = products.find((p) => p.id === req.productId)?.nombre || 'El producto seleccionado';
              throw new Error(`STOCK:${productName}:${available}:${req.quantity}`);
            }
          }

          tx.set(bookingRef, bookingData);

          for (const req of requirements) {
            const stockRef = doc(db, 'daily_stock', `${req.dateStr}_${req.productId}`);
            tx.set(
              stockRef,
              {
                fecha: req.dateStr,
                producto_id: req.productId,
                cantidad_reservada: increment(req.quantity),
                actualizado_por: link.creado_por || 'public_link',
                timestamp: serverTimestamp(),
              },
              { merge: true }
            );
          }

          const linkUpdates: Record<string, unknown> = {
            reservas_creadas: (linkData.reservas_creadas || 0) + 1,
            ultimo_acceso: serverTimestamp(),
          };

          if (linkData.uso_unico) {
            linkUpdates.activo = false;
            linkUpdates.usado = true;
            linkUpdates.usado_en = serverTimestamp();
          }

          tx.update(linkRef, linkUpdates);
        });
      } catch (transactionError: unknown) {
        const transactionMessage = getErrorMessage(transactionError);
        if (transactionMessage.startsWith('STOCK:')) {
          const [, productName, availableRaw] = transactionMessage.split(':');
          const available = Number(availableRaw);
          const message =
            available <= 0
              ? `❌ ${productName} no tiene stock disponible para las fechas seleccionadas. Por favor, elige otro producto o cambia las fechas.`
              : `❌ ${productName} solo tiene ${available} unidad(es) disponible(s), pero solicitaste más. Reduce la cantidad o cambia las fechas.`;
          setError(message);
          setSubmitting(false);
          return;
        }

        if (transactionMessage === 'LINK_INVALID') {
          setError('Este enlace no es válido.');
          setSubmitting(false);
          return;
        }
        if (transactionMessage === 'LINK_INACTIVE') {
          setError('Este enlace está desactivado.');
          setSubmitting(false);
          return;
        }
        if (transactionMessage === 'LINK_USED') {
          setError('Este enlace ya fue utilizado.');
          setSubmitting(false);
          return;
        }

        console.error('Error reserving stock:', transactionError);
        setError('Hubo un problema al reservar el stock. Inténtalo otra vez.');
        setSubmitting(false);
        return;
      }

      let paymentUrl: string | undefined;

      if (requiresPayment) {
        try {
          const response = await fetch('/api/stripe/create-checkout', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              bookingId,
              amount: bookingTotal,
              currency: 'eur',
              clientEmail: clientEmail.trim(),
              clientName: clientName.trim(),
              bookingRef: ref,
              token: contractToken,
              expiresAt: Math.floor(expiracion.getTime() / 1000),
            }),
          });

          if (response.ok) {
            const { url } = await response.json();
            paymentUrl = url;
          }
        } catch (paymentError) {
          console.error('Error creating payment link:', paymentError);
        }
      }

      const contractUrl = `${window.location.origin}/contract/${bookingId}?t=${contractToken}`;
      setSuccess({ contractUrl, paymentUrl, requiresPayment });
    } catch (err) {
      console.error(err);
      setError('Hubo un problema al crear la reserva. Inténtalo otra vez.');
    } finally {
      setSubmitting(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    alert('Enlace copiado');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="animate-spin text-blue-600" size={40} />
      </div>
    );
  }

  if (error && !link) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <div className="bg-white border border-red-100 shadow-sm rounded-2xl p-8 text-center max-w-md">
          <div className="bg-red-50 text-red-600 inline-flex p-3 rounded-full mb-4">
            <X size={28} />
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Enlace no disponible</h1>
          <p className="text-gray-500">{error}</p>
        </div>
      </div>
    );
  }

  if (success.contractUrl) {
    return (
      <div className="min-h-screen bg-linear-to-b from-sky-50 via-white to-blue-50 flex items-center justify-center px-4 py-12">
        <div className="bg-white rounded-3xl shadow-xl border border-slate-100 p-8 max-w-lg w-full text-center">
          <div className="bg-emerald-100 text-emerald-700 inline-flex p-3 rounded-full mb-4">
            <CheckCircle size={32} />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">¡Reserva creada!</h1>
          <p className="text-gray-600 mb-6">
            {success.requiresPayment
              ? 'Solo falta firmar el contrato para confirmar la reserva.'
              : 'Solo falta firmar el contrato para confirmar la reserva. No requiere pago previo.'}
          </p>

          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-left mb-6">
            <p className="text-xs text-slate-500 mb-2">
              {success.requiresPayment ? 'Enlace de firma y pago' : 'Enlace de firma'}
            </p>
            <p className="text-xs font-mono break-all text-slate-700">{success.contractUrl}</p>
          </div>

          <div className="flex flex-col gap-3">
            <a
              href={success.contractUrl}
              className="btn-primary w-full py-3"
            >
              <CheckCircle size={18} />
              Firmar ahora
            </a>
            <button
              onClick={() => copyToClipboard(success.contractUrl)}
              className="btn-outline w-full"
            >
              <Copy size={18} />
              Copiar enlace
            </button>
            {success.paymentUrl && (
              <a
                href={success.paymentUrl}
                className="btn-outline w-full text-blue-700 border-blue-200 hover:bg-blue-50"
              >
                Pago directo
              </a>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-linear-to-b from-sky-50 via-white to-blue-50">
      <div className="relative overflow-hidden">
        <div className="absolute -top-20 -right-24 h-72 w-72 bg-blue-200/40 rounded-full blur-3xl" />
        <div className="absolute -bottom-24 -left-16 h-72 w-72 bg-sky-200/50 rounded-full blur-3xl" />

        <div className="relative max-w-5xl mx-auto px-4 py-10">
          <header className="bg-white/80 backdrop-blur border border-white/60 rounded-3xl p-6 md:p-8 shadow-lg shadow-blue-900/5">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
              <div className="flex items-center gap-4">
                <div className="h-12 w-12 rounded-2xl bg-slate-900 text-white flex items-center justify-center font-bold text-lg">
                  SB
                </div>
                <div>
                  <h1 className="text-2xl md:text-3xl font-bold text-slate-900">Reserva rápida</h1>
                  <p className="text-slate-500 text-sm md:text-base">
                    Completa tu reserva en pocos pasos, sin registro.
                  </p>
                </div>
              </div>
              <div className="bg-emerald-50 text-emerald-700 border border-emerald-100 px-4 py-2 rounded-full text-xs font-semibold uppercase tracking-wide">
                Enlace seguro
              </div>
            </div>
          </header>

          <form onSubmit={handleSubmit} className="mt-8 space-y-8">
            {error && (
              <div className="bg-red-50 border border-red-100 text-red-700 px-4 py-3 rounded-2xl flex items-center gap-3">
                <X size={18} />
                <span className="text-sm font-medium">{error}</span>
              </div>
            )}

            <section className="bg-white rounded-3xl border border-slate-100 shadow-sm p-6 md:p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="h-10 w-10 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold">
                  1
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Fechas</h2>
                </div>
              </div>

              <div className="space-y-4">
                <label className="inline-flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={isMultiDay}
                    onChange={(e) => setIsMultiDay(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  Varios dias
                </label>

                <div className={`grid grid-cols-1 gap-6 ${isMultiDay ? 'md:grid-cols-2' : ''}`}>
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700 flex items-center gap-2 mb-2">
                    <CalendarDays size={18} /> Inicio
                  </span>
                  <input
                    type="date"
                    value={startDate}
                    min={minDateStr}
                    onChange={(e) => {
                      const nextDate = e.target.value || minDateStr;
                      const safeDate = nextDate < minDateStr ? minDateStr : nextDate;
                      setStartDate(safeDate);
                      setEndDate(safeDate);
                    }}
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none"
                    required
                  />
                </label>
                  {isMultiDay ? (
                    <label className="block">
                      <span className="text-sm font-semibold text-slate-700 flex items-center gap-2 mb-2">
                        <CalendarDays size={18} /> Fin
                      </span>
                      <input
                        type="date"
                        value={endDate}
                        min={startDate < minDateStr ? minDateStr : startDate}
                        onChange={(e) => {
                          const nextDate = e.target.value || startDate;
                          setEndDate(nextDate < startDate ? startDate : nextDate);
                        }}
                        className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none"
                        required={isMultiDay}
                      />
                    </label>
                  ) : null}
                </div>
              </div>

              <div className="mt-2 inline-flex items-center gap-2 bg-blue-50 text-blue-700 px-4 py-2 rounded-full text-sm font-semibold">
                <CalendarDays size={16} />
                {dayCount} {dayCount === 1 ? 'día' : 'días'}
              </div>
              {isPastCutoff && (
                <div className="mt-2 inline-flex items-center gap-2 bg-amber-50 text-amber-700 px-4 py-2 rounded-full text-xs font-semibold">
                  Después de las 17:00 no se permiten reservas para hoy.
                </div>
              )}
            </section>

            <section className="bg-white rounded-3xl border border-slate-100 shadow-sm p-6 md:p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="h-10 w-10 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold">
                  2
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Selecciona el equipo</h2>
                  <p className="text-sm text-slate-500">Marca la cantidad de cada producto.</p>
                </div>
              </div>

              {products.length === 0 ? (
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 text-center text-slate-500">
                  No hay productos disponibles en este momento.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {products.map((product) => {
                    const qty = quantities[product.id || ''] || 0;
                    const canAddInstructor = hasInstructorOption(product);
                    const canAddFuel = hasFuelOption(product);
                    const optionState = productOptions[product.id || ''] || {
                      instructor_requested: false,
                      fuel_requested: false,
                    };
                    const itemPreview: BookingItem = {
                      producto_id: product.id || '',
                      cantidad: Math.max(1, qty || 1),
                      tipo_alquiler: 'dia',
                      duracion: dayCount,
                      instructor_requested: optionState.instructor_requested,
                      fuel_requested: optionState.fuel_requested,
                    };
                    const instructorPreview = getBookingItemInstructorTotal(itemPreview, product, dayCount);
                    const fuelPreview = getBookingItemFuelTotal(itemPreview, product, dayCount);
                    const requiresLicense = qty > 0 && doesBookingItemRequireNauticalLicense(itemPreview, product);
                    return (
                      <div
                        key={product.id}
                        className="border border-slate-200 rounded-2xl p-4 shadow-sm hover:shadow-md transition-shadow"
                      >
                        <div className="flex gap-4 items-center">
                          <div className="h-16 w-16 rounded-xl bg-slate-100 overflow-hidden flex items-center justify-center">
                            {product.imagen_url ? (
                              <img
                                src={product.imagen_url}
                                alt={product.nombre}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <ShoppingBag size={24} className="text-slate-400" />
                            )}
                          </div>
                          <div className="flex-1">
                            <h3 className="font-semibold text-slate-900">{product.nombre}</h3>
                            <p className="text-sm text-slate-500">€{formatPrice(getProductDailyPrice(product, startDate))}/día</p>
                            <p className="text-xs font-medium uppercase tracking-[0.08em] text-amber-700 mt-1">
                              {getProductVatShortLabel(product)}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => product.id && updateQuantity(product.id, -1)}
                              className="btn-icon h-9 w-9 border border-slate-200 text-slate-500 hover:bg-slate-50"
                            >
                              <Minus size={16} />
                            </button>
                            <div className="min-w-[32px] text-center font-semibold text-slate-900">{qty}</div>
                            <button
                              type="button"
                              onClick={() => product.id && updateQuantity(product.id, 1)}
                              className="btn-icon h-9 w-9 border border-blue-200 text-blue-600 hover:bg-blue-50"
                            >
                              <Plus size={16} />
                            </button>
                          </div>
                        </div>

                        {(canAddInstructor || canAddFuel) && (
                          <div className="mt-4 grid gap-3 md:grid-cols-2">
                            {canAddInstructor && product.id && (
                              <label className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm">
                                <div className="flex items-start gap-3">
                                  <input
                                    type="checkbox"
                                    checked={optionState.instructor_requested}
                                    onChange={(e) =>
                                      updateProductOption(product.id as string, 'instructor_requested', e.target.checked)
                                    }
                                    className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                  />
                                  <div>
                                    <div className="font-semibold text-slate-900">Añadir monitor/instructor</div>
                                    <div className="text-xs text-slate-500">
                                      €{formatPrice(
                                        Number(product.instructor_price_per_day || 0) *
                                          (product.instructor_incluir_iva ? 1.21 : 1)
                                      )}/día por unidad
                                      {product.instructor_incluir_iva ? ' (IVA incl.)' : ''}
                                      {qty > 0 && instructorPreview > 0 ? ` · Total €${formatPrice(instructorPreview)}` : ''}
                                    </div>
                                  </div>
                                </div>
                              </label>
                            )}

                            {canAddFuel && product.id && (
                              <label className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm">
                                <div className="flex items-start gap-3">
                                  <input
                                    type="checkbox"
                                    checked={optionState.fuel_requested}
                                    onChange={(e) =>
                                      updateProductOption(product.id as string, 'fuel_requested', e.target.checked)
                                    }
                                    className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                  />
                                  <div>
                                    <div className="font-semibold text-slate-900">Añadir fuel/combustible</div>
                                    <div className="text-xs text-slate-500">
                                      €{formatPrice(Number(product.fuel_price_per_day || 0))}/día por unidad (sin IVA)
                                      {qty > 0 && fuelPreview > 0 ? ` · Total €${formatPrice(fuelPreview)}` : ''}
                                    </div>
                                  </div>
                                </div>
                              </label>
                            )}
                          </div>
                        )}

                        {supportsEfoilBatteryOption(product) && product.efoil_battery?.trim() ? (
                          <div className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-600">
                            Batería / autonomía: {product.efoil_battery.trim()}
                          </div>
                        ) : null}

                        {requiresLicense && (
                          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
                            Obligatorio licencia náutica. Puede añadirse más tarde.
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="bg-white rounded-3xl border border-slate-100 shadow-sm p-6 md:p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="h-10 w-10 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold">
                  3
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Entrega en el puerto</h2>
                  <p className="text-sm text-slate-500">Indícanos dónde y cuándo entregar el equipo.</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700 flex items-center gap-2 mb-2">
                    <MapPin size={18} /> Ubicación
                  </span>
                  <select
                    value={deliveryLocation}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (isDeliveryLocation(value)) {
                        setDeliveryLocation(value);
                      }
                    }}
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none"
                  >
                    {DELIVERY_LOCATION_GROUPS.map((group) => (
                      <optgroup key={group.label} label={group.label}>
                        {group.options.map((option) => (
                          <option key={option} value={option}>
                            {option === 'club_nautico'
                              ? 'Club Náutico Ibiza'
                              : option === 'marina_ibiza'
                                ? 'Marina Ibiza'
                                : option === 'marina_botafoch'
                                  ? 'Marina Botafoch'
                                  : option === 'marina_port_ibiza'
                                    ? 'Marina Port Ibiza (Old Town)'
                                    : option === 'marina_santa_eulalia'
                                      ? 'Marina Santa Eulalia'
                                      : 'Club Nautic San Antonio'}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
                {deliveryTotal > 0 ? (
                  <div className="md:col-span-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
                    Suplemento de entrega: €{formatPrice(deliveryTotal)}
                  </div>
                ) : null}
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700 flex items-center gap-2 mb-2">
                    <Anchor size={18} /> Hora de entrega
                  </span>
                  <input
                    type="time"
                    value={deliveryTime}
                    onChange={(e) => setDeliveryTime(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none"
                    required
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700 flex items-center gap-2 mb-2">
                    <Anchor size={18} /> Nombre del barco (opcional)
                  </span>
                  <input
                    type="text"
                    value={boatName}
                    onChange={(e) => setBoatName(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none"
                    placeholder="Ej: Blue Pearl"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700 flex items-center gap-2 mb-2">
                    <Anchor size={18} /> Número de amarre (opcional)
                  </span>
                  <input
                    type="text"
                    value={dockingNumber}
                    onChange={(e) => setDockingNumber(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none"
                    placeholder="Ej: H-12"
                  />
                </label>
              </div>
            </section>

            <section className="bg-white rounded-3xl border border-slate-100 shadow-sm p-6 md:p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="h-10 w-10 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold">
                  4
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Datos del cliente</h2>
                  <p className="text-sm text-slate-500">
                    Completa los datos de la persona que usará el servicio.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700 flex items-center gap-2 mb-2">
                    <User size={18} /> Nombre completo
                  </span>
                  <input
                    type="text"
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none"
                    placeholder="Ej: Juan Pérez"
                    required
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700 flex items-center gap-2 mb-2">
                    <Mail size={18} /> Email
                  </span>
                  <input
                    type="email"
                    value={clientEmail}
                    onChange={(e) => setClientEmail(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none"
                    placeholder="juan@ejemplo.com"
                    required
                  />
                </label>
                <label className="block md:col-span-2">
                  <span className="text-sm font-semibold text-slate-700 flex items-center gap-2 mb-2">
                    <Phone size={18} /> Teléfono / WhatsApp
                  </span>
                  <input
                    type="tel"
                    value={clientPhone}
                    onChange={(e) => setClientPhone(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none"
                    placeholder="+34 600 000 000"
                  />
                </label>
                <label className="block md:col-span-2">
                  <span className="text-sm font-semibold text-slate-700 flex items-center gap-2 mb-2">
                    <Mail size={18} /> Notas (opcional)
                  </span>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                    placeholder="Indicaciones especiales..."
                  />
                </label>
              </div>
            </section>

            <section className="bg-white rounded-3xl border border-slate-100 shadow-sm p-6 md:p-8 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
              <div>
                <p className="text-sm text-slate-500">Total a pagar</p>
                <div className="text-3xl font-bold text-slate-900">
                  €{formatPrice(clientTotals.total + deliveryTotal)}
                </div>
                <div className="text-xs text-slate-500 mt-2 space-y-1">
                  <div>Alquiler: €{formatPrice(clientTotals.rentalTotal)}</div>
                  {clientTotals.instructorTotal > 0 && <div>Monitor: €{formatPrice(clientTotals.instructorTotal)}</div>}
                  {clientTotals.fuelTotal > 0 && <div>Fuel: €{formatPrice(clientTotals.fuelTotal)}</div>}
                  {deliveryTotal > 0 && <div>Entrega: €{formatPrice(deliveryTotal)}</div>}
                </div>
                <p className="text-xs font-medium uppercase tracking-[0.08em] text-emerald-700 mt-2">
                  IVA aplicado donde corresponde
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Monitor con IVA si esta configurado asi. Fuel sin IVA.
                </p>
                {vatSummaryLabel ? <p className="text-xs text-slate-500 mt-1">{vatSummaryLabel}</p> : null}
                {nauticalLicenseRequired ? (
                  <p className="text-xs text-amber-700 mt-2">
                    Si reservas sin monitor, la licencia náutica del cliente será necesaria, pero no hace falta subirla ahora.
                  </p>
                ) : null}
                <p className="text-xs text-slate-400 mt-1">
                  Precio sujeto a disponibilidad y confirmación final.
                </p>
              </div>
              <button
                type="submit"
                disabled={submitting || items.length === 0}
                className="btn-primary px-8 py-4 disabled:opacity-60"
              >
                {submitting ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
                Crear reserva
              </button>
            </section>
          </form>
        </div>
      </div>
    </div>
  );
}
