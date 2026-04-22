import { FieldValue } from 'firebase-admin/firestore';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase/admin';
import type { Booking, User } from '@/types';

export const runtime = 'nodejs';

const RESEND_API_URL = 'https://api.resend.com/emails';

function parseRecipients(value?: string | null) {
  if (!value) return [];
  return value
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function getAppUrl(request: NextRequest) {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    request.headers.get('origin') ||
    (() => {
      const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
      if (!host) return null;
      const proto = request.headers.get('x-forwarded-proto') || 'https';
      return `${proto}://${host}`;
    })() ||
    'http://localhost:3000'
  );
}

function getServiceDateLabel(value?: string) {
  if (!value) return 'Sin fecha';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

async function resolveRecipients() {
  const configured = parseRecipients(process.env.ADMIN_BOOKING_NOTIFICATION_EMAILS);
  if (configured.length > 0) return configured;

  const snapshot = await getAdminDb()
    .collection('users')
    .where('rol', '==', 'admin')
    .where('activo', '==', true)
    .get();

  return snapshot.docs
    .map((docSnap) => docSnap.data() as User)
    .map((user) => user.email?.trim())
    .filter((email): email is string => Boolean(email));
}

async function resolvePartnerName(booking: Booking) {
  const partnerId = booking.broker_id || booking.agency_id || booking.creado_por;
  if (!partnerId) return null;

  const snapshot = await getAdminDb().collection('users').doc(partnerId).get();
  if (!snapshot.exists) return null;
  const user = snapshot.data() as User;
  return user.nombre || user.email || null;
}

export async function POST(request: NextRequest) {
  try {
    const resendApiKey = process.env.RESEND_API_KEY;
    const fromEmail =
      process.env.BOOKING_NOTIFICATION_FROM_EMAIL || process.env.RESEND_FROM_EMAIL || '';

    if (!resendApiKey || !fromEmail) {
      return NextResponse.json(
        { ok: false, skipped: true, reason: 'missing_email_config' },
        { status: 202 }
      );
    }

    const body = (await request.json().catch(() => null)) as
      | { bookingId?: unknown; token?: unknown }
      | null;
    const bookingId = typeof body?.bookingId === 'string' ? body.bookingId.trim() : '';
    const token = typeof body?.token === 'string' ? body.token.trim() : '';

    if (!bookingId) {
      return NextResponse.json({ error: 'Missing bookingId' }, { status: 400 });
    }

    const adminDb = getAdminDb();
    const bookingRef = adminDb.collection('bookings').doc(bookingId);
    const bookingSnap = await bookingRef.get();

    if (!bookingSnap.exists) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }

    const booking = { id: bookingSnap.id, ...bookingSnap.data() } as Booking;

    if (booking.admin_booking_notified_at) {
      return NextResponse.json({ ok: true, deduped: true });
    }

    if (booking.token_acceso && booking.token_acceso !== token) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 403 });
    }

    const recipients = await resolveRecipients();
    if (recipients.length === 0) {
      return NextResponse.json(
        { ok: false, skipped: true, reason: 'missing_recipients' },
        { status: 202 }
      );
    }

    const appUrl = getAppUrl(request);
    const adminLink = `${appUrl}/admin/reservas?bookingRef=${encodeURIComponent(
      booking.numero_reserva
    )}&serviceDate=${encodeURIComponent(booking.fecha_inicio)}`;
    const partnerName = await resolvePartnerName(booking);
    const sourceLabel =
      booking.origen === 'public_link'
        ? 'enlace publico'
        : booking.broker_id
          ? 'broker'
          : booking.agency_id
            ? 'agencia'
            : booking.colaborador_id
              ? 'colaborador'
              : 'panel';

    const subject = `Nueva reserva ${booking.numero_reserva}`;
    const html = `
      <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #0f172a;">
        <h2 style="margin-bottom: 16px;">Nueva reserva recibida</h2>
        <p>Se ha creado una nueva reserva y ya esta disponible en el panel.</p>
        <ul>
          <li><strong>Referencia:</strong> ${booking.numero_reserva}</li>
          <li><strong>Cliente:</strong> ${booking.cliente?.nombre || 'Sin nombre'}</li>
          <li><strong>Email:</strong> ${booking.cliente?.email || 'Sin email'}</li>
          <li><strong>Fecha de servicio:</strong> ${getServiceDateLabel(booking.fecha_inicio)}</li>
          <li><strong>Total:</strong> €${Number(booking.precio_total || 0).toFixed(2)}</li>
          <li><strong>Origen:</strong> ${sourceLabel}</li>
          ${partnerName ? `<li><strong>Creada por:</strong> ${partnerName}</li>` : ''}
        </ul>
        <p style="margin-top: 20px;">
          <a
            href="${adminLink}"
            style="display: inline-block; background: #0f172a; color: #ffffff; text-decoration: none; padding: 10px 14px; border-radius: 8px;"
          >
            Ver reserva en admin
          </a>
        </p>
      </div>
    `;
    const text = [
      'Nueva reserva recibida',
      '',
      `Referencia: ${booking.numero_reserva}`,
      `Cliente: ${booking.cliente?.nombre || 'Sin nombre'}`,
      `Email: ${booking.cliente?.email || 'Sin email'}`,
      `Fecha de servicio: ${getServiceDateLabel(booking.fecha_inicio)}`,
      `Total: €${Number(booking.precio_total || 0).toFixed(2)}`,
      `Origen: ${sourceLabel}`,
      partnerName ? `Creada por: ${partnerName}` : null,
      '',
      `Abrir en admin: ${adminLink}`,
    ]
      .filter(Boolean)
      .join('\n');

    const emailResponse = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${resendApiKey}`,
      },
      body: JSON.stringify({
        from: fromEmail,
        to: recipients,
        subject,
        html,
        text,
      }),
    });

    if (!emailResponse.ok) {
      const payload = await emailResponse.text().catch(() => '');
      console.error('Booking notification email failed:', payload);
      return NextResponse.json({ ok: false, error: 'email_failed' }, { status: 502 });
    }

    await bookingRef.update({
      admin_booking_notified_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Booking notification route failed:', error);
    return NextResponse.json({ ok: false, error: 'internal_error' }, { status: 500 });
  }
}
