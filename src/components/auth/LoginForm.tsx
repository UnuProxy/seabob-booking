'use client';

import { useState, useEffect, type FormEvent } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import { auth } from '@/lib/firebase/config';
import { useAuthStore } from '@/store/authStore';

export function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const router = useRouter();
  const { user } = useAuthStore();

  useEffect(() => {
    if (!user) return;

    if (user.rol === 'admin' || user.rol === 'colaborador') {
      router.push('/admin/dashboard');
    } else if (user.rol === 'delivery') {
      router.push('/delivery/dashboard');
    } else if (user.rol === 'broker' || user.rol === 'agency') {
      router.push('/broker/dashboard');
    } else {
      router.push('/admin/dashboard');
    }
  }, [user, router]);

  const getLoginErrorMessage = (err: unknown) => {
    const code = typeof err === 'object' && err ? (err as { code?: unknown }).code : undefined;

    switch (code) {
      case 'auth/invalid-credential':
      case 'auth/user-not-found':
      case 'auth/wrong-password':
        return 'Email o contraseña incorrectos.';
      case 'auth/too-many-requests':
        return 'Demasiados intentos fallidos. Espera unos minutos antes de volver a intentar.';
      case 'auth/user-disabled':
        return 'Esta cuenta está desactivada. Contacta al administrador.';
      case 'auth/network-request-failed':
        return 'No se pudo conectar. Revisa tu internet e inténtalo de nuevo.';
      case 'auth/invalid-email':
        return 'El email no tiene un formato válido.';
      default:
        return 'Error al iniciar sesión. Inténtalo de nuevo.';
    }
  };

  const handleLogin = async (event: FormEvent) => {
    event.preventDefault();
    if (user || isSubmitting) return;

    setError('');
    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail) {
      setError('Introduce un email válido.');
      return;
    }

    setIsSubmitting(true);
    try {
      await signInWithEmailAndPassword(auth, normalizedEmail, password);
    } catch (err: unknown) {
      setError(getLoginErrorMessage(err));
      console.error('Login failed:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (user) {
    return null;
  }

  return (
    <div className="w-full">
      <h2 className="text-3xl font-semibold text-slate-900 mb-6">Acceder al Portal</h2>

      {error && (
        <div className="bg-rose-100 border border-rose-300 text-rose-700 px-4 py-3 rounded-md mb-4">
          {error}
        </div>
      )}

      <form onSubmit={handleLogin} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1">Email</label>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full px-4 py-3 border border-slate-200 rounded-2xl bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1">Contraseña</label>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full px-4 py-3 border border-slate-200 rounded-2xl bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900"
            required
          />
        </div>

        <button
          type="submit"
          className="btn-primary w-full py-3"
          disabled={isSubmitting}
        >
          {isSubmitting ? 'Entrando...' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
