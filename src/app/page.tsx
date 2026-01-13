import Image from 'next/image';
import { LoginForm } from '@/components/auth/LoginForm';

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-blue-900 to-blue-700 text-white">
      <div className="relative overflow-hidden">
        <div className="absolute -top-24 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-cyan-400/20 blur-3xl" aria-hidden="true" />
        <div className="absolute bottom-0 right-0 h-72 w-72 rounded-full bg-indigo-500/20 blur-3xl" aria-hidden="true" />
        <div
          className="absolute inset-0"
          style={{ background: 'radial-gradient(circle at top, rgba(255, 255, 255, 0.12), transparent 55%)' }}
          aria-hidden="true"
        />

        <div className="relative z-10 min-h-screen flex flex-col">
          <div className="flex-1">
            <div className="mx-auto grid items-center gap-10 px-6 py-10 md:px-10 md:py-16 max-w-6xl md:grid-cols-[1.1fr_0.9fr]">
              <div className="flex flex-col items-center md:items-start text-center md:text-left gap-5 md:gap-6">
                <p className="text-[11px] uppercase tracking-[0.5em] text-blue-200/80">SeaBob Center</p>
                <div className="relative flex items-center justify-center md:justify-start">
                  <div className="absolute h-48 w-48 md:h-64 md:w-64 rounded-full bg-white/15 blur-3xl" aria-hidden="true" />
                  <Image
                    src="/seabob-logo-CENTER_IBIZA-ROJO.png"
                    alt="SeaBob Center logo"
                    width={520}
                    height={200}
                    className="relative z-10 w-56 sm:w-64 md:w-80 h-auto drop-shadow-[0_14px_32px_rgba(0,0,0,0.55)] brightness-150 contrast-125 saturate-125"
                    priority
                  />
                </div>

                <div className="space-y-2 md:space-y-3 max-w-xl">
                  <h1 className="text-2xl sm:text-3xl md:text-4xl font-semibold tracking-tight leading-[1.15]">
                    Bienvenido a SeaBob Center
                  </h1>
                  <p className="text-sm sm:text-base md:text-lg text-blue-100/90 leading-snug">
                    Gestiona reservas, equipos y operaciones del día con claridad y precisión.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2 justify-center md:justify-start">
                  {['Reservas', 'Equipos', 'Operaciones'].map((label) => (
                    <span
                      key={label}
                      className="px-3 py-1.5 text-[11px] font-semibold tracking-wide rounded-full border border-white/30 bg-white/10 text-white"
                    >
                      {label}
                    </span>
                  ))}
                </div>
              </div>

              <div className="w-full max-w-md mx-auto">
                <div className="bg-white/92 backdrop-blur-xl border border-white/50 rounded-3xl shadow-[0_32px_80px_rgba(15,23,42,0.35)] p-8 md:p-10">
                  <LoginForm />
                  <p className="mt-6 text-sm text-slate-600 text-center">
                    Bienvenido de nuevo; estamos listos para ayudarte a reservar, coordinar y crecer
                    juntos.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <footer className="text-xs text-blue-200/80 text-center pb-6">
            &copy; {new Date().getFullYear()} SeaBob Center. Todos los derechos reservados.
          </footer>
        </div>
      </div>
    </div>
  );
}
