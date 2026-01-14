'use client';

import { useState, useEffect } from 'react';
import { User } from '@/types';
import { collection, query, where, onSnapshot, doc, setDoc, serverTimestamp, deleteDoc, updateDoc } from 'firebase/firestore';
import { initializeApp, getApp, deleteApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { db } from '@/lib/firebase/config';
import { UserPlus, Mail, Phone, Building2, Trash2, Loader2, X, Save, AlertCircle, MapPin, Pencil, Lock } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import clsx from 'clsx';

export default function PartnersPage() {
  const [partners, setPartners] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPartner, setEditingPartner] = useState<User | null>(null);

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

  const handleDelete = async (id: string) => {
    if (confirm('¿Estás seguro de eliminar este partner?')) {
      try {
        await deleteDoc(doc(db, 'users', id));
      } catch (error) {
        console.error("Error deleting partner:", error);
        alert("Error al eliminar el partner");
      }
    }
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
            
            <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <button 
                onClick={() => {
                  setEditingPartner(partner);
                  setIsModalOpen(true);
                }}
                className="btn-icon text-slate-400 hover:text-blue-600 hover:bg-blue-50"
                title="Editar"
              >
                <Pencil size={18} />
              </button>
              <button 
                onClick={() => handleDelete(partner.id)}
                className="btn-icon text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                title="Eliminar"
              >
                <Trash2 size={18} />
              </button>
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
                    {partner.direccion_facturacion && <div className="truncate" title={partner.direccion_facturacion}>{partner.direccion_facturacion}</div>}
                 </div>
              )}
            </div>

            <div className="pt-4 border-t border-gray-100 flex justify-between items-center text-sm">
              <span className={`px-2.5 py-1 rounded-lg text-xs font-bold uppercase tracking-wide ${
                partner.rol === 'agency' ? 'bg-purple-100 text-purple-700' : 'bg-orange-100 text-orange-700'
              }`}>
                {partner.rol}
              </span>

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
        />
      )}
    </div>
  );
}

function PartnerForm({ onClose, initialData }: { onClose: () => void; initialData?: User | null }) {
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
  const [password, setPassword] = useState('');

  useEffect(() => {
    if (!initialData) {
      // Generate a random 8-character password
      const randomPass = Math.random().toString(36).slice(-8).toUpperCase();
      setPassword(randomPass);
    }
  }, [initialData]);

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
        // 1. Create Auth User
        const uid = await createAuthUser(email, password);

        // 2. Create Firestore Document with UID
        await setDoc(doc(db, 'users', uid), {
          ...commonData,
          id: uid,
          email,
          whatsapp_conectado: false,
          activo: true,
          creado_por: user?.id,
          creado_en: serverTimestamp(),
          requires_password_change: true, // Force password change
          permisos: [],
        });
      }

      onClose();
    } catch (err: any) {
      console.error(err);
      if (err.code === 'auth/email-already-in-use') {
        setError('Este email ya está registrado.');
      } else {
        setError('Error: ' + err.message);
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
            <div className="bg-blue-50 p-3 rounded-xl border border-blue-100">
              <label className="block text-sm font-bold text-blue-900 mb-1.5">
                <span className="flex items-center gap-1">
                  <Lock size={14} />
                  Contraseña Generada *
                </span>
              </label>
              <div className="relative">
                <input
                  type="text" 
                  value={password}
                  readOnly
                  className="w-full px-4 py-2.5 rounded-xl border border-blue-200 bg-white text-blue-900 font-mono font-bold tracking-wider text-center"
                />
              </div>
              <p className="text-xs text-blue-700 mt-2 leading-relaxed">
                ⚠️ <strong>Importante:</strong> Copia esta contraseña y envíala al usuario.
                El sistema le pedirá cambiarla en su primer inicio de sesión.
              </p>
            </div>
          )}          <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-sm text-blue-700">
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