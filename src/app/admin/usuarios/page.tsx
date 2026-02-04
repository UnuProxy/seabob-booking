'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, orderBy, doc, deleteDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import type { Booking, User } from '@/types';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, Search, ShieldAlert, Trash2, UserPlus, X, RefreshCcw } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { initializeApp, getApp, deleteApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signOut } from 'firebase/auth';

const INTERNAL_ROLES: User['rol'][] = ['admin', 'colaborador', 'delivery'];
const EXTERNAL_ROLES: User['rol'][] = ['broker', 'agency'];

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
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const { user: currentUser } = useAuthStore();
  const [isModalOpen, setIsModalOpen] = useState(false);

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

  const handleDelete = async (target: User) => {
    if (deletingId) return;
    if (currentUser?.id === target.id) {
      alert('No puedes eliminar tu propio usuario.');
      return;
    }
    const name = target.nombre || target.email || 'este usuario';
    if (!confirm(`¿Eliminar ${name}? Esta acción no se puede deshacer.`)) return;
    try {
      setDeletingId(target.id);
      await deleteDoc(doc(db, 'users', target.id));
    } catch (error) {
      console.error('Error deleting user:', error);
      alert('Error al eliminar el usuario.');
    } finally {
      setDeletingId(null);
    }
  };

  const renderTable = (usersList: User[], emptyMessage: string) => (
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
              <th className="px-6 py-4 text-left font-semibold">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {usersList.length === 0 ? (
              <tr>
                <td className="px-6 py-10 text-center text-slate-500" colSpan={8}>
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              usersList.map((user) => {
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
                    <td className="px-6 py-4">
                      <button
                        type="button"
                        onClick={() => handleDelete(user)}
                        disabled={deletingId === user.id || currentUser?.id === user.id}
                        className={clsx(
                          'inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold transition',
                          deletingId === user.id
                            ? 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed'
                            : currentUser?.id === user.id
                              ? 'border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed'
                              : 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'
                        )}
                        title={currentUser?.id === user.id ? 'No puedes eliminar tu propio usuario' : 'Eliminar usuario'}
                      >
                        <Trash2 size={14} />
                        {deletingId === user.id ? 'Eliminando...' : 'Eliminar'}
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        <p className="text-gray-500 mt-4">Cargando usuarios...</p>
      </div>
    );
  }

  const internalUsers = filteredUsers.filter((user) => INTERNAL_ROLES.includes(user.rol));
  const externalUsers = filteredUsers.filter((user) => EXTERNAL_ROLES.includes(user.rol));

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
          <button
            className="btn-primary"
            onClick={() => setIsModalOpen(true)}
          >
            + Nuevo Usuario
          </button>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Equipo interno</h2>
          <p className="text-sm text-slate-500">
            Administradores, colaboradores y equipo de entregas.
          </p>
        </div>
        {renderTable(internalUsers, 'No hay usuarios internos que coincidan con la búsqueda.')}
      </div>

      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Brokers y externos</h2>
          <p className="text-sm text-slate-500">
            Socios externos con acceso limitado al portal.
          </p>
        </div>
        {renderTable(externalUsers, 'No hay usuarios externos que coincidan con la búsqueda.')}
      </div>

      {isModalOpen && (
        <UserForm
          onClose={() => setIsModalOpen(false)}
          currentUserId={currentUser?.id}
        />
      )}
    </div>
  );
}

function UserForm({
  onClose,
  currentUserId,
}: {
  onClose: () => void;
  currentUserId?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [role, setRole] = useState<User['rol']>('colaborador');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [taxId, setTaxId] = useState('');
  const [billingAddress, setBillingAddress] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    const randomPass = Math.random().toString(36).slice(-8).toUpperCase();
    setPassword(randomPass);
  }, []);

  const regeneratePassword = () => {
    const randomPass = Math.random().toString(36).slice(-8).toUpperCase();
    setPassword(randomPass);
  };

  const createAuthUser = async (userEmail: string, pass: string) => {
    const config = getApp().options;
    const secondaryApp = initializeApp(config, `Secondary-${Date.now()}`);
    const secondaryAuth = getAuth(secondaryApp);

    try {
      const userCredential = await createUserWithEmailAndPassword(secondaryAuth, userEmail, pass);
      await signOut(secondaryAuth);
      return userCredential.user.uid;
    } finally {
      await deleteApp(secondaryApp);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');

    try {
      const uid = await createAuthUser(email, password);
      const tipo_entidad =
        role === 'broker' || role === 'agency' ? role : 'individual';

      const payload: Record<string, any> = {
        id: uid,
        email,
        nombre: name,
        rol: role,
        tipo_entidad,
        whatsapp_conectado: false,
        activo: true,
        creado_por: currentUserId || null,
        creado_en: serverTimestamp(),
        requires_password_change: true,
        permisos: [],
      };

      if (companyName.trim()) payload.empresa_nombre = companyName.trim();
      if (phone.trim()) payload.whatsapp_numero = phone.trim();
      if (billingAddress.trim()) payload.direccion_facturacion = billingAddress.trim();
      if (taxId.trim()) payload.nif_cif = taxId.trim();

      await setDoc(doc(db, 'users', uid), payload);

      onClose();
    } catch (err: any) {
      console.error(err);
      if (err.code === 'auth/email-already-in-use') {
        setError('Este email ya está registrado.');
      } else {
        setError(`Error: ${err.message || 'No se pudo crear el usuario.'}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const isExternal = role === 'broker' || role === 'agency';

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">
        <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-slate-50 rounded-t-2xl shrink-0">
          <div className="flex items-center gap-3">
            <UserPlus size={20} className="text-blue-600" />
            <h2 className="text-xl font-bold text-gray-800">Nuevo Usuario</h2>
          </div>
          <button
            onClick={onClose}
            className="btn-icon text-slate-500 hover:text-slate-700 hover:bg-slate-200"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto">
          {error && (
            <div className="bg-rose-100 border border-rose-200 text-rose-700 px-4 py-2 rounded-lg text-sm">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Rol</label>
            <select
              value={role}
              onChange={(event) => setRole(event.target.value as User['rol'])}
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="admin">Admin</option>
              <option value="colaborador">Colaborador</option>
              <option value="delivery">Equipo de entregas</option>
              <option value="broker">Broker</option>
              <option value="agency">Agencia</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Nombre completo</label>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Teléfono / WhatsApp</label>
            <input
              type="text"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {isExternal && (
            <>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Empresa</label>
                <input
                  type="text"
                  value={companyName}
                  onChange={(event) => setCompanyName(event.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">NIF/CIF</label>
                <input
                  type="text"
                  value={taxId}
                  onChange={(event) => setTaxId(event.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Dirección de facturación</label>
                <input
                  type="text"
                  value={billingAddress}
                  onChange={(event) => setBillingAddress(event.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Contraseña temporal</label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={password}
                readOnly
                className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-700 shadow-sm focus:outline-none"
              />
              <button
                type="button"
                onClick={regeneratePassword}
                className="btn-outline px-3"
                title="Generar otra contraseña"
              >
                <RefreshCcw size={16} />
              </button>
            </div>
            <p className="text-xs text-slate-500 mt-2">
              El usuario tendrá que cambiar la contraseña al primer ingreso.
            </p>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
            <button type="button" onClick={onClose} className="btn-outline">
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Creando...' : 'Crear usuario'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
