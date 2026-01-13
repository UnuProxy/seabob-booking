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
          // Validate user ID before querying
          if (!firebaseUser.uid || firebaseUser.uid.length === 0) {
            console.error('Invalid user ID');
            setUser(null);
            setLoading(false);
            return;
          }

          // Fetch additional user data from Firestore
          const userDocRef = doc(db, 'users', firebaseUser.uid);
          
          // Add timeout to prevent hanging
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Firestore query timeout')), 10000)
          );
          
          const userDoc = await Promise.race([
            getDoc(userDocRef),
            timeoutPromise
          ]) as any;

          if (userDoc.exists()) {
            setUser({ id: firebaseUser.uid, ...userDoc.data() } as User);
            
            // Update last login asynchronously (don't wait)
            setDoc(
              userDocRef,
              { last_login_at: serverTimestamp(), last_seen_at: serverTimestamp() },
              { merge: true }
            ).catch(err => console.warn('Failed to update last login:', err));
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
      } catch (error: any) {
        console.error('Error fetching user profile:', error);
        
        // If it's a network error, still allow the user to be set from Firebase Auth
        if (error?.code === 'unavailable' && firebaseUser) {
          console.warn('Firestore unavailable, using Firebase Auth data only');
          setUser({
            id: firebaseUser.uid,
            email: firebaseUser.email!,
            nombre: firebaseUser.displayName || 'User',
            rol: 'admin',
            tipo_entidad: 'individual',
            whatsapp_conectado: false,
            activo: true,
            creado_en: new Date().toISOString(),
            permisos: ['all'],
          } as User);
        } else {
          setUser(null);
        }
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, [setUser, setLoading]);

  return <>{children}</>;
}
