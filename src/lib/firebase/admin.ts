import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';

let cachedDb: Firestore | null = null;

function initAdminApp() {
  const projectIdEnv =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCP_PROJECT;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  const serviceAccountJson =
    process.env.FIREBASE_SERVICE_ACCOUNT ||
    (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64
      ? Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8')
      : undefined);

  if (getApps().length) {
    return getApps()[0];
  }

  if (serviceAccountJson) {
    const serviceAccount = JSON.parse(serviceAccountJson) as {
      project_id?: string;
      client_email?: string;
      private_key?: string;
    };
    const projectId = projectIdEnv || serviceAccount.project_id;
    if (!projectId || !serviceAccount.client_email || !serviceAccount.private_key) {
      throw new Error(
        'Invalid FIREBASE_SERVICE_ACCOUNT. Ensure project_id, client_email, and private_key are present.'
      );
    }
    return initializeApp({
      credential: cert({
        projectId,
        clientEmail: serviceAccount.client_email,
        privateKey: serviceAccount.private_key.replace(/\\n/g, '\n'),
      }),
    });
  }

  if (projectIdEnv && clientEmail && privateKey) {
    return initializeApp({
      credential: cert({ projectId: projectIdEnv, clientEmail, privateKey }),
    });
  }

  throw new Error(
    'Missing Firebase Admin env vars. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY or FIREBASE_SERVICE_ACCOUNT.'
  );
}

export function getAdminDb() {
  if (!cachedDb) {
    cachedDb = getFirestore(initAdminApp());
  }
  return cachedDb;
}
