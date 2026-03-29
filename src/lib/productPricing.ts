import type { Product, SeasonalPriceMonth } from '@/types';

const VAT_RATE = 0.21;
const VAT_PERCENT_LABEL = '+21%';

export const SEASONAL_PRICE_MONTHS: Array<{
  key: SeasonalPriceMonth;
  label: string;
  monthIndex: number;
}> = [
  { key: 'april', label: 'Abril', monthIndex: 3 },
  { key: 'may', label: 'Mayo', monthIndex: 4 },
  { key: 'june', label: 'Junio', monthIndex: 5 },
  { key: 'july', label: 'Julio', monthIndex: 6 },
  { key: 'august', label: 'Agosto', monthIndex: 7 },
  { key: 'september', label: 'Septiembre', monthIndex: 8 },
  { key: 'october', label: 'Octubre', monthIndex: 9 },
];

const seasonalMonthByIndex = new Map(
  SEASONAL_PRICE_MONTHS.map((month) => [month.monthIndex, month.key])
);

export function getProductBaseDailyPrice(product: Product | undefined, dateLike?: Date | string): number {
  if (!product) return 0;
  if (!dateLike) return Number(product.precio_diario) || 0;

  const date = dateLike instanceof Date ? dateLike : new Date(dateLike);
  if (Number.isNaN(date.getTime())) {
    return Number(product.precio_diario) || 0;
  }

  const seasonalMonth = seasonalMonthByIndex.get(date.getMonth());
  if (!seasonalMonth) {
    return Number(product.precio_diario) || 0;
  }

  const seasonalPrice = product.precios_por_mes?.[seasonalMonth];
  if (seasonalPrice !== undefined && Number(seasonalPrice) > 0) {
    return Number(seasonalPrice) || 0;
  }

  return Number(product.precio_diario) || 0;
}

export function getProductDailyPrice(product: Product | undefined, dateLike?: Date | string): number {
  const basePrice = getProductBaseDailyPrice(product, dateLike);
  if (!product?.incluir_iva) return basePrice;
  return Math.round(basePrice * (1 + VAT_RATE));
}

export function getProductVatLabel(product: Product | undefined): string {
  if (!product) return `Sin IVA por defecto. Marca la casilla para incluir IVA (${VAT_PERCENT_LABEL}).`;
  return product.incluir_iva
    ? `IVA incluido (${VAT_PERCENT_LABEL})`
    : `Sin IVA por defecto. Marca la casilla para incluir IVA (${VAT_PERCENT_LABEL}).`;
}

export function getProductVatShortLabel(product: Product | undefined): string {
  return product?.incluir_iva ? `IVA incluido (${VAT_PERCENT_LABEL})` : 'Sin IVA por defecto';
}
