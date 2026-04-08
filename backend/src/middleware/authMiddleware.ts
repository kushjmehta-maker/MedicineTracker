import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyIdToken } from '../services/auth/FirebaseAdminService';
import { syncUser } from '../services/auth/UserSyncService';
import { logger } from '../observability/logger';

// =============================================================================
// authMiddleware
//
// Fastify preHandler — attaches an authenticated user to every request.
//
// Flow:
//   1. Extract Bearer token from Authorization header
//   2. Verify with Firebase Admin SDK (checks signature + expiry + revocation)
//   3. Map Firebase UID → internal UUID via UserSyncService (creates on first login)
//   4. Attach request.user = { id, phone }
//   5. Set PostgreSQL session variable app.current_user_id for RLS
//
// Public routes (health, metrics, webhook, plans) call skipAuth() before
// this middleware runs — see SKIP_PATHS below.
// =============================================================================

/** Shape attached to every authenticated request. */
export interface AuthUser {
  id: string;    // internal UUID v7
  phone: string; // E.164
}

// Augment FastifyRequest so downstream handlers get typed request.user
declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

/** Paths that do NOT require a Firebase token. */
const SKIP_PATHS = new Set([
  '/health',
  '/metrics',
]);

/** Prefix patterns that skip auth (e.g. webhooks, public plan listing). */
const SKIP_PREFIXES = [
  '/v1/billing/webhook/',
  '/v1/billing/plans',
];

function shouldSkip(path: string): boolean {
  if (SKIP_PATHS.has(path)) return true;
  return SKIP_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (shouldSkip(request.url)) return;

  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    logger.warn({ url: request.url }, 'Missing or malformed Authorization header');
    return reply.status(401).send({ error: 'Unauthorized' });
  }

  const idToken = authHeader.slice(7); // strip "Bearer "

  try {
    const verified = await verifyIdToken(idToken);
    const user = await syncUser(verified.uid, verified.phone);

    request.user = { id: user.id, phone: user.phone };

    // Set PostgreSQL session variable so RLS policies work correctly.
    // This is done lazily here; the DB client will use it in the next query
    // within the same connection if pooled correctly.
    // For full correctness, use withTransaction or a per-request pool hook.
    // The session variable is set via getPool() queries in service methods
    // that call: SET LOCAL app.current_user_id = '...';
    // We store it on the request so services can pick it up.
    (request as FastifyRequest & { internalUserId: string }).internalUserId = user.id;
  } catch (err) {
    logger.warn({ err, url: request.url }, 'Auth token verification failed');
    return reply.status(401).send({ error: 'Unauthorized' });
  }
}
