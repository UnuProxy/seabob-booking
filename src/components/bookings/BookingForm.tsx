'use client';

import { useState, useEffect } from 'react';
import { collection, getDocs, query, where, serverTimestamp, doc, getDoc, increment, runTransaction } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { Product, BookingItem, DailyStock, User as AppUser } from '@/types';
import { getProductDailyPrice } from '@/lib/productPricing';
import { BOOKING_FORM_DRAFT_KEY, clearBookingDraftStorage } from '@/lib/bookingDraft';
import {
  doesBookingItemRequireNauticalLicense,
  getBookingDayCount,
  getBookingItemFuelTotal,
  getBookingItemInstructorTotal,
  hasFuelOption,
  hasInstructorOption,
} from '@/lib/bookingExtras';
import { useAuthStore } from '@/store/authStore';
import { X, Plus, Trash2, Save, Loader2 } from 'lucide-react';
import { addDays, format, eachDayOfInterval } from 'date-fns';

interface BookingFormProps {
  onClose: () => void;
  onSuccess?: (data: { contractUrl: string; paymentUrl?: string; bookingId: string }) => void;
  initialSelectedProductId?: string;
}

interface BookingFormDraft {
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  startDate: string;
  endDate: string;
  isMultiDay: boolean;
  items: BookingItem[];
  isProductPickerOpen: boolean;
  currentStep: number;
  deliveryLocation: 'marina_ibiza' | 'marina_botafoch' | 'club_nautico' | 'otro';
  deliveryLocationDetail: string;
  boatName: string;
  dockingNumber: string;
  deliveryTime: string;
  notes: string;
  skipPayment: boolean;
  partnerType: 'directo' | 'broker' | 'agency' | 'colaborador';
  partnerId: string;
}

export function BookingForm({ onClose, onSuccess, initialSelectedProductId }: BookingFormProps) {
  const { user } = useAuthStore();
  const formatPrice = (amount: number) => amount.toLocaleString('es-ES', { maximumFractionDigits: 0 });
  const getErrorCode = (error: unknown) =>
    typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code || '') : '';
  const getErrorMessage = (error: unknown) =>
    typeof error === 'object' && error && 'message' in error ? String((error as { message?: unknown }).message || '') : '';
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
  const [hasAppliedInitialProduct, setHasAppliedInitialProduct] = useState(false);
  const [canSubmitStepThree, setCanSubmitStepThree] = useState(false);
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [hasDraftData, setHasDraftData] = useState(false);
  
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

  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      const rawDraft = window.sessionStorage.getItem(BOOKING_FORM_DRAFT_KEY);
      if (!rawDraft) {
        setHasDraftData(false);
        return;
      }

      const draft = JSON.parse(rawDraft) as Partial<BookingFormDraft>;

      setClientName(typeof draft.clientName === 'string' ? draft.clientName : '');
      setClientEmail(typeof draft.clientEmail === 'string' ? draft.clientEmail : '');
      setClientPhone(typeof draft.clientPhone === 'string' ? draft.clientPhone : '');
      setStartDate(typeof draft.startDate === 'string' ? draft.startDate : minDateStr);
      setEndDate(typeof draft.endDate === 'string' ? draft.endDate : minDateStr);
      setIsMultiDay(Boolean(draft.isMultiDay));
      setItems(
        Array.isArray(draft.items)
          ? draft.items.map((item) => ({
              producto_id: typeof item?.producto_id === 'string' ? item.producto_id : '',
              cantidad: Math.max(1, Number(item?.cantidad || 1)),
              tipo_alquiler: item?.tipo_alquiler || 'dia',
              duracion: Math.max(1, Number(item?.duracion || 1)),
              instructor_requested: Boolean(item?.instructor_requested),
              fuel_requested: Boolean(item?.fuel_requested),
            }))
          : []
      );
      setIsProductPickerOpen(Boolean(draft.isProductPickerOpen));
      setCurrentStep(
        typeof draft.currentStep === 'number' ? Math.min(3, Math.max(1, draft.currentStep)) : 1
      );
      setDeliveryLocation(
        draft.deliveryLocation === 'marina_ibiza' ||
          draft.deliveryLocation === 'marina_botafoch' ||
          draft.deliveryLocation === 'club_nautico' ||
          draft.deliveryLocation === 'otro'
          ? draft.deliveryLocation
          : 'marina_ibiza'
      );
      setDeliveryLocationDetail(typeof draft.deliveryLocationDetail === 'string' ? draft.deliveryLocationDetail : '');
      setBoatName(typeof draft.boatName === 'string' ? draft.boatName : '');
      setDockingNumber(typeof draft.dockingNumber === 'string' ? draft.dockingNumber : '');
      setDeliveryTime(typeof draft.deliveryTime === 'string' ? draft.deliveryTime : '09:00');
      setNotes(typeof draft.notes === 'string' ? draft.notes : '');
      setSkipPayment(Boolean(draft.skipPayment));
      setPartnerType(
        draft.partnerType === 'broker' ||
          draft.partnerType === 'agency' ||
          draft.partnerType === 'colaborador' ||
          draft.partnerType === 'directo'
          ? draft.partnerType
          : 'directo'
      );
      setPartnerId(typeof draft.partnerId === 'string' ? draft.partnerId : '');
      setHasDraftData(true);
    } catch (error) {
      console.error('Error restoring booking draft:', error);
      window.sessionStorage.removeItem(BOOKING_FORM_DRAFT_KEY);
      setHasDraftData(false);
    } finally {
      setDraftHydrated(true);
    }
  }, [minDateStr]);

  useEffect(() => {
    if (!draftHydrated || successData) return;

    const draft: BookingFormDraft = {
      clientName,
      clientEmail,
      clientPhone,
      startDate,
      endDate,
      isMultiDay,
      items,
      isProductPickerOpen,
      currentStep,
      deliveryLocation,
      deliveryLocationDetail,
      boatName,
      dockingNumber,
      deliveryTime,
      notes,
      skipPayment,
      partnerType,
      partnerId,
    };

    try {
      window.sessionStorage.setItem(BOOKING_FORM_DRAFT_KEY, JSON.stringify(draft));
    } catch (error) {
      console.error('Error saving booking draft:', error);
    }
  }, [
    boatName,
    clientEmail,
    clientName,
    clientPhone,
    currentStep,
    deliveryLocation,
    deliveryLocationDetail,
    deliveryTime,
    dockingNumber,
    draftHydrated,
    endDate,
    isMultiDay,
    isProductPickerOpen,
    items,
    notes,
    partnerId,
    partnerType,
    skipPayment,
    startDate,
    successData,
  ]);

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
      } catch (err: unknown) {
        console.error('Error fetching products:', err);
        if (getErrorCode(err) === 'permission-denied') {
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
    if (!draftHydrated || hasDraftData || !initialSelectedProductId || items.length > 0 || hasAppliedInitialProduct) return;

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
        instructor_requested: false,
        fuel_requested: false,
      }
    ]);
    setHasAppliedInitialProduct(true);
  }, [draftHydrated, hasAppliedInitialProduct, hasDraftData, initialSelectedProductId, items.length, productStock, products]);

  useEffect(() => {
    if (currentStep !== 3) {
      setCanSubmitStepThree(false);
      return;
    }

    const timer = window.setTimeout(() => {
      setCanSubmitStepThree(true);
    }, 350);

    return () => window.clearTimeout(timer);
  }, [currentStep]);

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
        instructor_requested: false,
        fuel_requested: false,
      }
    ]);
    setIsProductPickerOpen(false);
    setError('');
  };

  const updateItem = (index: number, field: keyof BookingItem, value: BookingItem[keyof BookingItem]) => {
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
      const days = getBookingDayCount(startDate, endDate);
      return getProductDailyPrice(product, startDate) * days * item.cantidad;
    }
    return (product.precio_hora || 0) * Math.max(1, item.duracion) * item.cantidad;
  };

  const getItemInstructorSubtotal = (item: BookingItem, product?: Product) =>
    getBookingItemInstructorTotal(item, product, getBookingDayCount(startDate, endDate));

  const getItemFuelSubtotal = (item: BookingItem, product?: Product) =>
    getBookingItemFuelTotal(item, product, getBookingDayCount(startDate, endDate));

  const calculateRentalTotal = () => {
    return items.reduce((acc, item) => {
      const product = products.find(p => p.id === item.producto_id);
      return acc + getItemSubtotal(item, product);
    }, 0);
  };

  const calculateInstructorTotal = () => {
    return items.reduce((acc, item) => {
      const product = products.find((p) => p.id === item.producto_id);
      return acc + getItemInstructorSubtotal(item, product);
    }, 0);
  };

  const calculateFuelTotal = () => {
    return items.reduce((acc, item) => {
      const product = products.find((p) => p.id === item.producto_id);
      return acc + getItemFuelSubtotal(item, product);
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
    setCurrentStep((prev) => Math.min(3, prev + 1));
  };

  const goToPreviousStep = () => {
    setError('');
    setCurrentStep((prev) => Math.max(1, prev - 1));
  };


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (currentStep < 3) {
      goToNextStep();
      return;
    }
    if (!canSubmitStepThree || loading) return;
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
      const instructorTotal = calculateInstructorTotal();
      const fuelTotal = calculateFuelTotal();
      const totalAmount = rentalTotal + instructorTotal + fuelTotal;
      
      // Build items with product names, prices, and commission rates
      const itemsWithNames = items.map((item) => {
        const product = products.find((p) => p.id === item.producto_id);
        const instructorTotalForItem = getItemInstructorSubtotal(item, product);
        const fuelTotalForItem = getItemFuelSubtotal(item, product);
        
        return {
          ...item,
          producto_nombre: product?.nombre || item.producto_id,
          precio_unitario:
            item.tipo_alquiler === 'hora'
              ? product?.precio_hora || 0
              : getProductDailyPrice(product, startDate),
          comision_percent: product?.comision || 0, // Store commission rate at time of booking
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
      const nauticalLicenseRequired = itemsWithNames.some((item) => item.nautical_license_required);
      
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
        precio_total: totalAmount,
        precio_alquiler: rentalTotal,
        instructor_total: instructorTotal,
        fuel_total: fuelTotal,
        nautical_license_required: nauticalLicenseRequired,
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
      } catch (stockError: unknown) {
        const stockErrorMessage = getErrorMessage(stockError);
        if (stockErrorMessage.startsWith('STOCK:')) {
          const [, productName, availableRaw] = stockErrorMessage.split(':');
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
      clearBookingDraftStorage();
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
  const instructorTotal = calculateInstructorTotal();
  const fuelTotal = calculateFuelTotal();
  const total = rentalTotal + instructorTotal + fuelTotal;
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
  const requiresLicenseUpload = items.some((item) => {
    const product = products.find((entry) => entry.id === item.producto_id);
    return doesBookingItemRequireNauticalLicense(item, product);
  });

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-0 sm:p-4">
      <div className="flex h-svh w-full max-w-4xl flex-col overflow-hidden rounded-none bg-white shadow-2xl sm:h-auto sm:max-h-[92vh] sm:rounded-3xl">
        <div className="sticky top-0 z-10 border-b border-slate-200 bg-white px-4 py-4 sm:px-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold text-slate-900">Nueva Reserva</h2>
            </div>
            <button
              onClick={onClose}
              className="btn-icon text-slate-500 hover:text-slate-700 hover:bg-slate-100"
            >
              <X size={24} />
            </button>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2">
            {[
              { step: 1, label: 'Cliente' },
              { step: 2, label: 'Fecha' },
              { step: 3, label: 'Productos' },
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
                className={`rounded-2xl border px-2 py-3 text-center text-sm font-semibold transition sm:px-3 ${
                  item.step === currentStep
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : item.step < currentStep
                      ? 'border-blue-200 bg-blue-50 text-slate-900'
                      : 'border-slate-200 bg-slate-50 text-slate-400'
                }`}
              >
                <span className="mr-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/15 text-xs sm:mr-2">
                  {item.step}
                </span>
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col bg-slate-50">
          <div className="min-h-0 flex-1 overflow-y-auto p-4 pb-6 sm:p-6">
            {error && (
              <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
                {error}
              </div>
            )}

            {currentStep === 1 && (
              <div className="space-y-4">
                <section className="rounded-3xl border border-slate-200 bg-white p-4 sm:p-6">
                  <h3 className="text-xl font-bold text-slate-900">Cliente</h3>
                  <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-2 block text-sm font-semibold text-slate-700">Nombre</label>
                      <input
                        type="text"
                        value={clientName}
                        onChange={(e) => setClientName(e.target.value)}
                        className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-lg text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
                        placeholder="Nombre"
                        required
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-sm font-semibold text-slate-700">Teléfono</label>
                      <input
                        type="tel"
                        value={clientPhone}
                        onChange={(e) => setClientPhone(e.target.value)}
                        className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-lg text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
                        placeholder="Teléfono"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="mb-2 block text-sm font-semibold text-slate-700">Email</label>
                      <input
                        type="email"
                        value={clientEmail}
                        onChange={(e) => setClientEmail(e.target.value)}
                        className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-lg text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
                        placeholder="Email"
                      />
                    </div>
                  </div>
                </section>

                {user?.rol === 'admin' && (
                  <section className="rounded-3xl border border-slate-200 bg-white p-4 sm:p-6">
                    <h3 className="text-xl font-bold text-slate-900">Pago</h3>
                    <div className="mt-4 space-y-4">
                      <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                        <input
                          id="skipPayment"
                          type="checkbox"
                          checked={skipPayment}
                          onChange={(event) => setSkipPayment(event.target.checked)}
                          className="h-5 w-5 rounded border-gray-300 text-slate-900 focus:ring-slate-900/30"
                        />
                        <span className="text-base font-semibold text-slate-900">Sin pago ahora</span>
                      </label>

                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div>
                          <label className="mb-2 block text-sm font-semibold text-slate-700">Tipo</label>
                          <select
                            value={partnerType}
                            onChange={(event) => {
                              const nextType = event.target.value as typeof partnerType;
                              setPartnerType(nextType);
                              setPartnerId('');
                            }}
                            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-lg text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
                          >
                            <option value="directo">Directo</option>
                            <option value="broker">Broker</option>
                            <option value="agency">Agencia</option>
                            <option value="colaborador">Colaborador</option>
                          </select>
                        </div>
                        <div>
                          <label className="mb-2 block text-sm font-semibold text-slate-700">Nombre</label>
                          <select
                            value={partnerId}
                            onChange={(event) => setPartnerId(event.target.value)}
                            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-lg text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
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
              </div>
            )}

            {currentStep === 2 && (
              <section className="rounded-3xl border border-slate-200 bg-white p-4 sm:p-6">
                <h3 className="text-xl font-bold text-slate-900">Fecha y lugar</h3>
                <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-sm font-semibold text-slate-700">Inicio</label>
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
                      className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-lg text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
                      required
                    />
                  </div>
                  <div className="flex items-end">
                    <label className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                      <input
                        type="checkbox"
                        checked={isMultiDay}
                        onChange={(e) => setIsMultiDay(e.target.checked)}
                        className="h-5 w-5 rounded border-gray-300 text-slate-900 focus:ring-slate-900/30"
                      />
                      <span className="text-base font-semibold text-slate-900">Varios días</span>
                    </label>
                  </div>

                  {isMultiDay ? (
                    <div>
                      <label className="mb-2 block text-sm font-semibold text-slate-700">Fin</label>
                      <input
                        type="date"
                        value={endDate}
                        min={startDate < minDateStr ? minDateStr : startDate}
                        onChange={(e) => {
                          const nextDate = e.target.value || startDate;
                          setEndDate(nextDate < startDate ? startDate : nextDate);
                        }}
                        className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-lg text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
                        required={isMultiDay}
                      />
                    </div>
                  ) : null}

                  <div>
                    <label className="mb-2 block text-sm font-semibold text-slate-700">Hora</label>
                    <input
                      type="time"
                      value={deliveryTime}
                      onChange={(e) => setDeliveryTime(e.target.value)}
                      className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-lg text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
                      required
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-semibold text-slate-700">Lugar</label>
                    <select
                      value={deliveryLocation}
                      onChange={(e) => {
                        const nextValue = e.target.value as 'marina_ibiza' | 'marina_botafoch' | 'club_nautico' | 'otro';
                        setDeliveryLocation(nextValue);
                        if (nextValue !== 'otro') setDeliveryLocationDetail('');
                      }}
                      className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-lg text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
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
                      <label className="mb-2 block text-sm font-semibold text-slate-700">Dirección</label>
                      <textarea
                        value={deliveryLocationDetail}
                        onChange={(e) => setDeliveryLocationDetail(e.target.value)}
                        rows={2}
                        className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-lg text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
                        placeholder="Dirección"
                        required
                      />
                    </div>
                  ) : null}

                  <div>
                    <label className="mb-2 block text-sm font-semibold text-slate-700">Barco</label>
                    <input
                      type="text"
                      value={boatName}
                      onChange={(e) => setBoatName(e.target.value)}
                      className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-lg text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
                      placeholder="Barco"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-semibold text-slate-700">Amarre</label>
                    <input
                      type="text"
                      value={dockingNumber}
                      onChange={(e) => setDockingNumber(e.target.value)}
                      className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-lg text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
                      placeholder="Amarre"
                    />
                  </div>
                </div>

                {isPastCutoff && (
                  <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-700">
                    Hoy ya no se puede reservar.
                  </div>
                )}
              </section>
            )}

            {currentStep === 3 && (
              <div className="space-y-4">
                <section className="rounded-3xl border border-slate-200 bg-white p-4 sm:p-6">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-xl font-bold text-slate-900">Productos</h3>
                    <button type="button" onClick={addItem} className="btn-primary">
                      <Plus size={16} />
                      {isProductPickerOpen ? 'Cerrar' : 'Añadir'}
                    </button>
                  </div>

                  {isProductPickerOpen && (
                    <div className="mt-4 grid gap-3">
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
                            className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-left disabled:opacity-50"
                          >
                            <div>
                              <div className="text-lg font-semibold text-slate-900">{product.nombre}</div>
                              <div className="text-sm text-slate-500">
                                €{formatPrice(getProductDailyPrice(product, startDate))}/día
                              </div>
                            </div>
                            <div className={`text-sm font-semibold ${isOutOfStock ? 'text-rose-600' : 'text-emerald-700'}`}>
                              {isOutOfStock ? 'Sin stock' : stockInfo ? `${stockInfo.available}` : ''}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <div className="mt-4 space-y-4">
                    {items.map((item, index) => {
                      const selectedProduct = products.find((p) => p.id === item.producto_id);
                      const stockInfo = selectedProduct?.id ? productStock[selectedProduct.id] : null;
                      const canAddInstructor = hasInstructorOption(selectedProduct);
                      const canAddFuel = hasFuelOption(selectedProduct);
                      const requiresLicense = doesBookingItemRequireNauticalLicense(item, selectedProduct);

                      return (
                        <div key={index} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                          <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_110px_auto]">
                            <div>
                              <label className="mb-2 block text-sm font-semibold text-slate-700">Producto</label>
                              <select
                                value={item.producto_id}
                                onChange={(e) => {
                                  const nextProduct = products.find((product) => product.id === e.target.value);
                                  const nextItem: BookingItem = {
                                    ...item,
                                    producto_id: e.target.value,
                                    instructor_requested: hasInstructorOption(nextProduct) ? Boolean(item.instructor_requested) : false,
                                    fuel_requested: hasFuelOption(nextProduct) ? Boolean(item.fuel_requested) : false,
                                  };
                                  const newItems = [...items];
                                  newItems[index] = nextItem;
                                  setItems(newItems);
                                }}
                                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-lg text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
                              >
                                <option value="">Selecciona</option>
                                {products.map((product) => {
                                  const pStock = product.id ? productStock[product.id] : null;
                                  const outOfStock = pStock?.isOutOfStock;
                                  return (
                                    <option key={product.id} value={product.id} disabled={outOfStock}>
                                      {product.nombre} - €{formatPrice(getProductDailyPrice(product, startDate))}/día
                                    </option>
                                  );
                                })}
                              </select>
                            </div>

                            <div>
                              <label className="mb-2 block text-sm font-semibold text-slate-700">Cantidad</label>
                              <input
                                type="number"
                                min="1"
                                max={stockInfo?.available || 999}
                                value={item.cantidad}
                                onChange={(e) => updateItem(index, 'cantidad', parseInt(e.target.value))}
                                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-lg text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
                                disabled={!item.producto_id}
                              />
                            </div>

                            <div className="flex items-end">
                              <button
                                type="button"
                                onClick={() => removeItem(index)}
                                className="btn-outline w-full md:w-auto"
                              >
                                <Trash2 size={16} />
                                Quitar
                              </button>
                            </div>
                          </div>

                          {stockInfo?.isLowStock && !stockInfo.isOutOfStock ? (
                            <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-700">
                              Poco stock: quedan {stockInfo.available}
                            </div>
                          ) : null}

                          {stockInfo?.isOutOfStock ? (
                            <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
                              Sin stock para estas fechas
                            </div>
                          ) : null}

                          {(canAddInstructor || canAddFuel) && (
                            <div className="mt-4 grid gap-3 md:grid-cols-2">
                              {canAddInstructor && (
                                <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-4">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(item.instructor_requested)}
                                    onChange={(e) => updateItem(index, 'instructor_requested', e.target.checked)}
                                    className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                  />
                                  <div>
                                    <div className="font-semibold text-slate-900">Monitor</div>
                                    <div className="text-sm text-slate-500">
                                      €{formatPrice(
                                        Number(selectedProduct?.instructor_price_per_day || 0) *
                                          (selectedProduct?.instructor_incluir_iva ? 1.21 : 1)
                                      )}/día
                                    </div>
                                  </div>
                                </label>
                              )}

                              {canAddFuel && (
                                <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-4">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(item.fuel_requested)}
                                    onChange={(e) => updateItem(index, 'fuel_requested', e.target.checked)}
                                    className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                  />
                                  <div>
                                    <div className="font-semibold text-slate-900">Fuel</div>
                                    <div className="text-sm text-slate-500">
                                      €{formatPrice(Number(selectedProduct?.fuel_price_per_day || 0))}/día
                                    </div>
                                  </div>
                                </label>
                              )}
                            </div>
                          )}

                          {requiresLicense ? (
                            <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-700">
                              Hará falta licencia náutica.
                            </div>
                          ) : null}
                        </div>
                      );
                    })}

                    {!isProductPickerOpen && items.length === 0 ? (
                      <div className="rounded-3xl border-2 border-dashed border-slate-200 bg-white px-6 py-12 text-center">
                        <button type="button" onClick={addItem} className="btn-primary">
                          <Plus size={16} />
                          Añadir producto
                        </button>
                      </div>
                    ) : null}
                  </div>
                </section>

                <section className="rounded-3xl border border-slate-200 bg-white p-4 sm:p-6">
                  <h3 className="text-xl font-bold text-slate-900">Notas</h3>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={4}
                    className="mt-4 w-full rounded-2xl border border-slate-200 px-4 py-3 text-lg text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
                    placeholder="Notas"
                  />
                </section>
              </div>
            )}
          </div>

          <div className="sticky bottom-0 border-t border-slate-200 bg-white px-4 py-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:px-6 sm:pb-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-500">{vatSummaryLabel || 'Total'}</div>
                <div className="mt-1 text-3xl font-bold text-slate-900">
                  €{total.toLocaleString('es-ES', { minimumFractionDigits: 2 })}
                </div>
                {(instructorTotal > 0 || fuelTotal > 0) && (
                  <div className="mt-1 text-sm text-slate-500">
                    {instructorTotal > 0 ? `Monitor €${instructorTotal.toLocaleString('es-ES', { minimumFractionDigits: 2 })}` : ''}
                    {instructorTotal > 0 && fuelTotal > 0 ? ' · ' : ''}
                    {fuelTotal > 0 ? `Fuel €${fuelTotal.toLocaleString('es-ES', { minimumFractionDigits: 2 })}` : ''}
                  </div>
                )}
                {requiresLicenseUpload ? (
                  <div className="mt-2 text-sm font-medium text-amber-700">Hace falta licencia</div>
                ) : null}
              </div>

              <div className="grid w-full grid-cols-2 gap-3 sm:flex sm:w-auto sm:self-end">
                {currentStep > 1 ? (
                  <button type="button" onClick={goToPreviousStep} className="btn-outline w-full sm:w-auto">
                    Atrás
                  </button>
                ) : (
                  <button type="button" onClick={onClose} className="btn-outline w-full sm:w-auto">
                    Cancelar
                  </button>
                )}
                {currentStep < 3 ? (
                  <button type="button" onClick={goToNextStep} className="btn-primary w-full sm:w-auto">
                    Siguiente
                  </button>
                ) : (
                  <button type="submit" disabled={loading || !canSubmitStepThree} className="btn-primary w-full sm:w-auto disabled:opacity-50">
                    {loading ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
                    Crear Reserva
                  </button>
                )}
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
