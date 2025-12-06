export type UserRole = 'admin' | 'colaborador' | 'broker' | 'agency';
export type EntityType = 'individual' | 'broker' | 'agency';
export type ProductType = 'seabob' | 'jetski' | 'servicio';
export type RentalType = 'hora' | 'dia';
export type BookingStatus = 'pendiente' | 'confirmada' | 'completada' | 'cancelada';

export interface User {
  id: string;
  email: string;
  nombre: string;
  rol: UserRole;
  tipo_entidad: EntityType;
  empresa_nombre?: string; // For brokers/agencies
  whatsapp_conectado: boolean;
  whatsapp_numero?: string;
  direccion_facturacion?: string;
  nif_cif?: string;
  requires_password_change?: boolean;
  comisiones?: {
    broker_commission_percent: number;
    agency_commission_percent: number;
  };
  activo: boolean;
  creado_por?: string;
  creado_en: Date | string; // Timestamp
  permisos: string[];
}

export interface Product {
  id: string;
  nombre: string;
  descripcion: string;
  precio_diario: number;
  precio_hora: number;
  tipo: ProductType;
  imagen_url: string;
  activo: boolean;
  creado_por: string;
}

export interface DailyStock {
  id: string;
  fecha: string; // YYYY-MM-DD
  producto_id: string;
  cantidad_disponible: number;
  cantidad_reservada: number;
  // cantidad_restante is computed: cantidad_disponible - cantidad_reservada
  actualizado_por: string;
  timestamp: Date | string;
}

export interface BookingItem {
  producto_id: string;
  cantidad: number;
  tipo_alquiler: RentalType;
  duracion: number; // in hours or days
}

export interface Booking {
  id: string;
  numero_reserva: string; // REF-DDMMYYYY-XXXX
  cliente: {
    nombre: string;
    email: string;
    telefono: string;
    whatsapp: string;
  };
  broker_id?: string;
  agency_id?: string;
  colaborador_id?: string;
  items: BookingItem[];
  fecha_inicio: string; // ISO Date
  fecha_fin: string; // ISO Date
  // Delivery Details
  ubicacion_entrega?: 'marina_ibiza' | 'marina_botafoch' | 'club_nautico' | 'otro';
  nombre_barco?: string;
  numero_amarre?: string;
  hora_entrega?: string; // HH:mm format
  // Contract & Payment
  token_acceso?: string; // For public access
  firma_cliente?: string; // Base64 signature
  terminos_aceptados?: boolean;
  terminos_aceptados_en?: Date | string;
  precio_total: number;
  estado: BookingStatus;
  acuerdo_firmado: boolean;
  pago_realizado?: boolean;
  pago_realizado_en?: Date | string;
  stripe_checkout_session_id?: string; // Stripe Checkout Session ID
  stripe_payment_link?: string; // Stripe Payment Link URL
  creado_por?: string; // User ID who created the booking
  pdf_acuerdo_url?: string;
  notas?: string;
  creado_en: Date | string;
  confirmado_en?: Date | string;
}

export interface WhatsAppLink {
  id: string;
  user_id: string;
  whatsapp_numero: string;
  codigo_enlace: string;
  enlace_publico: string;
  cliente_nombre?: string;
  cliente_email?: string;
  activo: boolean;
  clics: number;
  creado_en: Date | string;
  ultim_acceso?: Date | string;
}

