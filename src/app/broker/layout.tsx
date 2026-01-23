'use client';

import { useAuthStore } from '@/store/authStore';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import Image from 'next/image';
import { Menu, X, CalendarDays, LogOut, Briefcase, Wallet } from 'lucide-react';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase/config';
import Link from 'next/link';
import clsx from 'clsx';
import ForcePasswordChange from '@/components/auth/ForcePasswordChange';
import { usePartnerCommissions } from '@/lib/firebase/hooks/usePartnerCommissions';

export default function BrokerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading } = useAuthStore();
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  
  // Fetch commission data for the sidebar badge - must be called before any returns
  const { pendiente: pendingCommission } = usePartnerCommissions(
    user?.id,
    user?.rol as 'broker' | 'agency' | undefined
  );

  useEffect(() => {
    if (!loading) {
      if (!user) {
        router.push('/login');
      } else if (user.rol !== 'broker' && user.rol !== 'agency') {
        // Redirect non-brokers to admin dashboard
        router.push('/admin/dashboard');
      }
    }
  }, [user, loading, router]);

  useEffect(() => {
    // Scroll to top on route change
    window.scrollTo(0, 0);
  }, [pathname]);

  const handleLogout = async () => {
    await signOut(auth);
    router.push('/login');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-slate-200 border-t-blue-600"></div>
          <p className="text-slate-500 text-sm font-medium animate-pulse">Cargando SeaBob Center...</p>
        </div>
      </div>
    );
  }

  if (!user || (user.rol !== 'broker' && user.rol !== 'agency')) return null;

  const navItems = [
    { name: 'Dashboard', href: '/broker/dashboard', icon: Briefcase },
    { name: 'Mis Reservas', href: '/broker/reservas', icon: CalendarDays },
    { name: 'Mis Comisiones', href: '/broker/comisiones', icon: Wallet, badge: pendingCommission > 0 ? `€${pendingCommission.toFixed(0)}` : undefined },
  ];

  return (
    <>
      <ForcePasswordChange />
      
      {/* Mobile Overlay */}
      <div 
        className={clsx(
          "fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden transition-opacity duration-300",
          sidebarOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        onClick={() => setSidebarOpen(false)}
      />

      {/* Sidebar */}
      <aside 
        className={clsx(
          "fixed top-0 left-0 z-50 h-screen w-72 text-slate-100 transition-transform duration-300 lg:translate-x-0 shadow-xl flex flex-col bg-linear-to-b from-slate-950 via-blue-950 to-blue-900 border-r border-white/10 overflow-hidden",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
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
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden btn-icon text-white/60 hover:text-white hover:bg-white/10 absolute right-4 top-4"
          >
            <X size={24} />
          </button>
        </div>

        {/* Nav Items */}
        <nav className="flex-1 px-4 py-6 space-y-2 overflow-y-auto scrollbar-thin scrollbar-thumb-white/20">
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => {
                  if (window.innerWidth < 1024) setSidebarOpen(false);
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
                <span className="flex-1">{item.name}</span>
                {item.badge && (
                  <span className={clsx(
                    "px-2 py-0.5 text-xs font-bold rounded-full",
                    isActive 
                      ? "bg-white/20 text-white" 
                      : "bg-emerald-400 text-emerald-950"
                  )}>
                    {item.badge}
                  </span>
                )}
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
              <p className="text-xs text-blue-100/60 capitalize truncate">
                {user?.rol === 'broker' ? 'Broker' : 'Agencia'}
              </p>
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
      
      <div className="min-h-screen bg-white lg:pl-72">
        {/* Mobile Header */}
        <header className="lg:hidden bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setSidebarOpen(true)}
              className="btn-icon -ml-2 text-slate-600 hover:bg-slate-100"
            >
              <Menu size={24} />
            </button>
            <span className="font-bold text-lg text-slate-800">SeaBob Center</span>
          </div>
        </header>

        {/* Main Content Area */}
        <main className="p-4 lg:p-8">
          <div className="max-w-7xl mx-auto">
            {children}
          </div>
        </main>
      </div>
    </>
  );
}
