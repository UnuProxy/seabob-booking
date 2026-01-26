'use client';

import Link from 'next/link';
import { Users, Briefcase, Settings, Shield, LineChart } from 'lucide-react';

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 mb-2">Configuracion</h1>
        <p className="text-gray-500">
          Ajusta las opciones generales y accede a los modulos de gestion.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Link
          href="/admin/usuarios"
          className="group rounded-2xl border border-gray-200 bg-white p-5 shadow-sm hover:shadow-md transition"
        >
          <div className="flex items-start gap-4">
            <span className="rounded-xl bg-blue-50 p-3 text-blue-600">
              <Users size={22} />
            </span>
            <div>
              <h2 className="font-semibold text-gray-900">Usuarios y roles</h2>
              <p className="text-sm text-gray-500 mt-1">
                Gestiona accesos, permisos y perfiles del equipo.
              </p>
            </div>
          </div>
        </Link>

        <Link
          href="/admin/partners"
          className="group rounded-2xl border border-gray-200 bg-white p-5 shadow-sm hover:shadow-md transition"
        >
          <div className="flex items-start gap-4">
            <span className="rounded-xl bg-purple-50 p-3 text-purple-600">
              <Briefcase size={22} />
            </span>
            <div>
              <h2 className="font-semibold text-gray-900">Brokers y agencias</h2>
              <p className="text-sm text-gray-500 mt-1">
                Administra socios, datos comerciales y colaboraciones.
              </p>
            </div>
          </div>
        </Link>

        <Link
          href="/admin/finanzas"
          className="group rounded-2xl border border-gray-200 bg-white p-5 shadow-sm hover:shadow-md transition"
        >
          <div className="flex items-start gap-4">
            <span className="rounded-xl bg-emerald-50 p-3 text-emerald-600">
              <LineChart size={22} />
            </span>
            <div>
              <h2 className="font-semibold text-gray-900">Finanzas</h2>
              <p className="text-sm text-gray-500 mt-1">
                Revisa movimientos, ingresos y balance general.
              </p>
            </div>
          </div>
        </Link>

        <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-5">
          <div className="flex items-start gap-4">
            <span className="rounded-xl bg-slate-100 p-3 text-slate-600">
              <Shield size={22} />
            </span>
            <div>
              <h2 className="font-semibold text-gray-900">Seguridad</h2>
              <p className="text-sm text-gray-500 mt-1">
                En preparacion. Aqui se agregaran politicas y ajustes avanzados.
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-5">
          <div className="flex items-start gap-4">
            <span className="rounded-xl bg-slate-100 p-3 text-slate-600">
              <Settings size={22} />
            </span>
            <div>
              <h2 className="font-semibold text-gray-900">Preferencias</h2>
              <p className="text-sm text-gray-500 mt-1">
                En preparacion. Ajustes generales del sistema.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
