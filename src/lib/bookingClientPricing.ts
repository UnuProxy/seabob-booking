import type { BookingItem, Product } from '@/types';
import {
  getBookingItemFuelTotal,
  getBookingItemInstructorTotal,
  getBookingItemRentalTotal,
} from '@/lib/bookingExtras';

const CLIENT_VAT_MULTIPLIER = 1.21;

const roundMoney = (amount: number) => Math.round(amount * 100) / 100;

const withClientVat = (amount: number, alreadyIncludesVat = false) =>
  roundMoney(alreadyIncludesVat ? amount : amount * CLIENT_VAT_MULTIPLIER);

export function getBookingItemRentalClientTotal(
  item: Pick<BookingItem, 'cantidad' | 'duracion' | 'tipo_alquiler'>,
  product?: Product | null,
  startDate?: string,
  endDate?: string
) {
  const subtotal = getBookingItemRentalTotal(item, product, startDate, endDate);
  return withClientVat(subtotal, Boolean(product?.incluir_iva));
}

export function getBookingItemInstructorClientTotal(
  item: Pick<BookingItem, 'cantidad' | 'instructor_requested'>,
  product?: Product | null,
  dayCount = 1
) {
  const subtotal = getBookingItemInstructorTotal(item, product, dayCount);
  return withClientVat(subtotal, Boolean(product?.instructor_incluir_iva));
}

export function getBookingItemFuelClientTotal(
  item: Pick<BookingItem, 'cantidad' | 'fuel_requested'>,
  product?: Product | null,
  dayCount = 1
) {
  const subtotal = getBookingItemFuelTotal(item, product, dayCount);
  return roundMoney(subtotal);
}

export function getBookingClientTotals(
  items: BookingItem[],
  productResolver: (productId: string) => Product | undefined,
  startDate?: string,
  endDate?: string
) {
  const dayCount = startDate ? Math.max(1, getDayCount(startDate, endDate || startDate)) : 1;

  const rentalTotal = items.reduce((sum, item) => {
    return sum + getBookingItemRentalClientTotal(item, productResolver(item.producto_id), startDate, endDate);
  }, 0);

  const instructorTotal = items.reduce((sum, item) => {
    return sum + getBookingItemInstructorClientTotal(item, productResolver(item.producto_id), dayCount);
  }, 0);

  const fuelTotal = items.reduce((sum, item) => {
    return sum + getBookingItemFuelClientTotal(item, productResolver(item.producto_id), dayCount);
  }, 0);

  return {
    rentalTotal: roundMoney(rentalTotal),
    instructorTotal: roundMoney(instructorTotal),
    fuelTotal: roundMoney(fuelTotal),
    total: roundMoney(rentalTotal + instructorTotal + fuelTotal),
  };
}

function getDayCount(startDate: string, endDate: string) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / msPerDay));
}
