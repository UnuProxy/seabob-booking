'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import type { Booking, User } from '@/types';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, Search, ShieldAlert } from 'lucide-react';

const getSafeDate = (value: any): Date | null => {
  if (!value) return null;
  if (typeof value?.toDate === 'function') return value.toDate();
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    const usersQuery = query(collection(db, 'users'));
    const unsubscribeUsers = onSnapshot(usersQuery, (snapshot) => {
      const data = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as User[];
      setUsers(
        data.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es', { sensitivity: 'base' }))
      );
      setLoading(false);
    });

    return () => unsubscribeUsers();
  }, []);

  useEffect(() => {
    const bookingsQuery = query(collection(db, 'bookings'), orderBy('creado_en', 'desc'));
    const unsubscribeBookings = onSnapshot(bookingsQuery, (snapshot) => {
      const data = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as Booking[];
      setBookings(data);
    });

    return () => unsubscribeBookings();
  }, []);

  const activityByUser = useMemo(() => {
    const map = new Map<string, { count: number; last: Date | null }>();
    bookings.forEach((booking) => {
      const userId = booking.creado_por;
      if (!userId) return;
      const createdAt = getSafeDate(booking.creado_en);
      const current = map.get(userId) || { count: 0, last: null };
      current.count += 1;
      if (createdAt && (!current.last || createdAt > current.last)) {
        current.last = createdAt;
      }
      map.set(userId, current);
    });
    return map;
  }, [bookings]);

  const filteredUsers = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return users;
    return users.filter((user) => {
      const name = user.nombre?.toLowerCase() || '';
      const email = user.email?.toLowerCase() || '';
      const role = user.rol?.toLowerCase() || '';
      return name.includes(term) || email.includes(term) || role.includes(term);
    });
  }, [users, searchTerm]);

  const renderIssues = (user: User) => {
    const issues: { label: string; tone: 'warning' | 'danger' | 'info' }[] = [];

    if (!user.activo) issues.push({ label: 'Inactivo', tone: 'danger' });
    if (user.requires_password_change) issues.push({ label: 'Debe cambiar clave', tone: 'warning' });
    if (!user.last_login_at) issues.push({ label: 'Sin login', tone: 'info' });
    if ((user.rol === 'broker' || user.rol === 'agency') && !user.whatsapp_numero) {
      issues.push({ label: 'Sin WhatsApp', tone: 'warning' });
    }
    if ((user.rol === 'broker' || user.rol === 'agency') && !user.nif_cif) {
      issues.push({ label: 'Sin CIF', tone: 'warning' });
    }

    if (issues.length === 0) {
      return (
        <span className="inline-flex items-center gap-2 text-emerald-700 text-xs font-semibold">
          <CheckCircle2 size={14} />
          Sin incidencias
        </span>
      );
    }

    return (
      <div className="flex flex-wrap gap-2">
        {issues.map((issue) => (
          <span
            key={issue.label}
            className={clsx(
              'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold',
              issue.tone === 'danger' && 'border-rose-200 bg-rose-50 text-rose-700',
              issue.tone === 'warning' && 'border-amber-200 bg-amber-50 text-amber-700',
              issue.tone === 'info' && 'border-slate-200 bg-slate-100 text-slate-600'
            )}
          >
            {issue.tone === 'danger' ? <ShieldAlert size={12} /> : <AlertTriangle size={12} />}
            {issue.label}
          </span>
        ))}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        <p className="text-gray-500 mt-4">Cargando usuarios...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-800 mb-2">Gestión de Usuarios</h1>
          <p className="text-gray-500">
            Revisa actividad, accesos recientes e incidencias en cuentas activas.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 w-full lg:w-auto">
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
              type="text"
              placeholder="Buscar por nombre, email o rol..."
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 pl-10 text-sm text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button className="btn-primary">+ Nuevo Usuario</button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 uppercase text-xs tracking-wide">
              <tr>
                <th className="px-6 py-4 text-left font-semibold">Usuario</th>
                <th className="px-6 py-4 text-left font-semibold">Rol</th>
                <th className="px-6 py-4 text-left font-semibold">Estado</th>
                <th className="px-6 py-4 text-left font-semibold">Último login</th>
                <th className="px-6 py-4 text-left font-semibold">Última actividad</th>
                <th className="px-6 py-4 text-left font-semibold">Reservas</th>
                <th className="px-6 py-4 text-left font-semibold">Incidencias</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredUsers.length === 0 ? (
                <tr>
                  <td className="px-6 py-10 text-center text-slate-500" colSpan={7}>
                    No hay usuarios que coincidan con la búsqueda.
                  </td>
                </tr>
              ) : (
                filteredUsers.map((user) => {
                  const lastLogin = getSafeDate(user.last_login_at);
                  const activity = activityByUser.get(user.id);
                  const lastActivity = activity?.last;
                  const bookingCount = activity?.count ?? 0;

                  return (
                    <tr key={user.id} className="hover:bg-slate-50/70">
                      <td className="px-6 py-4">
                        <div className="font-semibold text-slate-900">{user.nombre || 'Sin nombre'}</div>
                        <div className="text-xs text-slate-500">{user.email}</div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                          {user.rol}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={clsx(
                            'inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold border',
                            user.activo
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                              : 'border-rose-200 bg-rose-50 text-rose-700'
                          )}
                        >
                          {user.activo ? 'Activo' : 'Inactivo'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-slate-600">
                        {lastLogin
                          ? format(lastLogin, 'dd MMM yyyy, HH:mm', { locale: es })
                          : 'Sin registro'}
                      </td>
                      <td className="px-6 py-4 text-slate-600">
                        {lastActivity
                          ? format(lastActivity, 'dd MMM yyyy, HH:mm', { locale: es })
                          : 'Sin actividad'}
                      </td>
                      <td className="px-6 py-4 text-slate-700 font-semibold">{bookingCount}</td>
                      <td className="px-6 py-4">{renderIssues(user)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
