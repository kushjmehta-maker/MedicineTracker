#!/usr/bin/env bash
# =============================================================================
# migrate.sh — Idempotent migration runner
#
# Usage:
#   DATABASE_URL=postgresql://... ./database/migrate.sh
#   ./database/migrate.sh --validate          # run validate.sql after migrations
#   ./database/migrate.sh --dry-run           # print SQL without executing
#   ./database/migrate.sh --rollback 008      # run rollback_008.sql
#
# Tracking table: schema_migrations
#   Stores filename + sha256 of each applied migration.
#   Re-running a migration whose content has changed raises an error
#   (prevents silent drift).
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS_DIR="$SCRIPT_DIR/migrations"
ROLLBACKS_DIR="$SCRIPT_DIR/rollbacks"
VALIDATE_SQL="$SCRIPT_DIR/validate.sql"

: "${DATABASE_URL:?DATABASE_URL must be set}"

DRY_RUN=false
VALIDATE=false
ROLLBACK_FILE=""

# ─── Argument parsing ─────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)   DRY_RUN=true;          shift ;;
    --validate)  VALIDATE=true;         shift ;;
    --rollback)  ROLLBACK_FILE="$2";    shift 2 ;;
    *)           echo "Unknown flag: $1"; exit 1 ;;
  esac
done

# ─── psql wrapper ─────────────────────────────────────────────────────────────
run_sql() {
  local file="$1"
  if [[ "$DRY_RUN" == "true" ]]; then
    echo "[DRY RUN] Would execute: $file"
    cat "$file"
    return
  fi
  psql "$DATABASE_URL" --single-transaction --set ON_ERROR_STOP=1 -f "$file"
}

run_query() {
  local sql="$1"
  psql "$DATABASE_URL" --tuples-only --no-align -c "$sql"
}

# ─── Rollback mode ────────────────────────────────────────────────────────────
if [[ -n "$ROLLBACK_FILE" ]]; then
  TARGET="$ROLLBACKS_DIR/rollback_${ROLLBACK_FILE}.sql"
  if [[ ! -f "$TARGET" ]]; then
    echo "ERROR: Rollback file not found: $TARGET" >&2
    exit 1
  fi
  echo "⚠  Running rollback: $TARGET"
  run_sql "$TARGET"
  echo "✓ Rollback complete"
  exit 0
fi

# ─── Ensure tracking table exists ────────────────────────────────────────────
if [[ "$DRY_RUN" != "true" ]]; then
  psql "$DATABASE_URL" -c "
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id          SERIAL       PRIMARY KEY,
      filename    TEXT         UNIQUE NOT NULL,
      sha256      TEXT         NOT NULL,
      applied_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    );
  " > /dev/null
fi

# ─── Iterate migrations in order ─────────────────────────────────────────────
APPLIED=0
SKIPPED=0
ERRORS=0

for file in $(ls "$MIGRATIONS_DIR"/*.sql | sort); do
  filename=$(basename "$file")
  sha256=$(sha256sum "$file" | awk '{print $1}')

  if [[ "$DRY_RUN" != "true" ]]; then
    # Check if already applied
    existing=$(run_query "SELECT sha256 FROM schema_migrations WHERE filename = '$filename'" 2>/dev/null || true)

    if [[ -n "$existing" ]]; then
      if [[ "$existing" != "$sha256" ]]; then
        echo "ERROR: Migration $filename has been modified after application."
        echo "  Applied SHA256:  $existing"
        echo "  Current SHA256:  $sha256"
        echo "  This indicates schema drift. Create a new migration instead."
        ERRORS=$((ERRORS + 1))
        continue
      fi
      echo "  skip  $filename"
      SKIPPED=$((SKIPPED + 1))
      continue
    fi
  fi

  echo "  apply $filename"

  if ! run_sql "$file"; then
    echo "ERROR: Migration $filename failed" >&2
    ERRORS=$((ERRORS + 1))
    exit 1
  fi

  if [[ "$DRY_RUN" != "true" ]]; then
    psql "$DATABASE_URL" -c "
      INSERT INTO schema_migrations (filename, sha256)
      VALUES ('$filename', '$sha256');
    " > /dev/null
  fi

  APPLIED=$((APPLIED + 1))
done

echo ""
echo "Migrations complete: $APPLIED applied, $SKIPPED skipped, $ERRORS errors"

if [[ $ERRORS -gt 0 ]]; then
  exit 1
fi

# ─── Optional validation ──────────────────────────────────────────────────────
if [[ "$VALIDATE" == "true" ]]; then
  echo ""
  echo "Running schema validation..."
  run_sql "$VALIDATE_SQL"
fi
