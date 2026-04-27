'use client';

import { auth } from '@/lib/firebase/config';

export function getPublicContractUrl(origin: string, bookingId: string, token: string) {
  return `${origin}/contract/${bookingId}?t=${encodeURIComponent(token)}`;
}

export function getPublicPaymentUrl(origin: string, bookingId: string, token: string) {
  return `${origin}/pay/${bookingId}?t=${encodeURIComponent(token)}`;
}

export function getAdminContractPath(bookingId: string, token?: string | null) {
  const params = new URLSearchParams();
  if (token) {
    params.set('t', token);
  }
  params.set('view', 'admin');
  return `/contract/${bookingId}?${params.toString()}`;
}

export async function ensureBookingAccessToken(bookingId: string) {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Debes iniciar sesion para generar enlaces.');
  }

  const idToken = await currentUser.getIdToken();
  const response = await fetch('/api/bookings/ensure-access', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ bookingId }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || typeof data?.token !== 'string' || !data.token) {
    throw new Error(
      typeof data?.error === 'string' ? data.error : 'No se pudo generar el enlace del contrato.'
    );
  }

  return {
    token: data.token as string,
    generated: Boolean(data.generated),
  };
}
