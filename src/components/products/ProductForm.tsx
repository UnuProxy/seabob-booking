'use client';

import { useState } from 'react';
import { Product, ProductType } from '@/types';
import { addDoc, collection, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '@/lib/firebase/config';
import { X } from 'lucide-react';

interface ProductFormProps {
  onClose: () => void;
  productToEdit?: Product | null;
  onSuccess: () => void;
}

export function ProductForm({ onClose, productToEdit, onSuccess }: ProductFormProps) {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState<Partial<Product>>({
    nombre: '',
    descripcion: '',
    precio_diario: undefined,
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
      const productData = {
        ...formData,
        precio_diario: Number(formData.precio_diario) || 0,
        comision: Number(formData.comision) || 0,
        creado_por: auth.currentUser?.uid,
        updated_at: serverTimestamp(),
      };

      if (productToEdit?.id) {
        await updateDoc(doc(db, 'products', productToEdit.id), productData);
      } else {
        await addDoc(collection(db, 'products'), {
          ...productData,
          creado_en: serverTimestamp(),
        });
      }

      onSuccess();
      onClose();
    } catch (error) {
      console.error('Error saving product:', error);
      alert('Error al guardar el producto');
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-gray-200 flex justify-between items-center">
          <h2 className="text-xl font-bold text-gray-800">
            {productToEdit ? 'Editar Producto' : 'Nuevo Producto'}
          </h2>
          <button onClick={onClose} className="btn-icon text-slate-500 hover:text-slate-700 hover:bg-slate-100">
            <X size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="col-span-2">
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

            <div className="col-span-2">
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

            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">URL Imagen</label>
              <input
                type="url"
                value={formData.imagen_url}
                onChange={(e) => setFormData({ ...formData, imagen_url: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 outline-none text-black"
                placeholder="https://..."
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="btn-outline"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="btn-primary disabled:opacity-50"
            >
              {loading ? 'Guardando...' : 'Guardar Producto'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
