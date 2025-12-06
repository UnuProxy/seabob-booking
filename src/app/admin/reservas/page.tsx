'use client';

import { useState, useEffect } from 'react';
import { collection, query, orderBy, onSnapshot, deleteDoc, doc, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { Booking, Product, User } from '@/types';
import { BookingForm } from '@/components/bookings/BookingForm';
import { 
  CalendarDays, 
  Plus, 
  Search, 
  Filter, 
  MoreVertical, 
  CheckCircle2, 
  Clock, 
  XCircle, 
  FileCheck,
  Trash2,
  Eye,
  Share2,
  PenTool,
  CreditCard,
  User as UserIcon,
  Briefcase,
  X,
  ShoppingBag,
  Calendar
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import clsx from 'clsx';

export default function BookingsPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [products, setProducts] = useState<Record<string, Product>>({});
  const [users, setUsers] = useState<Record<string, User>>({});
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [viewingBooking, setViewingBooking] = useState<Booking | null>(null);

  // Fetch products for reference
  useEffect(() => {
    const fetchProducts = async () => {
      const q = query(collection(db, 'products'));
      const snapshot = await getDocs(q);
      const productMap: Record<string, Product> = {};
      snapshot.docs.forEach(doc => {
        productMap[doc.id] = { id: doc.id, ...doc.data() } as Product;
      });
      setProducts(productMap);
    };
    fetchProducts();
  }, []);

  // Fetch users (brokers, agencies, collaborators) for reference
  useEffect(() => {
    const fetchUsers = async () => {
      const q = query(collection(db, 'users'));
      const snapshot = await getDocs(q);
      const userMap: Record<string, User> = {};
      snapshot.docs.forEach(doc => {
        userMap[doc.id] = { id: doc.id, ...doc.data() } as User;
      });
      setUsers(userMap);
    };
    fetchUsers();
  }, []);

  // Real-time bookings
  useEffect(() => {
    const q = query(collection(db, 'bookings'), orderBy('creado_en', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const bookingsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Booking[];
      setBookings(bookingsData);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const handleDelete = async (id: string) => {
    if (confirm('¿Estás seguro de eliminar esta reserva permanentemente?')) {
      await deleteDoc(doc(db, 'bookings', id));
    }
  };

  const copyContractLink = (booking: Booking) => {
    if (!booking.token_acceso) {
        alert('Esta reserva no tiene enlace público generado.');
        return;
    }
    const url = `${window.location.origin}/contract/${booking.id}?t=${booking.token_acceso}`;
    navigator.clipboard.writeText(url);
    alert('Enlace del contrato copiado al portapapeles');
  };

  const filteredBookings = bookings.filter(booking => {
    const matchesSearch = 
      booking.cliente.nombre.toLowerCase().includes(searchTerm.toLowerCase()) ||
      booking.numero_reserva.toLowerCase().includes(searchTerm.toLowerCase()) ||
      booking.cliente.email.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesStatus = statusFilter === 'all' || booking.estado === statusFilter;

    return matchesSearch && matchesStatus;
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'confirmada': return 'bg-green-100 text-green-700 border-green-200';
      case 'pendiente': return 'bg-yellow-100 text-yellow-700 border-yellow-200';
      case 'completada': return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'cancelada': return 'bg-red-100 text-red-700 border-red-200';
      default: return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'confirmada': return <CheckCircle2 size={16} />;
      case 'pendiente': return <Clock size={16} />;
      case 'completada': return <FileCheck size={16} />;
      case 'cancelada': return <XCircle size={16} />;
      default: return <Clock size={16} />;
    }
  };

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
      return new Date(); // Fallback to current date if invalid
    }
    
    return date;
  };

  // Helper to get agent name
  const getAgentName = (booking: Booking): string => {
    if (booking.broker_id && users[booking.broker_id]) {
      return users[booking.broker_id].nombre || 'Broker desconocido';
    }
    if (booking.agency_id && users[booking.agency_id]) {
      return users[booking.agency_id].nombre || 'Agencia desconocida';
    }
    if (booking.colaborador_id && users[booking.colaborador_id]) {
      return users[booking.colaborador_id].nombre || 'Colaborador desconocido';
    }
    if (booking.creado_por && users[booking.creado_por]) {
      const creator = users[booking.creado_por];
      if (creator.rol === 'admin') return 'Admin';
      return creator.nombre || 'Usuario desconocido';
    }
    return 'Directo';
  };

  // Helper to get agent type
  const getAgentType = (booking: Booking): string => {
    if (booking.broker_id) return 'Broker';
    if (booking.agency_id) return 'Agencia';
    if (booking.colaborador_id) return 'Colaborador';
    if (booking.creado_por && users[booking.creado_por]) {
      return users[booking.creado_por].rol === 'admin' ? 'Admin' : 'Usuario';
    }
    return 'Directo';
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        <p className="text-gray-500 mt-4">Cargando reservas...</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-800 mb-2">Reservas</h1>
          <p className="text-gray-500">Gestiona y supervisa todas las reservas del sistema.</p>
        </div>
        
        <button 
          onClick={() => setIsModalOpen(true)}
          className="bg-slate-900 text-white px-5 py-3 rounded-xl hover:bg-slate-800 hover:shadow-xl hover:shadow-slate-900/20 hover:-translate-y-0.5 transition-all font-semibold shadow-lg shadow-slate-900/10 flex items-center gap-2"
        >
          <Plus size={20} />
          <span>Nueva Reserva</span>
        </button>
      </div>

      {/* Filters & Search */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 mb-6 flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="relative w-full md:w-96">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
          <input
            type="text"
            placeholder="Buscar por nombre, referencia o email..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-gray-50 focus:bg-white transition-all"
          />
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto overflow-x-auto pb-2 md:pb-0">
          {['all', 'pendiente', 'confirmada', 'completada', 'cancelada'].map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={clsx(
                "px-4 py-2 rounded-lg text-sm font-medium capitalize whitespace-nowrap transition-colors",
                statusFilter === status 
                  ? "bg-slate-900 text-white shadow-md" 
                  : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
              )}
            >
              {status === 'all' ? 'Todos' : status}
            </button>
          ))}
        </div>
      </div>

      {/* Bookings List */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {filteredBookings.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Referencia</th>
                  <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Cliente</th>
                  <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Agente</th>
                  <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Fechas</th>
                  <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Items</th>
                  <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Estado</th>
                  <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Firmado</th>
                  <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Pagado</th>
                  <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Total</th>
                  <th className="px-6 py-4 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredBookings.map((booking) => (
                  <tr key={booking.id} className="hover:bg-gray-50/50 transition-colors group">
                    <td className="px-6 py-4">
                      <span className="font-mono text-sm font-medium text-gray-900">{booking.numero_reserva}</span>
                      <div className="text-xs text-gray-500 mt-1">
                        {format(getDate(booking.creado_en), 'dd MMM yyyy', { locale: es })}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-900">{booking.cliente.nombre}</div>
                      <div className="text-sm text-gray-500">{booking.cliente.email}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <div className={clsx(
                          "p-1.5 rounded-lg",
                          getAgentType(booking) === 'Broker' ? "bg-orange-100 text-orange-600" :
                          getAgentType(booking) === 'Agencia' ? "bg-purple-100 text-purple-600" :
                          "bg-gray-100 text-gray-600"
                        )}>
                          {getAgentType(booking) === 'Broker' || getAgentType(booking) === 'Agencia' ? 
                            <Briefcase size={14} /> : <UserIcon size={14} />}
                        </div>
                        <div>
                          <div className="text-sm font-medium text-gray-900">{getAgentName(booking)}</div>
                          <div className="text-xs text-gray-500">{getAgentType(booking)}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1 text-sm">
                        <span className="text-gray-900">
                          {format(parseISO(booking.fecha_inicio), 'dd MMM', { locale: es })}
                        </span>
                        <span className="text-gray-400 text-xs">hasta</span>
                        <span className="text-gray-900">
                          {format(parseISO(booking.fecha_fin), 'dd MMM', { locale: es })}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="space-y-1">
                        {booking.items.map((item, idx) => (
                          <div key={idx} className="text-sm text-gray-600 flex items-center gap-2">
                            <span className="bg-gray-100 px-1.5 py-0.5 rounded text-xs font-mono font-medium">x{item.cantidad}</span>
                            <span className="truncate max-w-[150px]" title={products[item.producto_id]?.nombre}>
                              {products[item.producto_id]?.nombre || 'Producto desconocido'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={clsx(
                        "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border",
                        getStatusColor(booking.estado)
                      )}>
                        {getStatusIcon(booking.estado)}
                        <span className="capitalize">{booking.estado}</span>
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {booking.acuerdo_firmado ? (
                        <div className="flex items-center gap-2">
                          <div className="bg-green-100 p-1.5 rounded-lg">
                            <PenTool size={14} className="text-green-600" />
                          </div>
                          <div>
                            <div className="text-xs font-medium text-green-700">Firmado</div>
                            {booking.terminos_aceptados_en && (
                              <div className="text-xs text-gray-500">
                                {format(getDate(booking.terminos_aceptados_en), 'dd MMM', { locale: es })}
                              </div>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <div className="bg-gray-100 p-1.5 rounded-lg">
                            <PenTool size={14} className="text-gray-400" />
                          </div>
                          <span className="text-xs text-gray-500">Pendiente</span>
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {booking.pago_realizado ? (
                        <div className="flex items-center gap-2">
                          <div className="bg-green-100 p-1.5 rounded-lg">
                            <CreditCard size={14} className="text-green-600" />
                          </div>
                          <div>
                            <div className="text-xs font-medium text-green-700">Pagado</div>
                            {booking.pago_realizado_en && (
                              <div className="text-xs text-gray-500">
                                {format(getDate(booking.pago_realizado_en), 'dd MMM', { locale: es })}
                              </div>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <div className="bg-yellow-100 p-1.5 rounded-lg">
                            <CreditCard size={14} className="text-yellow-600" />
                          </div>
                          <span className="text-xs text-yellow-700">Pendiente</span>
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 font-medium text-gray-900">
                      €{booking.precio_total.toLocaleString('es-ES', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button 
                          onClick={() => copyContractLink(booking)}
                          className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                          title="Copiar enlace del contrato"
                        >
                          <Share2 size={18} />
                        </button>
                        <button 
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setViewingBooking(booking);
                          }}
                          className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" 
                          title="Ver detalles"
                        >
                          <Eye size={18} />
                        </button>
                        <button 
                          onClick={() => handleDelete(booking.id)}
                          className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" 
                          title="Eliminar"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-center px-4">
            <div className="bg-gray-100 p-4 rounded-full mb-4">
              <CalendarDays size={32} className="text-gray-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-1">No hay reservas encontradas</h3>
            <p className="text-gray-500 max-w-sm mx-auto mb-6">
              {searchTerm || statusFilter !== 'all' 
                ? 'Intenta ajustar los filtros o términos de búsqueda.' 
                : 'Aún no se han creado reservas en el sistema.'}
            </p>
            {(searchTerm || statusFilter !== 'all') && (
              <button 
                onClick={() => {
                  setSearchTerm('');
                  setStatusFilter('all');
                }}
                className="text-blue-600 hover:underline font-medium"
              >
                Limpiar filtros
              </button>
            )}
          </div>
        )}
      </div>

      {/* New Booking Modal */}
      {isModalOpen && (
        <BookingForm 
          onClose={() => setIsModalOpen(false)}
          onSuccess={() => {
            // The snapshot listener will automatically update the list
            setIsModalOpen(false);
          }}
        />
      )}

      {/* Booking Details Modal */}
      {viewingBooking && (
        <BookingDetailsModal 
          booking={viewingBooking}
          products={products}
          users={users}
          onClose={() => setViewingBooking(null)}
        />
      )}
    </div>
  );
}

// Booking Details Modal Component
function BookingDetailsModal({ 
  booking, 
  products, 
  users,
  onClose 
}: { 
  booking: Booking; 
  products: Record<string, Product>;
  users: Record<string, User>;
  onClose: () => void;
}) {
  const getDate = (timestamp: any): Date => {
    if (!timestamp) return new Date();
    if (timestamp && typeof timestamp.toDate === 'function') {
      return timestamp.toDate();
    }
    if (timestamp instanceof Date) {
      return timestamp;
    }
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) {
      return new Date();
    }
    return date;
  };

  const getAgentName = (booking: Booking): string => {
    if (booking.broker_id && users[booking.broker_id]) {
      return users[booking.broker_id].nombre || 'Broker desconocido';
    }
    if (booking.agency_id && users[booking.agency_id]) {
      return users[booking.agency_id].nombre || 'Agencia desconocida';
    }
    if (booking.colaborador_id && users[booking.colaborador_id]) {
      return users[booking.colaborador_id].nombre || 'Colaborador desconocido';
    }
    if (booking.creado_por && users[booking.creado_por]) {
      const creator = users[booking.creado_por];
      if (creator.rol === 'admin') return 'Admin';
      return creator.nombre || 'Usuario desconocido';
    }
    return 'Directo';
  };

  const getAgentType = (booking: Booking): string => {
    if (booking.broker_id) return 'Broker';
    if (booking.agency_id) return 'Agencia';
    if (booking.colaborador_id) return 'Colaborador';
    if (booking.creado_por && users[booking.creado_por]) {
      return users[booking.creado_por].rol === 'admin' ? 'Admin' : 'Usuario';
    }
    return 'Directo';
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-slate-50 rounded-t-2xl shrink-0">
          <div>
            <h2 className="text-2xl font-bold text-gray-800">Detalles de la Reserva</h2>
            <p className="text-gray-500 text-sm mt-1">Referencia: {booking.numero_reserva}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded-full p-2 transition-colors">
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {/* Client Info */}
          <section>
            <h3 className="text-lg font-bold text-gray-900 mb-3 flex items-center gap-2">
              <UserIcon size={20} className="text-blue-600" />
              Cliente
            </h3>
            <div className="bg-gray-50 rounded-xl p-4 grid grid-cols-2 gap-4">
              <div>
                <span className="text-xs text-gray-500 uppercase font-semibold">Nombre</span>
                <div className="text-gray-900 font-medium">{booking.cliente.nombre}</div>
              </div>
              <div>
                <span className="text-xs text-gray-500 uppercase font-semibold">Email</span>
                <div className="text-gray-900 font-medium">{booking.cliente.email}</div>
              </div>
              <div>
                <span className="text-xs text-gray-500 uppercase font-semibold">Teléfono</span>
                <div className="text-gray-900 font-medium">{booking.cliente.telefono || 'N/A'}</div>
              </div>
            </div>
          </section>

          {/* Agent Info */}
          <section>
            <h3 className="text-lg font-bold text-gray-900 mb-3 flex items-center gap-2">
              <Briefcase size={20} className="text-blue-600" />
              Agente
            </h3>
            <div className="bg-gray-50 rounded-xl p-4">
              <div className="flex items-center gap-3">
                <div className={clsx(
                  "p-2 rounded-lg",
                  getAgentType(booking) === 'Broker' ? "bg-orange-100 text-orange-600" :
                  getAgentType(booking) === 'Agencia' ? "bg-purple-100 text-purple-600" :
                  "bg-gray-100 text-gray-600"
                )}>
                  {getAgentType(booking) === 'Broker' || getAgentType(booking) === 'Agencia' ? 
                    <Briefcase size={16} /> : <UserIcon size={16} />}
                </div>
                <div>
                  <div className="font-bold text-gray-900">{getAgentName(booking)}</div>
                  <div className="text-sm text-gray-500">{getAgentType(booking)}</div>
                </div>
              </div>
            </div>
          </section>

          {/* Dates & Delivery */}
          <section>
            <h3 className="text-lg font-bold text-gray-900 mb-3 flex items-center gap-2">
              <Calendar size={20} className="text-blue-600" />
              Fechas y Entrega
            </h3>
            <div className="bg-gray-50 rounded-xl p-4 grid grid-cols-2 gap-4">
              <div>
                <span className="text-xs text-gray-500 uppercase font-semibold">Fecha Inicio</span>
                <div className="text-gray-900 font-medium">{format(parseISO(booking.fecha_inicio), 'dd MMM yyyy', { locale: es })}</div>
              </div>
              <div>
                <span className="text-xs text-gray-500 uppercase font-semibold">Fecha Fin</span>
                <div className="text-gray-900 font-medium">{format(parseISO(booking.fecha_fin), 'dd MMM yyyy', { locale: es })}</div>
              </div>
              {booking.ubicacion_entrega && (
                <div>
                  <span className="text-xs text-gray-500 uppercase font-semibold">Ubicación</span>
                  <div className="text-gray-900 font-medium">
                    {booking.ubicacion_entrega === 'marina_ibiza' ? 'Marina Ibiza' : 
                     booking.ubicacion_entrega === 'marina_botafoch' ? 'Marina Botafoch' : 
                     booking.ubicacion_entrega === 'club_nautico' ? 'Club Náutico' : 'Otro'}
                  </div>
                </div>
              )}
              {booking.hora_entrega && (
                <div>
                  <span className="text-xs text-gray-500 uppercase font-semibold">Hora de Entrega</span>
                  <div className="text-gray-900 font-medium font-mono">{booking.hora_entrega}</div>
                </div>
              )}
              {booking.nombre_barco && (
                <div>
                  <span className="text-xs text-gray-500 uppercase font-semibold">Barco</span>
                  <div className="text-gray-900 font-medium">{booking.nombre_barco}</div>
                </div>
              )}
              {booking.numero_amarre && (
                <div>
                  <span className="text-xs text-gray-500 uppercase font-semibold">Amarre</span>
                  <div className="text-gray-900 font-medium">{booking.numero_amarre}</div>
                </div>
              )}
            </div>
          </section>

          {/* Items */}
          <section>
            <h3 className="text-lg font-bold text-gray-900 mb-3 flex items-center gap-2">
              <ShoppingBag size={20} className="text-blue-600" />
              Productos
            </h3>
            <div className="bg-gray-50 rounded-xl p-4 space-y-2">
              {booking.items.map((item, idx) => (
                <div key={idx} className="flex justify-between items-center py-2 border-b border-gray-200 last:border-0">
                  <div>
                    <div className="font-medium text-gray-900">
                      {products[item.producto_id]?.nombre || `Producto ${item.producto_id}`}
                    </div>
                    <div className="text-sm text-gray-500">Cantidad: {item.cantidad}</div>
                  </div>
                </div>
              ))}
              <div className="pt-2 border-t-2 border-gray-300 flex justify-between items-center">
                <span className="font-bold text-gray-900">Total</span>
                <span className="font-bold text-xl text-gray-900">€{booking.precio_total.toLocaleString('es-ES', { minimumFractionDigits: 2 })}</span>
              </div>
            </div>
          </section>

          {/* Status & Actions */}
          <section>
            <h3 className="text-lg font-bold text-gray-900 mb-3">Estado y Acciones</h3>
            <div className="bg-gray-50 rounded-xl p-4 grid grid-cols-3 gap-4">
              <div>
                <span className="text-xs text-gray-500 uppercase font-semibold">Estado</span>
                <div className="mt-1">
                  <span className={clsx(
                    "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border",
                    booking.estado === 'confirmada' ? 'bg-green-100 text-green-700 border-green-200' :
                    booking.estado === 'pendiente' ? 'bg-yellow-100 text-yellow-700 border-yellow-200' :
                    booking.estado === 'completada' ? 'bg-blue-100 text-blue-700 border-blue-200' :
                    'bg-red-100 text-red-700 border-red-200'
                  )}>
                    {booking.estado}
                  </span>
                </div>
              </div>
              <div>
                <span className="text-xs text-gray-500 uppercase font-semibold">Firmado</span>
                <div className="mt-1">
                  {booking.acuerdo_firmado ? (
                    <span className="inline-flex items-center gap-1 text-green-700 font-medium">
                      <CheckCircle2 size={16} />
                      Sí
                    </span>
                  ) : (
                    <span className="text-gray-500">No</span>
                  )}
                </div>
              </div>
              <div>
                <span className="text-xs text-gray-500 uppercase font-semibold">Pagado</span>
                <div className="mt-1">
                  {booking.pago_realizado ? (
                    <span className="inline-flex items-center gap-1 text-green-700 font-medium">
                      <CheckCircle2 size={16} />
                      Sí
                    </span>
                  ) : (
                    <span className="text-gray-500">No</span>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* Notes */}
          {booking.notas && (
            <section>
              <h3 className="text-lg font-bold text-gray-900 mb-3">Notas</h3>
              <div className="bg-gray-50 rounded-xl p-4">
                <p className="text-gray-700">{booking.notas}</p>
              </div>
            </section>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-gray-100 bg-gray-50 rounded-b-2xl shrink-0">
          <button
            onClick={onClose}
            className="w-full py-3 bg-slate-900 text-white rounded-xl hover:bg-slate-800 font-bold transition-colors"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

