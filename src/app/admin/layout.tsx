'use client';

import { Sidebar } from '@/components/layout/Sidebar';
import ForcePasswordChange from '@/components/auth/ForcePasswordChange';
import { useAuthStore } from '@/store/authStore';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Menu } from 'lucide-react';
import { usePathname } from 'next/navigation';

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading } = useAuthStore();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    if (!loading) {
      if (!user) {
        router.push('/login');
      } else if (user.rol === 'broker' || user.rol === 'agency') {
        // Redirect brokers/agencies to their own dashboard
        router.push('/broker/dashboard');
      }
    }
  }, [user, loading, router]);

  useEffect(() => {
    // Scroll to top on route change
    window.scrollTo(0, 0);
  }, [pathname]);

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

  if (!user || user.rol === 'broker' || user.rol === 'agency') return null;

  return (
    <>
      <ForcePasswordChange />
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      
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
          <div className="max-w-7xl mx-auto w-full">
            {children}
          </div>
        </main>
      </div>
    </>
  );
}
