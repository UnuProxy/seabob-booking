export type UserRole = 'admin' | 'colaborador' | 'broker' | 'agency';
export type EntityType = 'individual' | 'broker' | 'agency';
export type ProductType = 'seabob' | 'jetski' | 'servicio';
export type RentalType = 'hora' | 'dia';
export type BookingStatus = 'pendiente' | 'confirmada' | 'completada' | 'cancelada';

export type PaymentMethod = 
  | 'stripe'          // Stripe payment
  | 'efectivo'        // Cash
  | 'transferencia'   // Bank transfer
  | 'tarjeta'         // Card payment (manual)
  | 'otro';           // Other
export type PaymentMethod = 'transferencia' | 'efectivo' | 'stripe' | 'otro';

export interface User {
  id: string;
  email: string;
  nombre: string;
  rol: UserRole;
  tipo_entidad: EntityType;
  empresa_nombre?: string;
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
  creado_en: Date | string;
  permisos: string[];
  last_login_at?: Date | string;
  last_seen_at?: Date | string;
}

export interface Product {
  id?: string;
  nombre: string;
  descripcion: string;
  precio_diario: number;
  comision: number; // Percentage (e.g., 15 = 15%)
  tipo: ProductType;
  imagen_url: string;
  activo: boolean;
  creado_por?: string;
  creado_en?: any;
  updated_at?: any;
}

export interface DailyStock {
  id: string;
  fecha: string;
  producto_id: string;
  cantidad_disponible: number;
  cantidad_reservada: number;
  actualizado_por: string;
  timestamp: Date | string;
}

export interface BookingItem {
  producto_id: string;
  cantidad: number;
  tipo_alquiler: RentalType;
  duracion: number;
  producto_nombre?: string;
  precio_unitario?: number;
  comision_percent?: number; // Store the commission rate at time of booking
}

export interface Booking {
  id: string;
  numero_reserva: string;
  cliente: {
    nombre: string;
    email: string;
    telefono: string;
    whatsapp: string;
  };
  broker_id?: string;
  agency_id?: string;
  colaborador_id?: string;
  public_link_id?: string;
  cliente_directo?: boolean; // Direct client (no broker/agency)
  origen?: 'panel' | 'public_link';
  items: BookingItem[];
  fecha_inicio: string;
  fecha_fin: string;
  ubicacion_entrega?: 'marina_ibiza' | 'marina_botafoch' | 'club_nautico' | 'otro';
  nombre_barco?: string;
  numero_amarre?: string;
  hora_entrega?: string;
  token_acceso?: string;
  firma_cliente?: string;
  terminos_aceptados?: boolean;
  terminos_aceptados_en?: Date | string;
  precio_total: number;
  
  // Payment tracking
  pago_realizado?: boolean;
  pago_realizado_en?: Date | string;
  pago_metodo?: PaymentMethod; // How payment was received
  pago_referencia?: string; // Payment reference number
  stripe_checkout_session_id?: string;
  stripe_payment_link?: string;
  stripe_payment_intent_id?: string;
  
  // Refund tracking
  reembolso_realizado?: boolean;
  reembolso_monto?: number;
  reembolso_fecha?: Date | string;
  reembolso_motivo?: string;
  reembolso_metodo?: PaymentMethod;
  reembolso_referencia?: string;
  stripe_refund_id?: string;
  
  // Commission tracking
  comision_total: number; // Total commission amount for this booking
  comision_pagada: number; // Amount of commission already paid
  comision_pendiente?: number; // Computed: comision_total - comision_pagada
  
  estado: BookingStatus;
  acuerdo_firmado: boolean;
  creado_por?: string;
  pdf_acuerdo_url?: string;
  notas?: string;
  creado_en: Date | string;
  confirmado_en?: Date | string;
  updated_at?: Date | string;
}

// Commission payment record
export interface PagoComision {
  id: string;
  partner_id: string; // broker_id or agency_id
  partner_nombre: string;
  partner_tipo: 'broker' | 'agency';
  monto: number;
  metodo: PaymentMethod;
  referencia?: string; // Bank reference, receipt number, etc.
  booking_ids: string[]; // Which bookings this payment covers
  notas?: string;
  creado_por: string;
  creado_en: Date | string;
}

// For displaying commission summaries
export interface PartnerCommissionSummary {
  partner_id: string;
  partner_nombre: string;
  partner_tipo: 'broker' | 'agency';
  total_comisiones: number;
  total_pagado: number;
  pendiente: number;
  num_reservas: number;
  reservas_pendientes: Booking[];
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

export interface BookingLink {
  id: string;
  token: string;
  activo: boolean;
  uso_unico: boolean;
  usado?: boolean;
  visitas: number;
  reservas_creadas: number;
  cliente_nombre?: string;
  cliente_email?: string;
  cliente_telefono?: string;
  etiqueta?: string;
  notas?: string;
  creado_por?: string;
  creado_en: Date | string;
  ultimo_acceso?: Date | string;
  usado_en?: Date | string;
}