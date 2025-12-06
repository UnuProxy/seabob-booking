'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';
import { 
  LayoutDashboard, 
  Package, 
  CalendarDays, 
  Users, 
  FileText, 
  Settings, 
  LogOut,
  MessageCircle,
  Briefcase,
  X
} from 'lucide-react';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase/config';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { user } = useAuthStore();
  const router = useRouter();

  const handleLogout = async () => {
    await signOut(auth);
    router.push('/login');
  };

  const navItems = [
    { name: 'Dashboard', href: '/admin/dashboard', icon: LayoutDashboard, roles: ['admin', 'colaborador', 'broker', 'agency'] },
    { name: 'Reservas', href: '/admin/reservas', icon: CalendarDays, roles: ['admin', 'colaborador', 'broker', 'agency'] },
    { name: 'Productos', href: '/admin/productos', icon: Package, roles: ['admin'] },
    { name: 'Stock Diario', href: '/admin/stock', icon: CalendarDays, roles: ['admin', 'colaborador'] },
    { name: 'Usuarios', href: '/admin/usuarios', icon: Users, roles: ['admin'] },
    { name: 'Brokers/Agencias', href: '/admin/partners', icon: Briefcase, roles: ['admin'] },
    { name: 'Enlaces WhatsApp', href: '/admin/enlaces', icon: MessageCircle, roles: ['admin', 'colaborador'] },
    { name: 'Contratos', href: '/admin/contratos', icon: FileText, roles: ['admin', 'colaborador'] },
    { name: 'Configuración', href: '/admin/settings', icon: Settings, roles: ['admin'] },
  ];

  // Filter items based on user role
  const filteredNavItems = navItems.filter(item => 
    user && item.roles.includes(user.rol)
  );

  return (
    <>
      {/* Mobile Overlay */}
      <div 
        className={clsx(
          "fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden transition-opacity duration-300",
          isOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        onClick={onClose}
      />

      {/* Sidebar Container */}
      <aside 
        className={clsx(
          "fixed top-0 left-0 z-50 h-screen w-72 bg-slate-900 border-r border-slate-800 text-slate-100 transition-transform duration-300 lg:translate-x-0 lg:static lg:shrink-0 shadow-xl flex flex-col",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Header with Logo */}
        <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-slate-900">
          <div className="relative w-full h-16 bg-white rounded-lg p-2">
             <img 
               src="/seabob-logo-CENTER_IBIZA-ROJO.png" 
               alt="SeaBob Center Ibiza" 
               className="w-full h-full object-contain object-left"
             />
          </div>
          <button 
            onClick={onClose}
            className="lg:hidden p-2 text-gray-400 hover:text-gray-600 transition-colors absolute right-4 top-4"
          >
            <X size={24} />
          </button>
        </div>

        {/* Nav Items */}
        <nav className="flex-1 px-4 py-6 space-y-2 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-700">
          {filteredNavItems.map((item) => {
            const isActive = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => {
                  if (window.innerWidth < 1024) onClose();
                }}
                className={clsx(
                  "flex items-center gap-4 px-4 py-4 rounded-xl transition-all duration-200 group font-medium text-base",
                  isActive 
                    ? "bg-blue-600 text-white shadow-lg shadow-blue-900/50 translate-x-1" 
                    : "text-slate-400 hover:bg-slate-800 hover:text-white hover:translate-x-1"
                )}
              >
                <item.icon 
                  size={24} 
                  className={clsx(
                    "transition-colors",
                    isActive ? "text-white" : "text-slate-500 group-hover:text-blue-400"
                  )} 
                />
                <span>{item.name}</span>
              </Link>
            );
          })}
        </nav>

        {/* Footer User Profile */}
        <div className="p-4 border-t border-slate-800 bg-slate-900">
          <div className="flex items-center gap-3 px-2 mb-4">
            <div className="h-10 w-10 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold text-lg shadow-md ring-2 ring-slate-700">
              {user?.nombre?.charAt(0) || 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold truncate text-white">{user?.nombre || 'Usuario'}</p>
              <p className="text-xs text-slate-400 capitalize truncate">{user?.rol}</p>
            </div>
          </div>
          
          <button
            onClick={handleLogout}
            className="flex items-center justify-center gap-2 w-full px-4 py-3 text-red-400 hover:bg-red-950/30 hover:text-red-300 rounded-lg transition-colors text-sm font-medium border border-slate-700 hover:border-red-900/50 bg-slate-800/50 shadow-sm"
          >
            <LogOut size={20} />
            <span>Cerrar Sesión</span>
          </button>
        </div>
      </aside>
    </>
  );
}
