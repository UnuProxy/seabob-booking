import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminAuth, getAdminDb } from '@/lib/firebase/admin';

export const runtime = 'nodejs';

function generateTempPassword(length = 10) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

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

export async function POST(
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

  const userRef = getAdminDb().collection('users').doc(uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    return NextResponse.json({ error: 'User not found.' }, { status: 404 });
  }

  const user = (userSnap.data() || {}) as Record<string, unknown>;
  const rol = user.rol;
  if (rol !== 'broker' && rol !== 'agency') {
    return NextResponse.json({ error: 'Only brokers/agencies are supported.' }, { status: 400 });
  }

  const email = user.email;
  if (!email || typeof email !== 'string') {
    return NextResponse.json({ error: 'User has no email.' }, { status: 400 });
  }

  const tempPassword = generateTempPassword();

  try {
    await getAdminAuth().updateUser(uid, { password: tempPassword });
  } catch (error: unknown) {
    const code =
      typeof error === 'object' && error
        ? (error as { code?: unknown }).code
        : undefined;
    if (code === 'auth/user-not-found') {
      return NextResponse.json({ error: 'Auth user not found.' }, { status: 404 });
    }
    console.error('updateUser password failed:', error);
    return NextResponse.json({ error: 'Could not update password.' }, { status: 500 });
  }

  await userRef.set(
    {
      requires_password_change: true,
      invite_status: 'generated',
      temp_password_last_generated_at: FieldValue.serverTimestamp(),
      temp_password_last_generated_by: admin.uid,
    },
    { merge: true }
  );

  const loginUrl = `${req.nextUrl.origin}/login`;

  return NextResponse.json({
    username: email,
    email,
    tempPassword,
    loginUrl,
  });
}
