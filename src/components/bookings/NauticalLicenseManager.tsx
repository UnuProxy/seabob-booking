'use client';

import { useMemo, useState } from 'react';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { db, storage } from '@/lib/firebase/config';
import type { Booking } from '@/types';

interface NauticalLicenseManagerProps {
  booking: Booking;
}

const makeSafeFileName = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_');

export function NauticalLicenseManager({ booking }: NauticalLicenseManagerProps) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const isRequired = Boolean(booking.nautical_license_required);
  const hasLicense = Boolean(booking.nautical_license_url);
  const acceptedTypes = useMemo(() => 'application/pdf,image/*', []);

  const handleUpload = async () => {
    if (!booking.id || !file) return;

    setUploading(true);
    setError('');

    try {
      const isPdf = file.type === 'application/pdf';
      const isImage = file.type.startsWith('image/');

      if (!isPdf && !isImage) {
        throw new Error('Solo se permiten PDF o imágenes.');
      }

      const safeName = makeSafeFileName(file.name);
      const path = `bookings/${booking.id}/nautical-license/${Date.now()}-${safeName}`;
      const fileRef = storageRef(storage, path);

      await uploadBytes(fileRef, file, {
        contentType: file.type || 'application/octet-stream',
      });

      const url = await getDownloadURL(fileRef);

      await updateDoc(doc(db, 'bookings', booking.id), {
        nautical_license_url: url,
        nautical_license_path: path,
        nautical_license_name: file.name,
        nautical_license_type: file.type || 'application/octet-stream',
        nautical_license_uploaded_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      });

      setFile(null);
    } catch (err: unknown) {
      const message =
        typeof err === 'object' && err && 'message' in err ? String((err as { message?: unknown }).message || '') : '';
      setError(message || 'No se pudo subir la licencia náutica.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <section>
      <h3 className="text-lg font-bold text-gray-900 mb-3">Licencia náutica</h3>
      <div className="bg-gray-50 rounded-xl p-4 space-y-3">
        <div className="text-sm text-gray-700">
          {isRequired
            ? 'Obligatoria porque la reserva incluye al menos un producto sin monitor.'
            : 'No obligatoria para esta reserva.'}
        </div>

        {hasLicense ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
            Licencia subida: {booking.nautical_license_name || 'archivo adjunto'}.
            {' '}
            <a
              href={booking.nautical_license_url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold underline"
            >
              Ver archivo
            </a>
          </div>
        ) : isRequired ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
            Pendiente de subir.
          </div>
        ) : null}

        <div className="space-y-3">
          <input
            type="file"
            accept={acceptedTypes}
            onChange={(event) => setFile(event.target.files?.[0] || null)}
            className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-slate-800"
          />
          <div className="text-xs text-gray-500">
            Admite PDF, JPG, PNG o WebP. Puedes subirlo ahora o más tarde.
          </div>
          <button
            type="button"
            onClick={handleUpload}
            disabled={!file || uploading}
            className="btn-primary disabled:opacity-50"
          >
            {uploading ? 'Subiendo...' : hasLicense ? 'Reemplazar licencia' : 'Subir licencia'}
          </button>
          {error ? <div className="text-sm text-rose-700">{error}</div> : null}
        </div>
      </div>
    </section>
  );
}
