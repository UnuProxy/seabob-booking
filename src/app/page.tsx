import Image from 'next/image';
import { LoginForm } from '@/components/auth/LoginForm';

export default function Home() {
  return (
    <div className="min-h-svh bg-linear-to-b from-slate-950 via-slate-900 to-sky-800 text-white">
      <div className="relative overflow-hidden">
        <div
          className="absolute -top-28 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-cyan-300/20 blur-3xl motion-safe:animate-[glow-float_12s_ease-in-out_infinite] hidden md:block"
          aria-hidden="true"
        />
        <div
          className="absolute -bottom-24 right-6 h-80 w-80 rounded-full bg-amber-200/15 blur-3xl motion-safe:animate-[glow-float_14s_ease-in-out_infinite] hidden md:block"
          style={{ animationDelay: '1.5s' }}
          aria-hidden="true"
        />
        <div
          className="absolute inset-0 opacity-80 hidden md:block"
          style={{
            background:
              'radial-gradient(circle at 15% 20%, rgba(255, 255, 255, 0.18), transparent 45%), radial-gradient(circle at 80% 10%, rgba(56, 189, 248, 0.16), transparent 50%)',
          }}
          aria-hidden="true"
        />

        <div className="relative z-10 min-h-svh flex flex-col justify-center md:justify-start">
          <div className="flex-1">
            <div className="mx-auto grid min-h-svh md:min-h-0 content-center place-items-center gap-4 px-5 py-0 md:px-10 md:py-20 max-w-6xl md:grid-cols-[1.1fr_0.9fr] md:gap-x-12 md:gap-y-8 md:place-items-stretch md:content-start">
              <div className="order-1 md:order-0 md:col-start-1 flex flex-col items-center md:items-start text-center md:text-left gap-5 md:gap-7 motion-safe:animate-[hero-fade_0.9s_ease-out]">
                <div className="relative flex items-center justify-center md:justify-start">
                  <div className="absolute h-48 w-48 md:h-64 md:w-64 rounded-full bg-white/20 blur-3xl motion-safe:animate-[glow-float_10s_ease-in-out_infinite]" aria-hidden="true" />
                  <div className="absolute h-28 w-40 md:h-36 md:w-48 rounded-full bg-cyan-200/20 blur-2xl" aria-hidden="true" />
                  <Image
                    src="/seabob-logo-CENTER_IBIZA-ROJO.png"
                    alt="SeaBob Center logo"
                    width={520}
                    height={200}
                    className="relative z-10 w-44 sm:w-56 md:w-80 h-auto drop-shadow-[0_18px_38px_rgba(0,0,0,0.7)] brightness-150 contrast-125 saturate-140"
                    priority
                  />
                </div>

                <div className="space-y-3 max-w-xl">
                  <h1 className="text-2xl sm:text-4xl md:text-5xl font-semibold tracking-[-0.01em] leading-[1.08] font-display">
                    Bienvenido a SeaBob Center
                  </h1>
                  <p className="text-xs sm:text-lg md:text-xl text-blue-100/90 leading-snug">
                    Reserva SeaBobs en minutos: elige fechas, paga al 100% y firma el contrato
                    digitalmente.
                  </p>
                </div>
              </div>

              <div
                className="order-2 md:order-0 md:col-start-2 md:row-span-2 w-full max-w-md mx-auto motion-safe:animate-[hero-fade_1.1s_ease-out]"
                style={{ animationDelay: '0.15s' }}
              >
                <div className="bg-white/92 backdrop-blur-xl border border-white/50 rounded-3xl shadow-[0_32px_80px_rgba(15,23,42,0.35)] p-6 md:p-10">
                  <LoginForm />
                  <p className="mt-5 text-sm text-slate-600 text-center">
                    Si es tu primera vez, solicita acceso al administrador. Estamos listos para
                    ayudarte a reservar y coordinar todo en Ibiza.
                  </p>
                </div>
              </div>

              <div className="order-3 hidden md:block md:order-0 md:col-start-1 w-full max-w-xl mx-auto md:mx-0">
                <div className="grid gap-3 sm:gap-4 grid-cols-3">
                  {[
                    { title: 'Elige fechas y equipo', note: 'Stock en tiempo real.' },
                    { title: 'Paga 100% seguro', note: 'Confirmación inmediata.' },
                    { title: 'Firma y listo', note: 'Contrato digital.' },
                  ].map((step, index) => (
                    <div
                      key={step.title}
                      className="rounded-2xl border border-white/15 bg-white/15 px-3 py-3 text-center md:text-left"
                    >
                      <p className="text-[11px] uppercase tracking-[0.18em] text-blue-100/80">
                        Paso {index + 1}
                      </p>
                      <p className="text-xs sm:text-sm font-semibold text-white mt-1">
                        {step.title}
                      </p>
                      <p className="text-[11px] sm:text-xs text-blue-100/90 mt-1">{step.note}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <footer className="hidden md:block text-xs text-blue-200/80 text-center pb-6">
            &copy; {new Date().getFullYear()} SeaBob Center. Todos los derechos reservados.
          </footer>
        </div>
      </div>
    </div>
  );
}
