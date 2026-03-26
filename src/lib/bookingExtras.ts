import { addDays } from 'date-fns';
import type { BookingItem, Product } from '@/types';
import { getProductDailyPrice } from '@/lib/productPricing';

export const hasInstructorOption = (product?: Product | null) =>
  Number(product?.instructor_price_per_day || 0) > 0;

export const hasFuelOption = (product?: Product | null) =>
  Number(product?.fuel_price_per_day || 0) > 0;

export const getBookingDayCount = (startDate: string, endDate: string): number => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / msPerDay));
};

export const getBookingItemRentalTotal = (
  item: Pick<BookingItem, 'cantidad' | 'duracion' | 'tipo_alquiler'>,
  product?: Product | null,
  startDate?: string,
  endDate?: string
): number => {
  if (!product) return 0;

  if (item.tipo_alquiler !== 'dia') {
    return Number(product.precio_hora || 0) * Math.max(1, item.duracion || 0) * Math.max(1, item.cantidad || 0);
  }

  if (!startDate) {
    return getProductDailyPrice(product) * Math.max(1, item.cantidad || 0);
  }

  const dayCount = getBookingDayCount(startDate, endDate || startDate);
  const start = new Date(startDate);

  if (Number.isNaN(start.getTime())) {
    return getProductDailyPrice(product, startDate) * dayCount * Math.max(1, item.cantidad || 0);
  }

  return Array.from({ length: dayCount }).reduce<number>((total, _, index) => {
    return total + getProductDailyPrice(product, addDays(start, index)) * Math.max(1, item.cantidad || 0);
  }, 0);
};

export const getBookingItemAverageDailyPrice = (
  item: Pick<BookingItem, 'cantidad' | 'duracion' | 'tipo_alquiler'>,
  product?: Product | null,
  startDate?: string,
  endDate?: string
): number => {
  if (!product) return 0;
  if (item.tipo_alquiler !== 'dia') return Number(product.precio_hora || 0);
  if (!startDate) return getProductDailyPrice(product);

  const dayCount = getBookingDayCount(startDate, endDate || startDate);
  const quantity = Math.max(1, item.cantidad || 0);
  return getBookingItemRentalTotal(item, product, startDate, endDate) / Math.max(1, dayCount * quantity);
};

export const getBookingItemInstructorTotal = (
  item: Pick<BookingItem, 'cantidad' | 'instructor_requested'>,
  product?: Product | null,
  dayCount = 1
): number => {
  if (!item.instructor_requested || !hasInstructorOption(product)) return 0;
  const basePrice = Number(product?.instructor_price_per_day || 0);
  const vatMultiplier = product?.instructor_incluir_iva ? 1.21 : 1;
  return basePrice * vatMultiplier * Math.max(1, item.cantidad || 0) * Math.max(1, dayCount);
};

export const getBookingItemFuelTotal = (
  item: Pick<BookingItem, 'cantidad' | 'fuel_requested'>,
  product?: Product | null,
  dayCount = 1
): number => {
  if (!item.fuel_requested || !hasFuelOption(product)) return 0;
  return Number(product?.fuel_price_per_day || 0) * Math.max(1, item.cantidad || 0) * Math.max(1, dayCount);
};

export const doesBookingItemRequireNauticalLicense = (
  item: Pick<BookingItem, 'instructor_requested'>,
  product?: Product | null
) => hasInstructorOption(product) && !item.instructor_requested;
