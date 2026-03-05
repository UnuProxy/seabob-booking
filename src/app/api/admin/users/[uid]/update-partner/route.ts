import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminAuth, getAdminDb } from '@/lib/firebase/admin';

export const runtime = 'nodejs';

async function requireStaff(req: NextRequest) {
  const authHeader = req.headers.get('authorization') || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return { ok: false as const, status: 401, message: 'Missing Authorization header.' };
  }

  try {
    const decoded = await getAdminAuth().verifyIdToken(match[1]);
    const callerSnap = await getAdminDb().collection('users').doc(decoded.uid).get();
    const caller = callerSnap.exists ? callerSnap.data() : null;
    if (!caller || (caller.rol !== 'admin' && caller.rol !== 'colaborador')) {
      return { ok: false as const, status: 403, message: 'Forbidden.' };
    }
    return { ok: true as const, uid: decoded.uid };
  } catch {
    return { ok: false as const, status: 401, message: 'Invalid token.' };
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ uid: string }> }
) {
  const admin = await requireStaff(req);
  if (!admin.ok) {
    return NextResponse.json({ error: admin.message }, { status: admin.status });
  }

  const { uid } = await params;
  if (!uid) {
    return NextResponse.json({ error: 'Missing user id.' }, { status: 400 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const nombre = typeof body.nombre === 'string' ? body.nombre.trim() : '';
  const rol = body.rol;
  const empresaNombre = typeof body.empresa_nombre === 'string' ? body.empresa_nombre.trim() : '';
  const whatsappNumero = typeof body.whatsapp_numero === 'string' ? body.whatsapp_numero.trim() : '';
  const direccionFacturacion = typeof body.direccion_facturacion === 'string' ? body.direccion_facturacion.trim() : '';
  const nifCif = typeof body.nif_cif === 'string' ? body.nif_cif.trim() : '';
  const allowBookingWithoutPayment = body.allow_booking_without_payment === true;

  if (!nombre || !empresaNombre || !direccionFacturacion || !nifCif) {
    return NextResponse.json(
      { error: 'nombre, empresa_nombre, direccion_facturacion y nif_cif son obligatorios.' },
      { status: 400 }
    );
  }

  if (rol !== 'broker' && rol !== 'agency') {
    return NextResponse.json({ error: 'rol must be broker or agency.' }, { status: 400 });
  }

  const userRef = getAdminDb().collection('users').doc(uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    return NextResponse.json({ error: 'User not found.' }, { status: 404 });
  }

  const user = (userSnap.data() || {}) as Record<string, unknown>;
  const existingRole = user.rol;
  if (existingRole !== 'broker' && existingRole !== 'agency') {
    return NextResponse.json({ error: 'Only brokers/agencies are supported.' }, { status: 400 });
  }

  await userRef.set(
    {
      nombre,
      rol,
      tipo_entidad: rol,
      empresa_nombre: empresaNombre,
      whatsapp_numero: whatsappNumero,
      direccion_facturacion: direccionFacturacion,
      nif_cif: nifCif,
      allow_booking_without_payment: allowBookingWithoutPayment,
      actualizado_en: FieldValue.serverTimestamp(),
      actualizado_por: admin.uid,
    },
    { merge: true }
  );

  return NextResponse.json({ ok: true });
}
