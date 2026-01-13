'use client';

import { useEffect } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase/config';
import { useAuthStore } from '@/store/authStore';
import { User } from '@/types';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { setUser, setLoading } = useAuthStore();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setLoading(true);
      try {
        if (firebaseUser) {
          // Fetch additional user data from Firestore
          const userDocRef = doc(db, 'users', firebaseUser.uid);
          const userDoc = await getDoc(userDocRef);

          if (userDoc.exists()) {
            setUser({ id: firebaseUser.uid, ...userDoc.data() } as User);
            await setDoc(
              userDocRef,
              { last_login_at: serverTimestamp(), last_seen_at: serverTimestamp() },
              { merge: true }
            );
          } else {
            // AUTO-CREATE ADMIN PROFILE FOR FIRST USER
            const nowIso = new Date().toISOString();
            const newUser = {
              email: firebaseUser.email!,
              nombre: firebaseUser.displayName || 'Admin',
              rol: 'admin',
              tipo_entidad: 'individual',
              whatsapp_conectado: false,
              activo: true,
              creado_en: nowIso,
              permisos: ['all'],
              last_login_at: nowIso,
              last_seen_at: nowIso
            };
            
            await setDoc(userDocRef, {
              ...newUser,
              creado_en: serverTimestamp(),
              last_login_at: serverTimestamp(),
              last_seen_at: serverTimestamp()
            });
            setUser({ id: firebaseUser.uid, ...newUser } as unknown as User);
          }
        } else {
          setUser(null);
        }
      } catch (error) {
        console.error('Error fetching user profile:', error);
        setUser(null);
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, [setUser, setLoading]);

  return <>{children}</>;
}
