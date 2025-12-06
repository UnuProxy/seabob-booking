'use client';

import { useState, useEffect } from 'react';
import { collection, query, onSnapshot, addDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { WhatsAppLink } from '@/types';
import { useAuthStore } from '@/store/authStore';
import { MessageCircle, Plus, Trash2, Copy, ExternalLink, Search, Loader2, X, Save } from 'lucide-react';

export default function WhatsAppLinksPage() {
  const { user } = useAuthStore();
  const [links, setLinks] = useState<WhatsAppLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    if (!user) return;

    const q = query(collection(db, 'whatsapp_links'));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as WhatsAppLink));
      // Sort by newest
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

  const handleDelete = async (id: string) => {
    if (confirm('¿Estás seguro de eliminar este enlace?')) {
      await deleteDoc(doc(db, 'whatsapp_links', id));
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    alert('Enlace copiado al portapapeles');
  };

  const filteredLinks = links.filter(link => 
    link.whatsapp_numero.includes(searchTerm) ||
    (link.cliente_nombre && link.cliente_nombre.toLowerCase().includes(searchTerm.toLowerCase()))
  );

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
          <h1 className="text-3xl font-bold text-gray-800 mb-2">Enlaces de WhatsApp</h1>
          <p className="text-gray-500">Genera y gestiona enlaces directos para clientes.</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="bg-green-600 text-white px-5 py-3 rounded-xl hover:bg-green-700 hover:shadow-xl hover:shadow-green-900/20 transition-all font-semibold flex items-center gap-2 shadow-lg shadow-green-900/10"
        >
          <Plus size={20} />
          <span>Nuevo Enlace</span>
        </button>
      </div>

      <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
          <input 
            type="text"
            placeholder="Buscar por teléfono o nombre..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-green-500 transition-all"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredLinks.map((link) => (
          <div key={link.id} className="bg-white rounded-xl shadow-sm p-6 border border-gray-200 hover:shadow-md transition-shadow group relative">
            <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
              <button 
                onClick={() => handleDelete(link.id)}
                className="p-2 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                title="Eliminar"
              >
                <Trash2 size={18} />
              </button>
            </div>

            <div className="flex items-center gap-3 mb-4">
              <div className="bg-green-50 p-3 rounded-full">
                <MessageCircle size={24} className="text-green-600" />
              </div>
              <div>
                <h3 className="font-bold text-gray-900">{link.cliente_nombre || 'Cliente sin nombre'}</h3>
                <p className="text-sm text-gray-500 font-mono">{link.whatsapp_numero}</p>
              </div>
            </div>

            <div className="bg-gray-50 p-3 rounded-lg mb-4 break-all text-xs text-gray-600 font-mono border border-gray-100">
              {link.enlace_publico}
            </div>

            <div className="flex gap-3">
              <button 
                onClick={() => copyToClipboard(link.enlace_publico)}
                className="flex-1 bg-white border border-gray-200 text-gray-700 py-2 rounded-lg hover:bg-gray-50 font-medium text-sm flex items-center justify-center gap-2 transition-colors shadow-sm"
              >
                <Copy size={16} />
                Copiar
              </button>
              <a 
                href={link.enlace_publico}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 bg-green-600 text-white py-2 rounded-lg hover:bg-green-700 font-medium text-sm flex items-center justify-center gap-2 transition-colors shadow-green-900/20 shadow-md"
              >
                <ExternalLink size={16} />
                Probar
              </a>
            </div>
          </div>
        ))}
      </div>

      {isModalOpen && <LinkGeneratorForm onClose={() => setIsModalOpen(false)} />}
    </div>
  );
}

function LinkGeneratorForm({ onClose }: { onClose: () => void }) {
  const { user } = useAuthStore();
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [message, setMessage] = useState('Hola, me gustaría más información sobre SeaBob Center Ibiza...');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const encodedMessage = encodeURIComponent(message);
      const publicLink = `https://wa.me/${phone.replace(/\+/g, '').replace(/\s/g, '')}?text=${encodedMessage}`;

      await addDoc(collection(db, 'whatsapp_links'), {
        user_id: user?.id,
        whatsapp_numero: phone,
        cliente_nombre: name,
        enlace_publico: publicLink,
        codigo_enlace: Math.random().toString(36).substring(7),
        activo: true,
        clics: 0,
        creado_en: new Date().toISOString(),
      });

      onClose();
    } catch (error) {
      console.error(error);
      alert('Error al crear enlace');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-[90vh]">
        <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-slate-50 rounded-t-2xl flex-shrink-0">
          <h2 className="text-xl font-bold text-gray-800">Generar Enlace WhatsApp</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded-full p-2 transition-colors">
            <X size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto flex-1">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Teléfono (con prefijo)</label>
            <input
              type="text"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="Ej: 34600000000"
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:ring-2 focus:ring-green-500 outline-none"
              required
            />
            <p className="text-xs text-gray-500 mt-1">Incluye el código de país (ej. 34 para España)</p>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Nombre Cliente (Opcional)</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Ej: Juan Pérez"
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:ring-2 focus:ring-green-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Mensaje Predefinido</label>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              rows={4}
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:ring-2 focus:ring-green-500 outline-none resize-none"
            />
          </div>

          <div className="pt-4">
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-green-600 text-white rounded-xl hover:bg-green-700 font-bold flex items-center justify-center gap-2 shadow-lg shadow-green-900/20"
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

