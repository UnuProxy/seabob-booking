import type { Product, ProductType } from '@/types';

const PRODUCT_TYPE_ORDER: ProductType[] = ['seabob', 'tabla', 'jetski', 'seascooter', 'servicio'];

export const getProductTypeSortOrder = (type: ProductType) => {
  const index = PRODUCT_TYPE_ORDER.indexOf(type);
  return index === -1 ? PRODUCT_TYPE_ORDER.length : index;
};

export const sortProductsByPriority = <T extends Pick<Product, 'tipo' | 'nombre'>>(products: T[]) =>
  [...products].sort((a, b) => {
    const typeDiff = getProductTypeSortOrder(a.tipo) - getProductTypeSortOrder(b.tipo);
    if (typeDiff !== 0) return typeDiff;
    return a.nombre.localeCompare(b.nombre, 'es');
  });

export const getProductTypeLabel = (type: ProductType) => {
  switch (type) {
    case 'seabob':
      return 'SeaBob';
    case 'jetski':
      return 'Jet Ski';
    case 'tabla':
      return 'Efoil';
    case 'seascooter':
      return 'Seascooter';
    case 'servicio':
      return 'Servicio Adicional';
    default:
      return type;
  }
};
