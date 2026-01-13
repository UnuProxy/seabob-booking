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
  Link2,
  Briefcase,
  X,
  Coins
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
    { name: 'Comisiones', href: '/admin/comisiones', icon: Coins, roles: ['admin'] },
    { name: 'Enlaces Reserva', href: '/admin/enlaces-reservas', icon: Link2, roles: ['admin', 'colaborador'] },
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
          "fixed top-0 left-0 z-50 h-screen w-72 text-slate-100 transition-transform duration-300 lg:translate-x-0 shadow-xl flex flex-col bg-gradient-to-b from-slate-950 via-blue-950 to-blue-900 border-r border-white/10 overflow-hidden",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="absolute -top-20 left-10 h-40 w-40 rounded-full bg-cyan-400/15 blur-3xl pointer-events-none" aria-hidden="true" />
        <div className="absolute bottom-10 -right-10 h-48 w-48 rounded-full bg-indigo-500/15 blur-3xl pointer-events-none" aria-hidden="true" />

        {/* Header with Logo */}
        <div className="p-6 border-b border-white/10 flex items-center justify-between relative">
          <div className="relative w-full h-16 bg-white/90 rounded-2xl p-2 shadow-lg shadow-black/30 border border-white/50">
            <Image
              src="/seabob-logo-CENTER_IBIZA-ROJO.png"
              alt="SeaBob Center Ibiza"
              fill
              sizes="240px"
              className="object-contain object-left"
              priority
            />
          </div>
          <button 
            onClick={onClose}
            className="lg:hidden btn-icon text-white/60 hover:text-white hover:bg-white/10 absolute right-4 top-4"
          >
            <X size={24} />
          </button>
        </div>

        {/* Nav Items */}
        <nav className="flex-1 px-4 py-6 space-y-2 overflow-y-auto scrollbar-thin scrollbar-thumb-white/20">
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
                    ? "bg-white/18 text-white shadow-[0_12px_30px_rgba(15,23,42,0.35)] translate-x-1" 
                    : "text-blue-100/70 hover:bg-white/10 hover:text-white hover:translate-x-1"
                )}
              >
                <item.icon 
                  size={24} 
                  className={clsx(
                    "transition-colors",
                    isActive ? "text-white" : "text-blue-200/60 group-hover:text-white"
                  )} 
                />
                <span>{item.name}</span>
              </Link>
            );
          })}
        </nav>

        {/* Footer User Profile */}
        <div className="p-4 border-t border-white/10">
          <div className="flex items-center gap-3 px-2 mb-4">
            <div className="h-10 w-10 rounded-full bg-white/15 flex items-center justify-center text-white font-bold text-lg shadow-md ring-1 ring-white/30">
              {user?.nombre?.charAt(0) || 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold truncate text-white">{user?.nombre || 'Usuario'}</p>
              <p className="text-xs text-blue-100/60 capitalize truncate">{user?.rol}</p>
            </div>
          </div>
          
          <button
            onClick={handleLogout}
            className="btn-light w-full text-red-100 hover:text-red-50"
          >
            <LogOut size={20} />
            <span>Cerrar Sesión</span>
          </button>
        </div>
      </aside>
    </>
  );
}
