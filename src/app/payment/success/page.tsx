import Link from 'next/link';
import { CheckCircle2, CircleX, Home } from 'lucide-react';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const getQueryValue = (value?: string | string[]) => {
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
};

export default async function PaymentSuccessPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const status = getQueryValue(params.status);
  const subject = getQueryValue(params.subject) || 'Pago remoto';
  const amountParam = getQueryValue(params.amount) || '0';
  const parsed = Number(amountParam.replace(',', '.'));
  const amount = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;

  const isSuccess = status === 'success';

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-10 flex items-center justify-center">
      <div className="w-full max-w-2xl bg-white border border-slate-200 shadow-sm rounded-2xl p-8">
        <div className="flex items-center gap-3 mb-4">
          {isSuccess ? (
            <CheckCircle2 className="text-emerald-600" size={30} />
          ) : (
            <CircleX className="text-amber-600" size={30} />
          )}
          <h1 className="text-2xl font-bold text-slate-900">
            {isSuccess ? 'Pago completado' : 'Pago cancelado'}
          </h1>
        </div>

        <p className="text-slate-600 mb-6">
          {isSuccess
            ? 'Gracias. Hemos recibido tu pago correctamente.'
            : 'No se ha procesado el pago. Puedes cerrar esta página o intentarlo de nuevo con tu enlace.'}
        </p>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
          <p className="text-sm text-slate-500 uppercase tracking-wide">Concepto</p>
          <p className="text-slate-900 font-medium break-words">{subject}</p>
          <p className="text-sm text-slate-500 uppercase tracking-wide mt-3">Importe</p>
          <p className="text-2xl font-bold text-slate-900">
            {amount.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })}
          </p>
        </div>

        <div className="mt-6 flex flex-col sm:flex-row gap-3">
          <Link href="/" className="btn-outline inline-flex items-center justify-center">
            <Home size={16} />
            Volver al inicio
          </Link>
          <p className="text-xs text-slate-500 self-center">
            Si tienes dudas sobre tu pago, contacta con el equipo de reservas.
          </p>
        </div>
      </div>
    </main>
  );
}
