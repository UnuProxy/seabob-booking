'use client';

import { useState, useEffect } from 'react';
import { collection, query, where, getDocs, doc, setDoc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { Product, DailyStock } from '@/types';
import { useAuthStore } from '@/store/authStore';
import { Calendar, Save, AlertCircle, Loader2, ChevronLeft, ChevronRight, Layers, X } from 'lucide-react';
import { format, addDays, subDays, eachDayOfInterval, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import clsx from 'clsx';

export default function DailyStockPage() {
  const { user } = useAuthStore();
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [products, setProducts] = useState<Product[]>([]);
  const [stocks, setStocks] = useState<Record<string, DailyStock>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [showBulkModal, setShowBulkModal] = useState(false);

  // Fetch products once
  useEffect(() => {
    const fetchProducts = async () => {
      try {
        const q = query(collection(db, 'products'), where('activo', '==', true));
        const snapshot = await getDocs(q);
        const productsData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as Product[];
        setProducts(productsData);
      } catch (err) {
        console.error('Error fetching products:', err);
        setError('Error al cargar productos');
      }
    };
    fetchProducts();
  }, []);

  // Fetch stock when date or products change
  useEffect(() => {
    const fetchStock = async () => {
      if (products.length === 0) return;
      
      setLoading(true);
      try {
        const dateStr = format(selectedDate, 'yyyy-MM-dd');
        const q = query(
          collection(db, 'daily_stock'), 
          where('fecha', '==', dateStr)
        );
        
        const snapshot = await getDocs(q);
        const stockMap: Record<string, DailyStock> = {};
        
        snapshot.docs.forEach(doc => {
          const data = doc.data() as DailyStock;
          stockMap[data.producto_id] = { ...data, id: doc.id };
        });
        
        setStocks(stockMap);
      } catch (err) {
        console.error('Error fetching stock:', err);
        setError('Error al cargar el stock diario');
      } finally {
        setLoading(false);
      }
    };

    fetchStock();
  }, [selectedDate, products]);

  const handleStockChange = (productId: string, value: string) => {
    const numValue = parseInt(value) || 0;
    setStocks(prev => ({
      ...prev,
      [productId]: {
        ...prev[productId],
        producto_id: productId,
        cantidad_disponible: numValue,
        cantidad_reservada: prev[productId]?.cantidad_reservada || 0,
        fecha: format(selectedDate, 'yyyy-MM-dd'),
        id: prev[productId]?.id || 'temp',
        actualizado_por: user?.id || '',
        timestamp: new Date() 
      }
    }));
  };

  const saveStock = async (productId: string) => {
    if (!user) return;
    
    setSaving(productId);
    setSuccessMessage('');
    setError('');

    try {
      const dateStr = format(selectedDate, 'yyyy-MM-dd');
      const stockData = stocks[productId];
      const stockId = `${dateStr}_${productId}`;

      const dataToSave = {
        fecha: dateStr,
        producto_id: productId,
        cantidad_disponible: stockData.cantidad_disponible,
        cantidad_reservada: stockData.cantidad_reservada || 0,
        actualizado_por: user.id,
        timestamp: serverTimestamp()
      };

      await setDoc(doc(db, 'daily_stock', stockId), dataToSave);
      
      setStocks(prev => ({
        ...prev,
        [productId]: {
          ...prev[productId],
          id: stockId
        }
      }));
      
      setSuccessMessage('Stock actualizado correctamente');
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (err) {
      console.error('Error saving stock:', err);
      setError('Error al guardar el stock');
    } finally {
      setSaving(null);
    }
  };

  const changeDate = (days: number) => {
    setSelectedDate(prev => days > 0 ? addDays(prev, days) : subDays(prev, Math.abs(days)));
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8 flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold text-gray-800 mb-2">Control de Stock Diario</h1>
          <p className="text-gray-500">Gestiona la disponibilidad de tus productos por día.</p>
        </div>
        
        <button
          onClick={() => setShowBulkModal(true)}
          className="btn-primary"
        >
          <Layers size={20} />
          <span>Generar Stock Masivo</span>
        </button>
      </div>

      {/* Date Navigation */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 mb-8 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-start">
          <button 
            onClick={() => changeDate(-1)}
            className="btn-icon text-slate-600 hover:bg-slate-100"
          >
            <ChevronLeft size={24} />
          </button>
          
          <div className="flex items-center gap-3 px-2">
            <Calendar className="text-blue-600" size={24} />
            <input 
              type="date"
              value={format(selectedDate, 'yyyy-MM-dd')}
              onChange={(e) => {
                if (e.target.value) {
                  setSelectedDate(parseISO(e.target.value));
                }
              }}
              className="text-xl font-bold text-gray-800 bg-transparent border-none focus:ring-0 p-0 cursor-pointer hover:text-blue-600 transition-colors"
            />
          </div>

          <button 
            onClick={() => changeDate(1)}
            className="btn-icon text-slate-600 hover:bg-slate-100"
          >
            <ChevronRight size={24} />
          </button>
        </div>
        
        <div className="text-sm text-gray-500 font-medium bg-gray-50 px-3 py-1.5 rounded-lg">
          {format(selectedDate, "EEEE, d 'de' MMMM yyyy", { locale: es })}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border-l-4 border-red-500 p-4 mb-6 rounded-r-lg flex items-center gap-3 text-red-700">
          <AlertCircle size={24} />
          <p>{error}</p>
        </div>
      )}

      {successMessage && (
        <div className="bg-green-50 border-l-4 border-green-500 p-4 mb-6 rounded-r-lg flex items-center gap-3 text-green-700">
          <div className="h-6 w-6 rounded-full bg-green-100 flex items-center justify-center">
            <Save size={14} />
          </div>
          <p>{successMessage}</p>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-12">
          <Loader2 className="animate-spin text-blue-600 mb-3" size={48} />
          <p className="text-gray-500">Cargando inventario...</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {products.map(product => {
            const stock = stocks[product.id] || { cantidad_disponible: 0, cantidad_reservada: 0 };
            
            return (
              <div key={product.id} className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 flex flex-col sm:flex-row sm:items-center justify-between group hover:border-blue-200 transition-colors gap-6">
                <div className="flex items-center gap-4">
                  <div className="h-16 w-16 bg-gray-100 rounded-lg overflow-hidden shrink-0">
                    {product.imagen_url ? (
                      <img src={product.imagen_url} alt={product.nombre} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">No img</div>
                    )}
                  </div>
                  <div>
                    <h3 className="font-bold text-lg text-gray-900">{product.nombre}</h3>
                    <p className="text-sm text-gray-500 uppercase tracking-wide font-medium">{product.tipo}</p>
                  </div>
                </div>

                <div className="flex items-center gap-6 justify-end">
                  <div className="text-right">
                    <p className="text-xs text-gray-500 mb-1 font-medium uppercase">Reservados</p>
                    <span className="font-mono text-lg font-medium text-gray-700 bg-gray-50 px-4 py-2 rounded-lg border border-gray-100 block text-center min-w-[3rem]">
                      {stock.cantidad_reservada}
                    </span>
                  </div>

                  <div className="text-right">
                    <label htmlFor={`stock-${product.id}`} className="block text-xs text-blue-600 font-medium mb-1 uppercase">
                      Disponible Total
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        id={`stock-${product.id}`}
                        type="number"
                        min="0"
                        value={stock.cantidad_disponible || ''}
                        onChange={(e) => handleStockChange(product.id, e.target.value)}
                        className="w-24 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-right font-mono text-lg"
                      />
                      <button
                        onClick={() => saveStock(product.id)}
                        disabled={saving === product.id}
                        className="btn-icon bg-slate-950 text-white hover:bg-slate-900 disabled:opacity-50"
                        title="Guardar cambios"
                      >
                        {saving === product.id ? (
                          <Loader2 size={20} className="animate-spin" />
                        ) : (
                          <Save size={20} />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {products.length === 0 && (
            <div className="text-center py-12 bg-gray-50 rounded-xl border-2 border-dashed border-gray-200">
              <p className="text-gray-500 text-lg">No hay productos activos para gestionar.</p>
            </div>
          )}
        </div>
      )}

      {/* Bulk Update Modal */}
      {showBulkModal && (
        <BulkUpdateModal 
          products={products} 
          onClose={() => setShowBulkModal(false)} 
          onSuccess={() => {
            setShowBulkModal(false);
            setSuccessMessage('Stock masivo generado correctamente');
            // Trigger refresh by toggling loading or forcing re-fetch if needed, 
            // but date change or product list didn't change, so we might need to force a reload of current date stock
            const current = new Date(selectedDate);
            setSelectedDate(new Date(current.getTime() + 1)); // HACK: slight change to trigger effect
            setTimeout(() => setSelectedDate(current), 50);
          }}
        />
      )}
    </div>
  );
}

function BulkUpdateModal({ 
  products, 
  onClose, 
  onSuccess 
}: { 
  products: Product[], 
  onClose: () => void, 
  onSuccess: () => void 
}) {
  const { user } = useAuthStore();
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [quantity, setQuantity] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!startDate || !endDate) {
      setError('Selecciona un rango de fechas');
      return;
    }
    if (selectedProducts.length === 0) {
      setError('Selecciona al menos un producto');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const start = parseISO(startDate);
      const end = parseISO(endDate);
      const days = eachDayOfInterval({ start, end });
      
      // Firestore batch limit is 500. 
      // Calculate total operations: days * products
      const totalOps = days.length * selectedProducts.length;
      
      // If simple batch is enough
      if (totalOps <= 500) {
        const batch = writeBatch(db);
        
        for (const day of days) {
          const dateStr = format(day, 'yyyy-MM-dd');
          
          for (const prodId of selectedProducts) {
            const stockId = `${dateStr}_${prodId}`;
            const ref = doc(db, 'daily_stock', stockId);
            
            // We need to be careful not to overwrite existing reservations if the doc exists
            // But writeBatch doesn't support "update if exists, set if not" with merge logic easily 
            // without reading first, which is expensive for bulk.
            // Strategy: "set" with merge: true. 
            // If we use merge: true, we can update only specific fields.
            
            batch.set(ref, {
              fecha: dateStr,
              producto_id: prodId,
              cantidad_disponible: quantity,
              actualizado_por: user.id,
              timestamp: serverTimestamp()
              // Note: we do NOT set cantidad_reservada here to avoid overwriting it to 0 if it exists.
              // However, if the document doesn't exist, cantidad_reservada won't be set.
              // This is fine, the UI handles undefined as 0.
            }, { merge: true });
          }
        }
        
        await batch.commit();
      } else {
        // TODO: Implement chunking for > 500 operations if needed
        throw new Error(`Demasiadas operaciones (${totalOps}). Por favor reduce el rango de fechas.`);
      }

      onSuccess();
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Error al guardar');
    } finally {
      setLoading(false);
    }
  };

  const toggleProduct = (id: string) => {
    setSelectedProducts(prev => 
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    );
  };

  const toggleAll = () => {
    if (selectedProducts.length === products.length) {
      setSelectedProducts([]);
    } else {
      setSelectedProducts(products.map(p => p.id));
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
        <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-slate-50">
          <h2 className="text-xl font-bold text-gray-800">Generar Stock Masivo</h2>
          <button
            onClick={onClose}
            className="btn-icon text-slate-500 hover:text-slate-700 hover:bg-slate-100"
          >
            <X size={24} />
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto flex-1">
          {error && (
            <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm mb-4 flex items-center gap-2">
              <AlertCircle size={16} />
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 mb-6">
            <div>
              <label className="block text-sm font-semibold text-gray-900 mb-1.5">Desde</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-200 bg-gray-50 rounded-xl focus:bg-white focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 text-gray-900 font-medium shadow-sm transition-all outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-900 mb-1.5">Hasta</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-200 bg-gray-50 rounded-xl focus:bg-white focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 text-gray-900 font-medium shadow-sm transition-all outline-none"
                required
              />
            </div>
          </div>

          <div className="mb-6">
            <label className="block text-sm font-semibold text-gray-900 mb-1.5">Cantidad Disponible (por día)</label>
            <input
              type="number"
              min="0"
              value={quantity || ''}
              onChange={(e) => setQuantity(parseInt(e.target.value) || 0)}
              className="w-full px-4 py-2.5 border border-gray-200 bg-gray-50 rounded-xl focus:bg-white focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 text-gray-900 font-medium shadow-sm transition-all outline-none"
              required
            />
            <p className="text-xs text-gray-500 mt-2 ml-1 font-medium">
              Esta cantidad se aplicará a cada día del rango seleccionado.
            </p>
          </div>

          <div className="mb-6">
            <div className="flex justify-between items-center mb-3">
              <label className="block text-sm font-semibold text-gray-900">Productos</label>
              <button 
                type="button"
                onClick={toggleAll}
                className="btn-ghost text-blue-700"
              >
                {selectedProducts.length === products.length ? 'Deseleccionar todos' : 'Seleccionar todos'}
              </button>
            </div>
            <div className="space-y-2 border border-gray-200 rounded-xl p-4 max-h-48 overflow-y-auto bg-gray-50/50">
              {products.map(product => (
                <label key={product.id} className="flex items-center gap-3 p-2.5 hover:bg-white hover:shadow-sm rounded-lg cursor-pointer transition-all border border-transparent hover:border-gray-100">
                  <input
                    type="checkbox"
                    checked={selectedProducts.includes(product.id)}
                    onChange={() => toggleProduct(product.id)}
                    className="w-5 h-5 text-slate-900 rounded border-gray-300 focus:ring-slate-900 cursor-pointer"
                  />
                  <span className="text-sm text-gray-700 font-medium select-none">{product.nombre}</span>
                </label>
              ))}
            </div>
          </div>
        </form>

        <div className="p-6 border-t border-gray-100 bg-gray-50 flex gap-3 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="btn-outline"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="btn-primary disabled:opacity-50"
          >
            {loading && <Loader2 size={16} className="animate-spin" />}
            {loading ? 'Generando...' : 'Generar Stock'}
          </button>
        </div>
      </div>
    </div>
  );
}
