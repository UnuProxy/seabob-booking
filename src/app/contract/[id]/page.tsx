'use client';

import { useState, useEffect, useRef } from 'react';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { Booking } from '@/types';
import { useParams, useSearchParams } from 'next/navigation';
import { Loader2, CheckCircle, AlertCircle, PenTool, Calendar, MapPin, Anchor, ShoppingBag, Download, CreditCard, ExternalLink } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

export default function ContractPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const id = params?.id as string;
  const token = searchParams.get('t');
  const paymentStatus = searchParams.get('payment');

  const [booking, setBooking] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  // Canvas Refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  // Helper to safely convert Firestore timestamp to Date
  const getDate = (timestamp: any): Date => {
    if (!timestamp) return new Date();
    
    // Firestore Timestamp
    if (timestamp && typeof timestamp.toDate === 'function') {
      return timestamp.toDate();
    }
    
    // Already a Date
    if (timestamp instanceof Date) {
      return timestamp;
    }
    
    // String or number
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) {
      return new Date();
    }
    
    return date;
  };

  useEffect(() => {
    const fetchBooking = async () => {
      try {
        if (!id) return;
        const docRef = doc(db, 'bookings', id);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
          const data = { id: docSnap.id, ...docSnap.data() } as Booking;
          
          // Verify Token
          if (data.token_acceso && data.token_acceso !== token) {
            setError('Enlace inválido o expirado.');
            setLoading(false);
            return;
          }

          setBooking(data);
          if (data.acuerdo_firmado) {
            setSuccess(true);
          }
          
          // If payment was just completed, refresh to show updated status
          if (paymentStatus === 'success') {
            // Refetch to get updated payment status
            setTimeout(() => {
              fetchBooking();
            }, 2000);
          }
        } else {
          setError('Reserva no encontrada.');
        }
      } catch (err) {
        console.error(err);
        setError('Error al cargar la reserva.');
      } finally {
        setLoading(false);
      }
    };

    fetchBooking();
  }, [id, token, paymentStatus]);

  // Canvas Logic
  const getCoordinates = (e: any, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    let clientX, clientY;
    if (e.touches && e.touches[0]) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    return {
      offsetX: (clientX - rect.left) * scaleX,
      offsetY: (clientY - rect.top) * scaleY
    };
  };

  const startDrawing = (e: any) => {
    e.preventDefault(); // Prevent scrolling on touch
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set style
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#000';

    setIsDrawing(true);
    const { offsetX, offsetY } = getCoordinates(e, canvas);
    ctx.beginPath();
    ctx.moveTo(offsetX, offsetY);
  };

  const draw = (e: any) => {
    if (!isDrawing) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { offsetX, offsetY } = getCoordinates(e, canvas);
    ctx.lineTo(offsetX, offsetY);
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
    if (canvasRef.current) {
        setSignature(canvasRef.current.toDataURL());
    }
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
      setSignature(null);
    }
  };

  const handleSubmit = async () => {
    if (!booking || !signature || !termsAccepted) return;
    
    setSubmitting(true);
    try {
      await updateDoc(doc(db, 'bookings', booking.id), {
        acuerdo_firmado: true,
        firma_cliente: signature,
        terminos_aceptados: true,
        terminos_aceptados_en: serverTimestamp(),
        estado: 'confirmada'
      });
      setSuccess(true);
    } catch (err) {
      console.error(err);
      alert('Error al guardar el contrato.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin text-blue-600" size={40} /></div>;
  if (error) return <div className="min-h-screen flex items-center justify-center text-red-600 font-bold">{error}</div>;
  if (!booking) return null;

  if (success) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl text-center max-w-md w-full">
          <div className="bg-green-100 p-4 rounded-full inline-flex mb-4">
            <CheckCircle size={48} className="text-green-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">¡Contrato Firmado!</h1>
          <p className="text-gray-600 mb-6">Gracias, {booking.cliente.nombre}. Tu reserva ha sido confirmada correctamente.</p>
          
          <div className="bg-blue-50 p-4 rounded-xl text-left mb-6">
            <h3 className="font-bold text-blue-900 text-sm uppercase mb-2">Siguientes Pasos</h3>
            <ul className="text-sm text-blue-800 space-y-2 list-disc pl-4">
              <li>Recibirás un email con los detalles.</li>
              <li>El pago se realizará según lo acordado.</li>
              <li>Nos vemos en <strong>{booking.ubicacion_entrega?.replace('_', ' ')}</strong> el {format(new Date(booking.fecha_inicio), 'dd/MM/yyyy')}.</li>
            </ul>
          </div>
          
          <button onClick={() => window.print()} className="w-full py-3 bg-gray-900 text-white rounded-xl font-bold flex items-center justify-center gap-2">
            <Download size={20} /> Descargar Copia
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4 md:px-8">
      <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-xl overflow-hidden">
        {/* Header */}
        <div className="bg-slate-900 text-white p-6 md:p-8">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold mb-2">Contrato de Alquiler</h1>
              <p className="text-slate-400">Referencia: {booking.numero_reserva}</p>
            </div>
            <div className="h-12 w-12 bg-white rounded-lg flex items-center justify-center text-slate-900 font-bold">SB</div>
          </div>
        </div>

        <div className="p-6 md:p-8 space-y-8">
          
          {/* Client Details */}
          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-4 border-b pb-2">Datos del Cliente</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <span className="block text-gray-500">Nombre</span>
                <span className="font-semibold text-gray-900">{booking.cliente.nombre}</span>
              </div>
              <div>
                <span className="block text-gray-500">Email</span>
                <span className="font-semibold text-gray-900">{booking.cliente.email}</span>
              </div>
              <div>
                <span className="block text-gray-500">Teléfono</span>
                <span className="font-semibold text-gray-900">{booking.cliente.telefono}</span>
              </div>
            </div>
          </section>

          {/* Delivery Details */}
          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-4 border-b pb-2 flex items-center gap-2">
               <Anchor size={20} className="text-blue-600" />
               Detalles de Entrega
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-sm bg-blue-50 p-4 rounded-xl">
              <div>
                <span className="block text-blue-600 font-bold text-xs uppercase mb-1">Ubicación</span>
                <span className="font-bold text-gray-900 text-lg">
                  {booking.ubicacion_entrega === 'marina_ibiza' ? 'Marina Ibiza' : 
                   booking.ubicacion_entrega === 'marina_botafoch' ? 'Marina Botafoch' : 
                   booking.ubicacion_entrega === 'club_nautico' ? 'Club Náutico' : 'Otro'}
                </span>
              </div>
              {booking.hora_entrega && (
                <div>
                  <span className="block text-blue-600 font-bold text-xs uppercase mb-1">Hora de Entrega</span>
                  <span className="font-bold text-gray-900 text-lg">{booking.hora_entrega}</span>
                </div>
              )}
              {booking.nombre_barco && (
                <div>
                  <span className="block text-blue-600 font-bold text-xs uppercase mb-1">Barco</span>
                  <span className="font-semibold text-gray-900">{booking.nombre_barco}</span>
                </div>
              )}
              {booking.numero_amarre && (
                <div>
                  <span className="block text-blue-600 font-bold text-xs uppercase mb-1">Amarre</span>
                  <span className="font-semibold text-gray-900">{booking.numero_amarre}</span>
                </div>
              )}
            </div>
          </section>

          {/* Booking Items */}
          <section>
             <h2 className="text-lg font-bold text-gray-900 mb-4 border-b pb-2">Resumen del Alquiler</h2>
             <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                {booking.items.map((item, idx) => (
                   <div key={idx} className="flex justify-between items-center text-sm">
                      <span className="font-medium text-gray-900">{item.cantidad}x Producto ID: {item.producto_id}</span>
                   </div>
                ))}
                <div className="border-t border-gray-200 pt-3 mt-3 flex justify-between items-center">
                   <span className="font-bold text-gray-900">Total a Pagar</span>
                   <span className="font-bold text-xl text-gray-900">€{booking.precio_total}</span>
                </div>
             </div>
          </section>

          {/* Payment Section */}
          <section>
             <h2 className="text-lg font-bold text-gray-900 mb-4 border-b pb-2 flex items-center gap-2">
                <CreditCard size={20} className="text-blue-600" />
                Pago
             </h2>
             {booking.pago_realizado ? (
                <div className="bg-green-50 border-2 border-green-200 rounded-xl p-4 flex items-center gap-3">
                   <div className="bg-green-100 p-2 rounded-lg">
                      <CheckCircle size={24} className="text-green-600" />
                   </div>
                   <div>
                      <div className="font-bold text-green-700">Pago Confirmado</div>
                      <div className="text-sm text-green-600">
                         {booking.pago_realizado_en && 
                            `Pagado el ${format(getDate(booking.pago_realizado_en), 'dd MMM yyyy', { locale: es })}`
                         }
                      </div>
                   </div>
                </div>
             ) : booking.stripe_payment_link ? (
                <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-4">
                   <div className="flex items-center justify-between mb-3">
                      <div>
                         <div className="font-bold text-blue-900 mb-1">Pago Pendiente</div>
                         <div className="text-sm text-blue-700">Total: €{booking.precio_total.toLocaleString('es-ES', { minimumFractionDigits: 2 })}</div>
                      </div>
                      <div className="bg-blue-100 p-2 rounded-lg">
                         <CreditCard size={24} className="text-blue-600" />
                      </div>
                   </div>
                   <a
                      href={booking.stripe_payment_link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 shadow-lg hover:shadow-xl transition-all flex items-center justify-center gap-2"
                   >
                      <ExternalLink size={20} />
                      Realizar Pago Ahora
                   </a>
                   <p className="text-xs text-blue-600 mt-2 text-center">Serás redirigido a Stripe para completar el pago de forma segura.</p>
                </div>
             ) : (
                <div className="bg-yellow-50 border-2 border-yellow-200 rounded-xl p-4 text-center">
                   <div className="text-yellow-700 font-medium">Enlace de pago no disponible</div>
                   <div className="text-sm text-yellow-600 mt-1">Contacta con el agente para realizar el pago.</div>
                </div>
             )}
          </section>

          {/* Terms */}
          <section>
             <h2 className="text-lg font-bold text-gray-900 mb-4 border-b pb-2">Términos y Condiciones</h2>
             <div className="h-40 overflow-y-auto bg-gray-50 p-4 rounded-xl text-xs text-gray-600 border border-gray-200">
                <p className="mb-2"><strong>1. OBJETO DEL CONTRATO:</strong> El arrendador cede en alquiler el equipo descrito...</p>
                <p className="mb-2"><strong>2. PAGO:</strong> El pago se realizará por adelantado...</p>
                <p className="mb-2"><strong>3. RESPONSABILIDAD:</strong> El arrendatario es responsable de cualquier daño...</p>
                <p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.</p>
             </div>
             <div className="mt-4 flex items-center gap-3">
                <input 
                   type="checkbox" 
                   id="terms" 
                   checked={termsAccepted}
                   onChange={e => setTermsAccepted(e.target.checked)}
                   className="w-5 h-5 text-blue-600 rounded focus:ring-blue-500 border-gray-300 cursor-pointer"
                />
                <label htmlFor="terms" className="text-sm text-gray-700 font-medium select-none cursor-pointer">
                   He leído y acepto los términos y condiciones del servicio.
                </label>
             </div>
          </section>

          {/* Signature */}
          <section>
             <h2 className="text-lg font-bold text-gray-900 mb-4 border-b pb-2 flex items-center gap-2">
                <PenTool size={20} className="text-blue-600" />
                Firma Digital
             </h2>
             <div className="border-2 border-dashed border-gray-300 rounded-xl bg-gray-50 relative overflow-hidden touch-none">
                <canvas
                   ref={canvasRef}
                   width={600}
                   height={200}
                   className="w-full h-48 cursor-crosshair touch-none"
                   onMouseDown={startDrawing}
                   onMouseMove={draw}
                   onMouseUp={stopDrawing}
                   onMouseLeave={stopDrawing}
                   onTouchStart={startDrawing}
                   onTouchMove={draw}
                   onTouchEnd={stopDrawing}
                />
                {!signature && !isDrawing && (
                   <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <p className="text-gray-400 text-sm">Firma aquí (dedo o ratón)</p>
                   </div>
                )}
                <button 
                   onClick={clearSignature}
                   className="absolute top-2 right-2 text-xs text-red-500 hover:bg-red-50 px-2 py-1 rounded border border-red-200"
                >
                   Borrar
                </button>
             </div>
             <p className="text-xs text-gray-500 mt-2">* Al firmar, aceptas la responsabilidad sobre el equipo alquilado.</p>
          </section>

          {/* Submit */}
          <div className="pt-6 border-t border-gray-100">
             <button
                onClick={handleSubmit}
                disabled={!termsAccepted || !signature || submitting}
                className="w-full py-4 bg-slate-900 text-white rounded-xl font-bold text-lg hover:bg-slate-800 shadow-xl hover:-translate-y-1 transition-all disabled:opacity-50 disabled:transform-none disabled:shadow-none flex items-center justify-center gap-3"
             >
                {submitting ? <Loader2 className="animate-spin" size={24} /> : <CheckCircle size={24} />}
                Confirmar y Firmar Contrato
             </button>
          </div>

        </div>
      </div>
    </div>
  );
}

