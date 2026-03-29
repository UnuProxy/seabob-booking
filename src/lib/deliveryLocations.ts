import type { Booking, DeliveryLocation } from '@/types';

export const DELIVERY_FEE_OUTSIDE_IBIZA = 50;

type DeliveryLocationMeta = {
  label: string;
  fee: number;
};

export const DELIVERY_LOCATION_META: Record<DeliveryLocation, DeliveryLocationMeta> = {
  marina_ibiza: { label: 'Marina Ibiza', fee: 0 },
  marina_botafoch: { label: 'Marina Botafoch', fee: 0 },
  club_nautico: { label: 'Club Náutico Ibiza', fee: 0 },
  marina_port_ibiza: { label: 'Marina Port Ibiza (Old Town)', fee: 0 },
  marina_santa_eulalia: { label: 'Marina Santa Eulalia', fee: DELIVERY_FEE_OUTSIDE_IBIZA },
  club_nautic_san_antonio: { label: 'Club Nautic San Antonio', fee: DELIVERY_FEE_OUTSIDE_IBIZA },
  otro: { label: 'Otro', fee: 0 },
};

export const DELIVERY_LOCATION_GROUPS: Array<{
  label: string;
  options: DeliveryLocation[];
}> = [
  {
    label: 'Puertos de Ibiza',
    options: ['marina_botafoch', 'marina_ibiza', 'club_nautico', 'marina_port_ibiza'],
  },
  {
    label: 'Santa Eulalia (+50 EUR)',
    options: ['marina_santa_eulalia'],
  },
  {
    label: 'San Antonio (+50 EUR)',
    options: ['club_nautic_san_antonio'],
  },
];

export const isDeliveryLocation = (value: unknown): value is DeliveryLocation =>
  typeof value === 'string' && value in DELIVERY_LOCATION_META;

export const getDeliveryLocationLabel = (
  value?: DeliveryLocation | string | null,
  detail?: string | null
) => {
  if (!value) return '';
  if (value === 'otro') return detail?.trim() || DELIVERY_LOCATION_META.otro.label;
  return DELIVERY_LOCATION_META[value as DeliveryLocation]?.label || String(value);
};

export const getDeliveryLocationFee = (value?: DeliveryLocation | string | null) => {
  if (!value || value === 'otro') return 0;
  return DELIVERY_LOCATION_META[value as DeliveryLocation]?.fee || 0;
};

export const getBookingDeliveryFee = (booking?: Booking | null) =>
  Number(booking?.delivery_total || 0) || getDeliveryLocationFee(booking?.ubicacion_entrega);
