'use client';

import { useState } from 'react';
import { Product, ProductType } from '@/types';
import { addDoc, collection, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth, storage } from '@/lib/firebase/config';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { ImageUp, X } from 'lucide-react';

interface ProductFormProps {
  onClose: () => void;
  productToEdit?: Product | null;
  onSuccess: () => void;
}

export function ProductForm({ onClose, productToEdit, onSuccess }: ProductFormProps) {
  const [loading, setLoading] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [formData, setFormData] = useState<Partial<Product>>({
    nombre: '',
    descripcion: '',
    precio_diario: undefined,
    deposito: undefined,
    comision: undefined,
    tipo: 'seabob',
    imagen_url: '',
    activo: true,
    ...productToEdit,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (!productToEdit?.id && !imageFile) {
        throw new Error('Por favor, sube una imagen.');
      }

      const productData: Record<string, unknown> = {
        ...formData,
        precio_diario: Number(formData.precio_diario) || 0,
        deposito: Number(formData.deposito) || 0,
        comision: Number(formData.comision) || 0,
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
        const fileRef = storageRef(storage, path);
        await uploadBytes(fileRef, imageFile, { contentType: imageFile.type });
        const url = await getDownloadURL(fileRef);

        await updateDoc(doc(db, 'products', productId), {
          imagen_url: url,
          updated_at: serverTimestamp(),
        });
      } else if (productToEdit?.id) {
        // If editing and no file selected, keep existing imagen_url as-is.
      }

      onSuccess();
      onClose();
    } catch (error) {
      console.error('Error saving product:', error);
      const message =
        typeof error === 'object' && error && 'message' in error
          ? String((error as { message?: unknown }).message || '')
          : '';
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
      <div className="bg-white w-full h-[100svh] sm:h-auto sm:max-h-[90vh] sm:max-w-2xl rounded-none sm:rounded-lg flex flex-col">
        <div className="sticky top-0 z-10 bg-white p-4 sm:p-6 border-b border-gray-200 flex justify-between items-center">
          <h2 className="text-xl font-bold text-gray-800">
            {productToEdit ? 'Editar Producto' : 'Nuevo Producto'}
          </h2>
          <button onClick={onClose} className="btn-icon text-slate-500 hover:text-slate-700 hover:bg-slate-100">
            <X size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-6">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Nombre del Producto</label>
              <input
                type="text"
                required
                value={formData.nombre}
                onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 outline-none text-black"
                placeholder="ej. SeaBob F5 SR"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Descripción</label>
              <textarea
                rows={3}
                value={formData.descripcion}
                onChange={(e) => setFormData({ ...formData, descripcion: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 outline-none text-black"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tipo</label>
              <select
                value={formData.tipo}
                onChange={(e) => setFormData({ ...formData, tipo: e.target.value as ProductType })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 outline-none text-black"
              >
                <option value="seabob">SeaBob</option>
                <option value="jetski">Jet Ski</option>
                <option value="servicio">Servicio Adicional</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Estado</label>
              <select
                value={formData.activo ? 'true' : 'false'}
                onChange={(e) => setFormData({ ...formData, activo: e.target.value === 'true' })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 outline-none text-black"
              >
                <option value="true">Activo</option>
                <option value="false">Inactivo</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Precio por Día (€)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                required
                value={formData.precio_diario ?? ''}
                onChange={(e) => setFormData({ ...formData, precio_diario: e.target.value === '' ? undefined : Number(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 outline-none text-black"
                placeholder="0"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Depósito reembolsable (€)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={formData.deposito ?? ''}
                onChange={(e) => setFormData({ ...formData, deposito: e.target.value === '' ? undefined : Number(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 outline-none text-black"
                placeholder="0"
              />
              <p className="text-xs text-gray-500 mt-1">
                Se cobra como fianza y se reembolsa si la devolución es correcta.
              </p>
            </div>

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
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 outline-none text-black"
                placeholder="ej. 15"
              />
              <p className="text-xs text-gray-500 mt-1">
                Porcentaje que se paga a brokers/agencias cuando reservan este producto.
              </p>
              {formData.comision !== undefined && formData.comision > 0 && (
                <p className="text-xs text-green-600 mt-1 font-medium">
                  Ejemplo: en una reserva de €{examplePrice}, la comisión sería €{exampleCommission}
                </p>
              )}
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Imagen</label>
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4">
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
                  }}
                  className="mt-3 block w-full text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-slate-800"
                />

                {productToEdit?.imagen_url && !imageFile && (
                  <p className="text-xs text-slate-500 mt-2">
                    Este producto ya tiene una imagen guardada. Sube otra para reemplazarla.
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="sticky bottom-0 -mx-4 sm:mx-0 mt-2 bg-white border-t border-gray-200 px-4 sm:px-0 pt-4 pb-4 sm:pb-0">
            <div className="flex flex-col-reverse sm:flex-row justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="btn-outline w-full sm:w-auto"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="btn-primary disabled:opacity-50 w-full sm:w-auto"
            >
              {loading ? 'Guardando...' : 'Guardar Producto'}
            </button>
          </div>
          </div>
        </form>
      </div>
    </div>
  );
}
