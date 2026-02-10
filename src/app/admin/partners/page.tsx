'use client';

import { useState, useEffect } from 'react';
import { User } from '@/types';
import { collection, query, where, onSnapshot, doc, setDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { initializeApp, getApp, deleteApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { jsPDF } from 'jspdf';
import { auth, db } from '@/lib/firebase/config';
import { UserPlus, Mail, Phone, Building2, Trash2, Loader2, X, Save, AlertCircle, MapPin, Pencil, Lock, Download, Copy, MoreVertical } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import clsx from 'clsx';

type GeneratedAccess = {
  partnerId: string;
  partnerName: string;
  companyName?: string;
  username: string;
  email: string;
  tempPassword: string;
  loginUrl: string;
};

function safeFilenamePart(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function downloadAccessPdf(access: GeneratedAccess) {
  const docPdf = new jsPDF({ unit: 'pt', format: 'a6' });
  const pageW = docPdf.internal.pageSize.getWidth();
  const pageH = docPdf.internal.pageSize.getHeight();
  const margin = 22;
  const contentW = pageW - margin * 2;

  const headerH = 64;
  docPdf.setFillColor(15, 23, 42);
  docPdf.rect(0, 0, pageW, headerH, 'F');

  docPdf.setTextColor(255, 255, 255);
  docPdf.setFont('helvetica', 'bold');
  docPdf.setFontSize(14);
  docPdf.text('SeaBob Center', margin, 30);
  docPdf.setFontSize(10);
  docPdf.setFont('helvetica', 'normal');
  docPdf.text('Acceso al portal', margin, 46);

  const dateLabel = new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date());
  docPdf.setFontSize(9);
  docPdf.text(dateLabel, pageW - margin, 30, { align: 'right' });

  let y = headerH + 18;
  docPdf.setTextColor(15, 23, 42);

  const drawCard = (cardY: number, cardH: number) => {
    docPdf.setFillColor(248, 250, 252);
    docPdf.setDrawColor(226, 232, 240);
    docPdf.roundedRect(margin, cardY, contentW, cardH, 10, 10, 'FD');
  };

  const drawField = (label: string, value: string, opts?: { mono?: boolean; big?: boolean }) => {
    const labelSize = 8.5;
    const valueSize = opts?.big ? 14 : 10;
    const cardH = opts?.big ? 54 : 56;

    drawCard(y, cardH);
    docPdf.setFont('helvetica', 'bold');
    docPdf.setFontSize(labelSize);
    docPdf.setTextColor(100, 116, 139);
    docPdf.text(label.toUpperCase(), margin + 12, y + 18);

    docPdf.setTextColor(15, 23, 42);
    docPdf.setFontSize(valueSize);
    docPdf.setFont(opts?.mono ? 'courier' : 'helvetica', opts?.mono ? 'bold' : 'normal');

    const maxTextW = contentW - 24;
    const lines = docPdf.splitTextToSize(value, maxTextW) as string[];
    const lineH = opts?.big ? 16 : 12;
    const startY = y + (opts?.big ? 40 : 36);

    lines.slice(0, opts?.big ? 1 : 2).forEach((line, idx) => {
      docPdf.text(line, margin + 12, startY + idx * lineH);
    });

    y += cardH + 10;
  };

  const partnerTitle = access.companyName ? access.companyName : access.partnerName;
  drawField('Partner', partnerTitle, { mono: false });
  drawField('Enlace', access.loginUrl, { mono: false });
  drawField('Usuario (email)', access.username, { mono: false });

  // Password card with accent background
  const passCardH = 56;
  docPdf.setFillColor(239, 246, 255);
  docPdf.setDrawColor(191, 219, 254);
  docPdf.roundedRect(margin, y, contentW, passCardH, 10, 10, 'FD');
  docPdf.setFont('helvetica', 'bold');
  docPdf.setFontSize(8.5);
  docPdf.setTextColor(29, 78, 216);
  docPdf.text('CONTRASEÑA TEMPORAL', margin + 12, y + 18);
  docPdf.setFont('courier', 'bold');
  docPdf.setFontSize(14);
  docPdf.setTextColor(15, 23, 42);
  docPdf.text(access.tempPassword, margin + 12, y + 42);
  y += passCardH + 12;

  // Steps
  const stepsH = Math.max(70, pageH - y - margin);
  drawCard(y, stepsH);
  docPdf.setFont('helvetica', 'bold');
  docPdf.setFontSize(9);
  docPdf.setTextColor(15, 23, 42);
  docPdf.text('Pasos', margin + 12, y + 18);
  docPdf.setFont('helvetica', 'normal');
  docPdf.setFontSize(9);
  docPdf.setTextColor(51, 65, 85);
  const steps = [
    `1) Abre el enlace: ${access.loginUrl}`,
    `2) Inicia sesión con el usuario: ${access.username}`,
    `3) Usa la contraseña temporal y cámbiala al primer ingreso.`,
  ];
  const stepLines = steps.flatMap((s) => docPdf.splitTextToSize(s, contentW - 24) as string[]);
  let stepsY = y + 34;
  stepLines.slice(0, 8).forEach((line) => {
    docPdf.text(line, margin + 12, stepsY);
    stepsY += 12;
  });

  const datePart = new Date().toISOString().slice(0, 10);
  const namePart = safeFilenamePart(access.companyName || access.partnerName || access.email);
  docPdf.save(`acceso-${namePart || 'partner'}-${datePart}.pdf`);
}

export default function PartnersPage() {
  const [partners, setPartners] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPartner, setEditingPartner] = useState<User | null>(null);
  const [generatedAccess, setGeneratedAccess] = useState<GeneratedAccess | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  useEffect(() => {
    const q = query(
      collection(db, 'users'), 
      where('rol', 'in', ['broker', 'agency'])
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as User));
      setPartners(data);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!openMenuId) return;
    const close = () => setOpenMenuId(null);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [openMenuId]);

  const handleDelete = async (id: string) => {
    const confirmed = confirm(
      '¿Estás seguro de eliminar este partner?\n\nEsto eliminará también su usuario de acceso (Auth) para que el email pueda reutilizarse.'
    );
    if (!confirmed) return;

    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) {
        alert('Sesión no válida. Vuelve a iniciar sesión.');
        return;
      }

      const res = await fetch(`/api/admin/users/${id}/delete`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        alert(payload?.error || 'No se pudo eliminar el partner.');
        return;
      }
    } catch (error) {
      console.error('Error deleting partner:', error);
      alert('Error al eliminar el partner');
    }
  };

  const generateTempPassword = async (partner: User) => {
    const inviteStatus = partner.invite_status ?? 'pending';
    const action = inviteStatus === 'generated' ? 'Regenerar' : 'Generar';
    const confirmed = confirm(
      `${action} contraseña temporal para ${partner.nombre}?\n\nEsto reemplazará cualquier contraseña anterior.`
    );
    if (!confirmed) return;

    const token = await auth.currentUser?.getIdToken();
    if (!token) {
      alert('Sesión no válida. Vuelve a iniciar sesión.');
      return;
    }

    const res = await fetch(`/api/admin/users/${partner.id}/generate-temp-password`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      alert(payload?.error || 'No se pudo generar la contraseña.');
      return;
    }

    setGeneratedAccess({
      partnerId: partner.id,
      partnerName: partner.nombre,
      companyName: partner.empresa_nombre,
      username: payload.username,
      email: payload.email,
      tempPassword: payload.tempPassword,
      loginUrl: payload.loginUrl,
    });
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <Loader2 className="animate-spin text-blue-600 mb-4" size={48} />
        <p className="text-gray-500">Cargando socios...</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-800 mb-2">Brokers y Agencias</h1>
          <p className="text-gray-500">Gestiona tus colaboradores externos. Las comisiones se calculan según el producto reservado.</p>
        </div>
        <button 
          onClick={() => {
            setEditingPartner(null);
            setIsModalOpen(true);
          }}
          className="btn-primary"
        >
          <UserPlus size={20} />
          <span>Nuevo Partner</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {partners.map((partner) => (
          <div key={partner.id} className="bg-white rounded-xl shadow-sm p-6 border border-gray-200 hover:shadow-md transition-shadow group relative">
            
            <div className="absolute top-4 right-4">
              <div className="relative">
                <button
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenMenuId((prev) => (prev === partner.id ? null : partner.id));
                  }}
                  className="btn-icon text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                  title="Acciones"
                >
                  <MoreVertical size={18} />
                </button>

                {openMenuId === partner.id && (
                  <div
                    onPointerDown={(e) => e.stopPropagation()}
                    className="absolute right-0 mt-2 w-44 rounded-xl border border-slate-200 bg-white shadow-lg overflow-hidden z-10"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setOpenMenuId(null);
                        setEditingPartner(partner);
                        setIsModalOpen(true);
                      }}
                      className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 flex items-center gap-2"
                    >
                      <Pencil size={16} className="text-slate-500" />
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setOpenMenuId(null);
                        handleDelete(partner.id);
                      }}
                      className="w-full px-3 py-2 text-left text-sm hover:bg-rose-50 text-rose-700 flex items-center gap-2"
                    >
                      <Trash2 size={16} className="text-rose-600" />
                      Eliminar
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-between items-start mb-4 pr-8">
              <div>
                <h3 className="text-lg font-bold text-gray-900">{partner.nombre}</h3>
                {partner.empresa_nombre && (
                  <p className="text-sm text-gray-500 flex items-center gap-1 mt-1 font-medium">
                    <Building2 size={14} />
                    {partner.empresa_nombre}
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-3 text-sm text-gray-600 mb-6">
              <div className="flex items-center gap-2 bg-gray-50 p-2 rounded-lg">
                <Mail size={16} className="text-gray-400" />
                <span className="truncate">{partner.email}</span>
              </div>
              {partner.whatsapp_numero && (
                <div className="flex items-center gap-2 bg-gray-50 p-2 rounded-lg">
                  <Phone size={16} className="text-gray-400" />
                  {partner.whatsapp_numero}
                </div>
              )}
              {(partner.nif_cif || partner.direccion_facturacion) && (
                 <div className="flex flex-col gap-1 bg-gray-50 p-2 rounded-lg mt-2 text-xs text-gray-500">
                    {partner.nif_cif && <div><strong>CIF:</strong> {partner.nif_cif}</div>}
                    {partner.direccion_facturacion && <div className="truncate">{partner.direccion_facturacion}</div>}
                 </div>
              )}
            </div>

            <div className="pt-4 border-t border-gray-100 flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`px-2.5 py-1 rounded-lg text-xs font-bold uppercase tracking-wide ${
                  partner.rol === 'agency' ? 'bg-purple-100 text-purple-700' : 'bg-orange-100 text-orange-700'
                }`}>
                  {partner.rol}
                </span>

                <span
                  className={clsx(
                    'text-[11px] font-semibold px-2 py-1 rounded-lg',
                    (partner.invite_status ?? 'pending') === 'generated'
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-amber-50 text-amber-700'
                  )}
                >
                  Acceso: {(partner.invite_status ?? 'pending') === 'generated' ? 'generado' : 'pendiente'}
                </span>

                <button
                  type="button"
                  onClick={() => generateTempPassword(partner)}
                  className={clsx(
                    'inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-semibold',
                    (partner.invite_status ?? 'pending') === 'generated'
                      ? 'border-slate-200 text-slate-800 hover:bg-slate-50'
                      : 'border-emerald-200 text-emerald-800 hover:bg-emerald-50'
                  )}
                  title={(partner.invite_status ?? 'pending') === 'generated' ? 'Regenerar acceso (y PDF)' : 'Generar acceso (y PDF)'}
                >
                  <Lock size={14} />
                  {(partner.invite_status ?? 'pending') === 'generated' ? 'Regenerar acceso' : 'Generar acceso'}
                </button>
              </div>

              <span className="text-xs text-gray-400">
                Comisión según producto
              </span>
            </div>
          </div>
        ))}

        {partners.length === 0 && (
          <div className="col-span-full text-center py-16 bg-gray-50 rounded-xl border-2 border-dashed border-gray-200">
            <div className="bg-white p-4 rounded-full inline-flex mb-4 shadow-sm">
              <UserPlus size={32} className="text-gray-300" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900">No hay partners registrados</h3>
            <p className="text-gray-500 mt-1">Añade brokers o agencias para empezar a colaborar.</p>
          </div>
        )}
      </div>

      {isModalOpen && (
        <PartnerForm 
          onClose={() => {
            setIsModalOpen(false);
            setEditingPartner(null);
          }} 
          initialData={editingPartner}
          onAccessGenerated={(access) => setGeneratedAccess(access)}
        />
      )}

      {generatedAccess && (
        <AccessModal
          access={generatedAccess}
          onClose={() => setGeneratedAccess(null)}
        />
      )}
    </div>
  );
}

function AccessModal({ access, onClose }: { access: GeneratedAccess; onClose: () => void }) {
  const copyText = async () => {
    const text = `Enlace: ${access.loginUrl}\nUsuario: ${access.username}\nContraseña temporal: ${access.tempPassword}`;
    try {
      await navigator.clipboard.writeText(text);
      alert('Copiado al portapapeles.');
    } catch {
      alert('No se pudo copiar automáticamente. Copia manualmente desde la pantalla.');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">
        <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-slate-50 rounded-t-2xl shrink-0">
          <h2 className="text-xl font-bold text-gray-800">Acceso generado</h2>
          <button onClick={onClose} className="btn-icon text-slate-500 hover:text-slate-700 hover:bg-slate-200">
            <X size={24} />
          </button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto">
          <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4">
            <p className="text-sm text-emerald-900 font-semibold">{access.partnerName}</p>
            {access.companyName && <p className="text-xs text-emerald-700 mt-1">{access.companyName}</p>}
          </div>

          <div className="space-y-2 text-sm text-slate-700">
            <div className="flex items-start justify-between gap-3 bg-slate-50 border border-slate-200 rounded-xl p-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-500">Enlace</p>
                <p className="break-words">{access.loginUrl}</p>
              </div>
            </div>
            <div className="flex items-start justify-between gap-3 bg-slate-50 border border-slate-200 rounded-xl p-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-500">Usuario (email)</p>
                <p className="break-words font-medium">{access.username}</p>
              </div>
            </div>
            <div className="flex items-start justify-between gap-3 bg-blue-50 border border-blue-100 rounded-xl p-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-blue-700">Contraseña temporal</p>
                <p className="font-mono font-bold tracking-wider text-blue-900 text-base">{access.tempPassword}</p>
                <p className="text-xs text-blue-700 mt-1">
                  El sistema le pedirá cambiarla en su primer inicio de sesión.
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <button type="button" onClick={copyText} className="btn-outline flex-1">
              <Copy size={18} />
              Copiar datos
            </button>
            <button type="button" onClick={() => downloadAccessPdf(access)} className="btn-primary flex-1">
              <Download size={18} />
              Descargar PDF
            </button>
          </div>
        </div>

        <div className="p-6 pt-0">
          <button type="button" onClick={onClose} className="btn-outline w-full">
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

function PartnerForm({
  onClose,
  initialData,
  onAccessGenerated,
}: {
  onClose: () => void;
  initialData?: User | null;
  onAccessGenerated: (access: GeneratedAccess) => void;
}) {
  const { user } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // Form Fields
  const [type, setType] = useState<'broker' | 'agency'>(
    (initialData?.rol === 'broker' || initialData?.rol === 'agency') ? initialData.rol : 'broker'
  );
  const [name, setName] = useState(initialData?.nombre || '');
  const [companyName, setCompanyName] = useState(initialData?.empresa_nombre || '');
  const [email, setEmail] = useState(initialData?.email || '');
  const [phone, setPhone] = useState(initialData?.whatsapp_numero || '');
  const [taxId, setTaxId] = useState(initialData?.nif_cif || '');
  const [billingAddress, setBillingAddress] = useState(initialData?.direccion_facturacion || '');
  const [generateAccessNow, setGenerateAccessNow] = useState(false);
  const [sharedPassword, setSharedPassword] = useState('');

  const makePassword = (len = 10) => {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = crypto.getRandomValues(new Uint8Array(len));
    let out = '';
    for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
    return out;
  };

  useEffect(() => {
    if (!initialData && generateAccessNow && !sharedPassword) {
      setSharedPassword(makePassword(10));
    }
  }, [initialData, generateAccessNow, sharedPassword]);

  const createAuthUser = async (email: string, pass: string) => {
    const config = getApp().options;
    const secondaryApp = initializeApp(config, "Secondary");
    const secondaryAuth = getAuth(secondaryApp);
    
    try {
      const userCredential = await createUserWithEmailAndPassword(secondaryAuth, email, pass);
      await signOut(secondaryAuth);
      return userCredential.user.uid;
    } finally {
      await deleteApp(secondaryApp);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const commonData = {
        nombre: name,
        rol: type,
        tipo_entidad: type,
        empresa_nombre: companyName,
        whatsapp_numero: phone,
        direccion_facturacion: billingAddress,
        nif_cif: taxId,
      };

      if (initialData) {
        await updateDoc(doc(db, 'users', initialData.id), commonData);
      } else {
        const passwordToUse = generateAccessNow ? sharedPassword : makePassword(18);

        // 1. Create Auth User
        const uid = await createAuthUser(email, passwordToUse);

        // 2. Create Firestore Document with UID
        const payload: Record<string, unknown> = {
          ...commonData,
          id: uid,
          email,
          whatsapp_conectado: false,
          activo: true,
          creado_por: user?.id,
          creado_en: serverTimestamp(),
          requires_password_change: true, // Force password change
          permisos: [],
          invite_status: generateAccessNow ? 'generated' : 'pending',
        };

        if (generateAccessNow) {
          payload.temp_password_last_generated_at = serverTimestamp();
          payload.temp_password_last_generated_by = user?.id || null;
        }

        await setDoc(doc(db, 'users', uid), payload);

        if (generateAccessNow) {
          const loginUrl = `${window.location.origin}/login`;
          onAccessGenerated({
            partnerId: uid,
            partnerName: name,
            companyName,
            username: email,
            email,
            tempPassword: passwordToUse,
            loginUrl,
          });
        }
      }

      onClose();
    } catch (err: unknown) {
      console.error(err);
      const code = typeof err === 'object' && err ? (err as { code?: unknown }).code : undefined;
      const message =
        typeof err === 'object' && err ? (err as { message?: unknown }).message : undefined;

      if (code === 'auth/email-already-in-use') {
        setError('Este email ya está registrado.');
      } else {
        setError('Error: ' + (typeof message === 'string' ? message : 'No se pudo guardar el partner.'));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">
        <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-slate-50 rounded-t-2xl shrink-0">
          <h2 className="text-xl font-bold text-gray-800">{initialData ? 'Editar Partner' : 'Nuevo Partner'}</h2>
          <button
            onClick={onClose}
            className="btn-icon text-slate-500 hover:text-slate-700 hover:bg-slate-200"
          >
            <X size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto flex-1">
          {error && (
            <div className="bg-red-50 text-red-700 p-3 rounded-lg flex items-center gap-2 text-sm">
              <AlertCircle size={16} />
              {error}
            </div>
          )}

          <div className="flex bg-gray-100 p-1 rounded-lg gap-2">
            <button
              type="button"
              onClick={() => setType('broker')}
              className={clsx('flex-1', type === 'broker' ? 'btn-primary' : 'btn-outline')}
            >
              Broker
            </button>
            <button
              type="button"
              onClick={() => setType('agency')}
              className={clsx('flex-1', type === 'agency' ? 'btn-primary' : 'btn-outline')}
            >
              Agencia
            </button>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Nombre del Contacto *</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 bg-white focus:bg-white focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 transition-all outline-none text-gray-900 font-medium"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Nombre Empresa *</label>
            <input
              type="text"
              value={companyName}
              onChange={e => setCompanyName(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 bg-white focus:bg-white focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 transition-all outline-none text-gray-900 font-medium"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">
              <span className="flex items-center gap-1">
                NIF / CIF (VAT) *
              </span>
            </label>
            <input
              type="text"
              value={taxId}
              onChange={e => setTaxId(e.target.value)}
              placeholder="Ej: B12345678"
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 bg-white focus:bg-white focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 transition-all outline-none text-gray-900 font-medium"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">
              <span className="flex items-center gap-1">
                <MapPin size={14} />
                Dirección Fiscal *
              </span>
            </label>
            <textarea
              value={billingAddress}
              onChange={e => setBillingAddress(e.target.value)}
              placeholder="Calle, número, código postal, ciudad..."
              rows={2}
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 bg-white focus:bg-white focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 transition-all outline-none text-gray-900 font-medium resize-none"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Email {initialData && <span className="text-xs text-gray-400 font-normal">(No editable)</span>}</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 bg-white focus:bg-white focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 transition-all outline-none text-gray-900 font-medium disabled:opacity-60 disabled:cursor-not-allowed"
                required
                disabled={!!initialData}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Teléfono</label>
              <input
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 bg-white focus:bg-white focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 transition-all outline-none text-gray-900 font-medium"
              />
            </div>
          </div>

          {!initialData && (
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-3">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={generateAccessNow}
                  onChange={(e) => setGenerateAccessNow(e.target.checked)}
                  className="mt-0.5 h-4 w-4"
                />
                <div>
                  <p className="text-sm font-semibold text-slate-900">Generar contraseña ahora</p>
                  <p className="text-xs text-slate-600">
                    Si lo dejas desactivado, podrás generar la contraseña y el PDF más tarde desde la lista.
                  </p>
                </div>
              </label>

              {generateAccessNow && (
                <div className="bg-blue-50 p-3 rounded-xl border border-blue-100">
                  <label className="block text-sm font-bold text-blue-900 mb-1.5">
                    <span className="flex items-center gap-1">
                      <Lock size={14} />
                      Contraseña Temporal
                    </span>
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={sharedPassword}
                      readOnly
                      className="w-full px-4 py-2.5 rounded-xl border border-blue-200 bg-white text-blue-900 font-mono font-bold tracking-wider text-center"
                    />
                  </div>
                  <p className="text-xs text-blue-700 mt-2 leading-relaxed">
                    El sistema le pedirá cambiarla en su primer inicio de sesión.
                  </p>
                </div>
              )}
            </div>
          )}
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-sm text-blue-700">
            <strong>ℹ️ Comisiones:</strong> Las comisiones se calculan automáticamente según el porcentaje configurado en cada producto.
          </div>

          <div className="pt-4">
            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full py-3 disabled:opacity-50"
            >
              {loading ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
              Guardar Partner
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
