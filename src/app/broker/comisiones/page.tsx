'use client';

import { useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import { usePartnerCommissions } from '@/lib/firebase/hooks/usePartnerCommissions';
import { Booking } from '@/types';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { 
  Wallet, 
  Clock, 
  CheckCircle, 
  TrendingUp, 
  ChevronDown, 
  ChevronUp,
  Calendar,
  Euro,
  RefreshCw
} from 'lucide-react';

function getDate(dateValue: any): Date {
  if (!dateValue) return new Date();
  if (dateValue instanceof Date) return dateValue;
  if (dateValue?.toDate) return dateValue.toDate();
  if (typeof dateValue === 'string') return new Date(dateValue);
  if (typeof dateValue === 'number') return new Date(dateValue);
  return new Date();
}

export default function BrokerComisionesPage() {
  const { user } = useAuthStore();
  const [expandedBooking, setExpandedBooking] = useState<string | null>(null);
  
  const {
    totalComisiones,
    totalPagado,
    pendiente,
    numReservas,
    reservasPendientes,
    loading,
    error,
    refetch
  } = usePartnerCommissions(
    user?.id,
    user?.rol as 'broker' | 'agency' | undefined
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-slate-200 border-t-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 text-red-700 p-6 rounded-xl">
        <p className="font-medium">Error al cargar comisiones</p>
        <p className="text-sm mt-1">{error}</p>
        <button 
          onClick={refetch}
          className="mt-4 btn-outline text-sm"
        >
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Mis Comisiones</h1>
          <p className="text-slate-600 mt-1">
            Seguimiento de tus comisiones por reservas realizadas
          </p>
        </div>
        <button
          onClick={refetch}
          className="btn-outline"
          title="Actualizar"
        >
          <RefreshCw size={18} />
          <span className="hidden sm:inline">Actualizar</span>
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-600 font-medium">Pendiente de Cobro</p>
              <p className="text-3xl font-bold text-amber-600 mt-2">€{pendiente.toFixed(2)}</p>
            </div>
            <div className="h-12 w-12 bg-amber-100 rounded-lg flex items-center justify-center">
              <Clock className="text-amber-600" size={24} />
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-600 font-medium">Ya Cobrado</p>
              <p className="text-3xl font-bold text-green-600 mt-2">€{totalPagado.toFixed(2)}</p>
            </div>
            <div className="h-12 w-12 bg-green-100 rounded-lg flex items-center justify-center">
              <CheckCircle className="text-green-600" size={24} />
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-600 font-medium">Total Generado</p>
              <p className="text-3xl font-bold text-blue-600 mt-2">€{totalComisiones.toFixed(2)}</p>
            </div>
            <div className="h-12 w-12 bg-blue-100 rounded-lg flex items-center justify-center">
              <TrendingUp className="text-blue-600" size={24} />
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-600 font-medium">Total Reservas</p>
              <p className="text-3xl font-bold text-slate-900 mt-2">{numReservas}</p>
            </div>
            <div className="h-12 w-12 bg-slate-100 rounded-lg flex items-center justify-center">
              <Wallet className="text-slate-600" size={24} />
            </div>
          </div>
        </div>
      </div>

      {/* Pending Commission Info */}
      {pendiente > 0 && (
        <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl p-6">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-amber-100 rounded-full">
              <Wallet className="text-amber-600" size={24} />
            </div>
            <div>
              <h3 className="font-semibold text-amber-900">Tienes comisiones pendientes</h3>
              <p className="text-amber-700 mt-1">
                Tienes <strong>€{pendiente.toFixed(2)}</strong> en comisiones pendientes de cobro 
                correspondientes a <strong>{reservasPendientes.length}</strong> reserva(s). 
                El pago se realiza periódicamente por SeaBob Center.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Pending Bookings Table */}
      {reservasPendientes.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 bg-slate-50">
            <h2 className="text-lg font-bold text-slate-900">Reservas Pendientes de Pago</h2>
            <p className="text-sm text-slate-600 mt-1">
              Estas reservas tienen comisiones que aún no han sido pagadas
            </p>
          </div>
          <div className="divide-y divide-slate-200">
            {reservasPendientes.map((booking) => {
              const pendienteReserva = (booking.comision_total || 0) - (booking.comision_pagada || 0);
              const isExpanded = expandedBooking === booking.id;
              
              return (
                <div key={booking.id}>
                  <div 
                    className="px-6 py-4 flex items-center justify-between hover:bg-slate-50 cursor-pointer transition-colors"
                    onClick={() => setExpandedBooking(isExpanded ? null : booking.id)}
                  >
                    <div className="flex items-center gap-4">
                      <div className="h-10 w-10 bg-blue-100 rounded-lg flex items-center justify-center">
                        <Calendar className="text-blue-600" size={20} />
                      </div>
                      <div>
                        <p className="font-medium text-slate-900">{booking.numero_reserva}</p>
                        <p className="text-sm text-slate-500">
                          {booking.cliente.nombre} • {format(getDate(booking.fecha_inicio), 'dd MMM yyyy', { locale: es })}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className="text-sm text-slate-500">Comisión pendiente</p>
                        <p className="font-bold text-amber-600">€{pendienteReserva.toFixed(2)}</p>
                      </div>
                      {isExpanded ? (
                        <ChevronUp className="text-slate-400" size={20} />
                      ) : (
                        <ChevronDown className="text-slate-400" size={20} />
                      )}
                    </div>
                  </div>
                  
                  {/* Expanded Details */}
                  {isExpanded && (
                    <div className="px-6 pb-4 bg-slate-50">
                      <div className="bg-white rounded-lg border border-slate-200 p-4">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                          <div>
                            <p className="text-slate-500">Cliente</p>
                            <p className="font-medium text-slate-900">{booking.cliente.nombre}</p>
                          </div>
                          <div>
                            <p className="text-slate-500">Total Reserva</p>
                            <p className="font-medium text-slate-900">€{booking.precio_total.toFixed(2)}</p>
                          </div>
                          <div>
                            <p className="text-slate-500">Comisión Total</p>
                            <p className="font-medium text-slate-900">€{(booking.comision_total || 0).toFixed(2)}</p>
                          </div>
                          <div>
                            <p className="text-slate-500">Ya Cobrado</p>
                            <p className="font-medium text-green-600">€{(booking.comision_pagada || 0).toFixed(2)}</p>
                          </div>
                        </div>
                        
                        {booking.items && booking.items.length > 0 && (
                          <div className="mt-4 pt-4 border-t border-slate-200">
                            <p className="text-sm font-medium text-slate-700 mb-2">Productos:</p>
                            <div className="space-y-1">
                              {booking.items.map((item, idx) => (
                                <div key={idx} className="flex justify-between text-sm">
                                  <span className="text-slate-600">
                                    {item.producto_nombre || item.producto_id} x{item.cantidad}
                                  </span>
                                  {item.comision_percent !== undefined && (
                                    <span className="text-slate-500">{item.comision_percent}% comisión</span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty State */}
      {numReservas === 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
          <div className="mx-auto w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
            <Wallet className="text-slate-400" size={32} />
          </div>
          <h3 className="text-lg font-semibold text-slate-900">Sin comisiones aún</h3>
          <p className="text-slate-600 mt-2 max-w-md mx-auto">
            Cuando realices reservas con productos que tienen comisión, 
            aparecerán aquí para que puedas hacer seguimiento.
          </p>
        </div>
      )}

      {/* All Paid State */}
      {numReservas > 0 && reservasPendientes.length === 0 && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-6">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-green-100 rounded-full">
              <CheckCircle className="text-green-600" size={24} />
            </div>
            <div>
              <h3 className="font-semibold text-green-900">¡Todo al día!</h3>
              <p className="text-green-700 mt-1">
                Todas tus comisiones han sido pagadas. Sigue generando reservas para 
                aumentar tus ganancias.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

