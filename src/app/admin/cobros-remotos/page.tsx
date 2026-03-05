'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Clock3, Copy, ExternalLink } from 'lucide-react';
import { auth } from '@/lib/firebase/config';
import { useAuthStore } from '@/store/authStore';

type RemotePaymentLink = {
  id: string;
  checkout_session_id?: string;
  payment_url?: string | null;
  amount?: number;
  amount_paid?: number;
  currency?: string;
  subject?: string;
  status?: 'pending' | 'paid' | string;
  created_at?: unknown;
  paid_at?: unknown;
};

export default function RemotePaymentsPage() {
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
  const [linksLoading, setLinksLoading] = useState(true);
  const [linksError, setLinksError] = useState('');
  const [history, setHistory] = useState<RemotePaymentLink[]>([]);

  const canGeneratePaymentLink = user?.rol === 'admin' || user?.rol === 'colaborador';

  const formatCurrency = (amount: number) =>
    amount.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });

  const getDate = (value: unknown): Date | null => {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (
      typeof value === 'object' &&
      value !== null &&
      'toDate' in value &&
      typeof (value as { toDate?: () => Date }).toDate === 'function'
    ) {
      return (value as { toDate: () => Date }).toDate();
    }
    const parsed = new Date(value as string | number);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };

  const formatDate = (value: unknown) => {
    const parsed = getDate(value);
    if (!parsed) return '—';
    return parsed.toLocaleString('es-ES', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const loadHistory = useCallback(async () => {
    if (!canGeneratePaymentLink) return;

    const token = await auth.currentUser?.getIdToken();
    if (!token) {
      setLinksError('Sesión no válida para cargar historial.');
      setLinksLoading(false);
      return;
    }

    try {
      const response = await fetch('/api/stripe/remote-payment-links', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const payload = (await response.json().catch(() => null)) as
        | { links?: RemotePaymentLink[]; error?: string }
        | null;

      if (!response.ok) {
        setLinksError(payload?.error || 'No se pudo cargar el historial.');
        setLinksLoading(false);
        return;
      }

      setHistory(payload?.links || []);
      setLinksError('');
    } catch (error) {
      console.error('Error loading remote payment links:', error);
      setLinksError('No se pudo cargar el historial.');
    } finally {
      setLinksLoading(false);
    }
  }, [canGeneratePaymentLink]);

  useEffect(() => {
    if (!canGeneratePaymentLink) return;
    setLinksLoading(true);
    void loadHistory();
    const timer = window.setInterval(() => {
      void loadHistory();
    }, 30000);
    return () => window.clearInterval(timer);
  }, [canGeneratePaymentLink, loadHistory]);

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
      setPaymentAmount('');
      setPaymentSubject('');
      setLinksLoading(true);
      void loadHistory();
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

  if (!canGeneratePaymentLink) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <p className="text-sm text-gray-600">No tienes permisos para generar enlaces de cobro.</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
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

      <div className="mt-6 bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Historial de enlaces</h3>
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            {history.length} registros
          </span>
        </div>

        {linksLoading ? (
          <p className="text-sm text-gray-500">Cargando historial...</p>
        ) : linksError ? (
          <p className="text-sm text-red-600">{linksError}</p>
        ) : history.length === 0 ? (
          <p className="text-sm text-gray-500">Todavía no hay enlaces generados.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 uppercase text-xs tracking-wide">
                  <th className="py-3 text-left font-semibold">Concepto</th>
                  <th className="py-3 text-left font-semibold">Importe</th>
                  <th className="py-3 text-left font-semibold">Estado</th>
                  <th className="py-3 text-left font-semibold">Creado</th>
                  <th className="py-3 text-left font-semibold">Pagado</th>
                  <th className="py-3 text-right font-semibold">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {history.map((link) => {
                  const amount = typeof link.amount === 'number' ? link.amount : 0;
                  const isPaid = link.status === 'paid';
                  const effectiveUrl = link.payment_url || null;
                  return (
                    <tr key={link.id}>
                      <td className="py-3 pr-4">
                        <p className="font-medium text-slate-900">{link.subject || 'Sin concepto'}</p>
                        <p className="text-xs text-slate-500 font-mono">{link.checkout_session_id || link.id}</p>
                      </td>
                      <td className="py-3 pr-4 text-slate-800">{formatCurrency(amount)}</td>
                      <td className="py-3 pr-4">
                        <span
                          className={
                            isPaid
                              ? 'inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-1 text-xs font-semibold text-green-700'
                              : 'inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700'
                          }
                        >
                          {isPaid ? <CheckCircle2 size={13} /> : <Clock3 size={13} />}
                          {isPaid ? 'Pagado' : 'Pendiente'}
                        </span>
                      </td>
                      <td className="py-3 pr-4 text-slate-600">{formatDate(link.created_at)}</td>
                      <td className="py-3 pr-4 text-slate-600">{isPaid ? formatDate(link.paid_at) : '—'}</td>
                      <td className="py-3 text-right">
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              if (!effectiveUrl) return;
                              navigator.clipboard.writeText(effectiveUrl);
                            }}
                            disabled={!effectiveUrl}
                            className="btn-icon text-slate-400 hover:text-blue-600 hover:bg-blue-50 disabled:opacity-40 disabled:cursor-not-allowed"
                            title="Copiar enlace"
                          >
                            <Copy size={16} />
                          </button>
                          <a
                            href={effectiveUrl || '#'}
                            target="_blank"
                            rel="noreferrer"
                            className="btn-icon text-slate-400 hover:text-emerald-600 hover:bg-emerald-50"
                            aria-disabled={!effectiveUrl}
                            title="Abrir enlace"
                            onClick={(event) => {
                              if (!effectiveUrl) event.preventDefault();
                            }}
                          >
                            <ExternalLink size={16} />
                          </a>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
