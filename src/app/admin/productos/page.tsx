'use client';

import { useEffect, useState } from 'react';
import { Product } from '@/types';
import { collection, onSnapshot, query, orderBy, deleteDoc, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { Edit, Trash2, Power, PowerOff } from 'lucide-react';
import { ProductForm } from '@/components/products/ProductForm';

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {products.map((product) => (
          <div key={product.id} className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden flex flex-col">
            <div className="h-48 bg-gray-100 relative">
              {product.imagen_url ? (
                <img 
                  src={product.imagen_url} 
                  alt={product.nombre} 
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="flex items-center justify-center h-full text-gray-400">
                  Sin Imagen
                </div>
              )}
              <div className={`absolute top-2 right-2 px-2 py-1 rounded text-xs font-bold ${
                product.activo ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
              }`}>
                {product.activo ? 'ACTIVO' : 'INACTIVO'}
              </div>
            </div>
            
            <div className="p-4 flex-1 flex flex-col">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <h3 className="text-lg font-bold text-gray-900">{product.nombre}</h3>
                  <span className="text-xs uppercase text-gray-500 font-semibold tracking-wider">
                    {product.tipo}
                  </span>
                </div>
              </div>
              
              <p className="text-gray-600 text-sm mb-4 line-clamp-2 flex-1">
                {product.descripcion}
              </p>
              
              <div className="flex items-center justify-between mt-auto pt-4 border-t border-gray-100">
                <div className="text-sm">
                  <div className="font-semibold text-gray-900">€{product.precio_diario} <span className="text-gray-500 font-normal">/ día</span></div>
                  {product.precio_hora > 0 && (
                    <div className="text-gray-500">€{product.precio_hora} / hora</div>
                  )}
                </div>
                
                <div className="flex gap-2">
                  <button 
                    onClick={() => handleEdit(product)}
                    className="btn-icon text-blue-600 hover:bg-blue-50"
                    title="Editar"
                  >
                    <Edit size={18} />
                  </button>
                  <button 
                    onClick={() => handleDelete(product.id)}
                    className="btn-icon text-rose-600 hover:bg-rose-50"
                    title="Eliminar"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}

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
          onSuccess={() => {
            // Success handler if needed (the snapshot listener updates the UI automatically)
          }}
        />
      )}
    </div>
  );
}
