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

export const FACTORY_SCHEMA_VERSION = 1

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
