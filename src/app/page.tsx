import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-blue-900 to-slate-900 text-white">
      <div className="text-center space-y-6 p-8">
        <h1 className="text-5xl font-bold tracking-tight">SeaBob Center</h1>
        <p className="text-xl text-blue-200 max-w-2xl mx-auto">
          Plataforma de gestión de alquileres y reservas.
        </p>
        
        <div className="pt-8">
          <Link 
            href="/login"
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-full font-semibold transition-all transform hover:scale-105"
          >
            Acceder al Portal
            <ArrowRight size={20} />
          </Link>
        </div>
      </div>
      
      <footer className="absolute bottom-8 text-slate-500 text-sm">
        &copy; {new Date().getFullYear()} SeaBob Center. Todos los derechos reservados.
      </footer>
    </div>
  );
}
