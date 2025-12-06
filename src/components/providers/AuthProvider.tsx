'use client';

import { useEffect } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
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
          } else {
            // AUTO-CREATE ADMIN PROFILE FOR FIRST USER
            const newUser = {
              email: firebaseUser.email!,
              nombre: firebaseUser.displayName || 'Admin',
              rol: 'admin',
              tipo_entidad: 'individual',
              whatsapp_conectado: false,
              activo: true,
              creado_en: new Date().toISOString(),
              permisos: ['all']
            };
            
            await setDoc(userDocRef, newUser);
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

