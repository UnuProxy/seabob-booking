'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  collection,
  onSnapshot,
  deleteDoc,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
  query,
  where,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { BookingLink } from '@/types';
import { useAuthStore } from '@/store/authStore';
import {
  Link2,
  Plus,
  Trash2,
  Copy,
  ExternalLink,
  Search,
  Loader2,
  X,
  Save,
  ToggleLeft,
  ToggleRight,
  User,
  Mail,
  Phone,
  CheckCircle2,
  Ban,
} from 'lucide-react';
import clsx from 'clsx';

export default function BookingLinksPage() {
  const { user } = useAuthStore();
  const [links, setLinks] = useState<BookingLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [origin, setOrigin] = useState('');

  useEffect(() => {
    if (!user) return;

    const linksRef = collection(db, 'booking_links');
    const linksQuery =
      user.rol === 'admin'
        ? linksRef
        : query(linksRef, where('creado_por', '==', user.id));

    const unsubscribe = onSnapshot(linksQuery, (snapshot) => {
      const data = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      })) as BookingLink[];

      data.sort((a, b) => {
        const dateA = a.creado_en ? new Date(a.creado_en as string).getTime() : 0;
        const dateB = b.creado_en ? new Date(b.creado_en as string).getTime() : 0;
        return dateB - dateA;
      });

      setLinks(data);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setOrigin(window.location.origin);
    }
  }, []);

  const handleDelete = async (id: string) => {
    if (confirm('¿Eliminar este enlace de reserva?')) {
      await deleteDoc(doc(db, 'booking_links', id));
    }
  };

  const handleToggle = async (link: BookingLink) => {
    await updateDoc(doc(db, 'booking_links', link.id), {
      activo: !link.activo,
    });
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    alert('Enlace copiado al portapapeles');
  };

  const filteredLinks = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return links;
    return links.filter((link) => {
      return [
        link.etiqueta,
        link.cliente_nombre,
        link.cliente_email,
        link.cliente_telefono,
        link.token,
      ]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(term));
    });
  }, [links, searchTerm]);

  const getLinkStatus = (link: BookingLink) => {
    if (link.usado || (link.uso_unico && link.reservas_creadas > 0)) {
      return {
        label: 'Usado',
        style: 'bg-amber-100 text-amber-700 border-amber-200',
        icon: <CheckCircle2 size={14} />,
      };
    }
    if (!link.activo) {
      return {
        label: 'Desactivado',
        style: 'bg-slate-100 text-slate-600 border-slate-200',
        icon: <Ban size={14} />,
      };
    }
    return {
      label: 'Activo',
      style: 'bg-emerald-100 text-emerald-700 border-emerald-200',
      icon: <CheckCircle2 size={14} />,
    };
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="animate-spin text-blue-600" size={40} />
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-800 mb-2">Enlaces de Reserva</h1>
          <p className="text-gray-500">
            Genera enlaces simples para que un cliente complete su reserva sin registrarse.
          </p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="btn-primary"
        >
          <Plus size={20} />
          <span>Nuevo Enlace</span>
        </button>
      </div>

      <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm mb-6">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
          <input
            type="text"
            placeholder="Buscar por etiqueta, cliente o token..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {filteredLinks.map((link) => {
          const publicUrl = `${origin || ''}/booking/${link.token}`;
          const status = getLinkStatus(link);
          return (
            <div
              key={link.id}
              className="bg-white rounded-xl shadow-sm p-6 border border-gray-200 hover:shadow-md transition-shadow group relative"
            >
              <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => handleDelete(link.id)}
                  className="btn-icon text-slate-300 hover:text-rose-500 hover:bg-rose-50"
                  title="Eliminar"
                >
                  <Trash2 size={18} />
                </button>
              </div>

              <div className="flex items-start justify-between gap-4 mb-4">
                <div className="flex items-start gap-3">
                  <div className="bg-blue-50 p-3 rounded-full">
                    <Link2 size={22} className="text-blue-600" />
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-900">
                      {link.etiqueta || 'Enlace sin etiqueta'}
                    </h3>
                    <p className="text-xs text-gray-500 font-mono mt-1">Token: {link.token}</p>
                  </div>
                </div>
                <span
                  className={clsx(
                    'text-xs font-semibold px-2.5 py-1 rounded-full border inline-flex items-center gap-1',
                    status.style
                  )}
                >
                  {status.icon}
                  {status.label}
                </span>
              </div>

              <div className="space-y-2 mb-4 text-sm text-gray-600">
                {link.cliente_nombre && (
                  <div className="flex items-center gap-2">
                    <User size={16} className="text-gray-400" />
                    <span>{link.cliente_nombre}</span>
                  </div>
                )}
                {link.cliente_email && (
                  <div className="flex items-center gap-2">
                    <Mail size={16} className="text-gray-400" />
                    <span>{link.cliente_email}</span>
                  </div>
                )}
                {link.cliente_telefono && (
                  <div className="flex items-center gap-2">
                    <Phone size={16} className="text-gray-400" />
                    <span>{link.cliente_telefono}</span>
                  </div>
                )}
                {!link.cliente_nombre && !link.cliente_email && !link.cliente_telefono && (
                  <p className="text-xs text-gray-400">Sin datos pre-rellenados.</p>
                )}
              </div>

              <div className="grid grid-cols-3 gap-3 mb-4 text-xs text-gray-500">
                <div className="bg-slate-50 rounded-lg border border-slate-100 px-3 py-2">
                  <div className="font-semibold text-gray-900">{link.visitas ?? 0}</div>
                  <div>Visitas</div>
                </div>
                <div className="bg-slate-50 rounded-lg border border-slate-100 px-3 py-2">
                  <div className="font-semibold text-gray-900">{link.reservas_creadas ?? 0}</div>
                  <div>Reservas</div>
                </div>
                <div className="bg-slate-50 rounded-lg border border-slate-100 px-3 py-2">
                  <div className="font-semibold text-gray-900">{link.uso_unico ? 'Único' : 'Libre'}</div>
                  <div>Uso</div>
                </div>
              </div>

              <div className="bg-gray-50 p-3 rounded-lg mb-4 break-all text-xs text-gray-600 font-mono border border-gray-100">
                {publicUrl}
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => copyToClipboard(publicUrl)}
                  className="btn-outline flex-1 min-w-[140px]"
                >
                  <Copy size={16} />
                  Copiar
                </button>
                <a
                  href={publicUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-primary flex-1 min-w-[140px]"
                >
                  <ExternalLink size={16} />
                  Abrir
                </a>
                <button
                  onClick={() => handleToggle(link)}
                  className={clsx(
                    'btn-outline flex-1 min-w-[140px]',
                    link.activo
                      ? 'text-emerald-700 border-emerald-200 hover:bg-emerald-50'
                      : 'text-slate-600 border-slate-200'
                  )}
                >
                  {link.activo ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                  {link.activo ? 'Desactivar' : 'Activar'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {isModalOpen && <LinkGeneratorForm onClose={() => setIsModalOpen(false)} />}
    </div>
  );
}

function LinkGeneratorForm({ onClose }: { onClose: () => void }) {
  const { user } = useAuthStore();
  const [label, setLabel] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [oneTime, setOneTime] = useState(true);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const docRef = doc(collection(db, 'booking_links'));
      const token = docRef.id;

      await setDoc(docRef, {
        token,
        activo: true,
        uso_unico: oneTime,
        usado: false,
        visitas: 0,
        reservas_creadas: 0,
        etiqueta: label.trim() || null,
        cliente_nombre: name.trim() || null,
        cliente_email: email.trim() || null,
        cliente_telefono: phone.trim() || null,
        notas: notes.trim() || null,
        creado_por: user?.id || null,
        creado_en: serverTimestamp(),
      });

      onClose();
    } catch (error) {
      console.error(error);
      alert('Error al crear el enlace');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">
        <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-slate-50 rounded-t-2xl flex-shrink-0">
          <div>
            <h2 className="text-xl font-bold text-gray-800">Nuevo enlace de reserva</h2>
            <p className="text-sm text-gray-500">Pre-rellena datos para facilitar la reserva.</p>
          </div>
          <button
            onClick={onClose}
            className="btn-icon text-slate-500 hover:text-slate-700 hover:bg-slate-200"
          >
            <X size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto flex-1">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Etiqueta interna</label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Ej: Reserva familia Martínez"
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Nombre cliente</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ej: Juan Pérez"
                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Email cliente</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="juan@correo.com"
                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Teléfono / WhatsApp</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+34 600 000 000"
                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Notas internas</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Preferencias o detalles para el equipo."
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none resize-none"
            />
          </div>

          <label className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium text-gray-700">
            <input
              type="checkbox"
              checked={oneTime}
              onChange={(e) => setOneTime(e.target.checked)}
              className="w-5 h-5 text-blue-600 rounded border-slate-300"
            />
            Enlace de uso único (se desactiva tras la primera reserva)
          </label>

          <div className="pt-4">
            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full py-3"
            >
              {loading ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
              Generar Enlace
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
