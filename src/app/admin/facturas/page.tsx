'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';
import { Download, FilePlus2, Receipt, RefreshCw, RotateCcw } from 'lucide-react';
import { db } from '@/lib/firebase/config';
import { downloadInvoicePdf } from '@/lib/invoicePdf';
import { INITIAL_INVOICE_SEQUENCE, buildInvoiceFromBooking, buildRefundInvoiceFromBooking } from '@/lib/invoices';
import { useAuthStore } from '@/store/authStore';
import type { Booking, Invoice } from '@/types';

const formatCurrency = (value: number) =>
  `${Number(value || 0) < 0 ? '-€' : '€'}${Math.abs(Number(value || 0)).toLocaleString('es-ES', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const getDate = (value: unknown): Date | null => {
  if (!value) return null;
  if (
    typeof value === 'object' &&
    value !== null &&
    'toDate' in value &&
    typeof (value as { toDate?: () => Date }).toDate === 'function'
  ) {
    return (value as { toDate: () => Date }).toDate();
  }
  if (value instanceof Date) return value;
  const parsed = new Date(value as string | number);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatDate = (value: unknown) => {
  const date = getDate(value);
  if (!date) return '-';
  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
};

export default function FacturasPage() {
  const { user } = useAuthStore();
  const router = useRouter();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyActionId, setBusyActionId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    if (!user) return;
    if (user.rol !== 'admin') {
      router.push('/admin/dashboard');
      return;
    }

    const unsubscribeBookings = onSnapshot(
      collection(db, 'bookings'),
      (snapshot) => {
        const data = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        })) as Booking[];
        setBookings(data);
        setLoading(false);
      },
      (error) => {
        console.error('Error fetching bookings for invoices:', error);
        setLoading(false);
      }
    );

    const unsubscribeInvoices = onSnapshot(
      query(collection(db, 'invoices'), orderBy('sequence_number', 'desc')),
      (snapshot) => {
        const data = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        })) as Invoice[];
        setInvoices(data);
      },
      (error) => {
        console.error('Error fetching invoices:', error);
      }
    );

    return () => {
      unsubscribeBookings();
      unsubscribeInvoices();
    };
  }, [router, user]);

  const standardInvoicesByBookingId = useMemo(
    () =>
      new Map(
        invoices
          .filter((invoice) => (invoice.invoice_kind || 'standard') === 'standard')
          .map((invoice) => [invoice.booking_id, invoice])
      ),
    [invoices]
  );

  const refundInvoicesByBookingId = useMemo(
    () =>
      new Map(
        invoices
          .filter((invoice) => invoice.invoice_kind === 'refund')
          .map((invoice) => [invoice.booking_id, invoice])
      ),
    [invoices]
  );

  const hasStandardInvoiceForBooking = useCallback(
    (booking: Booking) =>
      standardInvoicesByBookingId.has(booking.id) || Boolean(booking.invoice_id || booking.invoice_number),
    [standardInvoicesByBookingId]
  );

  const paidPendingBookings = useMemo(
    () =>
      bookings
        .filter((booking) => booking.pago_realizado && !hasStandardInvoiceForBooking(booking))
        .sort((a, b) => {
          const dateA = getDate(a.pago_realizado_en)?.getTime() || 0;
          const dateB = getDate(b.pago_realizado_en)?.getTime() || 0;
          return dateB - dateA;
        }),
    [bookings, hasStandardInvoiceForBooking]
  );

  const refundPendingBookings = useMemo(
    () =>
      bookings
        .filter(
          (booking) =>
            booking.reembolso_realizado &&
            hasStandardInvoiceForBooking(booking) &&
            !refundInvoicesByBookingId.has(booking.id)
        )
        .sort((a, b) => {
          const dateA = getDate(a.reembolso_fecha)?.getTime() || 0;
          const dateB = getDate(b.reembolso_fecha)?.getTime() || 0;
          return dateB - dateA;
        }),
    [bookings, hasStandardInvoiceForBooking, refundInvoicesByBookingId]
  );

  const totals = useMemo(() => {
    const totalIssued = invoices.filter((invoice) => (invoice.invoice_kind || 'standard') === 'standard').length;
    const totalRefunds = invoices
      .filter((invoice) => invoice.invoice_kind === 'refund')
      .reduce((sum, invoice) => sum + Math.abs(Number(invoice.amount_gross || 0)), 0);
    const totalBilled = invoices
      .filter((invoice) => (invoice.invoice_kind || 'standard') === 'standard')
      .reduce((sum, invoice) => sum + Number(invoice.amount_gross || 0), 0);
    const totalPending = paidPendingBookings.reduce(
      (sum, booking) => sum + Number(booking.precio_total || 0),
      0
    );

    return { totalIssued, totalBilled, totalPending, totalRefunds };
  }, [invoices, paidPendingBookings]);

  const getInvoiceStateLabel = (invoice: Invoice) => {
    if (invoice.invoice_kind === 'refund') return 'Abono';
    const booking = bookings.find((entry) => entry.id === invoice.booking_id);
    if (!booking) return 'Emitida';
    if (booking.reembolso_realizado) return 'Reembolsada';
    if (booking.estado === 'cancelada') return 'Cancelada';
    return 'Emitida';
  };

  const handleGenerateInvoice = async (booking: Booking) => {
    if (!user || busyActionId) return;
    setBusyActionId(`standard:${booking.id}`);
    setActionError('');

    try {
      const createdInvoice = await runTransaction(db, async (transaction) => {
        const bookingRef = doc(db, 'bookings', booking.id);
        const invoiceRef = doc(db, 'invoices', booking.id);
        const counterRef = doc(db, 'system_counters', 'invoice_sequence');

        const bookingSnap = await transaction.get(bookingRef);
        if (!bookingSnap.exists()) {
          throw new Error('La reserva ya no existe.');
        }

        const latestBooking = { id: bookingSnap.id, ...bookingSnap.data() } as Booking;
        if (!latestBooking.pago_realizado) {
          throw new Error('Solo puedes generar una factura cuando la reserva este pagada.');
        }

        const existingInvoiceSnap = await transaction.get(invoiceRef);
        if (existingInvoiceSnap.exists()) {
          return { id: existingInvoiceSnap.id, ...existingInvoiceSnap.data() } as Invoice;
        }

        const counterSnap = await transaction.get(counterRef);
        const nextSequence = Number(counterSnap.data()?.next_sequence ?? INITIAL_INVOICE_SEQUENCE);
        const invoicePayload = buildInvoiceFromBooking(latestBooking, nextSequence, user.id);
        const clientInvoice: Invoice = {
          id: latestBooking.id,
          ...invoicePayload,
          created_at: new Date().toISOString(),
        };

        transaction.set(invoiceRef, {
          ...invoicePayload,
          created_at: serverTimestamp(),
        });
        transaction.set(counterRef, { next_sequence: nextSequence + 1 }, { merge: true });
        transaction.set(
          bookingRef,
          {
            invoice_id: latestBooking.id,
            invoice_number: invoicePayload.invoice_number,
            invoice_generated_at: serverTimestamp(),
            updated_at: serverTimestamp(),
          },
          { merge: true }
        );

        return clientInvoice;
      });

      downloadInvoicePdf(createdInvoice);
    } catch (error) {
      console.error('Error generating invoice:', error);
      setActionError(error instanceof Error ? error.message : 'No se pudo generar la factura.');
    } finally {
      setBusyActionId(null);
    }
  };

  const handleGenerateRefundInvoice = async (booking: Booking) => {
    if (!user || busyActionId) return;
    setBusyActionId(`refund:${booking.id}`);
    setActionError('');

    try {
      const createdInvoice = await runTransaction(db, async (transaction) => {
        const bookingRef = doc(db, 'bookings', booking.id);
        const originalInvoiceRef = doc(db, 'invoices', booking.id);
        const refundInvoiceRef = doc(db, 'invoices', `${booking.id}__refund`);
        const counterRef = doc(db, 'system_counters', 'invoice_sequence');

        const bookingSnap = await transaction.get(bookingRef);
        if (!bookingSnap.exists()) {
          throw new Error('La reserva ya no existe.');
        }

        const latestBooking = { id: bookingSnap.id, ...bookingSnap.data() } as Booking;
        if (!latestBooking.reembolso_realizado) {
          throw new Error('La factura de abono solo se puede generar despues del reembolso.');
        }

        const originalInvoiceSnap = await transaction.get(originalInvoiceRef);
        if (!originalInvoiceSnap.exists()) {
          throw new Error('Primero debes tener una factura original emitida.');
        }

        const existingRefundSnap = await transaction.get(refundInvoiceRef);
        if (existingRefundSnap.exists()) {
          return { id: existingRefundSnap.id, ...existingRefundSnap.data() } as Invoice;
        }

        const originalInvoice = {
          id: originalInvoiceSnap.id,
          ...originalInvoiceSnap.data(),
        } as Invoice;
        const counterSnap = await transaction.get(counterRef);
        const nextSequence = Number(counterSnap.data()?.next_sequence ?? INITIAL_INVOICE_SEQUENCE);
        const invoicePayload = buildRefundInvoiceFromBooking(
          latestBooking,
          originalInvoice,
          nextSequence,
          user.id
        );
        const clientInvoice: Invoice = {
          id: refundInvoiceRef.id,
          ...invoicePayload,
          created_at: new Date().toISOString(),
        };

        transaction.set(refundInvoiceRef, {
          ...invoicePayload,
          created_at: serverTimestamp(),
        });
        transaction.set(counterRef, { next_sequence: nextSequence + 1 }, { merge: true });

        return clientInvoice;
      });

      downloadInvoicePdf(createdInvoice);
    } catch (error) {
      console.error('Error generating refund invoice:', error);
      setActionError(error instanceof Error ? error.message : 'No se pudo generar la factura de abono.');
    } finally {
      setBusyActionId(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <RefreshCw className="h-8 w-8 animate-spin text-blue-600" />
          <p className="text-sm font-medium text-slate-500">Cargando facturas...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <section className="rounded-3xl border border-slate-200 bg-linear-to-br from-slate-950 via-blue-950 to-blue-900 px-6 py-7 text-white shadow-2xl">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-blue-100">
              <Receipt className="h-4 w-4" />
              Facturacion
            </div>
            <h1 className="mt-4 text-3xl font-black tracking-tight">Facturas de reservas pagadas</h1>
            <p className="mt-3 text-sm text-blue-100/80">
              Las facturas solo se generan cuando la reserva ya esta marcada como pagada. La numeracion
              se asigna en orden estricto empezando por <span className="font-semibold text-white">AL-001</span>.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 backdrop-blur">
              <p className="text-xs uppercase tracking-[0.18em] text-blue-100/70">Emitidas</p>
              <p className="mt-2 text-2xl font-black">{totals.totalIssued}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 backdrop-blur">
              <p className="text-xs uppercase tracking-[0.18em] text-blue-100/70">Facturado</p>
              <p className="mt-2 text-2xl font-black">{formatCurrency(totals.totalBilled)}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 backdrop-blur">
              <p className="text-xs uppercase tracking-[0.18em] text-blue-100/70">Abonos emitidos</p>
              <p className="mt-2 text-2xl font-black">{formatCurrency(totals.totalRefunds)}</p>
            </div>
          </div>
        </div>
      </section>

      {actionError ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {actionError}
        </div>
      ) : null}

      <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-2 border-b border-slate-100 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Reservas pagadas sin factura</h2>
            <p className="text-sm text-slate-500">Genera la factura definitiva solo una vez por reserva.</p>
          </div>
          <span className="inline-flex w-fit items-center rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
            {paidPendingBookings.length} pendientes
          </span>
        </div>

        {paidPendingBookings.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-slate-500">
            No hay reservas pagadas pendientes de facturar.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-[0.16em] text-slate-500">
                <tr>
                  <th className="px-6 py-4 font-semibold">Reserva</th>
                  <th className="px-6 py-4 font-semibold">Cliente</th>
                  <th className="px-6 py-4 font-semibold">Pagada el</th>
                  <th className="px-6 py-4 font-semibold">Total</th>
                  <th className="px-6 py-4 font-semibold text-right">Accion</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paidPendingBookings.map((booking) => (
                  <tr key={booking.id} className="hover:bg-slate-50/80">
                    <td className="px-6 py-4">
                      <div className="font-semibold text-slate-900">{booking.numero_reserva}</div>
                      <div className="text-xs text-slate-500 capitalize">{booking.pago_metodo || 'manual'}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-medium text-slate-800">{booking.cliente?.nombre || 'Sin nombre'}</div>
                      <div className="text-xs text-slate-500">{booking.cliente?.email || '-'}</div>
                    </td>
                    <td className="px-6 py-4 text-slate-600">{formatDate(booking.pago_realizado_en)}</td>
                    <td className="px-6 py-4 font-semibold text-slate-900">
                      {formatCurrency(Number(booking.precio_total || 0))}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => handleGenerateInvoice(booking)}
                          disabled={busyActionId === `standard:${booking.id}`}
                          className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <FilePlus2 className="h-4 w-4" />
                          {busyActionId === `standard:${booking.id}` ? 'Generando...' : 'Generar factura'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-2 border-b border-slate-100 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Reservas reembolsadas sin factura de abono</h2>
            <p className="text-sm text-slate-500">
              La factura original se conserva y aqui puedes emitir el documento de devolucion.
            </p>
          </div>
          <span className="inline-flex w-fit items-center rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700">
            {refundPendingBookings.length} pendientes
          </span>
        </div>

        {refundPendingBookings.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-slate-500">
            No hay reembolsos pendientes de factura de abono.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-[0.16em] text-slate-500">
                <tr>
                  <th className="px-6 py-4 font-semibold">Reserva</th>
                  <th className="px-6 py-4 font-semibold">Factura original</th>
                  <th className="px-6 py-4 font-semibold">Motivo</th>
                  <th className="px-6 py-4 font-semibold">Importe</th>
                  <th className="px-6 py-4 font-semibold text-right">Accion</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {refundPendingBookings.map((booking) => {
                  const originalInvoice = standardInvoicesByBookingId.get(booking.id);
                  return (
                    <tr key={booking.id} className="hover:bg-slate-50/80">
                      <td className="px-6 py-4">
                        <div className="font-semibold text-slate-900">{booking.numero_reserva}</div>
                        <div className="text-xs text-slate-500">{booking.cliente?.nombre || 'Sin nombre'}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-medium text-slate-800">{originalInvoice?.invoice_number || '-'}</div>
                        <div className="text-xs text-slate-500">La original queda guardada</div>
                      </td>
                      <td className="px-6 py-4 text-slate-600">{booking.reembolso_motivo || 'Reembolso'}</td>
                      <td className="px-6 py-4 font-semibold text-slate-900">
                        {formatCurrency(Number(booking.reembolso_monto || 0) * -1)}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex justify-end">
                          <button
                            type="button"
                            onClick={() => handleGenerateRefundInvoice(booking)}
                            disabled={busyActionId === `refund:${booking.id}`}
                            className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <RotateCcw className="h-4 w-4" />
                            {busyActionId === `refund:${booking.id}` ? 'Generando...' : 'Generar abono'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-2 border-b border-slate-100 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Historial de facturas</h2>
            <p className="text-sm text-slate-500">
              Las facturas originales y las de abono quedan guardadas para mantener la numeracion y el historial.
            </p>
          </div>
          <span className="inline-flex w-fit items-center rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
            {invoices.length} registradas
          </span>
        </div>

        {invoices.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-slate-500">
            Todavia no se ha generado ninguna factura.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-[0.16em] text-slate-500">
                <tr>
                  <th className="px-6 py-4 font-semibold">Factura</th>
                  <th className="px-6 py-4 font-semibold">Tipo</th>
                  <th className="px-6 py-4 font-semibold">Reserva</th>
                  <th className="px-6 py-4 font-semibold">Cliente</th>
                  <th className="px-6 py-4 font-semibold">Fecha</th>
                  <th className="px-6 py-4 font-semibold">Importe</th>
                  <th className="px-6 py-4 font-semibold text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {invoices.map((invoice) => (
                  <tr key={invoice.id} className="hover:bg-slate-50/80">
                    <td className="px-6 py-4 font-semibold text-slate-900">{invoice.invoice_number}</td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1">
                        <span
                          className={
                            invoice.invoice_kind === 'refund'
                              ? 'inline-flex w-fit items-center rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700'
                              : 'inline-flex w-fit items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700'
                          }
                        >
                          {invoice.invoice_kind === 'refund' ? 'Abono' : 'Original'}
                        </span>
                        <span className="text-xs text-slate-500">{getInvoiceStateLabel(invoice)}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-medium text-slate-800">{invoice.booking_ref}</div>
                      {invoice.related_invoice_number ? (
                        <div className="text-xs text-slate-500">Base: {invoice.related_invoice_number}</div>
                      ) : null}
                      <Link
                        href={`/admin/reservas`}
                        className="text-xs font-medium text-blue-600 hover:text-blue-700"
                      >
                        Ver reserva
                      </Link>
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-medium text-slate-800">{invoice.client_name}</div>
                      <div className="text-xs text-slate-500">{invoice.client_email || '-'}</div>
                    </td>
                    <td className="px-6 py-4 text-slate-600">{formatDate(invoice.created_at || invoice.invoice_date)}</td>
                    <td className="px-6 py-4 font-semibold text-slate-900">
                      {formatCurrency(Number(invoice.amount_gross || 0))}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => downloadInvoicePdf(invoice)}
                          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                        >
                          <Download className="h-4 w-4" />
                          Descargar PDF
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
