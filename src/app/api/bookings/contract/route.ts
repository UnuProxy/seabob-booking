import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase/admin';
import type { Booking } from '@/types';

export const runtime = 'nodejs';

const serializeFirestoreValue = (value: unknown): unknown => {
  if (!value) return value;
  if (
    typeof value === 'object' &&
    value !== null &&
    'toDate' in value &&
    typeof (value as { toDate?: () => Date }).toDate === 'function'
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(serializeFirestoreValue);
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        serializeFirestoreValue(entry),
      ])
    );
  }
  return value;
};

const getToken = (request: NextRequest) => request.nextUrl.searchParams.get('token')?.trim() || '';

async function getBookingForToken(bookingId: string, token: string) {
  if (!bookingId || !token) {
    return { error: 'Missing booking id or token.', status: 400 as const };
  }

  const bookingRef = getAdminDb().collection('bookings').doc(bookingId);
  const bookingSnap = await bookingRef.get();
  if (!bookingSnap.exists) {
    return { error: 'Booking not found.', status: 404 as const };
  }

  const booking = { id: bookingSnap.id, ...bookingSnap.data() } as Booking;
  if (!booking.token_acceso || booking.token_acceso !== token) {
    return { error: 'Invalid token.', status: 403 as const };
  }

  return { bookingRef, booking };
}

export async function GET(request: NextRequest) {
  const bookingId = request.nextUrl.searchParams.get('bookingId')?.trim() || '';
  const result = await getBookingForToken(bookingId, getToken(request));

  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    booking: serializeFirestoreValue(result.booking),
  });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    bookingId?: unknown;
    token?: unknown;
    signature?: unknown;
    clientDocument?: unknown;
    clientAddress?: unknown;
  } | null;

  const bookingId = typeof body?.bookingId === 'string' ? body.bookingId.trim() : '';
  const token = typeof body?.token === 'string' ? body.token.trim() : '';
  const signature = typeof body?.signature === 'string' ? body.signature : '';
  const clientDocument = typeof body?.clientDocument === 'string' ? body.clientDocument.trim() : '';
  const clientAddress = typeof body?.clientAddress === 'string' ? body.clientAddress.trim() : '';

  if (!signature || !clientDocument || !clientAddress) {
    return NextResponse.json(
      { error: 'Missing signature, client document, or client address.' },
      { status: 400 }
    );
  }

  const result = await getBookingForToken(bookingId, token);
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  if (result.booking.acuerdo_firmado) {
    return NextResponse.json({ error: 'Contract already signed.' }, { status: 409 });
  }

  if (result.booking.requires_payment !== false && !result.booking.pago_realizado) {
    return NextResponse.json({ error: 'Payment required.' }, { status: 409 });
  }

  const updatedClient = {
    ...result.booking.cliente,
    documento_identidad: clientDocument,
    direccion: clientAddress,
  };

  await result.bookingRef.update({
    cliente: updatedClient,
    acuerdo_firmado: true,
    firma_cliente: signature,
    terminos_aceptados: true,
    terminos_aceptados_en: FieldValue.serverTimestamp(),
    estado: 'confirmada',
    updated_at: FieldValue.serverTimestamp(),
  });

  if (result.booking.invoice_id) {
    await getAdminDb()
      .collection('invoices')
      .doc(result.booking.invoice_id)
      .update({
        client_id_number: clientDocument,
        client_address: clientAddress,
      })
      .catch((error) => {
        console.warn('Could not update linked invoice client details:', error);
      });
  }

  return NextResponse.json({
    booking: serializeFirestoreValue({
      ...result.booking,
      cliente: updatedClient,
      acuerdo_firmado: true,
      firma_cliente: signature,
      terminos_aceptados: true,
      estado: 'confirmada',
    }),
  });
}
