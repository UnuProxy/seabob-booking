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
import { BookingItem, BookingLink, Product, User as AppUser } from '@/types';
import { addDays, differenceInDays, format, eachDayOfInterval } from 'date-fns';
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

  const [link, setLink] = useState<BookingLink | null>(null);
  const [creatorUser, setCreatorUser] = useState<AppUser | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState<{ contractUrl: string; paymentUrl?: string }>({
    contractUrl: '',
  });

  // Form State
  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [notes, setNotes] = useState('');

  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const [startDate, setStartDate] = useState(todayStr);
  const [endDate, setEndDate] = useState(todayStr);

  const [deliveryLocation, setDeliveryLocation] = useState<
    'marina_ibiza' | 'marina_botafoch' | 'club_nautico' | 'otro'
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
  }, [products]);

  useEffect(() => {
    if (endDate < startDate) {
      setEndDate(startDate);
    }
  }, [startDate, endDate]);

  const dayCount = useMemo(() => {
    const start = new Date(startDate);
    const end = new Date(endDate);
    return Math.max(1, differenceInDays(end, start));
  }, [startDate, endDate]);

  const items: BookingItem[] = useMemo(() => {
    return Object.entries(quantities)
      .filter(([, qty]) => qty > 0)
      .map(([productId, qty]) => ({
        producto_id: productId,
        cantidad: qty,
        tipo_alquiler: 'dia',
        duracion: dayCount,
      }));
  }, [quantities, dayCount]);

  const total = useMemo(() => {
    return items.reduce((acc, item) => {
      const product = products.find((p) => p.id === item.producto_id);
      if (!product) return acc;
      return acc + product.precio_diario * dayCount * item.cantidad;
    }, 0);
  }, [items, products, dayCount]);

  const updateQuantity = (productId: string, delta: number) => {
    setQuantities((prev) => {
      const nextValue = Math.max(0, (prev[productId] || 0) + delta);
      return { ...prev, [productId]: nextValue };
    });
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
        return {
          ...item,
          producto_nombre: product?.nombre || item.producto_id,
          precio_unitario:
            item.tipo_alquiler === 'hora'
              ? product?.precio_hora || 0
              : product?.precio_diario || 0,
          comision_percent: product?.comision || 0,
        };
      });

      const getItemSubtotal = (item: BookingItem, product?: Product) => {
        if (!product) return 0;
        if (item.tipo_alquiler === 'dia') {
          const start = new Date(startDate);
          const end = new Date(endDate);
          const days = Math.max(1, differenceInDays(end, start));
          return product.precio_diario * days * item.cantidad;
        }
        return (product.precio_hora || 0) * Math.max(1, item.duracion) * item.cantidad;
      };

      const commissionPartnerRole = creatorUser?.rol === 'broker' || creatorUser?.rol === 'agency';
      const comisionTotal = commissionPartnerRole
        ? itemsWithNames.reduce((total, item) => {
            const product = products.find((p) => p.id === item.producto_id);
            const itemPrice = getItemSubtotal(item, product);
            const commissionRate = (item.comision_percent || 0) / 100;
            return total + itemPrice * commissionRate;
          }, 0)
        : 0;

      // Calculate reservation expiration time (hold period)
      const fechaInicio = new Date(startDate);
      const ahora = new Date();
      const diasHastaInicio = Math.floor((fechaInicio.getTime() - ahora.getTime()) / (1000 * 60 * 60 * 24));
      
      let tiempoExpiracion: number; // in milliseconds
      if (diasHastaInicio >= 7) {
        // 7+ days away: 24 hours to pay/sign
        tiempoExpiracion = 24 * 60 * 60 * 1000; // 24 hours
      } else {
        // Less than 7 days: 1 hour to pay/sign
        tiempoExpiracion = 1 * 60 * 60 * 1000; // 1 hour
      }
      
      const expiracion = new Date(ahora.getTime() + tiempoExpiracion);

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
        precio_total: total,
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
        ...(creatorUser?.rol === 'broker' ? { broker_id: creatorUser.id } : {}),
        ...(creatorUser?.rol === 'agency' ? { agency_id: creatorUser.id } : {}),
        ...(creatorUser?.rol === 'colaborador' ? { colaborador_id: creatorUser.id } : {}),
        ...(!creatorUser || creatorUser.rol === 'admin' ? { cliente_directo: true } : {}),
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

          const linkUpdates: Record<string, any> = {
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
      } catch (transactionError: any) {
        if (transactionError?.message?.startsWith('STOCK:')) {
          const [, productName, availableRaw] = transactionError.message.split(':');
          const available = Number(availableRaw);
          const message =
            available <= 0
              ? `❌ ${productName} no tiene stock disponible para las fechas seleccionadas. Por favor, elige otro producto o cambia las fechas.`
              : `❌ ${productName} solo tiene ${available} unidad(es) disponible(s), pero solicitaste más. Reduce la cantidad o cambia las fechas.`;
          setError(message);
          setSubmitting(false);
          return;
        }

        if (transactionError?.message === 'LINK_INVALID') {
          setError('Este enlace no es válido.');
          setSubmitting(false);
          return;
        }
        if (transactionError?.message === 'LINK_INACTIVE') {
          setError('Este enlace está desactivado.');
          setSubmitting(false);
          return;
        }
        if (transactionError?.message === 'LINK_USED') {
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

      try {
        const response = await fetch('/api/stripe/create-checkout', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            bookingId,
            amount: total,
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

      const contractUrl = `${window.location.origin}/contract/${bookingId}?t=${contractToken}`;
      setSuccess({ contractUrl, paymentUrl });
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
            Solo falta firmar el contrato para confirmar la reserva.
          </p>

          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-left mb-6">
            <p className="text-xs text-slate-500 mb-2">Enlace de firma y pago</p>
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
                  <h2 className="text-lg font-bold text-slate-900">Fechas del alquiler</h2>
                  <p className="text-sm text-slate-500">Elige cuándo quieres disfrutar del SeaBob.</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700 flex items-center gap-2 mb-2">
                    <CalendarDays size={18} /> Fecha inicio
                  </span>
                  <input
                    type="date"
                    value={startDate}
                    min={todayStr}
                    onChange={(e) => {
                      const nextDate = e.target.value || todayStr;
                      const safeDate = nextDate < todayStr ? todayStr : nextDate;
                      setStartDate(safeDate);
                      setEndDate(safeDate);
                    }}
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none"
                    required
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700 flex items-center gap-2 mb-2">
                    <CalendarDays size={18} /> Fecha fin
                  </span>
                  <input
                    type="date"
                    value={endDate}
                    min={startDate < todayStr ? todayStr : startDate}
                    onChange={(e) => {
                      const nextDate = e.target.value || startDate;
                      setEndDate(nextDate < startDate ? startDate : nextDate);
                    }}
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none"
                    required
                  />
                </label>
              </div>

              <div className="mt-4 inline-flex items-center gap-2 bg-blue-50 text-blue-700 px-4 py-2 rounded-full text-sm font-semibold">
                <CalendarDays size={16} />
                Duración: {dayCount} {dayCount === 1 ? 'día' : 'días'}
              </div>
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
                    return (
                      <div
                        key={product.id}
                        className="border border-slate-200 rounded-2xl p-4 flex gap-4 items-center shadow-sm hover:shadow-md transition-shadow"
                      >
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
                          <p className="text-sm text-slate-500">€{product.precio_diario}/día</p>
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
                    onChange={(e) =>
                      setDeliveryLocation(e.target.value as 'marina_ibiza' | 'marina_botafoch' | 'club_nautico' | 'otro')
                    }
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none"
                  >
                    <option value="marina_ibiza">Marina Ibiza</option>
                    <option value="marina_botafoch">Marina Botafoch</option>
                    <option value="club_nautico">Club Náutico</option>
                    <option value="otro">Otro</option>
                  </select>
                </label>
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
                <p className="text-sm text-slate-500">Total estimado</p>
                <div className="text-3xl font-bold text-slate-900">
                  €{total.toLocaleString('es-ES', { minimumFractionDigits: 2 })}
                </div>
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
