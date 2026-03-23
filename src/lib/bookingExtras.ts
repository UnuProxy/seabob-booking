import type { BookingItem, Product } from '@/types';

export const hasInstructorOption = (product?: Product | null) =>
  Number(product?.instructor_price_per_day || 0) > 0;

export const hasFuelOption = (product?: Product | null) =>
  Number(product?.fuel_price_per_day || 0) > 0;

export const getBookingDayCount = (startDate: string, endDate: string) => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / msPerDay));
};

export const getBookingItemInstructorTotal = (
  item: Pick<BookingItem, 'cantidad' | 'instructor_requested'>,
  product?: Product | null,
  dayCount = 1
) => {
  if (!item.instructor_requested || !hasInstructorOption(product)) return 0;
  const basePrice = Number(product?.instructor_price_per_day || 0);
  const vatMultiplier = product?.instructor_incluir_iva ? 1.21 : 1;
  return basePrice * vatMultiplier * Math.max(1, item.cantidad || 0) * Math.max(1, dayCount);
};

export const getBookingItemFuelTotal = (
  item: Pick<BookingItem, 'cantidad' | 'fuel_requested'>,
  product?: Product | null,
  dayCount = 1
) => {
  if (!item.fuel_requested || !hasFuelOption(product)) return 0;
  return Number(product?.fuel_price_per_day || 0) * Math.max(1, item.cantidad || 0) * Math.max(1, dayCount);
};

export const doesBookingItemRequireNauticalLicense = (
  item: Pick<BookingItem, 'instructor_requested'>,
  product?: Product | null
) => hasInstructorOption(product) && !item.instructor_requested;
