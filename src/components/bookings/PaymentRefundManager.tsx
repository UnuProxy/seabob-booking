'use client';

import { useState } from 'react';
import { collection, doc, getDocs, query, serverTimestamp, updateDoc, where, documentId } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { Booking, PaymentMethod } from '@/types';
import { calculateCommissionTotal, calculateCommissionTotalWithProducts } from '@/lib/commission';
import { releaseBookingStockOnce } from '@/lib/bookingStock';
import {
  CreditCard,
  Euro,
  CheckCircle,
  XCircle,
  RefreshCcw,
  AlertCircle,
  Wallet,
  Building2,
  MoreHorizontal,
} from 'lucide-react';
import clsx from 'clsx';

interface PaymentRefundManagerProps {
  booking: Booking;
  onClose: () => void;
  onUpdate?: () => void;
}

export function PaymentRefundManager({ booking, onClose, onUpdate }: PaymentRefundManagerProps) {
  const getDateValue = (value: any): Date | null => {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (value?.toDate) return value.toDate();
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };
  const [loading, setLoading] = useState(false);
  const [depositLoading, setDepositLoading] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  // Payment form
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('transferencia');
  const [paymentReference, setPaymentReference] = useState('');
  
  // Refund form
  const rentalTotal = booking.precio_total || 0;
  const depositTotal = booking.deposito_total || 0;
  const maxRefundable = rentalTotal;
  const [refundAmount, setRefundAmount] = useState(maxRefundable.toString());
  const [refundMethod, setRefundMethod] = useState<PaymentMethod>('transferencia');
  const [refundReason, setRefundReason] = useState('');
  const [refundReference, setRefundReference] = useState('');

  const paymentMethods: { value: PaymentMethod; label: string; icon: any }[] = [
    { value: 'transferencia', label: 'Transferencia Bancaria', icon: Building2 },
    { value: 'tarjeta', label: 'Tarjeta (Manual)', icon: CreditCard },
    { value: 'stripe', label: 'Stripe', icon: Wallet },
    { value: 'otro', label: 'Otro', icon: MoreHorizontal },
  ];

  const handleMarkAsPaid = async () => {
    if (!paymentMethod) {
      setError('Por favor, selecciona un método de pago');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const bookingRef = doc(db, 'bookings', booking.id);
      const updates: Record<string, any> = {
        pago_realizado: true,
        pago_realizado_en: serverTimestamp(),
        pago_metodo: paymentMethod,
        pago_referencia: paymentReference || 'Manual',
        estado: booking.estado === 'pendiente' ? 'confirmada' : booking.estado,
        updated_at: serverTimestamp(),
      };

      if (booking.estado === 'pendiente') {
        updates.confirmado_en = serverTimestamp();
      }

      const hasPartner = Boolean(booking.broker_id || booking.agency_id);
      if (hasPartner) {
        let computedCommission = calculateCommissionTotal(booking);

        if (computedCommission <= 0) {
          const productIds = Array.from(
            new Set(booking.items?.map((item) => item.producto_id).filter(Boolean))
          );

          if (productIds.length) {
            const productsById: Record<string, any> = {};
            for (let i = 0; i < productIds.length; i += 10) {
              const chunk = productIds.slice(i, i + 10);
              const q = query(collection(db, 'products'), where(documentId(), 'in', chunk));
              const snapshot = await getDocs(q);
              snapshot.docs.forEach((docSnap) => {
                productsById[docSnap.id] = { id: docSnap.id, ...docSnap.data() };
              });
            }
            computedCommission = calculateCommissionTotalWithProducts(booking, productsById);
          }
        }

        if (computedCommission > 0 && !(booking.comision_total && booking.comision_total > 0)) {
          updates.comision_total = computedCommission;
          updates.comision_pagada = booking.comision_pagada || 0;
        } else if (computedCommission <= 0 && !(booking.comision_total && booking.comision_total > 0)) {
          console.warn('Commission remains 0 for booking', booking.id);
        }
      }

      await updateDoc(bookingRef, updates);

      setSuccess('✅ Pago registrado correctamente');
      setTimeout(() => {
        onUpdate?.();
        onClose();
      }, 1500);
    } catch (err: any) {
      console.error('Error marking as paid:', err);
      setError(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleProcessRefund = async () => {
    const amount = parseFloat(refundAmount);
    if (isNaN(amount) || amount <= 0 || amount > maxRefundable) {
      setError('Monto de reembolso inválido');
      return;
    }

    if (!refundReason.trim()) {
      setError('Por favor, indica el motivo del reembolso');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      if (refundMethod === 'stripe') {
        if (!booking.stripe_payment_intent_id) {
          setError('Este pago no tiene un intent de Stripe asociado');
          return;
        }

        const response = await fetch('/api/stripe/refund', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bookingId: booking.id,
            amount,
            reason: refundReason,
          }),
        });

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data?.error || 'No se pudo procesar el reembolso en Stripe');
        }

        setSuccess('✅ Reembolso procesado en Stripe');
        setTimeout(() => {
          onUpdate?.();
          onClose();
        }, 1500);
        return;
      }

      const bookingRef = doc(db, 'bookings', booking.id);
      await updateDoc(bookingRef, {
        reembolso_realizado: true,
        reembolso_monto: amount,
        reembolso_fecha: serverTimestamp(),
        reembolso_motivo: refundReason,
        reembolso_metodo: refundMethod,
        reembolso_referencia: refundReference || 'Manual',
        estado: 'cancelada', // Auto-cancel when refunded
        updated_at: serverTimestamp(),
      });

      try {
        await releaseBookingStockOnce(booking.id, 'manual_refund');
      } catch (releaseError) {
        console.error('Error releasing stock after refund:', releaseError);
      }

      setSuccess('✅ Reembolso registrado correctamente');
      setTimeout(() => {
        onUpdate?.();
        onClose();
      }, 1500);
    } catch (err: any) {
      console.error('Error processing refund:', err);
      setError(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDepositRefund = async () => {
    if (!depositTotal || depositLoading) return;
    if (!booking.pago_realizado) {
      setError('El pago debe estar marcado como realizado para reembolsar el depósito.');
      return;
    }
    if (booking.deposito_reembolsado) {
      setError('El depósito ya fue reembolsado.');
      return;
    }

    setDepositLoading(true);
    setError('');
    setSuccess('');

    try {
      if (booking.pago_metodo === 'stripe') {
        const response = await fetch('/api/stripe/refund-deposit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookingId: booking.id }),
        });

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data?.error || 'No se pudo reembolsar el depósito en Stripe');
        }
      } else {
        await updateDoc(doc(db, 'bookings', booking.id), {
          deposito_reembolsado: true,
          deposito_reembolsado_en: serverTimestamp(),
          updated_at: serverTimestamp(),
        });
      }

      setSuccess('✅ Depósito reembolsado correctamente');
      onUpdate?.();
    } catch (err: any) {
      console.error('Deposit refund error:', err);
      setError(`Error: ${err.message || 'No se pudo reembolsar el depósito.'}`);
    } finally {
      setDepositLoading(false);
    }
  };

  const isPaid = booking.pago_realizado;
  const isRefunded = booking.reembolso_realizado;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-linear-to-r from-blue-600 to-blue-700 text-white p-6 rounded-t-2xl">
          <div className="flex justify-between items-start">
            <div>
              <h2 className="text-2xl font-bold mb-1">Gestión de Pagos y Reembolsos</h2>
              <p className="text-blue-100">Reserva #{booking.numero_reserva}</p>
            </div>
            <button
              onClick={onClose}
              className="text-white hover:bg-white/20 rounded-lg p-2 transition-colors"
            >
              <XCircle size={24} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Booking Summary */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
            <h3 className="font-semibold text-slate-800 mb-3">Detalles de la Reserva</h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-slate-500">Cliente:</span>
                <p className="font-medium text-slate-900">{booking.cliente.nombre}</p>
              </div>
              <div>
                <span className="text-slate-500">Alquiler:</span>
                <p className="font-bold text-slate-900 text-lg">€{rentalTotal.toFixed(2)}</p>
                {depositTotal > 0 && (
                  <p className="text-xs text-slate-500 mt-1">
                    Depósito: €{depositTotal.toFixed(2)}
                  </p>
                )}
                {depositTotal > 0 && (
                  <p className="text-xs text-slate-500">
                    Total cobrado: €{(rentalTotal + depositTotal).toFixed(2)}
                  </p>
                )}
              </div>
              <div>
                <span className="text-slate-500">Estado Pago:</span>
                <p className={clsx(
                  "inline-flex items-center gap-1 px-2 py-1 rounded-lg font-medium",
                  isPaid ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"
                )}>
                  {isPaid ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
                  {isPaid ? 'Pagado' : 'Pendiente'}
                </p>
              </div>
              <div>
                <span className="text-slate-500">Reembolso:</span>
                <p className={clsx(
                  "inline-flex items-center gap-1 px-2 py-1 rounded-lg font-medium",
                  isRefunded ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-600"
                )}>
                  {isRefunded ? 'Sí' : 'No'}
                </p>
              </div>
              {depositTotal > 0 && (
                <div>
                  <span className="text-slate-500">Depósito:</span>
                  <p className={clsx(
                    "inline-flex items-center gap-1 px-2 py-1 rounded-lg font-medium",
                    booking.deposito_reembolsado ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                  )}>
                    {booking.deposito_reembolsado ? 'Reembolsado' : 'Pendiente'}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Error/Success Messages */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl flex items-center gap-2">
              <AlertCircle size={20} />
              <span>{error}</span>
            </div>
          )}
          {success && (
            <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-xl flex items-center gap-2">
              <CheckCircle size={20} />
              <span>{success}</span>
            </div>
          )}

          {/* Payment Section */}
          {!isPaid && !isRefunded && (
            <div className="border border-green-200 bg-green-50 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <Euro className="text-green-600" size={24} />
                <h3 className="text-lg font-bold text-green-900">Registrar Pago</h3>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">
                    Método de Pago *
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {paymentMethods.map((method) => {
                      const Icon = method.icon;
                      return (
                        <button
                          key={method.value}
                          type="button"
                          onClick={() => setPaymentMethod(method.value)}
                          className={clsx(
                            "flex items-center gap-2 px-3 py-2.5 rounded-lg border-2 transition-all font-medium text-sm",
                            paymentMethod === method.value
                              ? "border-green-500 bg-green-50 text-green-700"
                              : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                          )}
                        >
                          <Icon size={18} />
                          {method.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">
                    Referencia del Pago (Opcional)
                  </label>
                  <input
                    type="text"
                    value={paymentReference}
                    onChange={(e) => setPaymentReference(e.target.value)}
                    placeholder="ej. ID de transacción, número de recibo..."
                    className="w-full px-4 py-2.5 rounded-lg border border-slate-200 focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none"
                  />
                </div>

                <button
                  onClick={handleMarkAsPaid}
                  disabled={loading}
                  className={clsx(
                    "w-full py-3 rounded-lg font-bold text-white transition-all flex items-center justify-center gap-2",
                    loading
                      ? "bg-slate-400 cursor-not-allowed"
                      : "bg-green-600 hover:bg-green-700 shadow-lg shadow-green-600/30"
                  )}
                >
                  <CheckCircle size={20} />
                  {loading ? 'Procesando...' : 'Marcar como Pagado'}
                </button>
              </div>
            </div>
          )}

          {/* Already Paid Info */}
          {isPaid && !isRefunded && (
            <div className="border border-green-200 bg-green-50 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle className="text-green-600" size={24} />
                <h3 className="text-lg font-bold text-green-900">Pago Confirmado</h3>
              </div>
              <div className="space-y-2 text-sm text-green-900">
                {booking.pago_metodo && (
                  <p><span className="font-semibold">Método:</span> {booking.pago_metodo}</p>
                )}
                {booking.pago_referencia && (
                  <p><span className="font-semibold">Referencia:</span> {booking.pago_referencia}</p>
                )}
              </div>
            </div>
          )}

          {depositTotal > 0 && (
            <div className="border border-blue-200 bg-blue-50 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <Wallet className="text-blue-600" size={24} />
                <h3 className="text-lg font-bold text-blue-900">Depósito reembolsable</h3>
              </div>
              <div className="space-y-2 text-sm text-blue-900">
                <p><span className="font-semibold">Monto:</span> €{depositTotal.toFixed(2)}</p>
                <p>
                  <span className="font-semibold">Estado:</span>{' '}
                  {booking.deposito_reembolsado ? 'Reembolsado' : 'Pendiente'}
                </p>
                {booking.deposito_reembolsado_en && (
                  <p>
                    <span className="font-semibold">Reembolsado el:</span>{' '}
                    {getDateValue(booking.deposito_reembolsado_en)?.toLocaleDateString('es-ES') || '-'}
                  </p>
                )}
              </div>
              {!booking.deposito_reembolsado && (
                <button
                  onClick={handleDepositRefund}
                  disabled={depositLoading}
                  className={clsx(
                    'mt-4 w-full py-2.5 rounded-lg font-bold text-white transition-all flex items-center justify-center gap-2',
                    depositLoading
                      ? 'bg-slate-400 cursor-not-allowed'
                      : 'bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-600/30'
                  )}
                >
                  <RefreshCcw size={18} />
                  {depositLoading ? 'Procesando...' : 'Reembolsar depósito'}
                </button>
              )}
            </div>
          )}

          {/* Refund Section */}
          {isPaid && !isRefunded && (
            <div className="border border-orange-200 bg-orange-50 rounded-xl p-5">
              <button
                type="button"
                onClick={() => setRefundOpen((prev) => !prev)}
                className="w-full flex items-center justify-between text-left"
              >
                <div className="flex items-center gap-2">
                  <RefreshCcw className="text-orange-600" size={24} />
                  <h3 className="text-lg font-bold text-orange-900">Procesar Reembolso</h3>
                </div>
                <span className="text-xs font-semibold text-orange-700">
                  {refundOpen ? 'Ocultar' : 'Abrir'}
                </span>
              </button>

              <p className="text-xs text-orange-700 mt-2">
                Esta sección sirve para reembolsar el importe del alquiler (sin depósito). El depósito se gestiona arriba.
              </p>

              {refundOpen && (
                <div className="space-y-4 mt-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">
                    Monto a Reembolsar *
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 font-bold">€</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max={maxRefundable}
                      value={refundAmount}
                      onChange={(e) => setRefundAmount(e.target.value)}
                      className="w-full pl-8 pr-4 py-2.5 rounded-lg border border-slate-200 focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none font-semibold"
                    />
                  </div>
                  <p className="text-xs text-slate-500 mt-1">Máximo: €{maxRefundable.toFixed(2)}</p>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">
                    Motivo del Reembolso *
                  </label>
                  <textarea
                    value={refundReason}
                    onChange={(e) => setRefundReason(e.target.value)}
                    placeholder="ej. Cancelación por mal tiempo, cambio de planes del cliente..."
                    rows={3}
                    className="w-full px-4 py-2.5 rounded-lg border border-slate-200 focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none resize-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">
                    Método de Reembolso *
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {paymentMethods.map((method) => {
                      const Icon = method.icon;
                      return (
                        <button
                          key={method.value}
                          type="button"
                          onClick={() => setRefundMethod(method.value)}
                          className={clsx(
                            "flex items-center gap-2 px-3 py-2.5 rounded-lg border-2 transition-all font-medium text-sm",
                            refundMethod === method.value
                              ? "border-orange-500 bg-orange-50 text-orange-700"
                              : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                          )}
                        >
                          <Icon size={18} />
                          {method.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">
                    Referencia del Reembolso (Opcional)
                  </label>
                  <input
                    type="text"
                    value={refundReference}
                    onChange={(e) => setRefundReference(e.target.value)}
                    placeholder="ej. ID de reembolso, número de operación..."
                    className="w-full px-4 py-2.5 rounded-lg border border-slate-200 focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none"
                  />
                </div>

                <button
                  onClick={handleProcessRefund}
                  disabled={loading}
                  className={clsx(
                    "w-full py-3 rounded-lg font-bold text-white transition-all flex items-center justify-center gap-2",
                    loading
                      ? "bg-slate-400 cursor-not-allowed"
                      : "bg-orange-600 hover:bg-orange-700 shadow-lg shadow-orange-600/30"
                  )}
                >
                  <RefreshCcw size={20} />
                  {loading ? 'Procesando...' : 'Procesar Reembolso'}
                </button>
              </div>
              )}
            </div>
          )}

          {/* Already Refunded Info */}
          {isRefunded && (
            <div className="border border-red-200 bg-red-50 rounded-xl p-5 text-red-800">
              <div className="flex items-center gap-2 mb-3">
                <RefreshCcw className="text-red-600" size={24} />
                <h3 className="text-lg font-bold text-red-900">Reembolso Procesado</h3>
              </div>
              <div className="space-y-2 text-sm">
                {booking.reembolso_monto && (
                  <p><span className="font-semibold text-red-900">Monto:</span> €{booking.reembolso_monto.toFixed(2)}</p>
                )}
                {booking.reembolso_metodo && (
                  <p><span className="font-semibold text-red-900">Método:</span> {booking.reembolso_metodo}</p>
                )}
                {booking.reembolso_motivo && (
                  <p><span className="font-semibold text-red-900">Motivo:</span> {booking.reembolso_motivo}</p>
                )}
                {booking.reembolso_referencia && (
                  <p><span className="font-semibold text-red-900">Referencia:</span> {booking.reembolso_referencia}</p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-200 p-4 bg-slate-50 rounded-b-2xl">
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-lg border border-slate-300 text-slate-700 font-semibold hover:bg-slate-100 transition-colors"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
