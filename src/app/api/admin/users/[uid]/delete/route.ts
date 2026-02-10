import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminDb } from '@/lib/firebase/admin';

export const runtime = 'nodejs';

async function requireAdmin(req: NextRequest) {
  const authHeader = req.headers.get('authorization') || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return { ok: false as const, status: 401, message: 'Missing Authorization header.' };
  }

  try {
    const decoded = await getAdminAuth().verifyIdToken(match[1]);
    const callerSnap = await getAdminDb().collection('users').doc(decoded.uid).get();
    const caller = callerSnap.exists ? callerSnap.data() : null;
    if (!caller || caller.rol !== 'admin') {
      return { ok: false as const, status: 403, message: 'Forbidden.' };
    }
    return { ok: true as const, uid: decoded.uid };
  } catch {
    return { ok: false as const, status: 401, message: 'Invalid token.' };
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ uid: string }> }
) {
  const admin = await requireAdmin(req);
  if (!admin.ok) {
    return NextResponse.json({ error: admin.message }, { status: admin.status });
  }

  const { uid } = await params;
  if (!uid) {
    return NextResponse.json({ error: 'Missing user id.' }, { status: 400 });
  }

  const db = getAdminDb();
  const userRef = db.collection('users').doc(uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    return NextResponse.json({ error: 'User not found.' }, { status: 404 });
  }

  const user = (userSnap.data() || {}) as Record<string, unknown>;
  const rol = user.rol;
  if (rol !== 'broker' && rol !== 'agency') {
    return NextResponse.json({ error: 'Only brokers/agencies are supported.' }, { status: 400 });
  }

  try {
    await getAdminAuth().deleteUser(uid);
  } catch (error: unknown) {
    const code =
      typeof error === 'object' && error
        ? (error as { code?: unknown }).code
        : undefined;
    if (code !== 'auth/user-not-found') {
      console.error('deleteUser failed:', error);
      return NextResponse.json({ error: 'Could not delete auth user.' }, { status: 500 });
    }
  }

  await userRef.delete();

  return NextResponse.json({ ok: true });
}

