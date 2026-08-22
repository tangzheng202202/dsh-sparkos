/**
 * SparkOS factory SQLite foundation.
 *
 * The database stores mutable workflow state and topic history. Large/raw
 * artifacts remain in VAULT so the system stays inspectable and reversible.
 * @module dsh-sparkos/src/storage/database
 */

import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { envPath, VAULT_ROOT } from '../vault.ts'

export const FACTORY_SCHEMA_VERSION = 5

export function defaultFactoryDbPath(): string {
  return envPath('SPARKOS_DB_PATH', path.join(VAULT_ROOT, 'data', 'sparkos.db'))
}

export interface OpenDatabaseOptions {
  path?: string
}

const MIGRATIONS: ReadonlyArray<{ version: number; sql: string }> = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS workflow_jobs (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        idempotency_key TEXT UNIQUE,
        status TEXT NOT NULL CHECK (status IN (
          'queued', 'running', 'waiting_approval', 'succeeded', 'failed', 'cancelled'
        )),
        priority INTEGER NOT NULL DEFAULT 0,
        input_json TEXT NOT NULL DEFAULT '{}',
        output_json TEXT,
        error TEXT,
        attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts >= 1),
        run_after TEXT NOT NULL,
        worker_id TEXT,
        lease_expires_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_workflow_jobs_claim
        ON workflow_jobs(status, run_after, priority DESC, created_at);
      CREATE INDEX IF NOT EXISTS idx_workflow_jobs_lease
        ON workflow_jobs(status, lease_expires_at);

      CREATE TABLE IF NOT EXISTS workflow_job_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL REFERENCES workflow_jobs(id) ON DELETE CASCADE,
        at TEXT NOT NULL,
        from_status TEXT,
        to_status TEXT NOT NULL,
        note TEXT
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_workflow_job_events_job
        ON workflow_job_events(job_id, id);

      CREATE TABLE IF NOT EXISTS topic_clusters (
        topic_key TEXT NOT NULL,
        observed_date TEXT NOT NULL,
        cluster_id TEXT NOT NULL,
        topic TEXT NOT NULL,
        heat TEXT NOT NULL,
        novelty TEXT NOT NULL,
        credibility TEXT NOT NULL,
        source_count INTEGER NOT NULL,
        mention_count INTEGER NOT NULL,
        cluster_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(topic_key, observed_date)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_topic_clusters_date
        ON topic_clusters(observed_date, cluster_id);

      CREATE TABLE IF NOT EXISTS topic_evidence (
        id TEXT PRIMARY KEY,
        topic_key TEXT NOT NULL,
        observed_date TEXT NOT NULL,
        url TEXT NOT NULL,
        claim TEXT,
        source_type TEXT NOT NULL,
        independence_group TEXT NOT NULL,
        verified INTEGER NOT NULL CHECK (verified IN (0, 1)),
        contradicts INTEGER NOT NULL CHECK (contradicts IN (0, 1)),
        created_at TEXT NOT NULL,
        UNIQUE(topic_key, observed_date, url, claim)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_topic_evidence_lookup
        ON topic_evidence(topic_key, observed_date);

      CREATE TABLE IF NOT EXISTS topic_rank_snapshots (
        snapshot_date TEXT NOT NULL,
        topic_key TEXT NOT NULL,
        cluster_id TEXT NOT NULL,
        topic TEXT NOT NULL,
        rank INTEGER NOT NULL,
        heat_score REAL NOT NULL,
        overall_score REAL NOT NULL,
        velocity_score REAL NOT NULL,
        mention_count INTEGER NOT NULL,
        source_count INTEGER NOT NULL,
        consecutive_top_days INTEGER NOT NULL,
        verification_grade TEXT NOT NULL CHECK (verification_grade IN ('A', 'B', 'C', 'D')),
        eligible_for_creation INTEGER NOT NULL CHECK (eligible_for_creation IN (0, 1)),
        breakdown_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(snapshot_date, topic_key)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_topic_rank_history
        ON topic_rank_snapshots(topic_key, snapshot_date DESC);
      CREATE INDEX IF NOT EXISTS idx_topic_rank_daily
        ON topic_rank_snapshots(snapshot_date, rank);

      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        subject_kind TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        decision TEXT NOT NULL CHECK (decision IN ('pending', 'approved', 'rejected')),
        note TEXT,
        created_at TEXT NOT NULL,
        decided_at TEXT,
        UNIQUE(subject_kind, subject_id)
      ) STRICT;
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE IF NOT EXISTS editorial_runs (
        id TEXT PRIMARY KEY,
        mode TEXT NOT NULL CHECK (mode IN ('midweek', 'weekly')),
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        input_fingerprint TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending_approval', 'approved', 'archived')),
        generated_at TEXT NOT NULL,
        summary_json TEXT NOT NULL DEFAULT '{}',
        UNIQUE(mode, period_end, input_fingerprint)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_editorial_runs_latest
        ON editorial_runs(period_end DESC, generated_at DESC);

      CREATE TABLE IF NOT EXISTS editorial_cards (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES editorial_runs(id) ON DELETE CASCADE,
        rank INTEGER NOT NULL CHECK (rank >= 1),
        topic_key TEXT NOT NULL,
        title TEXT NOT NULL,
        trend_pattern TEXT NOT NULL CHECK (trend_pattern IN (
          'persistent', 'accelerating', 'resurfacing', 'reversal', 'structural', 'emerging'
        )),
        core_thesis TEXT NOT NULL,
        why_now TEXT NOT NULL,
        facts_json TEXT NOT NULL DEFAULT '[]',
        evidence_json TEXT NOT NULL DEFAULT '[]',
        counter_arguments_json TEXT NOT NULL DEFAULT '[]',
        knowledge_cards_json TEXT NOT NULL DEFAULT '[]',
        platforms_json TEXT NOT NULL DEFAULT '[]',
        content_format TEXT NOT NULL,
        risks_json TEXT NOT NULL DEFAULT '[]',
        verification_grade TEXT NOT NULL CHECK (verification_grade IN ('A', 'B')),
        expected_value REAL NOT NULL,
        decision TEXT NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending', 'approved', 'rejected')),
        created_at TEXT NOT NULL,
        decided_at TEXT,
        UNIQUE(run_id, topic_key)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_editorial_cards_run
        ON editorial_cards(run_id, rank);
      CREATE INDEX IF NOT EXISTS idx_editorial_cards_decision
        ON editorial_cards(decision, created_at DESC);
    `,
  },
  {
    version: 3,
    sql: `
      CREATE TABLE IF NOT EXISTS draft_packages (
        id TEXT PRIMARY KEY,
        card_id TEXT NOT NULL REFERENCES editorial_cards(id),
        revision INTEGER NOT NULL CHECK (revision >= 1),
        parent_package_id TEXT REFERENCES draft_packages(id),
        job_id TEXT NOT NULL REFERENCES workflow_jobs(id),
        contract_version INTEGER NOT NULL,
        input_fingerprint TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN (
          'awaiting_generation', 'validation_failed', 'waiting_approval', 'approved', 'rejected'
        )),
        request_json TEXT NOT NULL,
        submission_json TEXT,
        validation_json TEXT NOT NULL DEFAULT '{"ok":false,"errors":[]}',
        artifact_dir TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        decided_at TEXT,
        UNIQUE(card_id, input_fingerprint),
        UNIQUE(card_id, revision)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_draft_packages_status
        ON draft_packages(status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_draft_packages_card
        ON draft_packages(card_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS draft_artifacts (
        id TEXT PRIMARY KEY,
        package_id TEXT NOT NULL REFERENCES draft_packages(id) ON DELETE CASCADE,
        platform TEXT NOT NULL,
        format TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        bytes INTEGER NOT NULL CHECK (bytes >= 0),
        created_at TEXT NOT NULL,
        UNIQUE(package_id, relative_path)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_draft_artifacts_package
        ON draft_artifacts(package_id, platform);
    `,
  },
  {
    version: 4,
    sql: `
      CREATE TABLE IF NOT EXISTS visual_batches (
        id TEXT PRIMARY KEY,
        package_id TEXT NOT NULL UNIQUE REFERENCES draft_packages(id),
        revision INTEGER NOT NULL CHECK (revision >= 1),
        source_assets_sha256 TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN (
          'queued', 'generating', 'waiting_visual_approval', 'approved', 'rejected', 'failed'
        )),
        required_count INTEGER NOT NULL CHECK (required_count >= 1),
        approved_count INTEGER NOT NULL DEFAULT 0 CHECK (approved_count >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_visual_batches_status
        ON visual_batches(status, created_at);

      CREATE TABLE IF NOT EXISTS visual_asset_tasks (
        id TEXT PRIMARY KEY,
        batch_id TEXT NOT NULL REFERENCES visual_batches(id) ON DELETE CASCADE,
        package_id TEXT NOT NULL REFERENCES draft_packages(id),
        asset_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('cover', 'inline', 'carousel')),
        placement TEXT NOT NULL,
        prompt TEXT NOT NULL,
        alt_text TEXT NOT NULL,
        aspect_ratio TEXT NOT NULL CHECK (aspect_ratio IN ('2.35:1', '16:9', '3:4', '1:1')),
        target_width INTEGER NOT NULL CHECK (target_width > 0),
        target_height INTEGER NOT NULL CHECK (target_height > 0),
        state TEXT NOT NULL CHECK (state IN (
          'queued', 'generating', 'generated', 'waiting_visual_approval', 'retry', 'failed'
        )),
        idempotency_key TEXT NOT NULL UNIQUE,
        current_attempt INTEGER NOT NULL DEFAULT 0 CHECK (current_attempt >= 0),
        max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts >= 1),
        lease_token_hash TEXT,
        lease_expires_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(package_id, asset_id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_visual_asset_tasks_claim
        ON visual_asset_tasks(state, lease_expires_at, created_at);
      CREATE INDEX IF NOT EXISTS idx_visual_asset_tasks_batch
        ON visual_asset_tasks(batch_id, asset_id);

      CREATE TABLE IF NOT EXISTS visual_asset_attempts (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES visual_asset_tasks(id) ON DELETE CASCADE,
        job_id TEXT NOT NULL REFERENCES workflow_jobs(id),
        attempt_no INTEGER NOT NULL CHECK (attempt_no >= 1),
        source_attachment_id TEXT,
        source_media_type TEXT,
        source_bytes INTEGER CHECK (source_bytes IS NULL OR source_bytes >= 0),
        source_width INTEGER CHECK (source_width IS NULL OR source_width > 0),
        source_height INTEGER CHECK (source_height IS NULL OR source_height > 0),
        provider TEXT,
        model TEXT,
        source_tool TEXT,
        source_call_id TEXT,
        prompt_original TEXT NOT NULL,
        prompt_effective TEXT,
        negative_prompt TEXT,
        seed_requested INTEGER,
        seed_effective INTEGER CHECK (seed_effective IS NULL OR seed_effective IN (0, 1)),
        revised_prompt TEXT,
        content_filter TEXT,
        imported_relative_path TEXT,
        imported_sha256 TEXT,
        validation_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL CHECK (status IN (
          'generating', 'generated', 'waiting_visual_approval', 'retry', 'failed'
        )),
        generated_at TEXT,
        imported_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(task_id, attempt_no)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_visual_asset_attempts_task
        ON visual_asset_attempts(task_id, attempt_no DESC);
      CREATE INDEX IF NOT EXISTS idx_visual_asset_attempts_attachment
        ON visual_asset_attempts(source_attachment_id);

      CREATE TABLE IF NOT EXISTS visual_asset_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL REFERENCES visual_asset_tasks(id) ON DELETE CASCADE,
        attempt_id TEXT REFERENCES visual_asset_attempts(id) ON DELETE SET NULL,
        from_state TEXT,
        to_state TEXT NOT NULL,
        reason TEXT,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_visual_asset_events_task
        ON visual_asset_events(task_id, id);
    `,
  },
  {
    version: 5,
    sql: `
      CREATE TABLE IF NOT EXISTS visual_delivery_artifacts (
        id TEXT PRIMARY KEY,
        package_id TEXT NOT NULL REFERENCES draft_packages(id),
        batch_id TEXT NOT NULL REFERENCES visual_batches(id),
        version INTEGER NOT NULL CHECK (version >= 1),
        mode TEXT NOT NULL CHECK (mode IN ('preview', 'production')),
        platform TEXT NOT NULL,
        format TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        bytes INTEGER NOT NULL CHECK (bytes >= 0),
        manifest_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(package_id, version, platform, format)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_visual_delivery_package
        ON visual_delivery_artifacts(package_id, version DESC);
      CREATE INDEX IF NOT EXISTS idx_visual_delivery_batch
        ON visual_delivery_artifacts(batch_id, version DESC);
    `,
  },
]

function migrate(db: DatabaseSync): void {
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    ) STRICT;
  `)
  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>)
      .map((row) => Number(row.version)),
  )
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec(migration.sql)
      db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)')
        .run(migration.version, new Date().toISOString())
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
}

export function openFactoryDatabase(options: OpenDatabaseOptions = {}): DatabaseSync {
  const dbPath = options.path ?? defaultFactoryDbPath()
  if (dbPath !== ':memory:') mkdirSync(path.dirname(dbPath), { recursive: true })
  const db = new DatabaseSync(dbPath)
  // WAL lets the dashboard read while a worker is committing state.
  if (dbPath !== ':memory:') db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA synchronous = NORMAL;')
  migrate(db)
  return db
}

export interface FactoryDatabaseHealth {
  path: string
  schemaVersion: number
  jobs: Record<string, number>
}

export function databaseHealth(db: DatabaseSync, dbPath = defaultFactoryDbPath()): FactoryDatabaseHealth {
  const version = db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations')
    .get() as { version: number }
  const counts = db.prepare('SELECT status, COUNT(*) AS count FROM workflow_jobs GROUP BY status')
    .all() as Array<{ status: string; count: number }>
  return {
    path: dbPath,
    schemaVersion: Number(version.version),
    jobs: Object.fromEntries(counts.map((row) => [row.status, Number(row.count)])),
  }
}
