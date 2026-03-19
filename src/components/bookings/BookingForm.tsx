'use client';

import { useState, useEffect } from 'react';
import { collection, getDocs, query, where, serverTimestamp, doc, getDoc, increment, runTransaction } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { Product, BookingItem, RentalType, DailyStock, User as AppUser } from '@/types';
import { getProductDailyPrice, getProductVatShortLabel } from '@/lib/productPricing';
import { useAuthStore } from '@/store/authStore';
import { X, Plus, Trash2, Calendar, User, CreditCard, Save, Loader2, ShoppingBag, MapPin, Anchor, AlertCircle, PackageX } from 'lucide-react';
import { addDays, format, differenceInDays, eachDayOfInterval } from 'date-fns';

interface BookingFormProps {
  onClose: () => void;
  onSuccess?: (data: { contractUrl: string; paymentUrl?: string; bookingId: string }) => void;
  initialSelectedProductId?: string;
}

export function BookingForm({ onClose, onSuccess, initialSelectedProductId }: BookingFormProps) {
  const { user } = useAuthStore();
  const formatPrice = (amount: number) => amount.toLocaleString('es-ES', { maximumFractionDigits: 0 });
  const [loading, setLoading] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [partners, setPartners] = useState<AppUser[]>([]);
  const [productStock, setProductStock] = useState<Record<string, { available: number; isOutOfStock: boolean; isLowStock: boolean }>>({});
  const [error, setError] = useState('');
  const [successData, setSuccessData] = useState<{
    contractUrl: string;
    paymentUrl?: string;
    bookingId: string;
  } | null>(null);

  // Form State
  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  
  const now = new Date();
  const isPastCutoff = now.getHours() >= 17;
  const minDate = isPastCutoff ? addDays(now, 1) : now;
  const minDateStr = format(minDate, 'yyyy-MM-dd');
  const [startDate, setStartDate] = useState(minDateStr);
  const [endDate, setEndDate] = useState(minDateStr); // Default same day (1 day service)
  const [isMultiDay, setIsMultiDay] = useState(false);
  const [items, setItems] = useState<BookingItem[]>([]);
  const [isProductPickerOpen, setIsProductPickerOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  
  // Delivery Details
  const [deliveryLocation, setDeliveryLocation] = useState<'marina_ibiza' | 'marina_botafoch' | 'club_nautico' | 'otro'>('marina_ibiza');
  const [deliveryLocationDetail, setDeliveryLocationDetail] = useState('');
  const [boatName, setBoatName] = useState('');
  const [dockingNumber, setDockingNumber] = useState('');
  const [deliveryTime, setDeliveryTime] = useState('09:00'); // Default 9 AM
  
  const [notes, setNotes] = useState('');
  const [skipPayment, setSkipPayment] = useState(false);
  const [partnerType, setPartnerType] = useState<'directo' | 'broker' | 'agency' | 'colaborador'>('directo');
  const [partnerId, setPartnerId] = useState('');

  // Fetch products
  useEffect(() => {
    const fetchProducts = async () => {
      try {
        const q = query(collection(db, 'products'), where('activo', '==', true));
        const snapshot = await getDocs(q);
        const productsData = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Product));
        setProducts(productsData);
        
        if (productsData.length === 0) {
          setError('No hay productos activos disponibles. Contacta al administrador.');
        } else {
          setError(''); // Clear any previous errors
        }
      } catch (err: any) {
        console.error('Error fetching products:', err);
        if (err.code === 'permission-denied') {
          setError('No tienes permiso para ver los productos. Contacta al administrador.');
        } else {
          setError('Error al cargar productos. Verifica tu conexión.');
        }
      }
    };
    fetchProducts();
  }, []);

  useEffect(() => {
    if (!user || user.rol !== 'admin') return;

    const fetchPartners = async () => {
      try {
        const q = query(
          collection(db, 'users'),
          where('rol', 'in', ['broker', 'agency', 'colaborador'])
        );
        const snapshot = await getDocs(q);
        const usersData = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() } as AppUser));
        usersData.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
        setPartners(usersData);
      } catch (err) {
        console.error('Error fetching partners:', err);
      }
    };

    fetchPartners();
  }, [user]);

  useEffect(() => {
    if (!isMultiDay) {
      setEndDate(startDate);
    }
  }, [isMultiDay, startDate]);

  // Check stock availability for selected dates
  useEffect(() => {
    const checkStock = async () => {
      if (!startDate || !endDate || products.length === 0) return;

      try {
        const start = new Date(startDate);
        const end = new Date(endDate);
        const dates = eachDayOfInterval({ start, end });
        
        // For each product, check minimum available stock across all dates
        const stockMap: Record<string, { available: number; isOutOfStock: boolean; isLowStock: boolean }> = {};
        
        for (const product of products) {
          if (!product.id) continue;
          
          let minAvailable = Infinity;
          
          for (const date of dates) {
            const dateStr = format(date, 'yyyy-MM-dd');
            const stockDoc = await getDoc(doc(db, 'daily_stock', `${dateStr}_${product.id}`));
            
            if (stockDoc.exists()) {
              const stockData = stockDoc.data() as DailyStock;
              const available = (stockData.cantidad_disponible || 0) - (stockData.cantidad_reservada || 0);
              minAvailable = Math.min(minAvailable, available);
            } else {
              // No stock configured = 0 available
              minAvailable = 0;
            }
          }
          
          if (minAvailable === Infinity) minAvailable = 0;
          
          stockMap[product.id] = {
            available: minAvailable,
            isOutOfStock: minAvailable <= 0,
            isLowStock: minAvailable > 0 && minAvailable <= 2,
          };
        }
        
        setProductStock(stockMap);
      } catch (err) {
        console.error('Error checking stock:', err);
      }
    };

    checkStock();
  }, [startDate, endDate, products]);

  useEffect(() => {
    if (!initialSelectedProductId || items.length > 0) return;

    const product = products.find((entry) => entry.id === initialSelectedProductId);
    const stockInfo = product ? productStock[initialSelectedProductId] : null;

    if (!product || !stockInfo || stockInfo.isOutOfStock || stockInfo.available < 1) {
      return;
    }

    setItems([
      {
        producto_id: initialSelectedProductId,
        cantidad: 1,
        tipo_alquiler: 'dia',
        duracion: 1,
      }
    ]);
  }, [initialSelectedProductId, items.length, productStock, products]);

  const addItem = () => {
    if (products.length === 0) return;
    setIsProductPickerOpen((prev) => !prev);
  };

  const addItemWithProduct = (productId: string) => {
    setItems((prev) => [
      ...prev,
      {
        producto_id: productId,
        cantidad: 1,
        tipo_alquiler: 'dia',
        duracion: 1,
      }
    ]);
    setIsProductPickerOpen(false);
    setError('');
  };

  const updateItem = (index: number, field: keyof BookingItem, value: any) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], [field]: value };
    setItems(newItems);
  };

  const removeItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const getItemSubtotal = (item: BookingItem, product?: Product) => {
    if (!product) return 0;
    if (item.tipo_alquiler === 'dia') {
      const start = new Date(startDate);
      const end = new Date(endDate);
      const days = Math.max(1, differenceInDays(end, start));
      return getProductDailyPrice(product, startDate) * days * item.cantidad;
    }
    return (product.precio_hora || 0) * Math.max(1, item.duracion) * item.cantidad;
  };

  const calculateRentalTotal = () => {
    return items.reduce((acc, item) => {
      const product = products.find(p => p.id === item.producto_id);
      return acc + getItemSubtotal(item, product);
    }, 0);
  };

  const validateStep = (step: number) => {
    if (step === 1) {
      if (!clientName) {
        setError('El nombre del cliente es obligatorio');
        return false;
      }
      return true;
    }

    if (step === 2) {
      if (startDate < minDateStr) {
        setError('No se pueden crear reservas para hoy después de las 17:00. Selecciona otra fecha.');
        return false;
      }
      if (deliveryLocation === 'otro' && !deliveryLocationDetail.trim()) {
        setError('Escribe la direccion de entrega.');
        return false;
      }
      if (!deliveryLocation || !deliveryTime) {
        setError('Completa los datos de entrega.');
        return false;
      }
      return true;
    }

    if (step === 3) {
      if (items.length === 0) {
        setError('Debes añadir al menos un producto');
        return false;
      }
      if (items.some((item) => !item.producto_id)) {
        setError('Selecciona un producto en cada linea antes de continuar.');
        return false;
      }
      return true;
    }

    return true;
  };

  const goToNextStep = () => {
    if (!validateStep(currentStep)) return;
    setError('');
    setCurrentStep((prev) => Math.min(4, prev + 1));
  };

  const goToPreviousStep = () => {
    setError('');
    setCurrentStep((prev) => Math.max(1, prev - 1));
  };


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!clientName) {
      setError('El nombre del cliente es obligatorio');
      return;
    }
    if (startDate < minDateStr) {
      setError('No se pueden crear reservas para hoy después de las 17:00. Selecciona otra fecha.');
      return;
    }
    if (items.length === 0) {
      setError('Debes añadir al menos un producto');
      return;
    }
    if (items.some((item) => !item.producto_id)) {
      setError('Selecciona un producto en cada linea antes de continuar.');
      return;
    }

    // Validate stock availability
    for (const item of items) {
      const stockInfo = productStock[item.producto_id];
      if (stockInfo?.isOutOfStock) {
        const product = products.find(p => p.id === item.producto_id);
        setError(`❌ ${product?.nombre || 'El producto seleccionado'} no tiene stock disponible para las fechas seleccionadas. Por favor, elige otro producto o cambia las fechas.`);
        return;
      }
      if (stockInfo && item.cantidad > stockInfo.available) {
        const product = products.find(p => p.id === item.producto_id);
        setError(`❌ ${product?.nombre || 'El producto seleccionado'} solo tiene ${stockInfo.available} unidad(es) disponible(s), pero solicitaste ${item.cantidad}. Reduce la cantidad o cambia las fechas.`);
        return;
      }
    }

    setLoading(true);
    setError('');

    try {
      // Generate Ref
      const ref = `RES-${format(new Date(), 'ddMMyy')}-${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
      
      // Generate secure token for public access
      const token = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

      const rentalTotal = calculateRentalTotal();
      const totalAmount = rentalTotal;
      
      // Build items with product names, prices, and commission rates
      const itemsWithNames = items.map((item) => {
        const product = products.find((p) => p.id === item.producto_id);
        
        return {
          ...item,
          producto_nombre: product?.nombre || item.producto_id,
          precio_unitario:
            item.tipo_alquiler === 'hora'
              ? product?.precio_hora || 0
              : getProductDailyPrice(product, startDate),
          comision_percent: product?.comision || 0, // Store commission rate at time of booking
          deposito_unitario: 0,
        };
      });
      
      // Calculate total commission for broker/agency bookings
      let comisionTotal = 0;
      const commissionPartner =
        user.rol === 'broker' ||
        user.rol === 'agency' ||
        (user.rol === 'admin' && (partnerType === 'broker' || partnerType === 'agency'));

      if (commissionPartner) {
        comisionTotal = itemsWithNames.reduce((total, item) => {
          const product = products.find((p) => p.id === item.producto_id);
          const itemPrice = getItemSubtotal(item, product);
          const commissionRate = (item.comision_percent || 0) / 100;
          return total + (itemPrice * commissionRate);
        }, 0);
      }
      
      // Calculate reservation expiration time (hold period)
      const assignedPartner =
        user.rol === 'admin' && (partnerType === 'broker' || partnerType === 'agency') && partnerId
          ? partners.find((partner) => partner.id === partnerId)
          : null;
      const partnerAllowsBookingWithoutPayment =
        (user.rol === 'broker' || user.rol === 'agency')
          ? Boolean(user.allow_booking_without_payment)
          : Boolean(assignedPartner?.allow_booking_without_payment);
      const bypassPaymentRequirement = (user.rol === 'admin' && skipPayment) || partnerAllowsBookingWithoutPayment;

      let expiracion: Date | null = null;
      if (!bypassPaymentRequirement) {
        expiracion = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes
      }
      
      const bookingData = {
        numero_reserva: ref,
        cliente: {
          nombre: clientName,
          email: clientEmail,
          telefono: clientPhone,
          whatsapp: clientPhone
        },
        items: itemsWithNames,
        fecha_inicio: startDate,
        fecha_fin: endDate,
        precio_total: rentalTotal,
        deposito_total: 0,
        estado: user.rol === 'admin' && skipPayment ? 'confirmada' : 'pendiente',
        acuerdo_firmado: false,
        
        // Commission tracking (for broker/agency bookings)
        comision_total: comisionTotal,
        comision_pagada: 0,
        
        // Delivery Details
        ubicacion_entrega: deliveryLocation,
        ubicacion_entrega_detalle: deliveryLocation === 'otro' ? deliveryLocationDetail.trim() : '',
        nombre_barco: boatName,
        numero_amarre: dockingNumber,
        hora_entrega: deliveryTime,
        
        // Public Contract
        token_acceso: token,
        firma_cliente: null,
        terminos_aceptados: false,
        pago_realizado: false,
        requires_payment: !bypassPaymentRequirement,
        
        // Reservation hold/expiration
        expiracion: expiracion,
        expirado: false,
        stock_released: false,

        notas: notes,
        creado_en: serverTimestamp(),
        creado_por: user.id,
        origen: 'panel',
        ...(partnerType === 'directo' ? { cliente_directo: true } : {}),
        ...(user.rol === 'broker' ? { broker_id: user.id } : {}),
        ...(user.rol === 'agency' ? { agency_id: user.id } : {}),
        ...(user.rol === 'colaborador' ? { colaborador_id: user.id } : {}),
        ...(user.rol === 'admin' && partnerType === 'broker' && partnerId ? { broker_id: partnerId } : {}),
        ...(user.rol === 'admin' && partnerType === 'agency' && partnerId ? { agency_id: partnerId } : {}),
        ...(user.rol === 'admin' && partnerType === 'colaborador' && partnerId ? { colaborador_id: partnerId } : {})
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
          for (const req of requirements) {
            const stockRef = doc(db, 'daily_stock', `${req.dateStr}_${req.productId}`);
            const stockSnap = await tx.get(stockRef);
            const stockData = stockSnap.exists() ? (stockSnap.data() as DailyStock) : undefined;
            const available = (stockData?.cantidad_disponible || 0) - (stockData?.cantidad_reservada || 0);
            if (available <= 0) {
              const productName = products.find(p => p.id === req.productId)?.nombre || 'El producto seleccionado';
              throw new Error(`STOCK:${productName}:0:${req.quantity}`);
            }
            if (req.quantity > available) {
              const productName = products.find(p => p.id === req.productId)?.nombre || 'El producto seleccionado';
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
                actualizado_por: user.id,
                timestamp: serverTimestamp(),
              },
              { merge: true }
            );
          }
        });
      } catch (stockError: any) {
        if (stockError?.message?.startsWith('STOCK:')) {
          const [, productName, availableRaw] = stockError.message.split(':');
          const available = Number(availableRaw);
          const message =
            available <= 0
              ? `❌ ${productName} no tiene stock disponible para las fechas seleccionadas. Por favor, elige otro producto o cambia las fechas.`
              : `❌ ${productName} solo tiene ${available} unidad(es) disponible(s), pero solicitaste más. Reduce la cantidad o cambia las fechas.`;
          setError(message);
          setLoading(false);
          return;
        }

        console.error('Error reserving stock:', stockError);
        setError('Error al reservar el stock. Inténtalo de nuevo.');
        setLoading(false);
        return;
      }

      let paymentUrl: string | undefined;
      if (!bypassPaymentRequirement) {
        // 3. Generate Stripe payment link
        try {
          const response = await fetch('/api/stripe/create-checkout', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
              body: JSON.stringify({
                bookingId,
                amount: totalAmount,
                currency: 'eur',
                clientEmail,
                clientName,
                bookingRef: ref,
                token,
                expiresAt: expiracion ? Math.floor(expiracion.getTime() / 1000) : undefined,
              }),
          });

          if (response.ok) {
            const data = await response.json();
            paymentUrl = data?.url;
          } else {
            console.error('Failed to create payment link');
            // Continue anyway - booking is created, payment link can be generated later
          }
        } catch (paymentError) {
          console.error('Error creating payment link:', paymentError);
          // Continue anyway - booking is created
        }
      }

      const contractUrl = `${window.location.origin}/contract/${bookingId}?t=${token}`;
      const successPayload = { contractUrl, paymentUrl, bookingId };
      setSuccessData(successPayload);
      onSuccess?.(successPayload);
    } catch (err) {
      console.error(err);
      setError('Error al crear la reserva. Inténtalo de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  const rentalTotal = calculateRentalTotal();
  const total = rentalTotal;
  const dayCount = Math.max(1, differenceInDays(new Date(endDate), new Date(startDate)));
  const userAllowsBookingWithoutPayment =
    (user?.rol === 'broker' || user?.rol === 'agency') && Boolean(user?.allow_booking_without_payment);
  const selectedProducts = items
    .map((item) => products.find((product) => product.id === item.producto_id))
    .filter((product): product is Product => Boolean(product));
  const vatSummaryLabel =
    selectedProducts.length === 0
      ? ''
      : selectedProducts.every((product) => product.incluir_iva)
        ? 'Precio con IVA incluido'
        : selectedProducts.some((product) => product.incluir_iva)
          ? 'Incluye IVA en los productos marcados'
          : 'Precio sin IVA';

  const copyText = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  if (successData) {
    return (
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[90vh]">
          <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-slate-50 rounded-t-2xl">
            <div>
              <h2 className="text-2xl font-bold text-gray-800">Reserva creada</h2>
              <p className="text-gray-500 text-sm mt-1">Copia los enlaces antes de cerrar.</p>
            </div>
            <button
              onClick={onClose}
              className="btn-icon text-slate-500 hover:text-slate-700 hover:bg-slate-200"
            >
              <X size={24} />
            </button>
          </div>

          <div className="p-6 space-y-5">
            <div className="border border-slate-200 rounded-xl p-4">
              <p className="text-sm font-semibold text-slate-700 mb-2">Enlace del contrato</p>
              <div className="flex flex-col md:flex-row gap-3">
                <input
                  readOnly
                  value={successData.contractUrl}
                  className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 bg-slate-50"
                />
                <button
                  type="button"
                  onClick={() => copyText(successData.contractUrl)}
                  className="btn-primary"
                >
                  Copiar
                </button>
              </div>
            </div>

            <div className="text-xs text-slate-500">
              {successData.paymentUrl
                ? 'El enlace del contrato incluye el botón de pago.'
                : 'El enlace del contrato permite firmar sin pago previo para este partner.'}
            </div>

            <div className="flex justify-end gap-3">
              <button onClick={onClose} className="btn-outline">
                Cerrar
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-3 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl flex flex-col max-h-[96vh]">
        
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex justify-between items-center bg-slate-50 rounded-t-2xl">
          <div>
            <h2 className="text-xl font-bold text-gray-800">Nueva Reserva</h2>
          </div>
          <button
            onClick={onClose}
            className="btn-icon text-slate-500 hover:text-slate-700 hover:bg-slate-200"
          >
            <X size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4 bg-slate-50">
          {error && (
            <div className="bg-red-50 text-red-700 p-4 rounded-xl flex items-center gap-2 border border-red-100">
              <ShoppingBag size={20} />
              {error}
            </div>
          )}

          <div className="grid grid-cols-4 md:grid-cols-4 gap-2">
            {[
              { step: 1, label: 'Cliente' },
              { step: 2, label: 'Reserva' },
              { step: 3, label: 'Productos' },
              { step: 4, label: 'Notas' },
            ].map((item) => (
              <button
                key={item.step}
                type="button"
                onClick={() => {
                  if (item.step <= currentStep) {
                    setError('');
                    setCurrentStep(item.step);
                  }
                }}
                className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                  item.step === currentStep
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : item.step < currentStep
                      ? 'border-slate-200 bg-white text-slate-700'
                      : 'border-slate-200 bg-slate-100 text-slate-400'
                }`}
              >
                <span className="md:hidden">{item.step}</span>
                <span className="hidden md:inline">{item.label}</span>
              </button>
            ))}
          </div>

          {/* Section 1: Client Info */}
          {currentStep === 1 && (
          <section className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 text-white text-sm font-semibold shadow-sm">
                1
              </div>
              <div className="flex-1">
                <h3 className="flex items-center gap-2 text-lg font-bold text-gray-800">
                  <User className="text-blue-600" size={20} />
                  Cliente
                </h3>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Nombre</label>
                <input
                  type="text"
                  value={clientName}
                  onChange={e => setClientName(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white focus:bg-white focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 transition-all outline-none font-medium text-gray-900"
                  placeholder="Ej: Juan Pérez"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Email</label>
                <input
                  type="email"
                  value={clientEmail}
                  onChange={e => setClientEmail(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white focus:bg-white focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 transition-all outline-none font-medium text-gray-900"
                  placeholder="juan@ejemplo.com"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Teléfono</label>
                <input
                  type="tel"
                  value={clientPhone}
                  onChange={e => setClientPhone(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white focus:bg-white focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 transition-all outline-none font-medium text-gray-900"
                  placeholder="+34 600 000 000"
                />
              </div>
              <div className="md:col-span-2">
                {user?.rol === 'admin' ? (
                  <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">
                    {skipPayment
                      ? 'Reserva confirmada sin pago. Podrás registrar el pago manualmente más adelante.'
                      : 'Las reservas quedan en estado pendiente hasta recibir el pago completo.'}
                  </div>
                ) : (
                  <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">
                    {userAllowsBookingWithoutPayment
                      ? 'Este partner puede crear reservas sin pago previo. El cliente podrá firmar sin pagar antes.'
                      : 'Las reservas quedan en estado pendiente hasta recibir el pago completo.'}
                  </div>
                )}
              </div>
            </div>
          </section>
          )}

          {currentStep === 1 && user?.rol === 'admin' && (
            <section className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 text-white text-sm font-semibold shadow-sm">
                  <CreditCard className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <h3 className="flex items-center gap-2 text-lg font-bold text-gray-800">
                    Pago y asignacion
                  </h3>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex items-center gap-3">
                  <input
                    id="skipPayment"
                    type="checkbox"
                    checked={skipPayment}
                    onChange={(event) => setSkipPayment(event.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-slate-900 focus:ring-slate-900/30"
                  />
                  <label htmlFor="skipPayment" className="text-sm font-semibold text-gray-700">
                    Crear reserva sin pago (no generar enlace Stripe)
                  </label>
                </div>

                <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Asignar a</label>
                    <select
                      value={partnerType}
                      onChange={(event) => {
                        const nextType = event.target.value as typeof partnerType;
                        setPartnerType(nextType);
                        setPartnerId('');
                      }}
                      className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white focus:bg-white focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 transition-all outline-none font-medium text-gray-900"
                    >
                      <option value="directo">Cliente directo</option>
                      <option value="broker">Broker</option>
                      <option value="agency">Agencia</option>
                      <option value="colaborador">Colaborador</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Entidad</label>
                    <select
                      value={partnerId}
                      onChange={(event) => setPartnerId(event.target.value)}
                      className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white focus:bg-white focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 transition-all outline-none font-medium text-gray-900"
                      disabled={partnerType === 'directo'}
                    >
                      <option value="">Sin asignar</option>
                      {partners
                        .filter((partner) => partner.rol === partnerType)
                        .map((partner) => (
                          <option key={partner.id} value={partner.id}>
                            {partner.nombre}
                            {partner.empresa_nombre ? ` · ${partner.empresa_nombre}` : ''}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* Section 2: Dates & Details */}
          {currentStep === 2 && (
          <section className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 text-white text-sm font-semibold shadow-sm">
                2
              </div>
              <div className="flex-1">
                <h3 className="flex items-center gap-2 text-lg font-bold text-gray-800">
                  <Calendar className="text-blue-600" size={20} />
                  Reserva
                </h3>
              </div>
            </div>
            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className={`grid grid-cols-1 gap-3 ${isMultiDay ? 'md:grid-cols-2 xl:grid-cols-4' : 'md:grid-cols-3'}`}>
                <div className="md:col-span-2">
                  <label className="mb-2 block text-sm font-semibold text-gray-700">Inicio</label>
                  <div className="flex items-center gap-2">
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
                      className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-white px-4 py-3 font-medium text-gray-900 outline-none transition-all focus:bg-white focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
                      required
                    />
                    <label className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-700">
                      <input
                        type="checkbox"
                        checked={isMultiDay}
                        onChange={(e) => setIsMultiDay(e.target.checked)}
                        className="h-4 w-4 rounded border-gray-300 text-slate-900 focus:ring-slate-900/30"
                      />
                      <span className="hidden sm:inline">Varios dias</span>
                    </label>
                    <div className="shrink-0 rounded-xl bg-blue-100 px-3 py-3 text-sm font-bold text-blue-700">
                      {dayCount} {dayCount === 1 ? 'día' : 'días'}
                    </div>
                  </div>
                </div>
                {isMultiDay ? (
                  <div>
                    <label className="mb-2 block text-sm font-semibold text-gray-700">Fin</label>
                    <input
                      type="date"
                      value={endDate}
                      min={startDate < minDateStr ? minDateStr : startDate}
                      onChange={(e) => {
                        const nextDate = e.target.value || startDate;
                        setEndDate(nextDate < startDate ? startDate : nextDate);
                      }}
                      className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 font-medium text-gray-900 outline-none transition-all focus:bg-white focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
                      required={isMultiDay}
                    />
                  </div>
                ) : null}
                <div>
                   <label className="mb-2 block text-sm font-semibold text-gray-700">Ubicación</label>
                   <select
                      value={deliveryLocation}
                      onChange={(e) => {
                        const nextValue = e.target.value as 'marina_ibiza' | 'marina_botafoch' | 'club_nautico' | 'otro';
                        setDeliveryLocation(nextValue);
                        if (nextValue !== 'otro') {
                          setDeliveryLocationDetail('');
                        }
                      }}
                      className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white focus:bg-white focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 transition-all outline-none font-medium text-gray-900"
                      required
                   >
                      <option value="marina_ibiza">Marina Ibiza</option>
                      <option value="marina_botafoch">Marina Botafoch</option>
                      <option value="club_nautico">Club Náutico</option>
                      <option value="otro">Otro</option>
                   </select>
                </div>
                {deliveryLocation === 'otro' ? (
                  <div className="md:col-span-2">
                    <label className="mb-2 block text-sm font-semibold text-gray-700">Direccion</label>
                    <textarea
                      value={deliveryLocationDetail}
                      onChange={(e) => setDeliveryLocationDetail(e.target.value)}
                      rows={2}
                      className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 font-medium text-gray-900 outline-none transition-all focus:bg-white focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
                      placeholder="Escribe la direccion de entrega"
                      required
                    />
                  </div>
                ) : null}
                <div>
                   <label className="mb-2 block text-sm font-semibold text-gray-700">Hora</label>
                   <input
                      type="time"
                      value={deliveryTime}
                      onChange={e => setDeliveryTime(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white focus:bg-white focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 transition-all outline-none font-medium text-gray-900"
                      required
                   />
                </div>
                <div>
                   <label className="mb-2 block text-sm font-semibold text-gray-700">Barco</label>
                   <input
                      type="text"
                      value={boatName}
                      onChange={e => setBoatName(e.target.value)}
                      placeholder="Ej: Blue Pearl"
                      className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white focus:bg-white focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 transition-all outline-none font-medium text-gray-900"
                   />
                </div>
                <div>
                   <label className="mb-2 block text-sm font-semibold text-gray-700">Amarre</label>
                   <input
                      type="text"
                      value={dockingNumber}
                      onChange={e => setDockingNumber(e.target.value)}
                      placeholder="Ej: H-12"
                      className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white focus:bg-white focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 transition-all outline-none font-medium text-gray-900"
                   />
                </div>
                </div>

              {isPastCutoff && (
                <p className="mt-3 inline-block rounded-lg border border-amber-100 bg-amber-50 px-3 py-1 text-xs text-amber-700">
                  Sin reservas hoy despues de las 17:00
                </p>
              )}
            </div>
          </section>
          )}

          {/* Section 3: Items */}
          {currentStep === 3 && (
          <section className="rounded-2xl border-2 border-blue-200 bg-blue-50/40 p-4 shadow-sm">
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-white text-sm font-semibold shadow-sm">
                  3
                </div>
                <div className="flex-1">
                  <h3 className="flex items-center gap-2 text-lg font-bold text-gray-800">
                    <ShoppingBag className="text-blue-700" size={20} />
                    Productos
                  </h3>
                </div>
              </div>
              <button
                type="button"
                onClick={addItem}
                className="btn-ghost text-blue-700"
              >
                <Plus size={16} /> Añadir producto
              </button>
            </div>

            <div className="space-y-4">
              {isProductPickerOpen ? (
                <div className="rounded-xl border border-blue-200 bg-white p-3 shadow-sm">
                  <div className="mb-2 text-sm font-semibold text-slate-700">Selecciona un producto</div>
                  <div className="grid gap-2">
                    {products.map((product) => {
                      if (!product.id) return null;

                      const stockInfo = productStock[product.id];
                      const isOutOfStock = Boolean(stockInfo?.isOutOfStock);

                      return (
                        <button
                          key={product.id}
                          type="button"
                          onClick={() => addItemWithProduct(product.id as string)}
                          disabled={isOutOfStock}
                          className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3 text-left transition hover:border-blue-300 hover:bg-blue-50 disabled:cursor-not-allowed disabled:border-slate-100 disabled:bg-slate-50 disabled:text-slate-400"
                        >
                          <div>
                            <div className="font-medium text-slate-900">{product.nombre}</div>
                            <div className="text-xs text-slate-500">
                              €{formatPrice(getProductDailyPrice(product, startDate))}/dia · {getProductVatShortLabel(product)}
                            </div>
                          </div>
                          <div className={`text-xs font-semibold ${isOutOfStock ? 'text-red-600' : stockInfo?.isLowStock ? 'text-yellow-700' : 'text-green-700'}`}>
                            {isOutOfStock ? 'Sin stock' : stockInfo ? `${stockInfo.available} disp.` : 'Disponibilidad'}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {items.map((item, index) => {
                const selectedProduct = products.find(p => p.id === item.producto_id);
                const stockInfo = selectedProduct?.id ? productStock[selectedProduct.id] : null;
                const showStockWarning = stockInfo && (stockInfo.isOutOfStock || stockInfo.isLowStock);
                
                return (
                  <div key={index} className="flex flex-col gap-3 bg-white/90 p-3 rounded-xl border-2 border-blue-100 relative group text-gray-900 shadow-sm">
                    {/* Stock Warning Banner */}
                    {showStockWarning && (
                      <div className={`flex items-center gap-2 p-3 rounded-lg ${stockInfo.isOutOfStock ? 'bg-red-50 border border-red-200' : 'bg-yellow-50 border border-yellow-200'}`}>
                        {stockInfo.isOutOfStock ? (
                          <>
                            <PackageX className="text-red-600" size={20} />
                            <div className="flex-1">
                              <p className="text-sm font-bold text-red-700">⚠️ SIN STOCK DISPONIBLE</p>
                              <p className="text-xs text-red-600">Este producto no tiene unidades disponibles para las fechas seleccionadas. Por favor, elige otro producto o cambia las fechas.</p>
                            </div>
                          </>
                        ) : (
                          <>
                            <AlertCircle className="text-yellow-600" size={20} />
                            <div className="flex-1">
                              <p className="text-sm font-bold text-yellow-700">⚠️ STOCK BAJO</p>
                              <p className="text-xs text-yellow-600">Quedan solo {stockInfo.available} unidad(es) disponible(s) para estas fechas.</p>
                            </div>
                          </>
                        )}
                      </div>
                    )}

                    <div className="flex flex-col md:flex-row gap-4 items-start md:items-end">
                      <div className="flex-1 w-full">
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
                          Producto
                          {stockInfo && (
                            <span className={`ml-2 font-normal ${stockInfo.isOutOfStock ? 'text-red-600' : stockInfo.isLowStock ? 'text-yellow-600' : 'text-green-600'}`}>
                              ({stockInfo.available} disponibles)
                            </span>
                          )}
                        </label>
                        <select
                          value={item.producto_id}
                          onChange={(e) => updateItem(index, 'producto_id', e.target.value)}
                          className="w-full px-3 py-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none text-gray-900 font-medium"
                        >
                          <option value="">Selecciona un producto</option>
                          {products.map(p => {
                            const pStock = p.id ? productStock[p.id] : null;
                            const outOfStock = pStock?.isOutOfStock;
                            return (
                              <option key={p.id} value={p.id} disabled={outOfStock}>
                                {p.nombre} - €{formatPrice(getProductDailyPrice(p, startDate))}/día ({getProductVatShortLabel(p)}) {outOfStock ? '(SIN STOCK)' : pStock ? `(${pStock.available} disp.)` : ''}
                              </option>
                            );
                          })}
                        </select>
                      </div>
                      
                      <div className="w-full md:w-32">
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Cantidad</label>
                        <input
                          type="number"
                          min="1"
                          max={stockInfo?.available || 999}
                          value={item.cantidad}
                          onChange={(e) => updateItem(index, 'cantidad', parseInt(e.target.value))}
                          className="w-full px-3 py-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none text-gray-900 font-medium"
                          disabled={!item.producto_id}
                        />
                      </div>

                      <button
                        type="button"
                        onClick={() => removeItem(index)}
                        className="btn-icon text-rose-400 hover:text-rose-600 hover:bg-rose-50 absolute top-2 right-2 md:static"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>
                );
              })}

              {!isProductPickerOpen && items.length === 0 ? (
                <div className="text-center py-8 bg-white/80 border-2 border-dashed border-blue-200 rounded-xl text-gray-600">
                  Usa “Añadir producto” para abrir la lista.
                </div>
              ) : null}

            </div>
          </section>
          )}
          
          {/* Section 4: Notes */}
          {currentStep === 4 && (
          <section className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
             <div className="flex items-start gap-4">
               <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 text-white text-sm font-semibold shadow-sm">
                 4
               </div>
               <div className="flex-1">
                 <h3 className="text-lg font-bold text-gray-800">Notas Adicionales</h3>
               </div>
             </div>
             <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="w-full mt-4 px-4 py-3 rounded-xl border border-gray-200 bg-white focus:bg-white focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 transition-all outline-none text-gray-900"
                placeholder="Instrucciones especiales..."
             />
          </section>
          )}

        </form>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-100 bg-white rounded-b-2xl flex items-end justify-between gap-4">
          <div className="flex flex-col">
            <span className="text-xs text-gray-500 font-medium">Total</span>
            {vatSummaryLabel ? (
              <span className="text-xs text-amber-700 mt-1">{vatSummaryLabel}</span>
            ) : null}
            <span className="text-2xl font-bold text-slate-900">€{total.toLocaleString('es-ES', { minimumFractionDigits: 2 })}</span>
          </div>

          <div className="flex gap-3 shrink-0">
            {currentStep > 1 ? (
              <button
                type="button"
                onClick={goToPreviousStep}
                className="btn-outline"
              >
                Atras
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                className="btn-outline"
              >
                Cancelar
              </button>
            )}
            {currentStep < 4 ? (
              <button
                type="button"
                onClick={goToNextStep}
                className="btn-primary"
              >
                Siguiente
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={loading}
                className="btn-primary disabled:opacity-50"
              >
                {loading ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
                Crear Reserva
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
