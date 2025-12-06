'use client';

export default function UsersPage() {
  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-800">Gestión de Usuarios</h1>
        <button className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700">
          + Nuevo Usuario
        </button>
      </div>
      
      <div className="bg-white rounded-lg shadow overflow-hidden border border-gray-200">
        <div className="p-8 text-center text-gray-500">
          <p>La lista de usuarios aparecerá aquí.</p>
          <p className="text-sm mt-2">Conectando con Firebase...</p>
        </div>
      </div>
    </div>
  );
}

