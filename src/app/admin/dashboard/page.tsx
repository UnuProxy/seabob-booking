'use client';

import { useEffect, useState } from 'react';
import { Copy, ExternalLink } from 'lucide-react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { auth } from '@/lib/firebase/config';
import { useAuthStore } from '@/store/authStore';
import { Booking } from '@/types';

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

    </div>
  );
}
