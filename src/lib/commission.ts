import { differenceInDays } from 'date-fns';
import type { Booking, Product } from '@/types';

export const calculateCommissionTotal = (booking: Booking): number => {
  if (!booking.items?.length) return 0;

  const start = new Date(booking.fecha_inicio);
  const end = new Date(booking.fecha_fin);
  const days = Math.max(1, differenceInDays(end, start));

  return booking.items.reduce((total, item) => {
    const rate = (item.comision_percent ?? 0) / 100;
    if (!rate) return total;

    const quantity = item.cantidad ?? 0;
    if (item.tipo_alquiler === 'hora') {
      const hours = Math.max(1, item.duracion || 1);
      const base = (item.precio_unitario ?? 0) * hours * quantity;
      return total + base * rate;
    }

    const base = (item.precio_unitario ?? 0) * days * quantity;
    return total + base * rate;
  }, 0);
};

export const calculateCommissionTotalWithProducts = (
  booking: Booking,
  productsById: Record<string, Product>
): number => {
  if (!booking.items?.length) return 0;

  const start = new Date(booking.fecha_inicio);
  const end = new Date(booking.fecha_fin);
  const days = Math.max(1, differenceInDays(end, start));

  return booking.items.reduce((total, item) => {
    const product = productsById[item.producto_id];
    const rate = ((item.comision_percent ?? product?.comision ?? 0) as number) / 100;
    if (!rate) return total;

    const quantity = item.cantidad ?? 0;
    const unitPrice =
      item.precio_unitario ??
      (item.tipo_alquiler === 'hora' ? product?.precio_hora : product?.precio_diario) ??
      0;

    if (item.tipo_alquiler === 'hora') {
      const hours = Math.max(1, item.duracion || 1);
      const base = unitPrice * hours * quantity;
      return total + base * rate;
    }

    const base = unitPrice * days * quantity;
    return total + base * rate;
  }, 0);
};
