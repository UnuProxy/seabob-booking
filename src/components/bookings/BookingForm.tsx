'use client';

import { useState, useEffect } from 'react';
import { collection, addDoc, getDocs, query, where, serverTimestamp, doc, updateDoc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { Product, BookingItem, RentalType } from '@/types';
import { useAuthStore } from '@/store/authStore';
import { X, Plus, Trash2, Calendar, User, CreditCard, Save, Loader2, ShoppingBag, MapPin, Anchor } from 'lucide-react';
import { format, addDays, differenceInDays } from 'date-fns';

interface BookingFormProps {
  onClose: () => void;
  onSuccess: () => void;
}

export function BookingForm({ onClose, onSuccess }: BookingFormProps) {
  const { user } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState('');

  // Form State
  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  
  const [startDate, setStartDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(addDays(new Date(), 1), 'yyyy-MM-dd')); // Default 1 day
  const [items, setItems] = useState<BookingItem[]>([]);
  
  // Delivery Details
  const [deliveryLocation, setDeliveryLocation] = useState<'marina_ibiza' | 'marina_botafoch' | 'club_nautico' | 'otro'>('marina_ibiza');
  const [boatName, setBoatName] = useState('');
  const [dockingNumber, setDockingNumber] = useState('');
  const [deliveryTime, setDeliveryTime] = useState('09:00'); // Default 9 AM
  
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<'pendiente' | 'confirmada'>('confirmada');

  // Fetch products
  useEffect(() => {
    const fetchProducts = async () => {
      try {
        const q = query(collection(db, 'products'), where('activo', '==', true));
        const snapshot = await getDocs(q);
        setProducts(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Product)));
      } catch (err) {
        console.error(err);
        setError('Error al cargar productos');
      }
    };
    fetchProducts();
  }, []);

  const addItem = () => {
    if (products.length === 0) return;
    setItems([
      ...items, 
      { 
        producto_id: products[0].id, 
        cantidad: 1, 
        tipo_alquiler: 'dia', 
        duracion: 1 
      }
    ]);
  };

  const updateItem = (index: number, field: keyof BookingItem, value: any) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], [field]: value };
    setItems(newItems);
  };

  const removeItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  // Calculate Total
  const calculateTotal = () => {
    return items.reduce((acc, item) => {
      const product = products.find(p => p.id === item.producto_id);
      if (!product) return acc;

      let price = 0;
      if (item.tipo_alquiler === 'dia') {
        const start = new Date(startDate);
        const end = new Date(endDate);
        const days = Math.max(1, differenceInDays(end, start));
        price = product.precio_diario * days * item.cantidad;
      } else {
        price = product.precio_hora * item.duracion * item.cantidad;
      }
      return acc + price;
    }, 0);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!clientName || !clientEmail) {
      setError('El nombre y email del cliente son obligatorios');
      return;
    }
    if (items.length === 0) {
      setError('Debes añadir al menos un producto');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Generate Ref
      const ref = `RES-${format(new Date(), 'ddMMyy')}-${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
      
      // Generate secure token for public access
      const token = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

      const totalAmount = calculateTotal();
      
      const bookingData = {
        numero_reserva: ref,
        cliente: {
          nombre: clientName,
          email: clientEmail,
          telefono: clientPhone,
          whatsapp: clientPhone
        },
        items,
        fecha_inicio: startDate,
        fecha_fin: endDate,
        precio_total: totalAmount,
        estado: status,
        acuerdo_firmado: false,
        
        // Delivery Details
        ubicacion_entrega: deliveryLocation,
        nombre_barco: boatName,
        numero_amarre: dockingNumber,
        hora_entrega: deliveryTime,
        
        // Public Contract
        token_acceso: token,
        firma_cliente: null,
        terminos_aceptados: false,
        pago_realizado: false,

        notas: notes,
        creado_en: serverTimestamp(),
        creado_por: user.id
      };

      // 1. Create booking
      const docRef = await addDoc(collection(db, 'bookings'), bookingData);
      const bookingId = docRef.id;

      // 2. Generate Stripe payment link
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
          }),
        });

        if (response.ok) {
          const { checkout_url, session_id } = await response.json();
          
          // Update booking with payment link
          await updateDoc(doc(db, 'bookings', bookingId), {
            stripe_checkout_session_id: session_id,
            stripe_payment_link: checkout_url,
          });
        } else {
          console.error('Failed to create payment link');
          // Continue anyway - booking is created, payment link can be generated later
        }
      } catch (paymentError) {
        console.error('Error creating payment link:', paymentError);
        // Continue anyway - booking is created
      }
      
      onSuccess();
      onClose();
    } catch (err) {
      console.error(err);
      setError('Error al crear la reserva. Inténtalo de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  const total = calculateTotal();
  const dayCount = Math.max(1, differenceInDays(new Date(endDate), new Date(startDate)));

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-slate-50 rounded-t-2xl">
          <div>
            <h2 className="text-2xl font-bold text-gray-800">Nueva Reserva</h2>
            <p className="text-gray-500 text-sm mt-1">Rellena los datos para crear un nuevo alquiler.</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded-full p-2 transition-colors">
            <X size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-8 space-y-8">
          {error && (
            <div className="bg-red-50 text-red-700 p-4 rounded-xl flex items-center gap-2 border border-red-100">
              <ShoppingBag size={20} />
              {error}
            </div>
          )}

          {/* Section 1: Client Info */}
          <section>
            <h3 className="flex items-center gap-2 text-lg font-bold text-gray-800 mb-4">
              <User className="text-blue-600" size={20} />
              Datos del Cliente
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Nombre Completo</label>
                <input
                  type="text"
                  value={clientName}
                  onChange={e => setClientName(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 transition-all outline-none font-medium text-gray-900"
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
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 transition-all outline-none font-medium text-gray-900"
                  placeholder="juan@ejemplo.com"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Teléfono / WhatsApp</label>
                <input
                  type="tel"
                  value={clientPhone}
                  onChange={e => setClientPhone(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 transition-all outline-none font-medium text-gray-900"
                  placeholder="+34 600 000 000"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Estado Inicial</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as any)}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 transition-all outline-none font-medium text-gray-900"
                >
                  <option value="confirmada">Confirmada</option>
                  <option value="pendiente">Pendiente</option>
                </select>
              </div>
            </div>
          </section>

          <hr className="border-gray-100" />

          {/* Section 2: Dates & Details */}
          <section>
            <h3 className="flex items-center gap-2 text-lg font-bold text-gray-800 mb-4">
              <Calendar className="text-blue-600" size={20} />
              Fechas del Alquiler
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Fecha Inicio</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 transition-all outline-none font-medium text-gray-900"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Fecha Fin</label>
                <input
                  type="date"
                  value={endDate}
                  min={startDate}
                  onChange={e => setEndDate(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 transition-all outline-none font-medium text-gray-900"
                  required
                />
              </div>
            </div>
            <p className="mt-3 text-sm text-gray-500 bg-blue-50 inline-block px-3 py-1 rounded-lg border border-blue-100">
              Duración: <span className="font-bold text-blue-700">{dayCount} {dayCount === 1 ? 'día' : 'días'}</span>
            </p>
          </section>

          <hr className="border-gray-100" />

          {/* Section 3: Delivery Details */}
          <section>
             <h3 className="flex items-center gap-2 text-lg font-bold text-gray-800 mb-4">
                <Anchor className="text-blue-600" size={20} />
                Detalles de Entrega
             </h3>
             <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                   <label className="block text-sm font-semibold text-gray-700 mb-2">Ubicación *</label>
                   <select
                      value={deliveryLocation}
                      onChange={(e) => setDeliveryLocation(e.target.value as any)}
                      className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 transition-all outline-none font-medium text-gray-900"
                      required
                   >
                      <option value="marina_ibiza">Marina Ibiza</option>
                      <option value="marina_botafoch">Marina Botafoch</option>
                      <option value="club_nautico">Club Náutico</option>
                      <option value="otro">Otro</option>
                   </select>
                </div>
                <div>
                   <label className="block text-sm font-semibold text-gray-700 mb-2">Hora de Entrega *</label>
                   <input
                      type="time"
                      value={deliveryTime}
                      onChange={e => setDeliveryTime(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 transition-all outline-none font-medium text-gray-900"
                      required
                   />
                   <p className="text-xs text-gray-500 mt-1">Hora a la que se entregará el equipo</p>
                </div>
                <div>
                   <label className="block text-sm font-semibold text-gray-700 mb-2">Nombre del Barco</label>
                   <input
                      type="text"
                      value={boatName}
                      onChange={e => setBoatName(e.target.value)}
                      placeholder="Ej: Blue Pearl"
                      className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 transition-all outline-none font-medium text-gray-900"
                   />
                </div>
                <div>
                   <label className="block text-sm font-semibold text-gray-700 mb-2">Número de Amarre</label>
                   <input
                      type="text"
                      value={dockingNumber}
                      onChange={e => setDockingNumber(e.target.value)}
                      placeholder="Ej: H-12"
                      className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 transition-all outline-none font-medium text-gray-900"
                   />
                </div>
             </div>
          </section>

          <hr className="border-gray-100" />

          {/* Section 4: Items */}
          <section>
            <div className="flex justify-between items-center mb-4">
              <h3 className="flex items-center gap-2 text-lg font-bold text-gray-800">
                <ShoppingBag className="text-blue-600" size={20} />
                Productos
              </h3>
              <button
                type="button"
                onClick={addItem}
                className="text-sm font-semibold text-blue-600 hover:text-blue-700 hover:bg-blue-50 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1"
              >
                <Plus size={16} /> Añadir Producto
              </button>
            </div>

            <div className="space-y-4">
              {items.map((item, index) => (
                <div key={index} className="flex flex-col md:flex-row gap-4 items-start md:items-end bg-gray-50 p-4 rounded-xl border border-gray-100 relative group">
                  <div className="flex-1 w-full">
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Producto</label>
                    <select
                      value={item.producto_id}
                      onChange={(e) => updateItem(index, 'producto_id', e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none text-gray-900 font-medium"
                    >
                      {products.map(p => (
                        <option key={p.id} value={p.id}>{p.nombre} - €{p.precio_diario}/día</option>
                      ))}
                    </select>
                  </div>
                  
                  <div className="w-full md:w-32">
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Cantidad</label>
                    <input
                      type="number"
                      min="1"
                      value={item.cantidad}
                      onChange={(e) => updateItem(index, 'cantidad', parseInt(e.target.value))}
                      className="w-full px-3 py-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none text-gray-900 font-medium"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => removeItem(index)}
                    className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors absolute top-2 right-2 md:static"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              ))}

              {items.length === 0 && (
                <div className="text-center py-8 bg-gray-50 border-2 border-dashed border-gray-200 rounded-xl text-gray-400">
                  No hay productos seleccionados. Añade uno para continuar.
                </div>
              )}
            </div>
          </section>
          
          {/* Section 5: Notes */}
          <section>
             <h3 className="text-sm font-bold text-gray-700 mb-2">Notas Adicionales</h3>
             <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 transition-all outline-none text-gray-900"
                placeholder="Instrucciones especiales..."
             />
          </section>

        </form>

        {/* Footer */}
        <div className="p-6 border-t border-gray-100 bg-white rounded-b-2xl flex justify-between items-center">
          <div className="flex flex-col">
            <span className="text-sm text-gray-500 font-medium">Total Estimado</span>
            <span className="text-3xl font-bold text-slate-900">€{total.toLocaleString('es-ES', { minimumFractionDigits: 2 })}</span>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-3 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-xl transition-colors font-semibold"
            >
              Cancelar
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading || items.length === 0}
              className="px-8 py-3 bg-slate-900 text-white rounded-xl hover:bg-slate-800 hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0 transition-all font-semibold flex items-center gap-2 disabled:opacity-50 disabled:hover:transform-none disabled:shadow-none"
            >
              {loading ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
              Crear Reserva
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
