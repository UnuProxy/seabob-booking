'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Copy, ExternalLink, Package, X } from 'lucide-react';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { auth } from '@/lib/firebase/config';
import { useAuthStore } from '@/store/authStore';
import { Booking, Product } from '@/types';
import { getProductBaseDailyPrice, getProductDailyPrice } from '@/lib/productPricing';
import { getProductTypeLabel } from '@/lib/productTypes';

export default function DashboardPage() {
  const { user } = useAuthStore();
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentSubject, setPaymentSubject] = useState('');
  const [paymentError, setPaymentError] = useState('');
  const [creatingPaymentLink, setCreatingPaymentLink] = useState(false);
  const [copied, setCopied] = useState(false);
  const [generatedPaymentLink, setGeneratedPaymentLink] = useState<{
    sessionId: string;
    url: string;
    amount: number;
    subject: string;
  } | null>(null);
  const [stats, setStats] = useState({
    todayBookings: 0,
    pendingCount: 0,
    pendingAmount: 0,
    netRevenue: 0,
    refundedAmount: 0,
    commissionPending: 0,
  });
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  const formatPrice = (amount: number) =>
    amount.toLocaleString('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

  useEffect(() => {
    if (!user) return;

    const bookingsRef = collection(db, 'bookings');
    const bookingsQuery =
      user.rol === 'admin'
        ? bookingsRef
        : query(bookingsRef, where('creado_por', '==', user.id));

    const unsubscribe = onSnapshot(
      bookingsQuery,
      (snapshot) => {
        const bookings = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        })) as Booking[];

        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

        let todayBookings = 0;
        let pendingCount = 0;
        let pendingAmount = 0;
        let grossPaid = 0;
        let refundedAmount = 0;
        let commissionPending = 0;

        const getDate = (value: unknown): Date => {
          if (!value) return new Date();
          if (value instanceof Date) return value;
          if (
            typeof value === 'object' &&
            value !== null &&
            'toDate' in value &&
            typeof (value as { toDate?: () => Date }).toDate === 'function'
          ) {
            return (value as { toDate: () => Date }).toDate();
          }
          return new Date(value as string | number);
        };

        bookings.forEach((booking) => {
          const start = getDate(booking.fecha_inicio);
          const end = getDate(booking.fecha_fin);
          const isToday = end >= todayStart && start <= todayEnd;

          if (isToday) {
            todayBookings += 1;
          }

          if (!booking.pago_realizado && booking.estado === 'pendiente' && !booking.expirado) {
            pendingCount += 1;
            pendingAmount += booking.precio_total || 0;
          }

          if (booking.pago_realizado) {
            grossPaid += booking.precio_total || 0;
          }

          if (booking.reembolso_realizado) {
            refundedAmount += booking.reembolso_monto || 0;
          }

          if (booking.pago_realizado && !booking.reembolso_realizado) {
            const pending = (booking.comision_total || 0) - (booking.comision_pagada || 0);
            if (pending > 0) {
              commissionPending += pending;
            }
          }
        });

        const netRevenue = grossPaid - refundedAmount;

        setStats({
          todayBookings,
          pendingCount,
          pendingAmount,
          netRevenue,
          refundedAmount,
          commissionPending,
        });
      },
      (error) => {
        console.error('Error fetching dashboard data:', error);
      }
    );

    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    const productsQuery = query(collection(db, 'products'), orderBy('nombre'));
    const unsubscribe = onSnapshot(productsQuery, (snapshot) => {
      setProducts(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Product)));
    });

    return () => unsubscribe();
  }, []);

  const formatCurrency = (amount: number) =>
    amount.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
  const canGeneratePaymentLink = user?.rol === 'admin' || user?.rol === 'colaborador';

  const handleGeneratePaymentLink = async (event: React.FormEvent) => {
    event.preventDefault();
    setPaymentError('');
    setCopied(false);

    const normalizedAmount = Number(paymentAmount.replace(',', '.'));
    if (!Number.isFinite(normalizedAmount) || normalizedAmount < 0.5) {
      setPaymentError('El importe mínimo es 0,50 €.');
      return;
    }

    if (paymentSubject.trim().length < 3) {
      setPaymentError('El concepto debe tener al menos 3 caracteres.');
      return;
    }

    const token = await auth.currentUser?.getIdToken();
    if (!token) {
      setPaymentError('Sesión no válida. Vuelve a iniciar sesión.');
      return;
    }

    try {
      setCreatingPaymentLink(true);
      const response = await fetch('/api/stripe/create-remote-payment-link', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: normalizedAmount,
          subject: paymentSubject.trim(),
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { error?: string; sessionId?: string; url?: string; amount?: number; subject?: string }
        | null;

      if (!response.ok || !payload?.url || !payload?.sessionId) {
        setPaymentError(payload?.error || 'No se pudo generar el enlace de pago.');
        return;
      }

      setGeneratedPaymentLink({
        sessionId: payload.sessionId,
        url: payload.url,
        amount: payload.amount || normalizedAmount,
        subject: payload.subject || paymentSubject.trim(),
      });
    } catch (error) {
      console.error('Error generating payment link:', error);
      setPaymentError('No se pudo generar el enlace de pago.');
    } finally {
      setCreatingPaymentLink(false);
    }
  };

  const handleCopyPaymentLink = async () => {
    if (!generatedPaymentLink?.url) return;
    try {
      await navigator.clipboard.writeText(generatedPaymentLink.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setPaymentError('No se pudo copiar. Copia el enlace manualmente.');
    }
  };

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-800 mb-6">Dashboard</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 mb-8">
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <h3 className="text-gray-500 text-sm font-medium uppercase">Reservas de Hoy</h3>
          <p className="text-3xl font-bold text-gray-900 mt-2">{stats.todayBookings}</p>
        </div>
        
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <h3 className="text-gray-500 text-sm font-medium uppercase">Pendiente de Cobro</h3>
          <p className="text-3xl font-bold text-amber-600 mt-2">{formatCurrency(stats.pendingAmount)}</p>
          <p className="text-xs text-gray-500 mt-1">{stats.pendingCount} reservas sin pago</p>
        </div>
        
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <h3 className="text-gray-500 text-sm font-medium uppercase">Ingresos Netos</h3>
          <p className="text-3xl font-bold text-green-600 mt-2">{formatCurrency(stats.netRevenue)}</p>
          <p className="text-xs text-gray-500 mt-1">Reembolsos: {formatCurrency(stats.refundedAmount)}</p>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <h3 className="text-gray-500 text-sm font-medium uppercase">Comisiones Pendientes</h3>
          <p className="text-3xl font-bold text-blue-600 mt-2">{formatCurrency(stats.commissionPending)}</p>
          <p className="text-xs text-gray-500 mt-1">Solo reservas pagadas sin reembolso</p>
        </div>
      </div>

      {canGeneratePaymentLink && (
        <div id="cobro-remoto" className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-8 scroll-mt-24">
          <div className="flex flex-col gap-2 mb-5">
            <h2 className="text-xl font-semibold text-gray-800">Cobro remoto</h2>
            <p className="text-sm text-gray-600">
              Genera un enlace de pago Stripe para cobrar a distancia con solo importe y concepto.
            </p>
          </div>

          <form className="grid grid-cols-1 lg:grid-cols-4 gap-4" onSubmit={handleGeneratePaymentLink}>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Importe (€)</span>
              <input
                type="number"
                step="0.01"
                min="0.50"
                inputMode="decimal"
                value={paymentAmount}
                onChange={(event) => setPaymentAmount(event.target.value)}
                placeholder="150.00"
                className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </label>

            <label className="block lg:col-span-2">
              <span className="text-sm font-medium text-gray-700">Concepto</span>
              <input
                type="text"
                value={paymentSubject}
                onChange={(event) => setPaymentSubject(event.target.value)}
                placeholder="Reserva privada SEABOB - Juan Pérez"
                className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </label>

            <div className="flex items-end">
              <button type="submit" className="btn-primary w-full" disabled={creatingPaymentLink}>
                {creatingPaymentLink ? 'Generando enlace...' : 'Generar enlace'}
              </button>
            </div>
          </form>

          {paymentError && <p className="text-sm text-red-600 mt-3">{paymentError}</p>}

          {generatedPaymentLink?.url && (
            <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-sm text-emerald-800 font-medium">
                Enlace listo para enviar ({formatCurrency(generatedPaymentLink.amount)}).
              </p>
              <p className="text-sm text-emerald-700 mt-1">{generatedPaymentLink.subject}</p>
              <a
                href={generatedPaymentLink.url}
                target="_blank"
                rel="noreferrer"
                className="block mt-3 text-sm text-emerald-900 underline break-all"
              >
                {generatedPaymentLink.url}
              </a>
              <div className="flex flex-col sm:flex-row gap-3 mt-4">
                <button type="button" className="btn-outline" onClick={handleCopyPaymentLink}>
                  <Copy size={16} />
                  {copied ? 'Copiado' : 'Copiar enlace'}
                </button>
                <a href={generatedPaymentLink.url} target="_blank" rel="noreferrer" className="btn-primary">
                  <ExternalLink size={16} />
                  Abrir Checkout
                </a>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between gap-3 mb-5">
          <div>
            <h2 className="text-xl font-semibold text-gray-800">Productos</h2>
            <p className="text-sm text-gray-600">
              Haz clic en un producto para ver su ficha rápida y empezar una reserva.
            </p>
          </div>
          <Link href="/admin/productos" className="text-sm font-medium text-blue-600 hover:text-blue-700">
            Ver inventario
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {products.map((product) => (
            <button
              key={product.id}
              type="button"
              onClick={() => setSelectedProduct(product)}
              className="overflow-hidden rounded-2xl border border-gray-200 bg-white text-left transition-shadow hover:shadow-md"
            >
              <div className="h-40 bg-slate-100">
                {product.imagen_url ? (
                  <img src={product.imagen_url} alt={product.nombre} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-slate-400">
                    <Package size={30} />
                  </div>
                )}
              </div>
              <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900">{product.nombre}</h3>
                    <p className="mt-1 text-xs uppercase tracking-[0.12em] text-slate-500">{getProductTypeLabel(product.tipo)}</p>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-xs font-semibold ${product.activo ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-600'}`}>
                    {product.activo ? 'Activo' : 'Inactivo'}
                  </span>
                </div>
                <p className="mt-3 line-clamp-2 text-sm text-slate-600">{product.descripcion || 'Sin descripción.'}</p>
                <div className="mt-4 flex items-end justify-between gap-3">
                  <div>
                    <p className="text-2xl font-bold text-slate-900">{formatPrice(getProductBaseDailyPrice(product))}</p>
                    <p className="text-xs text-slate-500">
                      {product.incluir_iva ? 'Precio con IVA incluido' : 'Precio sin IVA'}
                    </p>
                    {product.incluir_iva ? (
                      <p className="mt-2 text-sm font-semibold text-emerald-700">
                        Total: {formatPrice(getProductDailyPrice(product))}
                      </p>
                    ) : null}
                  </div>
                  <span className="text-sm font-medium text-blue-600">Ver info</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {selectedProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl overflow-hidden rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <div>
                <h3 className="text-xl font-semibold text-slate-900">{selectedProduct.nombre}</h3>
                <p className="text-sm text-slate-500">{selectedProduct.tipo}</p>
              </div>
              <button type="button" onClick={() => setSelectedProduct(null)} className="btn-icon text-slate-500 hover:bg-slate-100">
                <X size={20} />
              </button>
            </div>
            <div className="grid gap-6 p-6 md:grid-cols-[1.1fr_0.9fr]">
              <div className="min-h-64 overflow-hidden rounded-2xl bg-slate-100">
                {selectedProduct.imagen_url ? (
                  <img src={selectedProduct.imagen_url} alt={selectedProduct.nombre} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-slate-400">
                    <Package size={36} />
                  </div>
                )}
              </div>
              <div className="flex flex-col">
                <p className="text-sm leading-6 text-slate-600">
                  {selectedProduct.descripcion || 'Sin descripción disponible.'}
                </p>
                <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-sm text-slate-500">
                    {selectedProduct.incluir_iva ? 'Precio por dia con IVA incluido' : 'Precio por dia sin IVA'}
                  </p>
                  <p className="mt-1 text-3xl font-bold text-slate-900">
                    {formatPrice(getProductBaseDailyPrice(selectedProduct))}
                  </p>
                  {selectedProduct.incluir_iva ? (
                    <>
                      <p className="mt-4 text-sm text-slate-500">Total por dia</p>
                      <p className="mt-1 text-3xl font-bold text-emerald-700">
                        {formatPrice(getProductDailyPrice(selectedProduct))}
                      </p>
                      <p className="mt-2 text-xs text-slate-500">IVA incluido (+21%).</p>
                    </>
                  ) : null}
                </div>
                <div className="mt-auto pt-6">
                  <Link
                    href={`/admin/reservas?new=true&productId=${selectedProduct.id}`}
                    className="btn-primary w-full justify-center"
                    onClick={() => setSelectedProduct(null)}
                  >
                    Empezar reserva
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
