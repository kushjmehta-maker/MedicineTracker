import * as admin from 'firebase-admin';
import { logger } from '../../observability/logger';

// =============================================================================
// FirebaseAdminService
//
// Singleton Firebase Admin SDK initializer.
// Verifies ID tokens issued by Firebase Auth (phone OTP flow).
//
// Environment variables required:
//   FIREBASE_PROJECT_ID      — from Firebase console → Project settings
//   FIREBASE_CLIENT_EMAIL    — from service account JSON
//   FIREBASE_PRIVATE_KEY     — from service account JSON (newlines as \n)
//
// In Railway/Render: paste the private key with literal \n characters;
// the replace() below converts them back to real newlines.
// =============================================================================

let _app: admin.app.App | null = null;

export function getFirebaseAdmin(): admin.app.App {
  if (_app) return _app;

  const projectId   = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey  = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      'Firebase Admin SDK not configured. Set FIREBASE_PROJECT_ID, ' +
      'FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY environment variables.',
    );
  }

  _app = admin.initializeApp({
    credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
  });

  logger.info({ projectId }, 'Firebase Admin SDK initialized');
  return _app;
}

export interface VerifiedToken {
  uid: string;          // Firebase UID
  phone: string;        // E.164 formatted phone number
  email?: string;
}

/**
 * Verify a Firebase ID token from the Authorization: Bearer <token> header.
 * Throws if the token is invalid, expired, or revoked.
 */
export async function verifyIdToken(idToken: string): Promise<VerifiedToken> {
  const app = getFirebaseAdmin();
  const decoded = await app.auth().verifyIdToken(idToken, true); // checkRevoked=true

  const phone = decoded.phone_number;
  if (!phone) {
    throw new Error('Token does not contain a phone number (phone auth required)');
  }

  return {
    uid: decoded.uid,
    phone,
    email: decoded.email,
  };
}
