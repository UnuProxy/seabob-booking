import { initializeApp, getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, Firestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const normalizeBucketName = (bucket?: string): string | undefined => {
  if (!bucket) return undefined;
  return bucket
    .trim()
    .replace(/^gs:\/\//, '')
    .replace(/^https?:\/\/storage\.googleapis\.com\//, '')
    .replace(/^https?:\/\/firebasestorage\.googleapis\.com\/v0\/b\//, '')
    .replace(/\/.*$/, '');
};

const projectId = firebaseConfig.projectId?.trim();
const configuredBucket = normalizeBucketName(firebaseConfig.storageBucket);
const appspotBucket = projectId ? `${projectId}.appspot.com` : undefined;
const firebaseStorageAppBucket = projectId ? `${projectId}.firebasestorage.app` : undefined;

const pushUnique = (list: string[], value?: string) => {
  if (!value || list.includes(value)) return;
  list.push(value);
};

const storageBucketCandidates: string[] = [];

// Always prefer the explicitly configured bucket first.
pushUnique(storageBucketCandidates, configuredBucket);

if (configuredBucket?.endsWith('.firebasestorage.app')) {
  // Keep legacy fallback for projects still backed by appspot.
  pushUnique(storageBucketCandidates, appspotBucket);
}

pushUnique(storageBucketCandidates, appspotBucket);
pushUnique(storageBucketCandidates, firebaseStorageAppBucket);

// Initialize Firebase
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const auth = getAuth(app);

// Initialize Firestore (persistence is now enabled by default in v9+)
const db: Firestore = getFirestore(app);

const storage = storageBucketCandidates.length > 0 ? getStorage(app, `gs://${storageBucketCandidates[0]}`) : getStorage(app);

export { app, auth, db, storage, storageBucketCandidates };
