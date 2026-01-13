import { BookingItem, Product } from '@/types';

/**
 * Calculate total commission for a booking based on product commission rates
 * @param items - Booking items with product info
 * @param products - Products map with commission rates
 * @returns Total commission amount in euros
 */
export function calculateBookingCommission(
  items: BookingItem[],
  products: Map<string, Product>
): number {
  return items.reduce((total, item) => {
    const product = products.get(item.producto_id);
    if (!product) return total;

    // Calculate item total price
    const pricePerUnit = product.precio_diario;
    const itemTotal = pricePerUnit * item.cantidad * item.duracion;

    // Apply commission percentage
    const commissionRate = (product.comision || 0) / 100;
    const itemCommission = itemTotal * commissionRate;

    return total + itemCommission;
  }, 0);
}

/**
 * Calculate commission for a single item
 */
export function calculateItemCommission(
  precio: number,
  cantidad: number,
  duracion: number,
  comisionPercent: number
): number {
  const itemTotal = precio * cantidad * duracion;
  return itemTotal * (comisionPercent / 100);
}

/**
 * Format currency in euros
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR'
  }).format(amount);
}