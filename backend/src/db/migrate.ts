/**
 * migrate.ts — standalone migration runner
 * Usage: npx ts-node src/db/migrate.ts
 *
 * In production, use database/migrate.sh (the canonical runner) which also
 * validates SHA-256 checksums to catch post-application drift.
 *
 * This file is kept for local development convenience and CI pipelines that
 * prefer a Node.js entrypoint.  It reads migrations from the canonical
 * database/migrations/ directory (one level above the backend root) rather
 * than the Phase-2 bootstrap migrations in src/db/migrations/, which are
 * superseded by the production schema.
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { getPool, closePool } from './client';

// Canonical schema lives at <repo-root>/database/migrations/
const MIGRATIONS_DIR = path.resolve(__dirname, '../../../database/migrations');

async function run(): Promise<void> {
  const pool = getPool();

  // Ensure the migrations tracking table exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id          SERIAL       PRIMARY KEY,
      filename    TEXT         UNIQUE NOT NULL,
      executed_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort(); // lexicographic order ensures numeric prefix ordering

  for (const file of files) {
    const { rows } = await pool.query<{ id: number }>(
      'SELECT id FROM _migrations WHERE filename = $1',
      [file],
    );

    if (rows.length > 0) {
      console.log(`  skip  ${file} (already applied)`);
      continue;
    }

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO _migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`  apply ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`  FAIL  ${file}:`, err);
      throw err;
    } finally {
      client.release();
    }
  }

  console.log('Migrations complete.');
}

run()
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  })
  .finally(closePool);
