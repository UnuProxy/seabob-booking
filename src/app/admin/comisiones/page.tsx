'use client';

import { useState, useEffect } from 'react';
import { collection, query, where, getDocs, doc, updateDoc, addDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '@/lib/firebase/config';
import { Booking, User, PagoComision, PartnerCommissionSummary, PaymentMethod } from '@/types';
import { DollarSign, Users, Clock, CheckCircle, X, ChevronDown, ChevronUp } from 'lucide-react';

export default function ComisionesPage() {
  const [loading, setLoading] = useState(true);
  const [summaries, setSummaries] = useState<PartnerCommissionSummary[]>([]);
  const [expandedPartner, setExpandedPartner] = useState<string | null>(null);
  const [paymentModal, setPaymentModal] = useState<{
    open: boolean;
    partner: PartnerCommissionSummary | null;
  }>({ open: false, partner: null });
  const [paymentHistory, setPaymentHistory] = useState<PagoComision[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    loadCommissions();
    loadPaymentHistory();
  }, []);

  const loadCommissions = async () => {
    try {
      // Get all partners (brokers and agencies)
      const usersQuery = query(
        collection(db, 'users'),
        where('rol', 'in', ['broker', 'agency'])
      );
      const usersSnapshot = await getDocs(usersQuery);
      const partners: User[] = usersSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as User));

      // Get all confirmed/completed bookings with commissions
      const bookingsQuery = query(
        collection(db, 'bookings'),
        where('estado', 'in', ['confirmada', 'completada'])
      );
      const bookingsSnapshot = await getDocs(bookingsQuery);
      const bookings: Booking[] = bookingsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as Booking));

      // Build summaries per partner
      const summariesMap = new Map<string, PartnerCommissionSummary>();

      partners.forEach(partner => {
        summariesMap.set(partner.id, {
          partner_id: partner.id,
          partner_nombre: partner.empresa_nombre || partner.nombre,
          partner_tipo: partner.rol as 'broker' | 'agency',
          total_comisiones: 0,
          total_pagado: 0,
          pendiente: 0,
          num_reservas: 0,
          reservas_pendientes: []
        });
      });

      // Assign bookings to partners
      bookings.forEach(booking => {
        const partnerId = booking.broker_id || booking.agency_id;
        if (!partnerId) return;

        const summary = summariesMap.get(partnerId);
        if (!summary) return;

        const comisionTotal = booking.comision_total || 0;
        const comisionPagada = booking.comision_pagada || 0;
        const pendiente = comisionTotal - comisionPagada;

        summary.total_comisiones += comisionTotal;
        summary.total_pagado += comisionPagada;
        summary.pendiente += pendiente;
        summary.num_reservas += 1;

        if (pendiente > 0) {
          summary.reservas_pendientes.push(booking);
        }
      });

      // Filter to only partners with activity and sort by pending amount
      const activeSummaries = Array.from(summariesMap.values())
        .filter(s => s.num_reservas > 0)
        .sort((a, b) => b.pendiente - a.pendiente);

      setSummaries(activeSummaries);
    } catch (error) {
      console.error('Error loading commissions:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadPaymentHistory = async () => {
    try {
      const paymentsQuery = query(collection(db, 'pagos_comisiones'));
      const snapshot = await getDocs(paymentsQuery);
      const payments = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as PagoComision));
      
      setPaymentHistory(payments.sort((a, b) => 
        new Date(b.creado_en as string).getTime() - new Date(a.creado_en as string).getTime()
      ));
    } catch (error) {
      console.error('Error loading payment history:', error);
    }
  };

  const totalPendiente = summaries.reduce((sum, s) => sum + s.pendiente, 0);
  const totalPagado = summaries.reduce((sum, s) => sum + s.total_pagado, 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-800">Comisiones</h1>
        <button
          onClick={() => setShowHistory(!showHistory)}
          className="btn-outline"
        >
          {showHistory ? 'Ver Resumen' : 'Ver Historial de Pagos'}
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-red-100 rounded-full">
              <Clock className="w-6 h-6 text-red-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Pendiente de Pago</p>
              <p className="text-2xl font-bold text-red-600">€{totalPendiente.toFixed(2)}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-green-100 rounded-full">
              <CheckCircle className="w-6 h-6 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Total Pagado</p>
              <p className="text-2xl font-bold text-green-600">€{totalPagado.toFixed(2)}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-blue-100 rounded-full">
              <Users className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Partners Activos</p>
              <p className="text-2xl font-bold text-gray-800">{summaries.length}</p>
            </div>
          </div>
        </div>
      </div>

      {showHistory ? (
        /* Payment History */
        <div className="bg-white rounded-lg shadow">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-800">Historial de Pagos</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Fecha</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Partner</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Monto</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Método</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Referencia</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Reservas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {paymentHistory.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-8 text-center text-gray-500">
                      No hay pagos registrados
                    </td>
                  </tr>
                ) : (
                  paymentHistory.map(payment => (
                    <tr key={payment.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-sm text-gray-900">
                        {new Date(payment.creado_en as string).toLocaleDateString('es-ES')}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900">{payment.partner_nombre}</td>
                      <td className="px-6 py-4 text-sm font-medium text-green-600">€{payment.monto.toFixed(2)}</td>
                      <td className="px-6 py-4 text-sm text-gray-600 capitalize">{payment.metodo}</td>
                      <td className="px-6 py-4 text-sm text-gray-600">{payment.referencia || '-'}</td>
                      <td className="px-6 py-4 text-sm text-gray-600">{payment.booking_ids.length}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Partner Commissions List */
        <div className="bg-white rounded-lg shadow">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-800">Comisiones por Partner</h2>
          </div>
          
          {summaries.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              No hay comisiones registradas
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {summaries.map(summary => (
                <div key={summary.partner_id} className="hover:bg-gray-50">
                  <div 
                    className="p-6 flex items-center justify-between cursor-pointer"
                    onClick={() => setExpandedPartner(
                      expandedPartner === summary.partner_id ? null : summary.partner_id
                    )}
                  >
                    <div className="flex items-center gap-4">
                      <div className={`p-2 rounded-full ${
                        summary.partner_tipo === 'broker' ? 'bg-purple-100' : 'bg-blue-100'
                      }`}>
                        <Users className={`w-5 h-5 ${
                          summary.partner_tipo === 'broker' ? 'text-purple-600' : 'text-blue-600'
                        }`} />
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">{summary.partner_nombre}</p>
                        <p className="text-sm text-gray-500 capitalize">
                          {summary.partner_tipo} • {summary.num_reservas} reservas
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-6">
                      <div className="text-right">
                        <p className="text-sm text-gray-500">Pendiente</p>
                        <p className={`font-bold ${summary.pendiente > 0 ? 'text-red-600' : 'text-green-600'}`}>
                          €{summary.pendiente.toFixed(2)}
                        </p>
                      </div>
                      
                      {summary.pendiente > 0 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setPaymentModal({ open: true, partner: summary });
                          }}
                          className="btn-primary text-sm"
                        >
                          Registrar Pago
                        </button>
                      )}
                      
                      {expandedPartner === summary.partner_id ? (
                        <ChevronUp className="w-5 h-5 text-gray-400" />
                      ) : (
                        <ChevronDown className="w-5 h-5 text-gray-400" />
                      )}
                    </div>
                  </div>

                  {/* Expanded Details */}
                  {expandedPartner === summary.partner_id && summary.reservas_pendientes.length > 0 && (
                    <div className="px-6 pb-6">
                      <div className="bg-gray-50 rounded-lg p-4">
                        <h4 className="text-sm font-medium text-gray-700 mb-3">Reservas Pendientes de Pago</h4>
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-left text-gray-500">
                              <th className="pb-2">Referencia</th>
                              <th className="pb-2">Fecha</th>
                              <th className="pb-2">Cliente</th>
                              <th className="pb-2">Total Reserva</th>
                              <th className="pb-2">Comisión</th>
                              <th className="pb-2">Pendiente</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200">
                            {summary.reservas_pendientes.map(booking => (
                              <tr key={booking.id}>
                                <td className="py-2 font-mono text-xs">{booking.numero_reserva}</td>
                                <td className="py-2">{new Date(booking.fecha_inicio).toLocaleDateString('es-ES')}</td>
                                <td className="py-2">{booking.cliente.nombre}</td>
                                <td className="py-2">€{booking.precio_total.toFixed(2)}</td>
                                <td className="py-2">€{(booking.comision_total || 0).toFixed(2)}</td>
                                <td className="py-2 font-medium text-red-600">
                                  €{((booking.comision_total || 0) - (booking.comision_pagada || 0)).toFixed(2)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Payment Modal */}
      {paymentModal.open && paymentModal.partner && (
        <PaymentModal
          partner={paymentModal.partner}
          onClose={() => setPaymentModal({ open: false, partner: null })}
          onSuccess={() => {
            setPaymentModal({ open: false, partner: null });
            loadCommissions();
            loadPaymentHistory();
          }}
        />
      )}
    </div>
  );
}

// Payment Modal Component
function PaymentModal({ 
  partner, 
  onClose, 
  onSuccess 
}: { 
  partner: PartnerCommissionSummary;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    monto: partner.pendiente,
    metodo: 'transferencia' as PaymentMethod,
    referencia: '',
    notas: '',
    selectedBookings: partner.reservas_pendientes.map(b => b.id)
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Create payment record
      const paymentData: Omit<PagoComision, 'id'> = {
        partner_id: partner.partner_id,
        partner_nombre: partner.partner_nombre,
        partner_tipo: partner.partner_tipo,
        monto: Number(formData.monto),
        metodo: formData.metodo,
        referencia: formData.referencia || undefined,
        booking_ids: formData.selectedBookings,
        notas: formData.notas || undefined,
        creado_por: auth.currentUser?.uid || '',
        creado_en: new Date().toISOString()
      };

      await addDoc(collection(db, 'pagos_comisiones'), {
        ...paymentData,
        creado_en: serverTimestamp()
      });

      // Update bookings with payment
      // Distribute payment across selected bookings
      let remainingPayment = Number(formData.monto);
      
      for (const bookingId of formData.selectedBookings) {
        const booking = partner.reservas_pendientes.find(b => b.id === bookingId);
        if (!booking) continue;

        const pendiente = (booking.comision_total || 0) - (booking.comision_pagada || 0);
        const paymentForThisBooking = Math.min(remainingPayment, pendiente);
        
        if (paymentForThisBooking > 0) {
          await updateDoc(doc(db, 'bookings', bookingId), {
            comision_pagada: (booking.comision_pagada || 0) + paymentForThisBooking,
            updated_at: serverTimestamp()
          });
          
          remainingPayment -= paymentForThisBooking;
        }

        if (remainingPayment <= 0) break;
      }

      onSuccess();
    } catch (error) {
      console.error('Error recording payment:', error);
      alert('Error al registrar el pago');
    } finally {
      setLoading(false);
    }
  };

  const toggleBooking = (bookingId: string) => {
    setFormData(prev => {
      const isSelected = prev.selectedBookings.includes(bookingId);
      const newSelected = isSelected
        ? prev.selectedBookings.filter(id => id !== bookingId)
        : [...prev.selectedBookings, bookingId];
      
      // Recalculate amount based on selected bookings
      const newMonto = partner.reservas_pendientes
        .filter(b => newSelected.includes(b.id))
        .reduce((sum, b) => sum + (b.comision_total || 0) - (b.comision_pagada || 0), 0);

      return {
        ...prev,
        selectedBookings: newSelected,
        monto: newMonto
      };
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-gray-200 flex justify-between items-center">
          <div>
            <h2 className="text-xl font-bold text-gray-800">Registrar Pago</h2>
            <p className="text-sm text-gray-500">{partner.partner_nombre}</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <X size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Booking Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Reservas a pagar
            </label>
            <div className="space-y-2 max-h-48 overflow-y-auto border border-gray-200 rounded-lg p-3">
              {partner.reservas_pendientes.map(booking => {
                const pendiente = (booking.comision_total || 0) - (booking.comision_pagada || 0);
                const isSelected = formData.selectedBookings.includes(booking.id);
                
                return (
                  <label
                    key={booking.id}
                    className={`flex items-center justify-between p-2 rounded cursor-pointer ${
                      isSelected ? 'bg-blue-50 border border-blue-200' : 'hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleBooking(booking.id)}
                        className="rounded border-gray-300 text-blue-600"
                      />
                      <div>
                        <span className="font-mono text-xs text-gray-600">{booking.numero_reserva}</span>
                        <span className="mx-2">•</span>
                        <span className="text-sm">{booking.cliente.nombre}</span>
                      </div>
                    </div>
                    <span className="font-medium text-red-600">€{pendiente.toFixed(2)}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Monto a pagar (€)
              </label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                required
                value={formData.monto}
                onChange={(e) => setFormData({ ...formData, monto: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 outline-none text-black"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Método de pago
              </label>
              <select
                value={formData.metodo}
                onChange={(e) => setFormData({ ...formData, metodo: e.target.value as PaymentMethod })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 outline-none text-black"
              >
                <option value="transferencia">Transferencia</option>
                <option value="efectivo">Efectivo</option>
                <option value="stripe">Stripe</option>
                <option value="otro">Otro</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Referencia (opcional)
            </label>
            <input
              type="text"
              value={formData.referencia}
              onChange={(e) => setFormData({ ...formData, referencia: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 outline-none text-black"
              placeholder="Nº transferencia, recibo, etc."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Notas (opcional)
            </label>
            <textarea
              rows={2}
              value={formData.notas}
              onChange={(e) => setFormData({ ...formData, notas: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 outline-none text-black"
            />
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
            <button type="button" onClick={onClose} className="btn-outline">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading || formData.selectedBookings.length === 0}
              className="btn-primary disabled:opacity-50"
            >
              {loading ? 'Guardando...' : `Pagar €${formData.monto.toFixed(2)}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}