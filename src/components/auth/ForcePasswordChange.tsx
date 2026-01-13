'use client';

import { useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import { updatePassword } from 'firebase/auth';
import { doc, updateDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase/config';
import { Lock, Save, Loader2, AlertCircle } from 'lucide-react';

export default function ForcePasswordChange() {
  const { user } = useAuthStore();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!user || !user.requires_password_change) {
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    if (newPassword !== confirmPassword) {
      setError('Las contraseñas no coinciden');
      setLoading(false);
      return;
    }

    if (newPassword.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres');
      setLoading(false);
      return;
    }

    try {
      const currentUser = auth.currentUser;
      if (currentUser) {
        await updatePassword(currentUser, newPassword);
        await updateDoc(doc(db, 'users', user.id), {
          requires_password_change: false
        });
        // Force reload to ensure state is clean
        window.location.reload();
      }
    } catch (err: any) {
      console.error(err);
      // Handle "requires-recent-login" error if session is stale
      if (err.code === 'auth/requires-recent-login') {
        setError('Por seguridad, cierra sesión y vuelve a entrar para cambiar la contraseña.');
      } else {
        setError('Error al actualizar contraseña: ' + err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/90 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8">
        <div className="flex flex-col items-center mb-6">
          <div className="bg-red-100 p-3 rounded-full mb-4">
            <Lock size={32} className="text-red-600" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 text-center">Cambio de Contraseña Obligatorio</h2>
          <p className="text-gray-500 text-center mt-2">
            Por seguridad, debes cambiar tu contraseña temporal antes de continuar.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="bg-red-50 text-red-700 p-3 rounded-lg flex items-center gap-2 text-sm">
              <AlertCircle size={16} />
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Nueva Contraseña</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 outline-none transition-all"
              placeholder="Mínimo 6 caracteres"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Confirmar Contraseña</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 outline-none transition-all"
              placeholder="Repite la contraseña"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full py-3 mt-2"
          >
            {loading ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
            Actualizar Contraseña
          </button>
        </form>
      </div>
    </div>
  );
}
