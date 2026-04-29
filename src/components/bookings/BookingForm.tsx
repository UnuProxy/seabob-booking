'use client';

import { useState, useEffect, useMemo } from 'react';
import { collection, getDocs, query, where, serverTimestamp, doc, getDoc, increment, runTransaction, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { Product, BookingItem, DailyStock, User as AppUser, PaymentMethod } from '@/types';
import { BOOKING_FORM_DRAFT_KEY, clearBookingDraftStorage } from '@/lib/bookingDraft';
import { getTimedBookingExpiration } from '@/lib/bookingExpiration';
import {
  DELIVERY_LOCATION_GROUPS,
  getDeliveryLocationFee,
  isDeliveryLocation,
} from '@/lib/deliveryLocations';
import {
  getBookingClientTotals,
  getBookingItemFuelClientTotal,
  getBookingItemInstructorClientTotal,
  getBookingItemRentalClientTotal,
} from '@/lib/bookingClientPricing';
import {
  getBookingItemAverageDailyPrice,
  getBookingItemRentalTotal,
  doesBookingItemRequireNauticalLicense,
  getBookingDayCount,
  hasFuelOption,
  hasInstructorOption,
  supportsEfoilBatteryOption,
} from '@/lib/bookingExtras';
import { useAuthStore } from '@/store/authStore';
import { X, Plus, Minus, Trash2, Save, Loader2, Search } from 'lucide-react';
import { addDays, format, eachDayOfInterval } from 'date-fns';

interface BookingFormProps {
  onClose: () => void;
  onSuccess?: (data: { contractUrl?: string; paymentUrl?: string; bookingId: string }) => void;
  initialSelectedProductId?: string;
}

interface BookingFormDraft {
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  clientDocument: string;
  clientAddress: string;
  creatorName: string;
  startDate: string;
  endDate: string;
  isMultiDay: boolean;
  items: BookingItem[];
  isProductPickerOpen: boolean;
  currentStep: number;
  deliveryLocation:
    | 'marina_ibiza'
    | 'marina_botafoch'
    | 'club_nautico'
    | 'marina_port_ibiza'
    | 'marina_santa_eulalia'
    | 'club_nautic_san_antonio'
    | 'otro';
  deliveryLocationDetail: string;
  boatName: string;
  dockingNumber: string;
  deliveryTime: string;
  notes: string;
  adminPaymentStatus?: 'pending' | 'paid';
  adminPaymentMethod?: PaymentMethod;
  partnerType: 'directo' | 'broker' | 'agency' | 'colaborador';
  partnerId: string;
}

export function BookingForm({ onClose, onSuccess, initialSelectedProductId }: BookingFormProps) {
  const { user } = useAuthStore();
  const isAdmin = user?.rol === 'admin';
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
    contractUrl?: string;
    paymentUrl?: string;
    bookingId: string;
  } | null>(null);

  // Form State
  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [clientDocument, setClientDocument] = useState('');
  const [clientAddress, setClientAddress] = useState('');
  const [creatorName, setCreatorName] = useState('');
  
  const now = new Date();
  const isPastCutoff = now.getHours() >= 17;
  const minDate = isPastCutoff ? addDays(now, 1) : now;
  const minDateStr = format(minDate, 'yyyy-MM-dd');
  const todayDateStr = format(new Date(), 'yyyy-MM-dd');
  const [startDate, setStartDate] = useState(minDateStr);
  const [endDate, setEndDate] = useState(minDateStr); // Default same day (1 day service)
  const [isMultiDay, setIsMultiDay] = useState(false);
  const [items, setItems] = useState<BookingItem[]>([]);
  const [isProductPickerOpen, setIsProductPickerOpen] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [showOutOfStockProducts, setShowOutOfStockProducts] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [hasAppliedInitialProduct, setHasAppliedInitialProduct] = useState(false);
  const [canSubmitStepThree, setCanSubmitStepThree] = useState(false);
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [hasDraftData, setHasDraftData] = useState(false);
  
  // Delivery Details
  const [deliveryLocation, setDeliveryLocation] = useState<
    | 'marina_ibiza'
    | 'marina_botafoch'
    | 'club_nautico'
    | 'marina_port_ibiza'
    | 'marina_santa_eulalia'
    | 'club_nautic_san_antonio'
    | 'otro'
  >('marina_ibiza');
  const [deliveryLocationDetail, setDeliveryLocationDetail] = useState('');
  const [boatName, setBoatName] = useState('');
  const [dockingNumber, setDockingNumber] = useState('');
  const [deliveryTime, setDeliveryTime] = useState('09:00'); // Default 9 AM
  
  const [notes, setNotes] = useState('');
  const [adminPaymentStatus, setAdminPaymentStatus] = useState<'pending' | 'paid'>('pending');
  const [adminPaymentMethod, setAdminPaymentMethod] = useState<PaymentMethod>('tarjeta');
  const [partnerType, setPartnerType] = useState<'directo' | 'broker' | 'agency' | 'colaborador'>('directo');
  const [partnerId, setPartnerId] = useState('');
  const isAdminBackdatedBooking = isAdmin && startDate < todayDateStr;

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
      setClientDocument(typeof draft.clientDocument === 'string' ? draft.clientDocument : '');
      setClientAddress(typeof draft.clientAddress === 'string' ? draft.clientAddress : '');
      setCreatorName(typeof draft.creatorName === 'string' ? draft.creatorName : '');
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
      setDeliveryLocation(isDeliveryLocation(draft.deliveryLocation) ? draft.deliveryLocation : 'marina_ibiza');
      setDeliveryLocationDetail(typeof draft.deliveryLocationDetail === 'string' ? draft.deliveryLocationDetail : '');
      setBoatName(typeof draft.boatName === 'string' ? draft.boatName : '');
      setDockingNumber(typeof draft.dockingNumber === 'string' ? draft.dockingNumber : '');
      setDeliveryTime(typeof draft.deliveryTime === 'string' ? draft.deliveryTime : '09:00');
      setNotes(typeof draft.notes === 'string' ? draft.notes : '');
      setAdminPaymentStatus(draft.adminPaymentStatus === 'paid' ? 'paid' : 'pending');
      setAdminPaymentMethod(
        draft.adminPaymentMethod === 'stripe' ||
          draft.adminPaymentMethod === 'transferencia' ||
          draft.adminPaymentMethod === 'tarjeta' ||
          draft.adminPaymentMethod === 'otro'
          ? draft.adminPaymentMethod
          : 'tarjeta'
      );
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
      clientDocument,
      clientAddress,
      creatorName,
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
      adminPaymentStatus,
      adminPaymentMethod,
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
    clientDocument,
    clientAddress,
    creatorName,
    clientName,
    clientPhone,
    currentStep,
    deliveryLocation,
    deliveryLocationDetail,
    deliveryTime,
    dockingNumber,
    draftHydrated,
    endDate,
    adminPaymentMethod,
    adminPaymentStatus,
    isMultiDay,
    isProductPickerOpen,
    items,
    notes,
    partnerId,
    partnerType,
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

      if (isAdminBackdatedBooking) {
        const stockMap: Record<string, { available: number; isOutOfStock: boolean; isLowStock: boolean }> = {};
        products.forEach((product) => {
          if (!product.id) return;
          stockMap[product.id] = {
            available: Number.MAX_SAFE_INTEGER,
            isOutOfStock: false,
            isLowStock: false,
          };
        });
        setProductStock(stockMap);
        return;
      }

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
  }, [endDate, isAdminBackdatedBooking, products, startDate]);

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
    setItems((prev) => {
      const existingIndex = prev.findIndex((item) => item.producto_id === productId);
      const available = productStock[productId]?.available ?? Infinity;

      if (existingIndex >= 0) {
        return prev.map((item, index) =>
          index === existingIndex
            ? { ...item, cantidad: Math.min(item.cantidad + 1, available) }
            : item
        );
      }

      return [
        ...prev,
        {
          producto_id: productId,
          cantidad: 1,
          tipo_alquiler: 'dia',
          duracion: 1,
          instructor_requested: false,
          fuel_requested: false,
        }
      ];
    });
    setIsProductPickerOpen(false);
    setProductSearch('');
    setError('');
  };

  const updateItem = (index: number, field: keyof BookingItem, value: BookingItem[keyof BookingItem]) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], [field]: value };
    setItems(newItems);
  };

  const updateItemQuantity = (index: number, nextQuantity: number) => {
    const currentItem = items[index];
    if (!currentItem) return;

    const maxAvailable = currentItem.producto_id ? productStock[currentItem.producto_id]?.available || 999 : 999;
    const safeQuantity = Math.max(1, Math.min(maxAvailable, nextQuantity));
    updateItem(index, 'cantidad', safeQuantity);
  };

  const removeItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const getDisplayedProductDayPrice = (product?: Product) =>
    getBookingItemRentalClientTotal(
      { cantidad: 1, duracion: 1, tipo_alquiler: 'dia' },
      product,
      startDate,
      startDate
    );

  const getItemSubtotal = (item: BookingItem, product?: Product) =>
    getBookingItemRentalClientTotal(item, product, startDate, endDate);

  const getItemInstructorSubtotal = (item: BookingItem, product?: Product) =>
    getBookingItemInstructorClientTotal(item, product, getBookingDayCount(startDate, endDate));

  const getItemFuelSubtotal = (item: BookingItem, product?: Product) =>
    getBookingItemFuelClientTotal(item, product, getBookingDayCount(startDate, endDate));

  const calculateRentalTotal = () =>
    getBookingClientTotals(
      items,
      (productId) => products.find((product) => product.id === productId),
      startDate,
      endDate
    ).rentalTotal;

  const calculateInstructorTotal = () =>
    getBookingClientTotals(
      items,
      (productId) => products.find((product) => product.id === productId),
      startDate,
      endDate
    ).instructorTotal;

  const calculateFuelTotal = () =>
    getBookingClientTotals(
      items,
      (productId) => products.find((product) => product.id === productId),
      startDate,
      endDate
    ).fuelTotal;
  const deliveryTotal = getDeliveryLocationFee(deliveryLocation);

  const validateStep = (step: number) => {
    if (step === 1) {
      if (!clientName) {
        setError('El nombre del cliente es obligatorio');
        return false;
      }
      return true;
    }

    if (step === 2) {
      if (!isAdmin && startDate < minDateStr) {
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
    if (!isAdmin && startDate < minDateStr) {
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
    if (!isAdminBackdatedBooking) {
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
    }

    setLoading(true);
    setError('');

    try {
      // Generate Ref
      const ref = `RES-${format(new Date(), 'ddMMyy')}-${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
      
      const shouldGenerateAccessLink = !(
        user.rol === 'broker' ||
        user.rol === 'agency' ||
        (user.rol === 'admin' && (partnerType === 'broker' || partnerType === 'agency'))
      );
      const token = shouldGenerateAccessLink
        ? Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
        : null;

      const bookingClientTotals = getBookingClientTotals(
        items,
        (productId) => products.find((product) => product.id === productId),
        startDate,
        endDate
      );
      const rentalTotal = bookingClientTotals.rentalTotal;
      const instructorTotal = bookingClientTotals.instructorTotal;
      const fuelTotal = bookingClientTotals.fuelTotal;
      const totalAmount = rentalTotal + instructorTotal + fuelTotal + deliveryTotal;
      
      // Build items with product names, prices, and commission rates
      const itemsWithNames = items.map((item) => {
        const product = products.find((p) => p.id === item.producto_id);
        const instructorTotalForItem = getItemInstructorSubtotal(item, product);
        const fuelTotalForItem = getItemFuelSubtotal(item, product);
        
        return {
          ...item,
          duracion: item.tipo_alquiler === 'dia' ? getBookingDayCount(startDate, endDate) : item.duracion,
          producto_nombre: product?.nombre || item.producto_id,
          precio_unitario:
            item.tipo_alquiler === 'hora'
              ? product?.precio_hora || 0
              : getBookingItemAverageDailyPrice(item, product, startDate, endDate),
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
          const itemPrice = getBookingItemRentalTotal(item, product, startDate, endDate);
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
      const adminMarkedPaid = user.rol === 'admin' && adminPaymentStatus === 'paid';
      const bypassPaymentRequirement =
        user.rol === 'admin' ? adminMarkedPaid : partnerAllowsBookingWithoutPayment;

      let expiracion: Date | null = null;
      if (!bypassPaymentRequirement && shouldGenerateAccessLink && !isAdminBackdatedBooking) {
        const expirationOwnerRole =
          user.rol === 'broker' || user.rol === 'agency'
            ? user.rol
            : user.rol === 'admin' && partnerType === 'broker'
              ? 'broker'
              : user.rol === 'admin' && partnerType === 'agency'
                ? 'agency'
                : user.rol;
        expiracion = getTimedBookingExpiration(startDate, expirationOwnerRole);
      }
      
      const bookingData = {
        numero_reserva: ref,
        cliente: {
          nombre: clientName,
          email: clientEmail,
          telefono: clientPhone,
          whatsapp: clientPhone,
          documento_identidad: clientDocument.trim(),
          direccion: clientAddress.trim(),
        },
        items: itemsWithNames,
        fecha_inicio: startDate,
        fecha_fin: endDate,
        precio_total: totalAmount,
        precio_alquiler: rentalTotal,
        instructor_total: instructorTotal,
        fuel_total: fuelTotal,
        delivery_total: deliveryTotal,
        nautical_license_required: nauticalLicenseRequired,
        deposito_total: 0,
        estado: user.rol === 'admin' && adminMarkedPaid ? 'confirmada' : 'pendiente',
        acuerdo_firmado: false,
        ...(user.rol === 'admin' && adminMarkedPaid ? { confirmado_en: serverTimestamp() } : {}),
        
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
        firma_cliente: null,
        terminos_aceptados: false,
        pago_realizado: adminMarkedPaid,
        ...(user.rol === 'admin' && adminMarkedPaid
          ? {
              pago_realizado_en: serverTimestamp(),
              pago_metodo: adminPaymentMethod,
            }
          : {}),
        requires_payment: user.rol === 'admin' ? !adminMarkedPaid : !bypassPaymentRequirement,
        
        // Reservation hold/expiration
        expiracion: expiracion,
        expirado: false,
        stock_released: false,

        notas: notes,
        creado_en: serverTimestamp(),
        creado_por: user.id,
        creado_por_nombre: creatorName.trim(),
        origen: 'panel',
        ...(token ? { token_acceso: token } : {}),
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
        const shouldReserveStock = !isAdminBackdatedBooking;
        if (shouldReserveStock) {
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
        } else {
          await setDoc(bookingRef, bookingData);
        }
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
      if (!bypassPaymentRequirement && token && !isAdminBackdatedBooking) {
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

      const contractUrl = token
        ? `${window.location.origin}/contract/${bookingId}?t=${token}`
        : undefined;
      void fetch('/api/notifications/booking-created', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          bookingId,
          token: token || undefined,
        }),
      }).catch((notificationError) => {
        console.error('Error sending booking notification:', notificationError);
      });
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
  const total = rentalTotal + instructorTotal + fuelTotal + deliveryTotal;
  const totalUnits = items.reduce((sum, item) => sum + Math.max(1, item.cantidad || 0), 0);
  const selectedProducts = items
    .map((item) => products.find((product) => product.id === item.producto_id))
    .filter((product): product is Product => Boolean(product));
  const selectedProductIds = new Set(items.map((item) => item.producto_id).filter(Boolean));
  const productPickerItems = useMemo(() => {
    const searchTerm = productSearch.trim().toLowerCase();

    return products
      .filter((product) => {
        if (!searchTerm) return true;
        return (
          product.nombre.toLowerCase().includes(searchTerm) ||
          product.tipo.toLowerCase().includes(searchTerm)
        );
      })
      .map((product) => {
        const stockInfo = product.id ? productStock[product.id] : undefined;
        const isOutOfStock = Boolean(stockInfo?.isOutOfStock);
        return {
          product,
          stockInfo,
          isOutOfStock,
          isSelected: Boolean(product.id && selectedProductIds.has(product.id)),
        };
      })
      .filter((entry) => showOutOfStockProducts || !entry.isOutOfStock || Boolean(productSearch.trim()))
      .sort((a, b) => {
        if (a.isOutOfStock !== b.isOutOfStock) return a.isOutOfStock ? 1 : -1;
        if (a.isSelected !== b.isSelected) return a.isSelected ? -1 : 1;
        return a.product.nombre.localeCompare(b.product.nombre, 'es');
      });
  }, [productSearch, productStock, products, selectedProductIds, showOutOfStockProducts]);
  const outOfStockCount = products.filter((product) => product.id && productStock[product.id]?.isOutOfStock).length;
  const availableProductCount = products.filter((product) => product.id && !productStock[product.id]?.isOutOfStock).length;
  const vatSummaryLabel =
    selectedProducts.length === 0 ? '' : 'IVA aplicado donde corresponde';
  const requiresLicenseUpload = items.some((item) => {
    const product = products.find((entry) => entry.id === item.producto_id);
    return doesBookingItemRequireNauticalLicense(item, product);
  });

  const copyText = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  if (successData) {
    const contractUrl = successData.contractUrl;

    return (
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[90vh]">
          <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-slate-50 rounded-t-2xl">
            <div>
              <h2 className="text-2xl font-bold text-gray-800">Reserva creada</h2>
              <p className="text-gray-500 text-sm mt-1">
                {contractUrl
                  ? 'Copia los enlaces antes de cerrar.'
                  : 'La reserva queda guardada y podras generar los enlaces mas tarde.'}
              </p>
            </div>
            <button
              onClick={onClose}
              className="btn-icon text-slate-500 hover:text-slate-700 hover:bg-slate-200"
            >
              <X size={24} />
            </button>
          </div>

          <div className="p-6 space-y-5">
            {contractUrl ? (
              <div className="border border-slate-200 rounded-xl p-4">
                <p className="text-sm font-semibold text-slate-700 mb-2">Enlace del contrato</p>
                <div className="flex flex-col md:flex-row gap-3">
                  <input
                    readOnly
                    value={contractUrl}
                    className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 bg-slate-50"
                  />
                  <button
                    type="button"
                    onClick={() => copyText(contractUrl)}
                    className="btn-primary"
                  >
                    Copiar
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                Para esta reserva no se ha creado ningun enlace automatico. El broker podra generar el
                contrato o el enlace de pago desde la ficha de la reserva cuando lo necesite.
              </div>
            )}

            <div className="text-xs text-slate-500">
              {contractUrl
                ? successData.paymentUrl
                  ? 'El enlace del contrato incluye el boton de pago.'
                  : 'El enlace del contrato permite firmar sin pago previo para este partner.'
                : 'No se ha generado ningun enlace de contrato ni de pago en este paso.'}
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
                    <div>
                      <label className="mb-2 block text-sm font-semibold text-slate-700">Passport / ID</label>
                      <input
                        type="text"
                        value={clientDocument}
                        onChange={(e) => setClientDocument(e.target.value)}
                        className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-lg text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
                        placeholder="Passport or ID number"
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-sm font-semibold text-slate-700">Email</label>
                      <input
                        type="email"
                        value={clientEmail}
                        onChange={(e) => setClientEmail(e.target.value)}
                        className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-lg text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
                        placeholder="Email"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="mb-2 block text-sm font-semibold text-slate-700">Dirección cliente</label>
                      <input
                        type="text"
                        value={clientAddress}
                        onChange={(e) => setClientAddress(e.target.value)}
                        className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-lg text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
                        placeholder="Dirección fiscal o domicilio"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="mb-2 block text-sm font-semibold text-slate-700">
                        Persona que crea la reserva
                      </label>
                      <input
                        type="text"
                        value={creatorName}
                        onChange={(e) => setCreatorName(e.target.value)}
                        className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-lg text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
                        placeholder="Nombre interno del empleado"
                      />
                      <p className="mt-1 text-xs text-slate-500">
                        Visible para el broker/agencia y para admin. Útil cuando varias personas usan el mismo acceso.
                      </p>
                    </div>
                  </div>
                </section>

                {user?.rol === 'admin' && (
                  <section className="rounded-3xl border border-slate-200 bg-white p-4 sm:p-6">
                    <h3 className="text-xl font-bold text-slate-900">Pago</h3>
                    <div className="mt-4 space-y-4">
                      <div>
                        <label className="mb-2 block text-sm font-semibold text-slate-700">Estado del pago</label>
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                          <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                            <input
                              type="radio"
                              name="adminPaymentStatus"
                              value="pending"
                              checked={adminPaymentStatus === 'pending'}
                              onChange={() => setAdminPaymentStatus('pending')}
                              className="h-5 w-5 border-gray-300 text-slate-900 focus:ring-slate-900/30"
                            />
                            <span className="text-base font-semibold text-slate-900">Pendiente de pago</span>
                          </label>
                          <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                            <input
                              type="radio"
                              name="adminPaymentStatus"
                              value="paid"
                              checked={adminPaymentStatus === 'paid'}
                              onChange={() => setAdminPaymentStatus('paid')}
                              className="h-5 w-5 border-gray-300 text-slate-900 focus:ring-slate-900/30"
                            />
                            <span className="text-base font-semibold text-slate-900">Ya pagada</span>
                          </label>
                        </div>
                      </div>

                      {adminPaymentStatus === 'paid' ? (
                        <div>
                          <label className="mb-2 block text-sm font-semibold text-slate-700">Metodo de pago</label>
                          <select
                            value={adminPaymentMethod}
                            onChange={(event) => setAdminPaymentMethod(event.target.value as PaymentMethod)}
                            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-lg text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
                          >
                            <option value="tarjeta">Tarjeta</option>
                            <option value="transferencia">Transferencia</option>
                            <option value="stripe">Stripe</option>
                            <option value="otro">Otro</option>
                          </select>
                        </div>
                      ) : (
                        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                          La reserva se guardara como pendiente de pago para que puedas cobrarla o actualizarla despues.
                        </div>
                      )}

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
                      min={isAdmin ? undefined : minDateStr}
                      onChange={(e) => {
                        const nextDate = e.target.value || (isAdmin ? todayDateStr : minDateStr);
                        const safeDate = isAdmin || nextDate >= minDateStr ? nextDate : minDateStr;
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
                        min={isAdmin ? startDate : startDate < minDateStr ? minDateStr : startDate}
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
                        const nextValue = e.target.value;
                        if (!isDeliveryLocation(nextValue)) return;
                        setDeliveryLocation(nextValue);
                        if (nextValue !== 'otro') setDeliveryLocationDetail('');
                      }}
                      className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-lg text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
                      required
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
                  </div>

                  {deliveryTotal > 0 ? (
                    <div className="md:col-span-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
                      Suplemento de entrega: €{deliveryTotal.toLocaleString('es-ES', { minimumFractionDigits: 2 })}
                    </div>
                  ) : null}

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
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <h3 className="text-xl font-bold text-slate-900">Productos</h3>
                      <p className="mt-1 text-sm text-slate-500">
                        Selecciona el material y ajusta cantidades sin duplicar líneas.
                      </p>
                    </div>
                    <button type="button" onClick={addItem} className="btn-primary w-full sm:w-auto">
                      <Plus size={16} />
                      {isProductPickerOpen ? 'Cerrar' : 'Añadir producto'}
                    </button>
                  </div>

                  {isProductPickerOpen && (
                    <div className="mt-4 rounded-3xl border border-slate-200 bg-slate-50/70 p-3 sm:p-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                          <div className="shrink-0 rounded-full bg-white px-3 py-2 ring-1 ring-slate-200">
                            Disponibles: <span className="text-slate-900">{availableProductCount}</span>
                          </div>
                          <div className="shrink-0 rounded-full bg-white px-3 py-2 ring-1 ring-slate-200">
                            Añadidos: <span className="text-slate-900">{items.length}</span>
                          </div>
                          <div className="shrink-0 rounded-full bg-white px-3 py-2 ring-1 ring-slate-200">
                            Sin stock: <span className="text-slate-900">{outOfStockCount}</span>
                          </div>
                        </div>

                        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                          <label className="relative block">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            <input
                              type="text"
                              value={productSearch}
                              onChange={(e) => setProductSearch(e.target.value)}
                              placeholder="Buscar producto"
                              className="w-full rounded-2xl border border-slate-200 bg-white py-2.5 pl-9 pr-4 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
                            />
                          </label>
                          {outOfStockCount > 0 ? (
                            <button
                              type="button"
                              onClick={() => setShowOutOfStockProducts((prev) => !prev)}
                              className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
                            >
                              {showOutOfStockProducts ? 'Ocultar sin stock' : `Ver sin stock (${outOfStockCount})`}
                            </button>
                          ) : null}
                        </div>
                      </div>

                      {productPickerItems.length === 0 ? (
                        <div className="mt-4 rounded-3xl border border-dashed border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-500">
                          No hay productos que coincidan con la búsqueda.
                        </div>
                      ) : (
                        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                          {productPickerItems.map(({ product, stockInfo, isOutOfStock, isSelected }) => (
                            <div
                              key={product.id}
                              className={`rounded-3xl border bg-white p-3.5 sm:p-4 transition ${
                                isSelected
                                  ? 'border-blue-200 ring-2 ring-blue-500/10'
                                  : 'border-slate-200 hover:border-slate-300 hover:shadow-sm'
                              } ${isOutOfStock ? 'opacity-70' : ''}`}
                            >
                              <div className="flex items-start gap-3">
                                <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl bg-slate-100 shadow-sm">
                                  {product.imagen_url ? (
                                    <img
                                      src={product.imagen_url}
                                      alt={product.nombre}
                                      className="h-full w-full object-cover"
                                    />
                                  ) : (
                                    <div className="flex h-full w-full items-center justify-center text-lg font-semibold text-slate-400">
                                      {product.nombre.slice(0, 2).toUpperCase()}
                                    </div>
                                  )}
                                </div>

                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                    <div className="min-w-0">
                                      <p className="truncate text-[17px] font-semibold text-slate-900">
                                        {product.nombre}
                                      </p>
                                      <p className="mt-1 text-sm font-medium text-slate-500">
                                        €{formatPrice(getDisplayedProductDayPrice(product))}/día
                                      </p>
                                      <p className="mt-2 text-[11px] uppercase tracking-[0.16em] text-slate-400">
                                        {isSelected ? 'Ya añadido' : product.tipo}
                                      </p>
                                    </div>
                                    <span
                                      className={`inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-semibold ${
                                        isOutOfStock
                                          ? 'bg-rose-50 text-rose-600'
                                          : stockInfo?.isLowStock
                                            ? 'bg-amber-50 text-amber-700'
                                            : 'bg-emerald-50 text-emerald-700'
                                      }`}
                                    >
                                      {isOutOfStock
                                        ? 'Sin stock'
                                        : stockInfo?.isLowStock
                                          ? `${stockInfo?.available ?? 0} uds`
                                          : `${stockInfo?.available ?? 0} disponibles`}
                                    </span>
                                  </div>

                                  <div className="mt-3 flex items-center justify-end">
                                    <button
                                      type="button"
                                      onClick={() => product.id && addItemWithProduct(product.id)}
                                      disabled={isOutOfStock}
                                      className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 px-3 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 sm:w-auto disabled:cursor-not-allowed disabled:border-slate-100 disabled:bg-slate-50 disabled:text-slate-400"
                                    >
                                      <Plus size={14} />
                                      {isSelected ? 'Sumar' : 'Añadir'}
                                    </button>
                                  </div>
                                  {supportsEfoilBatteryOption(product) && product.efoil_battery?.trim() ? (
                                    <div className="mt-3 rounded-2xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
                                      Batería / autonomía: {product.efoil_battery.trim()}
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="mt-4 space-y-4">
                    {items.length > 0 ? (
                      <div className="rounded-3xl border border-slate-200 bg-slate-50/70 p-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <p className="text-base font-semibold text-slate-900">
                              Tu selección
                            </p>
                            <p className="mt-1 text-sm text-slate-500">
                              {items.length} {items.length === 1 ? 'producto' : 'productos'} · {totalUnits} {totalUnits === 1 ? 'unidad' : 'unidades'}
                            </p>
                          </div>
                          <div className="grid grid-cols-4 gap-2 text-xs sm:min-w-[420px]">
                            <div className="rounded-2xl bg-white px-3 py-2 ring-1 ring-slate-200">
                              <p className="uppercase tracking-[0.12em] text-slate-400">Alquiler</p>
                              <p className="mt-1 text-sm font-semibold text-slate-900">
                                €{rentalTotal.toLocaleString('es-ES', { minimumFractionDigits: 2 })}
                              </p>
                            </div>
                            <div className="rounded-2xl bg-white px-3 py-2 ring-1 ring-slate-200">
                              <p className="uppercase tracking-[0.12em] text-slate-400">Extras</p>
                              <p className="mt-1 text-sm font-semibold text-slate-900">
                                €{(instructorTotal + fuelTotal).toLocaleString('es-ES', { minimumFractionDigits: 2 })}
                              </p>
                            </div>
                            <div className="rounded-2xl bg-white px-3 py-2 ring-1 ring-slate-200">
                              <p className="uppercase tracking-[0.12em] text-slate-400">Entrega</p>
                              <p className="mt-1 text-sm font-semibold text-slate-900">
                                €{deliveryTotal.toLocaleString('es-ES', { minimumFractionDigits: 2 })}
                              </p>
                            </div>
                            <div className="rounded-2xl bg-slate-900 px-3 py-2 text-white">
                              <p className="uppercase tracking-[0.12em] text-slate-300">Total</p>
                              <p className="mt-1 text-sm font-semibold">
                                €{total.toLocaleString('es-ES', { minimumFractionDigits: 2 })}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {items.map((item, index) => {
                      const selectedProduct = products.find((p) => p.id === item.producto_id);
                      const stockInfo = selectedProduct?.id ? productStock[selectedProduct.id] : null;
                      const canAddInstructor = hasInstructorOption(selectedProduct);
                      const canAddFuel = hasFuelOption(selectedProduct);
                      const hasBatteryInfo = supportsEfoilBatteryOption(selectedProduct) && Boolean(selectedProduct?.efoil_battery?.trim());
                      const requiresLicense = doesBookingItemRequireNauticalLicense(item, selectedProduct);
                      const rentalSubtotal = getItemSubtotal(item, selectedProduct);
                      const instructorSubtotal = getItemInstructorSubtotal(item, selectedProduct);
                      const fuelSubtotal = getItemFuelSubtotal(item, selectedProduct);
                      const itemTotal = rentalSubtotal + instructorSubtotal + fuelSubtotal;

                      return (
                        <div key={index} className="rounded-3xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
                          <div className="flex flex-col gap-4">
                            <div className="flex items-start gap-3">
                              <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
                                {selectedProduct?.imagen_url ? (
                                  <img
                                    src={selectedProduct.imagen_url}
                                    alt={selectedProduct.nombre}
                                    className="h-full w-full object-cover"
                                  />
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center text-lg font-semibold text-slate-400">
                                    {(selectedProduct?.nombre || 'PR').slice(0, 2).toUpperCase()}
                                  </div>
                                )}
                              </div>

                              <div className="min-w-0 flex-1">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <p className="truncate text-lg font-semibold text-slate-900">
                                      {selectedProduct?.nombre || 'Producto'}
                                    </p>
                                    <p className="mt-1 text-sm text-slate-500">
                                      €{formatPrice(getDisplayedProductDayPrice(selectedProduct))}/día · {getBookingDayCount(startDate, endDate)} {getBookingDayCount(startDate, endDate) === 1 ? 'día' : 'días'}
                                    </p>
                                  </div>
                                  <div className="text-right">
                                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
                                      Subtotal
                                    </p>
                                    <p className="mt-1 text-lg font-semibold text-slate-900">
                                      €{itemTotal.toLocaleString('es-ES', { minimumFractionDigits: 2 })}
                                    </p>
                                  </div>
                                </div>

                                <div className="mt-3 flex flex-wrap items-center gap-2">
                                  {stockInfo?.isOutOfStock ? (
                                    <span className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-600">
                                      Sin stock
                                    </span>
                                  ) : stockInfo?.isLowStock ? (
                                    <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
                                      Poco stock: {stockInfo.available}
                                    </span>
                                  ) : stockInfo ? (
                                    <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                                      {stockInfo.available} disponibles
                                    </span>
                                  ) : null}
                                  <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400 ring-1 ring-slate-200">
                                    {selectedProduct?.tipo || 'producto'}
                                  </span>
                                </div>
                                {hasBatteryInfo ? (
                                  <div className="mt-3 rounded-2xl bg-white px-3 py-2 text-sm text-slate-600 ring-1 ring-slate-200">
                                    Batería / autonomía: {selectedProduct?.efoil_battery?.trim()}
                                  </div>
                                ) : null}
                              </div>
                            </div>

                            <div className="flex flex-col gap-3 rounded-2xl bg-white p-3 ring-1 ring-slate-200 sm:flex-row sm:items-center sm:justify-between">
                              <div>
                                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
                                  Cantidad
                                </p>
                                <div className="mt-2 inline-flex items-center rounded-2xl border border-slate-200 bg-slate-50">
                                  <button
                                    type="button"
                                    onClick={() => updateItemQuantity(index, item.cantidad - 1)}
                                    className="flex h-10 w-10 items-center justify-center text-slate-600 transition hover:text-slate-900"
                                    disabled={item.cantidad <= 1}
                                  >
                                    <Minus size={16} />
                                  </button>
                                  <input
                                    type="number"
                                    min="1"
                                    max={stockInfo?.available || 999}
                                    value={item.cantidad}
                                    onChange={(e) => updateItemQuantity(index, Number(e.target.value || 1))}
                                    className="h-10 w-14 border-x border-slate-200 bg-white text-center text-base font-semibold text-slate-900 outline-none"
                                    disabled={!item.producto_id}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => updateItemQuantity(index, item.cantidad + 1)}
                                    className="flex h-10 w-10 items-center justify-center text-slate-600 transition hover:text-slate-900"
                                    disabled={Boolean(stockInfo && item.cantidad >= stockInfo.available)}
                                  >
                                    <Plus size={16} />
                                  </button>
                                </div>
                              </div>

                              <button
                                type="button"
                                onClick={() => removeItem(index)}
                                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700"
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
                                <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-4 transition hover:border-slate-300">
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
                                      {selectedProduct?.instructor_incluir_iva ? ' · IVA incl.' : ''}
                                    </div>
                                    {instructorSubtotal > 0 ? (
                                      <div className="mt-1 text-xs font-medium text-slate-700">
                                        Total extra: €{instructorSubtotal.toLocaleString('es-ES', { minimumFractionDigits: 2 })}
                                      </div>
                                    ) : null}
                                  </div>
                                </label>
                              )}

                              {canAddFuel && (
                                <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-4 transition hover:border-slate-300">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(item.fuel_requested)}
                                    onChange={(e) => updateItem(index, 'fuel_requested', e.target.checked)}
                                    className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                  />
                                  <div>
                                    <div className="font-semibold text-slate-900">Fuel</div>
                                    <div className="text-sm text-slate-500">
                                      €{formatPrice(Number(selectedProduct?.fuel_price_per_day || 0))}/día · sin IVA
                                    </div>
                                    {fuelSubtotal > 0 ? (
                                      <div className="mt-1 text-xs font-medium text-slate-700">
                                        Total extra: €{fuelSubtotal.toLocaleString('es-ES', { minimumFractionDigits: 2 })}
                                      </div>
                                    ) : null}
                                  </div>
                                </label>
                              )}
                            </div>
                          )}

                          {requiresLicense ? (
                            <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-700">
                              Obligatorio licencia náutica.
                            </div>
                          ) : null}
                        </div>
                      );
                    })}

                    {!isProductPickerOpen && items.length === 0 ? (
                      <div className="rounded-3xl border-2 border-dashed border-slate-200 bg-white px-6 py-12 text-center">
                        <p className="text-base font-semibold text-slate-900">Todavía no has añadido productos</p>
                        <p className="mt-2 text-sm text-slate-500">
                          Usa el botón &quot;Añadir producto&quot; para abrir el selector.
                        </p>
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
                    {instructorTotal > 0
                      ? `Monitor €${instructorTotal.toLocaleString('es-ES', { minimumFractionDigits: 2 })}`
                      : ''}
                    {instructorTotal > 0 && fuelTotal > 0 ? ' · ' : ''}
                    {fuelTotal > 0 ? `Fuel €${fuelTotal.toLocaleString('es-ES', { minimumFractionDigits: 2 })}` : ''}
                  </div>
                )}
                {deliveryTotal > 0 ? (
                  <div className="mt-1 text-sm text-slate-500">
                    Entrega €{deliveryTotal.toLocaleString('es-ES', { minimumFractionDigits: 2 })}
                  </div>
                ) : null}
                {requiresLicenseUpload ? (
                  <div className="mt-2 text-sm font-medium text-amber-700">Obligatorio licencia náutica</div>
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
