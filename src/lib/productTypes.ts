import type { ProductType } from '@/types';

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
