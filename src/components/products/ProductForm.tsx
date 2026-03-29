'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Product, ProductType } from '@/types';
import { addDoc, collection, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { app, db, auth, storageBucketCandidates } from '@/lib/firebase/config';
import { supportsEfoilBatteryOption, supportsFuelOption, supportsInstructorOption } from '@/lib/bookingExtras';
import { SEASONAL_PRICE_MONTHS } from '@/lib/productPricing';
import { deleteObject, getDownloadURL, getStorage, ref as storageRef, uploadBytes } from 'firebase/storage';
import { ImageUp, Trash2, X } from 'lucide-react';

interface ProductFormProps {
  onClose: () => void;
  productToEdit?: Product | null;
  onSuccess: () => void;
  onDelete?: () => void;
}

const getErrorMessage = (error: unknown): string =>
  typeof error === 'object' && error && 'message' in error
    ? String((error as { message?: unknown }).message || '')
    : '';

const getErrorCode = (error: unknown): string =>
  typeof error === 'object' && error && 'code' in error
    ? String((error as { code?: unknown }).code || '')
    : '';

const shouldRetryWithAnotherBucket = (error: unknown): boolean => {
  const code = getErrorCode(error);
  const message = getErrorMessage(error).toLowerCase();
  if (code === 'storage/unknown') return true;

  return (
    message.includes('not found') ||
    message.includes('cors') ||
    message.includes('preflight') ||
    message.includes('err_failed') ||
    message.includes('failed to fetch')
  );
};

export function ProductForm({ onClose, productToEdit, onSuccess, onDelete }: ProductFormProps) {
  const [loading, setLoading] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [removeCurrentImage, setRemoveCurrentImage] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const formRef = useRef<HTMLFormElement | null>(null);
  const [formData, setFormData] = useState<Partial<Product>>({
    nombre: '',
    descripcion: '',
    precio_diario: undefined,
    precios_por_mes: {},
    efoil_battery: '',
    incluir_iva: true,
    comision: undefined,
    tipo: 'seabob',
    imagen_url: '',
    activo: true,
    ...productToEdit,
  });
  const firstConfiguredMonthlyPrice = SEASONAL_PRICE_MONTHS.map(({ key }) => formData.precios_por_mes?.[key]).find(
    (value) => value !== undefined && value !== null && Number(value) > 0
  );
  const supportsInstructorFields = supportsInstructorOption({ tipo: formData.tipo } as Product);
  const supportsFuelFields = supportsFuelOption({ tipo: formData.tipo } as Product);
  const supportsBatteryFields = supportsEfoilBatteryOption({ tipo: formData.tipo } as Product);
  const showInstructorInExtrasStep = supportsInstructorFields && !supportsBatteryFields;
  const showOnlyCommissionInExtrasStep = !showInstructorInExtrasStep && !supportsFuelFields;
  const editedProductSupportsBattery = supportsEfoilBatteryOption(productToEdit ?? null);
  const hasMonthlyOverrides = SEASONAL_PRICE_MONTHS.some(
    ({ key }) => Number(formData.precios_por_mes?.[key] || 0) > 0
  );
  const [showSeasonalOverrides, setShowSeasonalOverrides] = useState(
    Boolean(
      (editedProductSupportsBattery && productToEdit?.efoil_battery) || hasMonthlyOverrides
    )
  );
  const [showExtras, setShowExtras] = useState(
    Boolean(
      productToEdit?.comision ||
        productToEdit?.instructor_price_per_day ||
        productToEdit?.fuel_price_per_day
    )
  );

  useEffect(() => {
    setFormData((prev) => {
      const next = { ...prev };

      if (!supportsInstructorOption({ tipo: next.tipo } as Product)) {
        next.instructor_price_per_day = undefined;
        next.instructor_incluir_iva = false;
      }

      if (!supportsFuelOption({ tipo: next.tipo } as Product)) {
        next.fuel_price_per_day = undefined;
      }

      if (!supportsEfoilBatteryOption({ tipo: next.tipo } as Product)) {
        next.efoil_battery = '';
      }

      return next;
    });
  }, [formData.tipo]);

  useEffect(() => {
    if (supportsFuelFields || showInstructorInExtrasStep) {
      setShowExtras(true);
    }
  }, [showInstructorInExtrasStep, supportsFuelFields]);

  useLayoutEffect(() => {
    if (!formRef.current) return;
    formRef.current.scrollTop = 0;
    requestAnimationFrame(() => {
      if (formRef.current) {
        formRef.current.scrollTop = 0;
      }
    });
  }, [currentStep]);

  const steps = [
    { title: 'Basico', description: 'Nombre, tipo y estado' },
    { title: 'Precios', description: 'Tarifa y extras opcionales' },
    { title: 'Imagen', description: 'Foto y confirmacion' },
  ];
  const isLastStep = currentStep === steps.length - 1;

  const setStep = (nextStep: number) => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    setCurrentStep(Math.min(Math.max(nextStep, 0), steps.length - 1));
  };

  const goToNextStep = () => {
    if (currentStep === 0 && !String(formData.nombre || '').trim()) {
      alert('Añade al menos el nombre del producto para continuar.');
      return;
    }
    setStep(currentStep + 1);
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
  };

  const handleSave = async () => {
    setLoading(true);

    try {
      if (!productToEdit?.id && !imageFile) {
        throw new Error('Por favor, sube una imagen.');
      }

      const previousImageUrl = productToEdit?.imagen_url?.trim() || '';
      const shouldDeleteCurrentImage = Boolean(productToEdit?.id && previousImageUrl && (removeCurrentImage || imageFile));
      const fallbackDailyPrice =
        Number(firstConfiguredMonthlyPrice) ||
        Number(formData.precio_diario) ||
        Number(productToEdit?.precio_diario) ||
        0;

      const productData: Record<string, unknown> = {
        ...formData,
        precio_diario: fallbackDailyPrice,
        instructor_price_per_day: supportsInstructorFields ? Number(formData.instructor_price_per_day) || 0 : 0,
        instructor_incluir_iva: supportsInstructorFields && Boolean(formData.instructor_incluir_iva),
        fuel_price_per_day: supportsFuelFields ? Number(formData.fuel_price_per_day) || 0 : 0,
        efoil_battery: supportsBatteryFields ? String(formData.efoil_battery ?? '').trim() : '',
        precio_temporada_baja: 0,
        precio_temporada_alta: 0,
        precios_por_mes: Object.fromEntries(
          SEASONAL_PRICE_MONTHS.map(({ key }) => {
            const value = formData.precios_por_mes?.[key];
            return [key, value === undefined ? null : Number(value) || 0];
          }).filter(([, value]) => value !== null)
        ),
        deposito: 0,
        incluir_iva: true,
        comision: Number(formData.comision) || 0,
        imagen_url: removeCurrentImage && !imageFile ? '' : formData.imagen_url || '',
        creado_por: auth.currentUser?.uid,
        updated_at: serverTimestamp(),
      };

      let productId = productToEdit?.id || '';

      if (productToEdit?.id) {
        await updateDoc(doc(db, 'products', productToEdit.id), productData);
      } else {
        const created = await addDoc(collection(db, 'products'), {
          ...productData,
          creado_en: serverTimestamp(),
        });
        productId = created.id;
      }

      if (imageFile && productId) {
        if (!imageFile.type.startsWith('image/')) {
          throw new Error('El archivo debe ser una imagen.');
        }
        if (imageFile.size > 6 * 1024 * 1024) {
          throw new Error('La imagen es demasiado grande (máx. 6MB).');
        }

        const safeName = imageFile.name
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9._-]+/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '');

        const path = `products/${productId}/${Date.now()}-${safeName || 'image'}`;
        const bucketsToTry = storageBucketCandidates.length > 0 ? storageBucketCandidates : [undefined];
        let url = '';
        let lastError: unknown;
        const triedBuckets: string[] = [];

        for (const bucket of bucketsToTry) {
          try {
            triedBuckets.push(bucket || '(default)');
            const bucketStorage = bucket ? getStorage(app, `gs://${bucket}`) : getStorage(app);
            const fileRef = storageRef(bucketStorage, path);
            await uploadBytes(fileRef, imageFile, { contentType: imageFile.type });
            url = await getDownloadURL(fileRef);
            break;
          } catch (error) {
            lastError = error;
            const canRetry = shouldRetryWithAnotherBucket(error);
            if (!canRetry) {
              throw error;
            }
          }
        }

        if (!url) {
          const code = getErrorCode(lastError);
          const message = getErrorMessage(lastError).toLowerCase();
          const bucketLikelyMissing =
            code === 'storage/unknown' ||
            message.includes('not found') ||
            message.includes('cors') ||
            message.includes('preflight');

          if (bucketLikelyMissing) {
            throw new Error(
              `No se pudo acceder a ningún bucket de Firebase Storage (${triedBuckets.join(', ')}). ` +
              'Revisa en Firebase Console > Storage el nombre exacto del bucket y actualiza NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET.'
            );
          }

          throw lastError || new Error('No se pudo subir la imagen al bucket de Storage.');
        }

        await updateDoc(doc(db, 'products', productId), {
          imagen_url: url,
          updated_at: serverTimestamp(),
        });

        if (shouldDeleteCurrentImage && previousImageUrl && previousImageUrl !== url) {
          try {
            const previousImageRef = storageRef(getStorage(app), previousImageUrl);
            await deleteObject(previousImageRef);
          } catch (cleanupError) {
            console.warn('No se pudo eliminar la imagen anterior:', cleanupError);
          }
        }
      } else if (productToEdit?.id) {
        if (shouldDeleteCurrentImage && previousImageUrl) {
          try {
            const previousImageRef = storageRef(getStorage(app), previousImageUrl);
            await deleteObject(previousImageRef);
          } catch (cleanupError) {
            console.warn('No se pudo eliminar la imagen anterior:', cleanupError);
          }
        }
      }

      onSuccess();
      onClose();
    } catch (error) {
      console.error('Error saving product:', error);
      const message = getErrorMessage(error);
      alert(message || 'Error al guardar el producto');
    } finally {
      setLoading(false);
    }
  };

  // Calculate example commission
  const examplePrice = 500;
  const exampleCommission = formData.comision 
    ? (examplePrice * (formData.comision / 100)).toFixed(2)
    : '0.00';

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-stretch sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full h-svh sm:h-auto sm:max-h-[90vh] sm:max-w-4xl rounded-none sm:rounded-3xl flex flex-col shadow-2xl">
        <div className="sticky top-0 z-10 bg-white p-4 sm:p-6 border-b border-gray-200 flex justify-between items-center">
          <div>
            <h2 className="text-xl font-bold text-gray-800">
              {productToEdit ? 'Editar Producto' : 'Nuevo Producto'}
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              Empieza con lo esencial. El resto es opcional.
            </p>
          </div>
          <button onClick={onClose} className="btn-icon text-slate-500 hover:text-slate-700 hover:bg-slate-100">
            <X size={24} />
          </button>
        </div>

        <form ref={formRef} onSubmit={handleFormSubmit} className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 bg-slate-50">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              {steps.map((step, index) => {
                const isActive = index === currentStep;
                const isDone = index < currentStep;
                return (
                  <button
                    key={step.title}
                    type="button"
                    onClick={() => setStep(index)}
                    className={`inline-flex items-center gap-2 rounded-full px-3 py-2 text-left text-xs transition ${
                      isActive
                        ? 'bg-slate-900 text-white'
                        : isDone
                          ? 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200/80'
                          : 'bg-slate-50 text-slate-500 ring-1 ring-slate-200/80'
                    }`}
                  >
                    <span
                      className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold ${
                        isActive
                          ? 'bg-white/15 text-white'
                          : isDone
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-white text-slate-500 ring-1 ring-slate-200'
                      }`}
                    >
                      {index + 1}
                    </span>
                    <span className="font-medium">{step.title}</span>
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-sm text-slate-500">
              Paso {currentStep + 1} de {steps.length}. {steps[currentStep].description}.
            </p>
          </div>

          {currentStep === 0 ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Básico</h3>
                <p className="text-sm text-slate-500">Nombre, tipo y estado.</p>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Nombre del Producto</label>
                <input
                  type="text"
                  required
                  value={formData.nombre}
                  onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-300 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none text-black"
                  placeholder="ej. SeaBob F5 SR"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Descripción</label>
                <textarea
                  rows={3}
                  value={formData.descripcion}
                  onChange={(e) => setFormData({ ...formData, descripcion: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-300 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none text-black"
                  placeholder="Descripción breve"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tipo</label>
                <select
                  value={formData.tipo}
                  onChange={(e) => setFormData({ ...formData, tipo: e.target.value as ProductType })}
                  className="w-full px-4 py-3 border border-gray-300 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none text-black"
                >
                  <option value="seabob">SeaBob</option>
                  <option value="jetski">Jet Ski</option>
                  <option value="tabla">Efoil</option>
                  <option value="seascooter">Seascooter</option>
                  <option value="servicio">Servicio Adicional</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Estado</label>
                <select
                  value={formData.activo ? 'true' : 'false'}
                  onChange={(e) => setFormData({ ...formData, activo: e.target.value === 'true' })}
                  className="w-full px-4 py-3 border border-gray-300 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none text-black"
                >
                  <option value="true">Activo</option>
                  <option value="false">Inactivo</option>
                </select>
              </div>
            </div>
          </section>
          ) : null}

          {currentStep === 1 ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
            <div>
              <h3 className="text-lg font-bold text-slate-900">Precios</h3>
              <p className="text-sm text-slate-500">Configura la tarifa base. Los precios mostrados incluyen el calculo de IVA.</p>
            </div>

            <div className="mt-5 space-y-5">
              <div className="rounded-2xl border border-slate-200 bg-slate-50/70">
                <button
                  type="button"
                  onClick={() => setShowSeasonalOverrides((prev) => !prev)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left sm:px-5"
                >
                  <div>
                    <h4 className="text-sm font-bold text-slate-900">Precios por mes</h4>
                    <p className="mt-1 text-xs text-slate-500">
                      {showSeasonalOverrides
                        ? supportsBatteryFields
                          ? 'Configura bateria efoil y los precios mensuales de temporada.'
                          : 'Configura los precios mensuales de temporada.'
                        : 'Opcional. Solo si quieres ajustar la tarifa por mes.'}
                    </p>
                  </div>
                  <span className="text-xs font-semibold text-slate-500">
                    {showSeasonalOverrides ? 'Ocultar' : 'Mostrar'}
                  </span>
                </button>

                {showSeasonalOverrides ? (
                  <div className="border-t border-slate-200 px-4 pb-4 pt-4 sm:px-5 sm:pb-5 space-y-4">
                    {supportsBatteryFields ? (
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div className="md:col-span-2">
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Batería / autonomía (efoil)
                          </label>
                          <input
                            type="text"
                            value={formData.efoil_battery ?? ''}
                            onChange={(e) => setFormData({ ...formData, efoil_battery: e.target.value })}
                            className="w-full px-4 py-3 border border-gray-300 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none text-black bg-white"
                            placeholder="Ej. 2 kWh, ~90 min, modelo…"
                          />
                          <p className="text-xs text-gray-500 mt-1">Opcional. Visible en ficha y útil para efoils.</p>
                        </div>

                        {supportsInstructorFields ? (
                          <>
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">
                                Monitor / Instructor (€ / día)
                              </label>
                              <input
                                type="number"
                                min="0"
                                step="1"
                                value={formData.instructor_price_per_day ?? ''}
                                onChange={(e) =>
                                  setFormData({
                                    ...formData,
                                    instructor_price_per_day: e.target.value === '' ? undefined : Number(e.target.value),
                                  })
                                }
                                className="w-full px-4 py-3 border border-gray-300 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none text-black bg-white"
                                placeholder="0"
                              />
                              <p className="text-xs text-gray-500 mt-1">
                                Precio del monitor para efoil por día.
                              </p>
                            </div>

                            <label className="flex items-start gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-4">
                              <input
                                type="checkbox"
                                checked={Boolean(formData.instructor_incluir_iva)}
                                onChange={(e) =>
                                  setFormData({
                                    ...formData,
                                    instructor_incluir_iva: e.target.checked,
                                  })
                                }
                                className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                              />
                              <div>
                                <span className="block text-sm font-medium text-gray-800">
                                  Incluir IVA (+21%) en monitor
                                </span>
                                <span className="block text-xs text-gray-500 mt-1">
                                  El monitor se mostrará y se cobrará con IVA incluido.
                                </span>
                              </div>
                            </label>

                            {formData.instructor_price_per_day !== undefined &&
                            Number(formData.instructor_price_per_day) > 0 &&
                            formData.instructor_incluir_iva ? (
                              <p className="text-xs font-medium text-emerald-700 md:col-span-2">
                                Monitor con IVA: €
                                {Math.round(Number(formData.instructor_price_per_day) * 1.21).toLocaleString('es-ES', {
                                  maximumFractionDigits: 0,
                                })}
                                / día
                              </p>
                            ) : null}
                          </>
                        ) : null}
                      </div>
                    ) : null}

                    <div>
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                        {SEASONAL_PRICE_MONTHS.map(({ key, label }) => (
                          <div key={key} className="rounded-2xl border border-slate-200 bg-white p-3">
                            <label className="block text-xs font-semibold text-gray-600 mb-2">{label}</label>
                            <input
                              type="number"
                              min="0"
                              step="1"
                              value={formData.precios_por_mes?.[key] ?? ''}
                              onChange={(e) =>
                                setFormData({
                                  ...formData,
                                  precios_por_mes: {
                                    ...formData.precios_por_mes,
                                    [key]: e.target.value === '' ? undefined : Number(e.target.value),
                                  },
                                })
                              }
                              className="w-full px-3 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-black bg-white"
                              placeholder="0"
                              inputMode="numeric"
                            />
                            {formData.precios_por_mes?.[key] !== undefined &&
                            Number(formData.precios_por_mes?.[key]) > 0 ? (
                              <p className="text-xs font-medium text-emerald-700 mt-2">
                                IVA: €
                                {Math.round(Number(formData.precios_por_mes?.[key]) * 1.21).toLocaleString('es-ES', {
                                  maximumFractionDigits: 0,
                                })}
                              </p>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </section>
          ) : null}

          {currentStep === 1 ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
            <button
              type="button"
              onClick={() => setShowExtras((prev) => !prev)}
              className="flex w-full items-center justify-between gap-3 text-left"
            >
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  {showOnlyCommissionInExtrasStep ? 'Comisión' : 'Extras y comisión'}
                </h3>
                <p className="text-sm text-slate-500">
                  {showOnlyCommissionInExtrasStep
                    ? 'Opcional. Solo porcentaje de comisión para brokers/agencias.'
                    : 'Opcional. Comisión, monitor y fuel.'}
                </p>
              </div>
              <span className="text-xs font-semibold text-slate-500">
                {showExtras ? 'Ocultar' : 'Mostrar'}
              </span>
            </button>

            {showExtras ? (
            <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Comisión Broker/Agencia (%)
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  value={formData.comision ?? ''}
                  onChange={(e) => setFormData({ ...formData, comision: e.target.value === '' ? undefined : Number(e.target.value) })}
                  className="w-full px-4 py-3 border border-gray-300 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none text-black"
                  placeholder="ej. 15"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Comisión para brokers/agencias.
                </p>
                {formData.comision !== undefined && formData.comision > 0 && (
                  <p className="text-xs text-green-600 mt-2 font-medium">
                    Ejemplo: €{exampleCommission} por una reserva de €{examplePrice}
                  </p>
                )}
              </div>

              {showInstructorInExtrasStep ? (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Monitor / Instructor (€ / día)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={formData.instructor_price_per_day ?? ''}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          instructor_price_per_day: e.target.value === '' ? undefined : Number(e.target.value),
                        })
                      }
                      className="w-full px-4 py-3 border border-gray-300 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none text-black"
                      placeholder="0"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Precio del monitor por día. Se mostrará con IVA cuando actives la opción inferior.
                    </p>
                  </div>

                  <label className="flex items-start gap-3 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4">
                    <input
                      type="checkbox"
                      checked={Boolean(formData.instructor_incluir_iva)}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          instructor_incluir_iva: e.target.checked,
                        })
                      }
                      className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <div>
                      <span className="block text-sm font-medium text-gray-800">
                        Incluir IVA (+21%) en monitor
                      </span>
                      <span className="block text-xs text-gray-500 mt-1">
                        El monitor se mostrará y se cobrará con IVA incluido.
                      </span>
                    </div>
                  </label>

                  {formData.instructor_price_per_day !== undefined && Number(formData.instructor_price_per_day) > 0 && formData.instructor_incluir_iva ? (
                    <p className="text-xs font-medium text-emerald-700">
                      Monitor con IVA: €
                      {Math.round(Number(formData.instructor_price_per_day) * 1.21).toLocaleString('es-ES', {
                        maximumFractionDigits: 0,
                      })}
                      / día
                    </p>
                  ) : null}
                </div>
              ) : null}

              {supportsFuelFields ? (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Fuel / Combustible (€ / día)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={formData.fuel_price_per_day ?? ''}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        fuel_price_per_day: e.target.value === '' ? undefined : Number(e.target.value),
                      })
                    }
                    className="w-full px-4 py-3 border border-gray-300 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none text-black"
                    placeholder="0"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Precio del combustible por día. Este extra no lleva IVA.
                  </p>
                </div>
              </div>
              ) : null}
            </div>
            ) : null}
          </section>
          ) : null}

          {currentStep === 2 ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
            <div>
              <h3 className="text-lg font-bold text-slate-900">Imagen</h3>
              <p className="text-sm text-slate-500">Sube o reemplaza la foto del producto y revisa antes de guardar.</p>
            </div>

            <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                    <ImageUp size={18} className="text-slate-600" />
                    Subir imagen
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    JPG/PNG/WebP. Máx. 6MB.
                  </p>
                </div>
                {imageFile && (
                  <button
                    type="button"
                    onClick={() => setImageFile(null)}
                    className="btn-icon text-slate-500 hover:text-slate-700 hover:bg-white"
                    title="Quitar imagen seleccionada"
                  >
                    <X size={18} />
                  </button>
                )}
              </div>

              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0] || null;
                  setImageFile(file);
                  if (file) setRemoveCurrentImage(false);
                }}
                className="mt-3 block w-full text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-slate-800"
              />

              {productToEdit?.imagen_url && (
                <div className="mt-3 space-y-2">
                  <p className="text-xs text-slate-500">
                    {imageFile
                      ? 'La imagen actual se reemplazará al guardar.'
                      : removeCurrentImage
                        ? 'La imagen actual se eliminará al guardar.'
                        : 'Este producto ya tiene una imagen guardada.'}
                  </p>
                  {!imageFile && (
                    <button
                      type="button"
                      onClick={() => setRemoveCurrentImage((prev) => !prev)}
                      className="text-xs font-semibold text-rose-700 hover:text-rose-800 underline"
                    >
                      {removeCurrentImage ? 'Cancelar eliminación de imagen' : 'Eliminar imagen actual'}
                    </button>
                  )}
                </div>
              )}
            </div>
          </section>
          ) : null}

          <div className="sticky bottom-0 -mx-4 sm:mx-0 mt-2 bg-white border-t border-gray-200 px-4 sm:px-0 pt-4 pb-4 sm:pb-0">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="order-2 sm:order-1">
                {productToEdit?.id && onDelete ? (
                  <button
                    type="button"
                    onClick={onDelete}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 sm:w-auto"
                  >
                    <Trash2 size={16} />
                    Eliminar producto
                  </button>
                ) : null}
              </div>
              <div className="order-1 flex flex-col-reverse gap-3 sm:order-2 sm:flex-row">
                <button
                  type="button"
                  onClick={onClose}
                  className="btn-outline w-full sm:w-auto"
                >
                  Cancelar
                </button>
                {currentStep > 0 ? (
                  <button
                    type="button"
                    onClick={() => setStep(currentStep - 1)}
                    className="btn-outline w-full sm:w-auto"
                  >
                    Atras
                  </button>
                ) : null}
                {isLastStep ? (
                  <button
                    type="button"
                    onClick={() => void handleSave()}
                    disabled={loading}
                    className="btn-primary disabled:opacity-50 w-full sm:w-auto"
                  >
                    {loading ? 'Guardando...' : 'Guardar Producto'}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={goToNextStep}
                    className="btn-primary w-full sm:w-auto"
                  >
                    Siguiente
                  </button>
                )}
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
