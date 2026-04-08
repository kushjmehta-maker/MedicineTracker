import { Pool, PoolClient } from 'pg';

// ─────────────────────────────────────────────────────────────────────────────
// Database client — singleton pg.Pool
//
// Exposes:
//  • getPool()          — raw pool for simple queries
//  • withTransaction()  — acquire a client, run fn inside BEGIN/COMMIT/ROLLBACK
// ─────────────────────────────────────────────────────────────────────────────

let _pool: Pool | null = null;

export function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 2_000,
    });
    _pool.on('error', (err) => {
      // Log but do not crash — the pool will recover individual clients
      console.error('[DB] Unexpected idle client error:', err.message);
    });
  }
  return _pool;
}

/**
 * Run `fn` inside a transaction.  Automatically commits on success and
 * rolls back on any thrown error.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Gracefully shut down the pool (call on process exit).
 */
export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}

/**
 * Inject a test pool (used in unit tests to avoid real DB connections).
 */
export function _setPoolForTesting(pool: Pool): void {
  _pool = pool;
}
