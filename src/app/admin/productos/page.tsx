'use client';

import { useEffect, useState } from 'react';
import { Product } from '@/types';
import { collection, onSnapshot, query, orderBy, deleteDoc, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { SEASONAL_PRICE_MONTHS, getProductBaseDailyPrice, getProductDailyPrice } from '@/lib/productPricing';
import { getProductTypeLabel } from '@/lib/productTypes';
import { Edit, Eye, X } from 'lucide-react';
import { ProductForm } from '@/components/products/ProductForm';

export default function ProductsPage() {
  const formatPrice = (amount: number) => amount.toLocaleString('es-ES', { maximumFractionDigits: 0 });
  const getSeasonalBasePrice = (product: Product, monthIndex: number) =>
    getProductBaseDailyPrice(product, new Date(2026, monthIndex, 1));
  const getConfiguredMonths = (product: Product) =>
    SEASONAL_PRICE_MONTHS.filter(({ key }) => product.precios_por_mes?.[key] !== undefined);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [viewingProduct, setViewingProduct] = useState<Product | null>(null);

  useEffect(() => {
    // Real-time listener for products
    const q = query(collection(db, 'products'), orderBy('nombre'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const productsData = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as Product[];
      setProducts(productsData);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const handleDelete = async (id: string) => {
    if (confirm('¿Estás seguro de eliminar este producto?')) {
      await deleteDoc(doc(db, 'products', id));
    }
  };

  const handleEdit = (product: Product) => {
    setEditingProduct(product);
    setIsFormOpen(true);
  };

  const handleNew = () => {
    setEditingProduct(null);
    setIsFormOpen(true);
  };

  const handleView = (product: Product) => {
    setViewingProduct(product);
  };

  const closeView = () => setViewingProduct(null);

  const openEditFromView = () => {
    if (!viewingProduct) return;
    const product = viewingProduct;
    setViewingProduct(null);
    handleEdit(product);
  };

  if (loading) {
    return <div className="p-8 text-center text-gray-500">Cargando productos...</div>;
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-800">Inventario de Productos</h1>
        <button 
          onClick={handleNew}
          className="btn-primary w-full sm:w-auto"
        >
          + Nuevo Producto
        </button>
      </div>

      <div className="grid grid-cols-1 items-stretch gap-6 md:grid-cols-2 lg:grid-cols-3">
        {products.map((product) => {
          const configuredMonths = getConfiguredMonths(product);
          const visibleMonths = configuredMonths.slice(0, 2);
          const displayPrice = getProductDailyPrice(product);
          const instructorPrice =
            Number(product.instructor_price_per_day || 0) *
            (product.instructor_incluir_iva ? 1.21 : 1);
          const fuelPrice = Number(product.fuel_price_per_day || 0);
          const extraSummary = [
            instructorPrice > 0 ? `Monitor €${formatPrice(instructorPrice)}` : null,
            fuelPrice > 0 ? `Fuel €${formatPrice(fuelPrice)}` : null,
          ]
            .filter(Boolean)
            .join(' · ');
          const seasonSummary =
            configuredMonths.length > 0
              ? visibleMonths
                  .map(({ label, monthIndex }) => `${label} €${formatPrice(getSeasonalBasePrice(product, monthIndex))}`)
                  .join(' · ')
              : 'Sin temporada';

          return (
            <div
              key={product.id}
              className="group flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <button
                type="button"
                onClick={() => handleEdit(product)}
                className="relative block h-32 w-full shrink-0 overflow-hidden bg-slate-100 text-left sm:h-36"
                title="Editar producto"
              >
                {product.imagen_url ? (
                  <img
                    src={product.imagen_url}
                    alt={product.nombre}
                    className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs font-medium text-slate-400">
                    Sin imagen
                  </div>
                )}
                <div className="absolute inset-x-0 top-0 flex items-start justify-between p-2">
                  <span className="rounded-md bg-white/95 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-700 shadow-sm">
                    {getProductTypeLabel(product.tipo)}
                  </span>
                  <span
                    className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide shadow-sm ${
                      product.activo
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-rose-100 text-rose-700'
                    }`}
                  >
                    {product.activo ? 'Activo' : 'Inactivo'}
                  </span>
                </div>
                <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-slate-950/80 to-transparent px-3 pb-2 pt-8 text-white">
                  <div className="text-lg font-bold leading-none sm:text-xl">
                    €{formatPrice(displayPrice)}
                    <span className="ml-0.5 text-xs font-medium text-white/85">/ día</span>
                  </div>
                  <div className="mt-0.5 text-[10px] font-medium text-white/80">
                    {product.incluir_iva ? 'IVA incl.' : 'sin IVA'}
                    {product.precio_hora && product.precio_hora > 0
                      ? ` · Hora €${formatPrice(product.precio_hora)}`
                      : ''}
                  </div>
                </div>
              </button>

              <div className="flex min-h-0 flex-1 flex-col p-3">
                <div className="min-h-0">
                  <button
                    type="button"
                    onClick={() => handleEdit(product)}
                    className="text-left"
                    title="Editar producto"
                  >
                    <h3 className="line-clamp-2 text-base font-bold leading-snug text-slate-900 group-hover:text-blue-700">
                      {product.nombre}
                    </h3>
                  </button>
                  <p className="mt-1 line-clamp-1 text-xs leading-snug text-slate-500">
                    {product.descripcion || 'Sin descripción.'}
                  </p>
                </div>

                <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50/80 px-2.5 py-2">
                  <p className="text-[11px] leading-snug text-slate-600">
                    <span className="font-semibold text-slate-500">Extras: </span>
                    {extraSummary || '—'}
                  </p>
                  <p className="mt-1 border-t border-slate-200/80 pt-1 text-[11px] leading-snug text-slate-600">
                    <span className="font-semibold text-slate-500">Meses: </span>
                    {seasonSummary}
                    {configuredMonths.length > visibleMonths.length ? ` +${configuredMonths.length - visibleMonths.length}` : ''}
                  </p>
                </div>

                <div className="mt-auto grid grid-cols-2 gap-1.5 pt-2">
                  <button
                    type="button"
                    onClick={() => handleView(product)}
                    className="inline-flex w-full items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white px-2 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                    title="Ver detalle"
                  >
                    <Eye size={14} />
                    Ver
                  </button>
                  <button
                    type="button"
                    onClick={() => handleEdit(product)}
                    className="inline-flex w-full items-center justify-center gap-1 rounded-xl border border-blue-200 bg-blue-50 px-2 py-2 text-xs font-semibold text-blue-700 transition hover:bg-blue-100"
                    title="Editar"
                  >
                    <Edit size={14} />
                    Editar
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        {products.length === 0 && (
          <div className="col-span-full text-center py-12 bg-gray-50 rounded-lg border-2 border-dashed border-gray-200">
            <p className="text-gray-500">No hay productos registrados.</p>
            <button 
              onClick={handleNew}
              className="btn-ghost mt-2 text-blue-700"
            >
              Crear el primer producto
            </button>
          </div>
        )}
      </div>

      {isFormOpen && (
        <ProductForm 
          onClose={() => setIsFormOpen(false)}
          productToEdit={editingProduct}
          onDelete={editingProduct?.id ? () => handleDelete(editingProduct.id as string) : undefined}
          onSuccess={() => {
            // Success handler if needed (the snapshot listener updates the UI automatically)
          }}
        />
      )}

      {viewingProduct ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div
            className="relative flex max-h-[min(90vh,720px)] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="product-view-title"
          >
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <h2 id="product-view-title" className="text-lg font-bold text-slate-900">
                {viewingProduct.nombre}
              </h2>
              <button
                type="button"
                onClick={closeView}
                className="btn-icon shrink-0 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                aria-label="Cerrar"
              >
                <X size={22} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {viewingProduct.imagen_url ? (
                <div className="mb-4 aspect-video w-full overflow-hidden rounded-2xl bg-slate-100">
                  <img
                    src={viewingProduct.imagen_url}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                </div>
              ) : null}
              <div className="mb-4 flex flex-wrap gap-2">
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                  {getProductTypeLabel(viewingProduct.tipo)}
                </span>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-bold ${
                    viewingProduct.activo ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                  }`}
                >
                  {viewingProduct.activo ? 'Activo' : 'Inactivo'}
                </span>
              </div>
              <p className="text-sm leading-relaxed text-slate-600">
                {viewingProduct.descripcion || 'Sin descripción.'}
              </p>
              {viewingProduct.efoil_battery?.trim() ? (
                <p className="mt-3 text-sm text-slate-700">
                  <span className="font-semibold text-slate-800">Batería (efoil): </span>
                  {viewingProduct.efoil_battery.trim()}
                </p>
              ) : null}
              <div className="mt-5 space-y-4 border-t border-slate-100 pt-5 text-sm">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Precio</div>
                  <p className="mt-1 font-semibold text-slate-900">
                    €{formatPrice(getProductBaseDailyPrice(viewingProduct))} / día
                    <span className="ml-2 font-normal text-slate-500">
                      {viewingProduct.incluir_iva ? '(IVA incl.)' : 'sin IVA'}
                    </span>
                  </p>
                  {viewingProduct.incluir_iva ? (
                    <p className="mt-1 text-emerald-700">
                      Total mostrado: €{formatPrice(getProductDailyPrice(viewingProduct))} / día
                    </p>
                  ) : null}
                  {viewingProduct.precio_hora && viewingProduct.precio_hora > 0 ? (
                    <p className="mt-2 text-slate-600">Hora: €{formatPrice(viewingProduct.precio_hora)}</p>
                  ) : null}
                  {(Number(viewingProduct.precio_temporada_baja || 0) > 0 ||
                    Number(viewingProduct.precio_temporada_alta || 0) > 0) && (
                    <ul className="mt-3 space-y-1 text-slate-600">
                      {Number(viewingProduct.precio_temporada_baja || 0) > 0 ? (
                        <li>
                          Temporada baja (abr–jun, sep–oct): €
                          {formatPrice(Number(viewingProduct.precio_temporada_baja))} / día base
                        </li>
                      ) : null}
                      {Number(viewingProduct.precio_temporada_alta || 0) > 0 ? (
                        <li>
                          Temporada alta (jul–ago): €
                          {formatPrice(Number(viewingProduct.precio_temporada_alta))} / día base
                        </li>
                      ) : null}
                    </ul>
                  )}
                </div>
                {(Number(viewingProduct.instructor_price_per_day || 0) > 0 ||
                  Number(viewingProduct.fuel_price_per_day || 0) > 0) && (
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Extras</div>
                    <ul className="mt-2 list-inside list-disc space-y-1 text-slate-700">
                      {Number(viewingProduct.instructor_price_per_day || 0) > 0 ? (
                        <li>
                          Monitor: €
                          {formatPrice(
                            Number(viewingProduct.instructor_price_per_day || 0) *
                              (viewingProduct.instructor_incluir_iva ? 1.21 : 1)
                          )}
                          / día
                          {viewingProduct.instructor_incluir_iva ? ' (IVA incl.)' : ''}
                        </li>
                      ) : null}
                      {Number(viewingProduct.fuel_price_per_day || 0) > 0 ? (
                        <li>Fuel: €{formatPrice(Number(viewingProduct.fuel_price_per_day || 0))} / día</li>
                      ) : null}
                    </ul>
                  </div>
                )}
                {getConfiguredMonths(viewingProduct).length > 0 ? (
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                      Precios por mes
                    </div>
                    <ul className="mt-2 grid gap-1 text-slate-700 sm:grid-cols-2">
                      {getConfiguredMonths(viewingProduct).map(({ key, label, monthIndex }) => (
                        <li key={key} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
                          {label}: €{formatPrice(getSeasonalBasePrice(viewingProduct, monthIndex))}
                          <span className="text-slate-500"> / día</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {viewingProduct.comision !== undefined && viewingProduct.comision > 0 ? (
                  <p className="text-slate-600">
                    Comisión broker/agencia: <span className="font-semibold">{viewingProduct.comision}%</span>
                  </p>
                ) : null}
              </div>
            </div>
            <div className="flex shrink-0 flex-col gap-2 border-t border-slate-100 bg-slate-50 px-5 py-4 sm:flex-row sm:justify-end">
              <button type="button" onClick={closeView} className="btn-outline w-full sm:w-auto">
                Cerrar
              </button>
              <button type="button" onClick={openEditFromView} className="btn-primary w-full sm:w-auto">
                Editar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
