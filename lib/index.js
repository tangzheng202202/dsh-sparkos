/* dsh-sparkos host half — built. Edit src/, then `npm run build`. */
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};

// src/vault.ts
var vault_exports = {};
__export(vault_exports, {
  CONTENTOS_ROOT: () => CONTENTOS_ROOT,
  DAILY_BRIEF_DIR: () => DAILY_BRIEF_DIR,
  KNOWLEDGE_ROOT: () => KNOWLEDGE_ROOT,
  MEDIA_OS_ROOT: () => MEDIA_OS_ROOT,
  PERF_DIR: () => PERF_DIR,
  RUNTIME_DISTILL_QUEUE: () => RUNTIME_DISTILL_QUEUE,
  RUNTIME_EVENTS: () => RUNTIME_EVENTS,
  TIMELINE_DATA: () => TIMELINE_DATA,
  VAULT_ROOT: () => VAULT_ROOT,
  envOrNull: () => envOrNull,
  envPath: () => envPath,
  expandHomePath: () => expandHomePath,
  initVault: () => initVault,
  resolveVaultRoot: () => resolveVaultRoot
});
import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
function envPath(name2, fallback) {
  const v = process.env[name2];
  return v && v.trim() !== "" ? v : fallback;
}
function envOrNull(name2) {
  const v = process.env[name2];
  if (!v || v.trim() === "") return null;
  return v.trim();
}
function expandHomePath(input, home = homedir()) {
  if (input === "~") return home;
  if (input.startsWith("~/") || input.startsWith("~\\")) return path.join(home, input.slice(2));
  return input;
}
function resolveVaultRoot(env = process.env, home = homedir()) {
  const explicit = env.SPARKOS_VAULT_ROOT;
  if (explicit !== void 0 && explicit.trim() !== "") return path.resolve(expandHomePath(explicit.trim(), home));
  const fromEnv = env.DSH_HOME;
  const legacy = path.join(home, "DeepSeek harness", "sparkos");
  if (existsSync(legacy)) return path.resolve(legacy);
  const dshHome = fromEnv !== void 0 && fromEnv.trim() !== "" ? expandHomePath(fromEnv.trim(), home) : path.join(home, ".dsh");
  return path.resolve(dshHome, "sparkos");
}
function underExternalOrVault(envName, relative) {
  const explicit = envOrNull(envName);
  if (explicit) return explicit;
  return path.join(CONTENTOS_ROOT, relative);
}
function runtimeIf(relative) {
  const p = path.join(CONTENTOS_ROOT, relative);
  return existsSync(p) ? p : null;
}
function migrationSource(item) {
  if (item.runtime && existsSync(item.runtime)) return item.runtime;
  return fileURLToPath(new URL("../seeds/" + item.seed, import.meta.url));
}
function copySeed(vaultRoot, seed, destRelative) {
  const dest = path.join(vaultRoot, destRelative);
  if (existsSync(dest)) return;
  mkdirSync(path.dirname(dest), { recursive: true });
  copyFileSync(fileURLToPath(new URL("../seeds/" + seed, import.meta.url)), dest);
}
function ensureSampleBrief(vaultRoot) {
  const dir = path.join(vaultRoot, "daily_brief");
  mkdirSync(path.join(dir, "drafts"), { recursive: true });
  let hasBrief = false;
  try {
    hasBrief = readdirSync(dir).some((name2) => name2.startsWith("daily_briefing_") && name2.endsWith(".md"));
  } catch {
    hasBrief = false;
  }
  if (hasBrief) return;
  copySeed(vaultRoot, "sample_daily_briefing.md", "daily_brief/daily_briefing_2000-01-01.md");
  copySeed(vaultRoot, "sample_daily_data.json", "daily_brief/daily_data_2000-01-01.json");
}
function initVault(vaultRoot = VAULT_ROOT) {
  mkdirSync(vaultRoot, { recursive: true });
  const migrated = [];
  const alreadyPresent = [];
  for (const item of MIGRATION) {
    const destAbs = path.join(vaultRoot, item.dest);
    mkdirSync(path.dirname(destAbs), { recursive: true });
    if (existsSync(destAbs)) {
      alreadyPresent.push(item.dest);
      continue;
    }
    copyFileSync(migrationSource(item), destAbs);
    migrated.push(item);
  }
  for (const dir of ["state", "distill_queue", "drafts", "perf", "daily_brief"]) {
    mkdirSync(path.join(vaultRoot, dir), { recursive: true });
  }
  ensureSampleBrief(vaultRoot);
  const manifestPath = path.join(vaultRoot, "MANIFEST");
  const stamp = (/* @__PURE__ */ new Date()).toISOString();
  const lines = readManifest(manifestPath);
  for (const m of migrated) {
    const source = MIGRATION.find((x) => x.dest === m.dest);
    lines.push(`${stamp}	${m.dest}	${m.note}	src=${source ? migrationSource(source) : "?"}`);
  }
  if (migrated.length > 0) writeFileSync(manifestPath, `${lines.join("\n")}
`);
  return { migrated, alreadyPresent, vaultRoot };
}
function readManifest(p) {
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8").split("\n").filter((l) => l.trim() !== "");
}
var VAULT_ROOT, KNOWLEDGE_ROOT, CONTENTOS_ROOT, MEDIA_OS_ROOT, TIMELINE_DATA, DAILY_BRIEF_DIR, PERF_DIR, RUNTIME_DISTILL_QUEUE, RUNTIME_EVENTS, MIGRATION;
var init_vault = __esm({
  "src/vault.ts"() {
    "use strict";
    VAULT_ROOT = resolveVaultRoot();
    KNOWLEDGE_ROOT = envPath("SPARKOS_KNOWLEDGE_ROOT", path.join(homedir(), "cow", "knowledge"));
    CONTENTOS_ROOT = envPath("SPARKOS_CONTENTOS_ROOT", path.join(homedir(), "cow", "projects", "contentos-x"));
    MEDIA_OS_ROOT = envPath("SPARKOS_MEDIA_OS_ROOT", path.join(homedir(), "DeepSeek harness", "media-os"));
    TIMELINE_DATA = envPath("SPARKOS_TIMELINE_DATA", path.join(VAULT_ROOT, "config", "timeline_cards.json"));
    DAILY_BRIEF_DIR = underExternalOrVault("SPARKOS_DAILY_BRIEF_DIR", "daily_brief");
    PERF_DIR = underExternalOrVault("SPARKOS_PERF_DIR", "perf");
    RUNTIME_DISTILL_QUEUE = underExternalOrVault("SPARKOS_RUNTIME_DISTILL_QUEUE", path.join("obsidian-bridge", "distill_queue"));
    RUNTIME_EVENTS = underExternalOrVault("SPARKOS_RUNTIME_EVENTS", path.join("archive", "events.jsonl"));
    MIGRATION = [
      { runtime: runtimeIf(path.join("config", "narrative_lines.json")), seed: "narrative_lines.json", dest: "config/narrative_lines.json", note: "\u53D9\u4E8B\u4E3B\u7EBF" },
      { runtime: runtimeIf(path.join("config", "line_names.json")), seed: "line_names.json", dest: "config/line_names.json", note: "\u4E3B\u7EBF\u547D\u540D" },
      { runtime: runtimeIf(path.join("archive", "events.jsonl")), seed: "events.jsonl", dest: "archive/events.jsonl", note: "\u4E8B\u4EF6\u8D26\u672C" },
      { runtime: runtimeIf(path.join("config", "timeline_cards.json")), seed: "timeline_cards.json", dest: "config/timeline_cards.json", note: "\u77E5\u8BC6\u5361" },
      { runtime: runtimeIf(path.join("config", "info_sources.json")), seed: "info_sources.json", dest: "config/info_sources.json", note: "\u4FE1\u606F\u6E90\u6CE8\u518C\u8868" }
    ];
  }
});

// src/intel/ingest.ts
var ingest_exports = {};
__export(ingest_exports, {
  defaultIntelConfig: () => defaultIntelConfig,
  eventKeyOf: () => eventKeyOf,
  itemEventKey: () => itemEventKey,
  observedAtOf: () => observedAtOf,
  runIngest: () => runIngest,
  statusOf: () => statusOf
});
import { existsSync as existsSync4, mkdirSync as mkdirSync2, readdirSync as readdirSync4, readFileSync as readFileSync4, statSync as statSync2, writeFileSync as writeFileSync2, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir as homedir2 } from "node:os";
import path4 from "node:path";
function defaultIntelConfig() {
  const sources = [];
  const all = envOrNull("SPARKOS_INTEL_ARCHIVE_ALL");
  if (all) sources.push({ id: "archive-all", dir: all, maxStalenessHours: 48, pattern: "all" });
  const published = envOrNull("SPARKOS_INTEL_ARCHIVE_PUBLISHED");
  if (published) sources.push({ id: "archive-published", dir: published, maxStalenessHours: 24, pattern: "published-only" });
  return {
    sources: [
      {
        id: "alpha-signal",
        dir: envPath("SPARKOS_ALPHA_ARCHIVE", path4.join(homedir2(), ".openclaw", "telegram-newsroom", "state", "archive")),
        maxStalenessHours: 48,
        pattern: "all"
      },
      {
        id: "hn",
        // FeedFuse/HN 每日快照（08:01 与 20:00 两波），一文件约 40 条（HN 20 + GitHub 20）。
        // 条目自带真实热度（score/heat，如 856），是情报层唯一的真实热度来源。
        dir: envPath("SPARKOS_HN_ARCHIVE", path4.join(KNOWLEDGE_ROOT, "sources", "raw")),
        maxStalenessHours: 30,
        pattern: "all",
        filePrefix: "tech-ai-",
        explodeItems: true
      },
      {
        id: "hermes-cn",
        // 2026-09-01 newsroom-cn 从 ~/.hermes/newsroom-cn 迁出，现位于 ~/newsroom-cn。
        // 仍可用 SPARKOS_HERMES_ARCHIVE 覆盖；旧路径的兼容 symlink 仅作双保险。
        dir: envPath("SPARKOS_HERMES_ARCHIVE", path4.join(homedir2(), "newsroom-cn", "state", "archive")),
        maxStalenessHours: 24,
        pattern: "published-only",
        // 综合新闻管道噪声高：只保留与内容主线相关的版块。
        // 2026-09-10 收紧：去掉「国际动态」——14 天实测该版块 63 条里仅 1 条与 AI/科技相关
        // （其余为台风/航母调动/俄美通话等），却占白名单通过量的 39%。去掉后信噪比 20.6%→33.0%。
        categories: ["\u79D1\u6280\u521B\u65B0", "\u8D22\u7ECF\u7ECF\u6D4E"],
        // P0+ 主题门（与分类是「或」关系）：救回落在时政要闻/国际动态里的主线相关稿件。
        // 实测 14 天可救回 5 条，其中「教师人工智能素养全覆盖培训」是条真 AI 政策新闻。
        topicsAllow: ["\u4EBA\u5DE5\u667A\u80FD", "AI", "\u79D1\u6280", "\u673A\u5668\u4EBA", "\u7B97\u529B", "\u91CF\u5B50", "\u82AF\u7247", "\u5927\u6A21\u578B"]
      },
      { id: "baicaotang", dir: envPath("SPARKOS_BAICAOTANG_ARCHIVE", "") || null, maxStalenessHours: 24, pattern: "all" }
    ],
    outDir: path4.join(VAULT_ROOT, "ops-intel", "ingest"),
    runsDir: path4.join(VAULT_ROOT, "ops-intel", "runs"),
    keepDays: 14
  };
}
function eventKeyOf(filename) {
  return filename.split(".")[0] ?? filename;
}
function itemEventKey(sourceId, item) {
  const seed = typeof item.url === "string" && item.url !== "" ? item.url : typeof item.title === "string" && item.title !== "" ? item.title : JSON.stringify(item);
  return sourceId + "-" + createHash("sha256").update(seed).digest("hex").slice(0, 16);
}
function observedAtOf(raw, now) {
  for (const k of ["created_at", "collected_at", "published_at"]) {
    const v = raw[k];
    if (typeof v === "string" && v !== "") return v;
  }
  return now.toISOString();
}
function statusOf(filename, body) {
  if (/\.published\.json$/.test(filename)) return "ok";
  if (/\.unsent-scope-blocked\.json$/.test(filename)) return "blocked";
  if (/\.rejected\.json$/.test(filename)) return "rejected";
  if (/\.expired\.json$/.test(filename)) return "expired";
  const s = body.status;
  if (s === "published") return "ok";
  if (s === "rejected") return "rejected";
  if (s === "expired") return "expired";
  return "unknown";
}
function listSnapshottedKeys(outDir, source) {
  const keys = /* @__PURE__ */ new Set();
  const sub = path4.join(outDir, source);
  if (!existsSync4(sub)) return keys;
  for (const f of readdirSync4(sub)) {
    if (f.endsWith(".snapshot.json")) keys.add(f.slice(0, -".snapshot.json".length));
  }
  return keys;
}
function pruneSnapshots(outDir, keepDays, now = Date.now()) {
  let removed = 0;
  if (!existsSync4(outDir)) return 0;
  for (const source of readdirSync4(outDir)) {
    const sub = path4.join(outDir, source);
    try {
      if (!statSync2(sub).isDirectory()) continue;
    } catch {
      continue;
    }
    for (const f of readdirSync4(sub)) {
      const p = path4.join(sub, f);
      try {
        if (now - statSync2(p).mtimeMs > keepDays * 24 * 3600 * 1e3) {
          rmSync(p);
          removed++;
        }
      } catch {
      }
    }
  }
  return removed;
}
function runIngest(cfg, now = /* @__PURE__ */ new Date()) {
  mkdirSync2(cfg.outDir, { recursive: true });
  const sources = [];
  for (const src of cfg.sources) {
    if (src.dir === null) {
      sources.push({ source: src.id, ok: true, scanned: 0, added: 0, skipped: 0, error: "pending-source" });
      continue;
    }
    if (!existsSync4(src.dir)) {
      sources.push({ source: src.id, ok: false, error: "source-missing", scanned: 0, added: 0, skipped: 0 });
      continue;
    }
    const files = readdirSync4(src.dir).filter((f) => f.endsWith(".json") && !f.startsWith(".")).filter((f) => src.pattern === "all" || /\.published\.json$/.test(f)).filter((f) => src.filePrefix === void 0 || f.startsWith(src.filePrefix)).sort();
    const known = listSnapshottedKeys(cfg.outDir, src.id);
    const sub = path4.join(cfg.outDir, src.id);
    mkdirSync2(sub, { recursive: true });
    let scanned = 0;
    let added = 0;
    let skipped = 0;
    const emit = (eventKey, raw, rawFile, status) => {
      const snapshot = {
        eventKey,
        source: src.id,
        status,
        observedAt: observedAtOf(raw, now),
        ingestedAt: now.toISOString(),
        rawFile,
        raw
      };
      writeFileSync2(path4.join(sub, `${eventKey}.snapshot.json`), `${JSON.stringify(snapshot, null, 2)}
`);
      known.add(eventKey);
      added++;
    };
    for (const f of files) {
      let parsed;
      try {
        parsed = JSON.parse(readFileSync4(path4.join(src.dir, f), "utf8"));
      } catch {
        parsed = void 0;
      }
      if (src.explodeItems) {
        if (!Array.isArray(parsed)) continue;
        scanned += parsed.length;
        for (const entry of parsed) {
          if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
          const item = entry;
          const eventKey2 = itemEventKey(src.id, item);
          if (known.has(eventKey2)) {
            skipped++;
            continue;
          }
          emit(eventKey2, item, f, "ok");
        }
        continue;
      }
      scanned++;
      const eventKey = eventKeyOf(f);
      if (known.has(eventKey)) {
        skipped++;
        continue;
      }
      const raw = parsed ?? {};
      emit(eventKey, raw, f, statusOf(f, raw));
    }
    sources.push({ source: src.id, ok: true, scanned, added, skipped });
  }
  pruneSnapshots(cfg.outDir, cfg.keepDays);
  return { stage: "ingest", at: now.toISOString(), sources, ok: sources.every((s) => s.ok) };
}
var init_ingest = __esm({
  "src/intel/ingest.ts"() {
    "use strict";
    init_vault();
  }
});

// src/intel/health.ts
import { existsSync as existsSync5, readdirSync as readdirSync5, readFileSync as readFileSync5 } from "node:fs";
import path5 from "node:path";
function latestOfFile(src, file) {
  let raw;
  try {
    raw = JSON.parse(readFileSync5(path5.join(src.dir, file), "utf8"));
  } catch {
    return { published: false, ts: null };
  }
  if (src.explodeItems) {
    if (!Array.isArray(raw)) return { published: false, ts: null };
    let ts2 = null;
    for (const entry of raw) {
      if (typeof entry !== "object" || entry === null) continue;
      const at = Date.parse(String(entry.collected_at ?? ""));
      if (Number.isFinite(at) && (ts2 === null || at > ts2)) ts2 = at;
    }
    return { published: ts2 !== null, ts: ts2 };
  }
  const body = typeof raw === "object" && raw !== null ? raw : {};
  const published = /\.published\.json$/.test(file) || body.status === "published";
  const publishedAt = typeof body.published_at === "string" ? Date.parse(body.published_at) : NaN;
  const createdAt = typeof body.created_at === "string" ? Date.parse(body.created_at) : NaN;
  const ts = Number.isFinite(publishedAt) ? publishedAt : Number.isFinite(createdAt) ? createdAt : null;
  return { published, ts };
}
function latestPublished(src, now) {
  void now;
  if (src.dir === null || !existsSync5(src.dir)) return null;
  let best = null;
  for (const f of readdirSync5(src.dir)) {
    if (!f.endsWith(".json") || f.startsWith(".")) continue;
    if (src.pattern === "published-only" && !/\.published\.json$/.test(f)) continue;
    if (src.filePrefix !== void 0 && !f.startsWith(src.filePrefix)) continue;
    const { published, ts } = latestOfFile(src, f);
    if (!published || ts === null) continue;
    if (best === null || ts > best.ts) best = { iso: new Date(ts).toISOString(), ts };
  }
  return best?.iso ?? null;
}
function failStreak(runsDir, source) {
  if (!existsSync5(runsDir)) return 0;
  const files = readdirSync5(runsDir).filter((f) => f.startsWith("run-") && f.endsWith(".json")).sort().reverse();
  let streak = 0;
  for (const f of files) {
    try {
      const run = JSON.parse(readFileSync5(path5.join(runsDir, f), "utf8"));
      const s = run.sources?.find((x) => x.source === source);
      if (s && s.ok === false) streak++;
      else break;
    } catch {
      break;
    }
  }
  return streak;
}
function computeHealth(cfg, now = /* @__PURE__ */ new Date()) {
  const sources = cfg.sources.map((src) => {
    if (src.dir === null) {
      return {
        id: src.id,
        status: "pending",
        latestPublishedAt: null,
        stalenessHours: null,
        maxStalenessHours: src.maxStalenessHours,
        failStreak: 0,
        note: "\u672A\u914D\u7F6E"
      };
    }
    if (!existsSync5(src.dir)) {
      return {
        id: src.id,
        status: "pending",
        latestPublishedAt: null,
        stalenessHours: null,
        maxStalenessHours: src.maxStalenessHours,
        failStreak: 0,
        note: "\u76EE\u5F55\u4E0D\u5B58\u5728\uFF0C\u672A\u6807\u7EA2\u3002\u8BF7\u68C0\u67E5\u8DEF\u5F84\uFF0C\u6216\u7559\u7A7A\u8868\u793A\u4E0D\u63A5\u5165"
      };
    }
    const latest = latestPublished(src, now.getTime());
    const staleness = latest !== null ? Math.max(0, Math.round((now.getTime() - Date.parse(latest)) / 36e5)) : null;
    const streak = failStreak(cfg.runsDir, src.id);
    let status;
    let note;
    if (latest === null && streak === 0) {
      status = "pending";
      note = "\u6682\u65E0\u5DF2\u53D1\u5E03\u7A3F\u4EF6";
    } else if (staleness === null || staleness > src.maxStalenessHours || streak > 0) {
      status = "red";
    } else {
      status = "green";
    }
    return {
      id: src.id,
      status,
      latestPublishedAt: latest,
      stalenessHours: staleness,
      maxStalenessHours: src.maxStalenessHours,
      failStreak: streak,
      note
    };
  });
  const real = sources.filter((s) => s.status !== "pending");
  const overall = real.some((s) => s.status === "red") ? "red" : real.length === 0 ? "pending" : "green";
  return { at: now.toISOString(), sources, overall };
}
var init_health = __esm({
  "src/intel/health.ts"() {
    "use strict";
  }
});

// src/intel/runs.ts
import { existsSync as existsSync6, mkdirSync as mkdirSync3, readdirSync as readdirSync6, readFileSync as readFileSync6, rmSync as rmSync2, writeFileSync as writeFileSync3 } from "node:fs";
import path6 from "node:path";
function writeRun(runsDir, run) {
  mkdirSync3(runsDir, { recursive: true });
  const file = path6.join(runsDir, `run-${run.at.replace(/[:.]/g, "-")}.json`);
  writeFileSync3(file, `${JSON.stringify(run, null, 2)}
`);
  return file;
}
function fromIngest(ingest) {
  return {
    stage: ingest.stage,
    at: ingest.at,
    sources: ingest.sources.map((s) => ({ source: s.source, ok: s.ok, error: s.error })),
    ok: ingest.ok
  };
}
function listRuns(runsDir, n = 1) {
  if (!existsSync6(runsDir)) return [];
  const files = readdirSync6(runsDir).filter((f) => f.startsWith("run-") && f.endsWith(".json")).sort().slice(-n);
  return files.flatMap((f) => {
    try {
      return [JSON.parse(readFileSync6(path6.join(runsDir, f), "utf8"))];
    } catch {
      return [];
    }
  });
}
function pruneRuns(runsDir, max = 200) {
  if (!existsSync6(runsDir)) return;
  const files = readdirSync6(runsDir).filter((f) => f.startsWith("run-")).sort();
  for (const f of files.slice(0, Math.max(0, files.length - max))) {
    try {
      rmSync2(path6.join(runsDir, f));
    } catch {
    }
  }
}
var init_runs = __esm({
  "src/intel/runs.ts"() {
    "use strict";
  }
});

// src/intel/report.ts
var report_exports = {};
__export(report_exports, {
  buildIntelReport: () => buildIntelReport,
  initOpsIntel: () => initOpsIntel,
  latestFusion: () => latestFusion
});
import { existsSync as existsSync7, mkdirSync as mkdirSync4, readdirSync as readdirSync7, readFileSync as readFileSync7, writeFileSync as writeFileSync4 } from "node:fs";
import path7 from "node:path";
function countArchive(cfg) {
  return cfg.sources.map((src) => {
    const base = { source: src.id, published: 0, blocked: 0, rejected: 0, expired: 0, total: 0 };
    if (src.dir === null || !existsSync7(src.dir)) return base;
    for (const f of readdirSync7(src.dir)) {
      if (!f.endsWith(".json") || f.startsWith(".")) continue;
      if (src.pattern === "published-only" && !/\.published\.json$/.test(f)) continue;
      if (src.filePrefix !== void 0 && !f.startsWith(src.filePrefix)) continue;
      if (src.explodeItems) {
        try {
          const arr = JSON.parse(readFileSync7(path7.join(src.dir, f), "utf8"));
          if (Array.isArray(arr)) {
            const n = arr.filter((x) => typeof x === "object" && x !== null).length;
            base.total += n;
            base.published += n;
          }
        } catch {
        }
        continue;
      }
      base.total++;
      let raw = {};
      try {
        raw = JSON.parse(readFileSync7(path7.join(src.dir, f), "utf8"));
      } catch {
      }
      const status = /\.published\.json$/.test(f) ? "published" : /\.unsent-scope-blocked\.json$/.test(f) ? "blocked" : /\.rejected\.json$/.test(f) ? "rejected" : /\.expired\.json$/.test(f) ? "expired" : raw.status === "published" ? "published" : raw.status === "rejected" ? "rejected" : raw.status === "expired" ? "expired" : "unknown";
      if (status === "published") base.published++;
      else if (status === "blocked") base.blocked++;
      else if (status === "rejected") base.rejected++;
      else if (status === "expired") base.expired++;
    }
    return base;
  });
}
function listFusion(cfg) {
  const dir = path7.join(path7.dirname(cfg.outDir), "fusion");
  try {
    return readdirSync7(dir).filter((f) => f.startsWith("fusion-") && f.endsWith(".json")).sort().reverse().slice(0, 7);
  } catch {
    return [];
  }
}
function countSnapshots(outDir) {
  try {
    return readdirSync7(outDir).reduce((acc, sub) => {
      const p = path7.join(outDir, sub);
      try {
        return acc + readdirSync7(p).filter((f) => f.endsWith(".snapshot.json")).length;
      } catch {
        return acc;
      }
    }, 0);
  } catch {
    return 0;
  }
}
function latestFusion(cfg = defaultIntelConfig()) {
  const dir = path7.join(path7.dirname(cfg.outDir), "fusion");
  const files = listFusion(cfg);
  if (files.length === 0) return null;
  try {
    return JSON.parse(readFileSync7(path7.join(dir, files[0]), "utf8"));
  } catch {
    return null;
  }
}
function buildIntelReport(cfg = defaultIntelConfig()) {
  return {
    at: (/* @__PURE__ */ new Date()).toISOString(),
    health: computeHealth(cfg),
    lastRun: listRuns(cfg.runsDir, 1)[0] ?? null,
    archiveCounts: countArchive(cfg),
    snapshotCount: countSnapshots(cfg.outDir),
    fusionAvailable: listFusion(cfg)
  };
}
function initOpsIntel(root = VAULT_ROOT) {
  const ops = path7.join(root, "ops-intel");
  const created = [];
  for (const dir of ["ingest", "fusion", "runs", "dispatch"]) {
    const p = path7.join(ops, dir);
    if (!existsSync7(p)) {
      mkdirSync4(p, { recursive: true });
      created.push(dir);
    }
  }
  const readme = path7.join(ops, "README.md");
  if (!existsSync7(readme)) {
    writeFileSync4(readme, [
      "# ops-intel \u2014 \u60C5\u62A5\u6307\u6325\u6240\u6570\u636E\u533A",
      "",
      "- ingest/\uFF1A\u6BCF\u8F6E\u8C03\u5EA6\u589E\u91CF\u5FEB\u7167\uFF0814 \u5929\u6EDA\u52A8\uFF09",
      "- fusion/\uFF1A\u65E5\u9891\u878D\u5408\u4EA7\u7269 fusion-YYYYMMDD.md/.json\uFF08agent \u624B\u52A8\u89E6\u53D1\uFF09",
      "- runs/\uFF1A\u6BCF\u8F6E run \u7559\u75D5\uFF08source-missing \u5FC5\u987B fail\uFF0C\u4E0D\u9759\u9ED8\uFF09",
      "- dispatch/\uFF1A\u9884\u7559\uFF08\u5916\u53D1\u987B\u7ECF\u4EBA\u5DE5\u88C1\u51B3\uFF0C\u672C\u63D2\u4EF6\u4E0D\u81EA\u52A8\u5916\u53D1\uFF09",
      "",
      "\u7EA2\u7EBF\uFF1A\u5916\u90E8\u5F52\u6863\u53EA\u8BFB\uFF1B\u672A\u914D\u7F6E\u73AF\u5883\u53D8\u91CF\u65F6\u4E0D\u63A5\u5165\u3002",
      ""
    ].join("\n"));
    created.push("README.md");
  }
  const ownership = path7.join(ops, "ownership.yml");
  if (!existsSync7(ownership)) {
    writeFileSync4(ownership, [
      "# \u60C5\u62A5\u6570\u636E\u533A\u6240\u6709\u6743",
      "migration: pending",
      "sources: []",
      "# \u53EF\u9009\u53EA\u8BFB\u5F52\u6863\uFF1ASPARKOS_INTEL_ARCHIVE_ALL / SPARKOS_INTEL_ARCHIVE_PUBLISHED",
      ""
    ].join("\n"));
    created.push("ownership.yml");
  }
  return { created };
}
var init_report = __esm({
  "src/intel/report.ts"() {
    "use strict";
    init_vault();
    init_ingest();
    init_health();
    init_runs();
  }
});

// src/server/security.ts
import { randomBytes } from "node:crypto";
function escapeJsonForScript(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}
function isSafeExternalUrl(raw) {
  if (typeof raw !== "string") return false;
  if (raw === "" || raw.length > 2048) return false;
  if (raw !== raw.trim()) return false;
  if (/[\u0000-\u001f\u007f]/.test(raw)) return false;
  if (!/^https?:\/\//i.test(raw)) return false;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
function issueCsrfToken() {
  const token = randomBytes(32).toString("hex");
  const now = Date.now();
  for (const [t, expiry] of csrfTokens) {
    if (expiry <= now) csrfTokens.delete(t);
  }
  if (csrfTokens.size >= CSRF_TOKEN_CAP) {
    const oldest = csrfTokens.keys().next().value;
    if (oldest !== void 0) csrfTokens.delete(oldest);
  }
  csrfTokens.set(token, now + CSRF_TOKEN_TTL_MS);
  return token;
}
function verifyCsrfToken(token) {
  if (typeof token !== "string" || token === "") return false;
  const expiry = csrfTokens.get(token);
  if (expiry === void 0) return false;
  if (expiry <= Date.now()) {
    csrfTokens.delete(token);
    return false;
  }
  return true;
}
function headerOf(req, name2) {
  const value = req.headers[name2.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}
function isSameOrigin(req) {
  const origin = headerOf(req, "origin");
  if (origin === void 0) return true;
  const host = headerOf(req, "host");
  if (host === void 0 || host === "") return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
function looksLikeBrowser(req) {
  return headerOf(req, "origin") !== void 0 || headerOf(req, "referer") !== void 0 || headerOf(req, "sec-fetch-site") !== void 0;
}
function checkMutationRequest(req) {
  if (req.method !== "POST") return null;
  const contentType = headerOf(req, "content-type");
  if (contentType !== void 0) {
    const mediaType = contentType.split(";")[0].trim().toLowerCase();
    if (mediaType !== "application/json") {
      return { status: 415, code: "unsupported-media-type", message: "mutation POST \u5FC5\u987B\u4F7F\u7528 application/json" };
    }
  }
  const secFetchSite = headerOf(req, "sec-fetch-site");
  if (secFetchSite !== void 0 && secFetchSite !== "same-origin" && secFetchSite !== "none") {
    return { status: 403, code: "cross-origin", message: "\u62D2\u7EDD\u8DE8\u7AD9\u5199\u5165\u8BF7\u6C42" };
  }
  if (!isSameOrigin(req)) {
    return { status: 403, code: "cross-origin", message: "\u62D2\u7EDD\u8DE8\u7AD9\u5199\u5165\u8BF7\u6C42" };
  }
  if (looksLikeBrowser(req)) {
    const token = headerOf(req, "x-sparkos-csrf");
    if (!verifyCsrfToken(token)) {
      return { status: 403, code: "csrf-token", message: "\u7F3A\u5C11\u6216\u65E0\u6548\u7684 CSRF token" };
    }
  }
  return null;
}
function newCspNonce() {
  return randomBytes(16).toString("base64url");
}
function cspWithNonce(nonce) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "frame-src 'self'",
    "connect-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'self'"
  ].join("; ");
}
var CSRF_TOKEN_TTL_MS, CSRF_TOKEN_CAP, csrfTokens;
var init_security = __esm({
  "src/server/security.ts"() {
    "use strict";
    CSRF_TOKEN_TTL_MS = 12 * 60 * 60 * 1e3;
    CSRF_TOKEN_CAP = 512;
    csrfTokens = /* @__PURE__ */ new Map();
  }
});

// src/intel/cluster.ts
var cluster_exports = {};
__export(cluster_exports, {
  T0_LIMIT: () => T0_LIMIT,
  T0_MIN_HEAT: () => T0_MIN_HEAT,
  buildClusterSkeletons: () => buildClusterSkeletons,
  heatLevelOf: () => heatLevelOf,
  latestClusters: () => latestClusters,
  loadClusters: () => loadClusters,
  saveClusters: () => saveClusters,
  t0Candidates: () => t0Candidates,
  validateCluster: () => validateCluster,
  writeAnalyzeRequest: () => writeAnalyzeRequest
});
import { existsSync as existsSync8, mkdirSync as mkdirSync5, readdirSync as readdirSync8, readFileSync as readFileSync9, writeFileSync as writeFileSync5 } from "node:fs";
import path8 from "node:path";
function localDateStamp(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return y + m + day;
}
function levelOf(up, base) {
  if (!up) return base;
  return base === "low" ? "medium" : base === "medium" ? "high" : "high";
}
function heatLevelOf(score) {
  if (score === null) return "low";
  if (score >= 70) return "high";
  if (score >= 45) return "medium";
  return "low";
}
function buildClusterSkeletons(items, dupGroups, date = /* @__PURE__ */ new Date()) {
  const stamp = localDateStamp(date);
  const byKey = new Map(items.map((i) => [i.eventKey, i]));
  const grouped = /* @__PURE__ */ new Set();
  const clusters = [];
  let seq = 1;
  const mk = (keys) => {
    const members = keys.map((k) => byKey.get(k)).filter((x) => x !== void 0);
    const sources = new Set(members.map((m) => m.source));
    const urls = [...new Set(members.map((m) => m.evidenceUrl).filter((u) => u !== ""))];
    const heats = members.map((m) => m.heat).filter((h) => typeof h === "number");
    const maxHeat = heats.length > 0 ? Math.max(...heats) : null;
    let heat = heatLevelOf(maxHeat);
    if (members.length >= 3) heat = levelOf(true, heat);
    if (sources.size >= 2) heat = levelOf(true, heat);
    return {
      clusterId: "c-" + stamp + "-" + String(seq++).padStart(3, "0"),
      date: stamp,
      topic: "",
      coreFacts: [],
      heat,
      sourceHeat: maxHeat === null ? void 0 : maxHeat,
      novelty: "medium",
      sourceCount: sources.size,
      evidenceUrls: urls,
      knowledgeCards: [],
      credibility: "medium",
      risks: [],
      platforms: [],
      angleSuggestions: [],
      eventKeys: keys
    };
  };
  for (const g of dupGroups) {
    g.forEach((k) => grouped.add(k));
    clusters.push(mk(g));
  }
  for (const i of items) {
    if (!grouped.has(i.eventKey)) clusters.push(mk([i.eventKey]));
  }
  return clusters.sort((a, b) => {
    const o = { high: 2, medium: 1, low: 0 };
    return o[b.heat] - o[a.heat] || b.eventKeys.length - a.eventKeys.length;
  });
}
function validateCluster(c) {
  const errs = [];
  if (typeof c.clusterId !== "string" || !/^c-\d{8}-\d{3}$/.test(c.clusterId)) errs.push("clusterId \u5FC5\u987B\u5F62\u5982 c-YYYYMMDD-001");
  if (typeof c.topic !== "string" || c.topic.trim() === "" || c.topic.length > 120) errs.push("topic \u5FC5\u586B\u4E14 \u2264120 \u5B57");
  if (!Array.isArray(c.eventKeys) || c.eventKeys.length === 0) errs.push("eventKeys \u5FC5\u586B\u4E14\u975E\u7A7A");
  for (const k of ["heat", "novelty", "credibility"]) {
    const v = c[k];
    if (v !== "low" && v !== "medium" && v !== "high") errs.push(k + " \u5FC5\u987B\u662F low/medium/high");
  }
  for (const k of ["coreFacts", "evidenceUrls", "knowledgeCards", "risks", "platforms", "angleSuggestions"]) {
    if (c[k] !== void 0 && !Array.isArray(c[k])) errs.push(k + " \u5FC5\u987B\u662F\u6570\u7EC4");
  }
  if (c.topicKey !== void 0 && !/^t-[a-z0-9][a-z0-9._-]{2,80}$/i.test(c.topicKey)) errs.push("topicKey \u5FC5\u987B\u5F62\u5982 t-<\u7A33\u5B9A\u4E3B\u9898\u952E>");
  if (c.evidence !== void 0 && !Array.isArray(c.evidence)) errs.push("evidence \u5FC5\u987B\u662F\u6570\u7EC4");
  if (Array.isArray(c.evidenceUrls)) {
    for (const [index, url] of c.evidenceUrls.entries()) {
      if (!isSafeExternalUrl(url)) errs.push(`evidenceUrls[${index}] \u5FC5\u987B\u662F http/https \u7EDD\u5BF9\u5730\u5740`);
    }
  }
  if (Array.isArray(c.evidence)) {
    for (const [index, item] of c.evidence.entries()) {
      if (item !== null && typeof item === "object" && "url" in item && !isSafeExternalUrl(item.url)) {
        errs.push(`evidence[${index}].url \u5FC5\u987B\u662F http/https \u7EDD\u5BF9\u5730\u5740`);
      }
    }
  }
  for (const k of ["sourceAuthorityScore", "audienceFitScore", "sourceHeat"]) {
    if (c[k] !== void 0 && (typeof c[k] !== "number" || c[k] < 0 || c[k] > 100)) errs.push(k + " \u5FC5\u987B\u662F 0-100");
  }
  if (c.judgment !== void 0) {
    if (typeof c.judgment !== "object" || c.judgment === null) errs.push("judgment \u5FC5\u987B\u662F\u5BF9\u8C61");
    else {
      for (const k of ["confirmedFacts", "inferences", "counterArguments", "uncertainties"]) {
        if (!Array.isArray(c.judgment[k])) errs.push("judgment." + k + " \u5FC5\u987B\u662F\u6570\u7EC4");
      }
      if (typeof c.judgment.editorialView !== "string") errs.push("judgment.editorialView \u5FC5\u987B\u662F\u5B57\u7B26\u4E32");
    }
  }
  return errs;
}
function clustersDir(cfg) {
  return path8.join(path8.dirname(cfg.outDir), "clusters");
}
function loadClusters(cfg, date) {
  const dir = clustersDir(cfg);
  const f = path8.join(dir, "clusters-" + localDateStamp(date) + ".json");
  if (!existsSync8(f)) return [];
  try {
    const raw = JSON.parse(readFileSync9(f, "utf8"));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}
function latestClusters(cfg) {
  const dir = clustersDir(cfg);
  try {
    const files = readdirSync8(dir).filter((f) => /^clusters-\d{8}\.json$/.test(f)).sort().reverse();
    if (files.length === 0) return null;
    const raw = JSON.parse(readFileSync9(path8.join(dir, files[0]), "utf8"));
    return { date: files[0].slice(9, 17), clusters: Array.isArray(raw) ? raw : [] };
  } catch {
    return null;
  }
}
function saveClusters(cfg, incoming, date) {
  const dir = clustersDir(cfg);
  mkdirSync5(dir, { recursive: true });
  const stamp = localDateStamp(date);
  const existing = loadClusters(cfg, date);
  const merged = new Map(existing.map((c) => [c.clusterId, c]));
  for (const c of incoming) {
    if (c.clusterId && c.clusterId.startsWith("c-")) merged.set(c.clusterId, c);
  }
  const out = [...merged.values()];
  const f = path8.join(dir, "clusters-" + stamp + ".json");
  writeFileSync5(f, JSON.stringify(out, null, 2) + "\n");
  return { file: f, total: out.length };
}
function t0Candidates(clusters, opts = {}) {
  const minHeat = opts.minHeat ?? T0_MIN_HEAT;
  const limit = opts.limit ?? T0_LIMIT;
  const crossSource = (c) => c.sourceCount >= 2 ? 1 : 0;
  return clusters.filter((c) => (typeof c.sourceHeat === "number" ? c.sourceHeat >= minHeat : c.heat === "high") || c.sourceCount >= 2).sort((a, b) => crossSource(b) - crossSource(a) || (b.sourceHeat ?? 0) - (a.sourceHeat ?? 0)).slice(0, limit);
}
function writeAnalyzeRequest(cfg, skeletons, date = /* @__PURE__ */ new Date()) {
  const dir = clustersDir(cfg);
  mkdirSync5(dir, { recursive: true });
  const stamp = localDateStamp(date);
  const existing = new Map(loadClusters(cfg, date).map((c) => [c.clusterId, c]));
  const analyzed = (c) => c !== void 0 && c.topic.trim() !== "";
  const pending = skeletons.filter((s) => !analyzed(existing.get(s.clusterId)));
  const t0 = t0Candidates(pending);
  const f = path8.join(dir, "analyze-" + stamp + ".json");
  writeFileSync5(f, JSON.stringify({
    date: stamp,
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    instructions: {
      topicKey: "\u8DE8\u65E5\u540C\u4E00\u8BDD\u9898\u5FC5\u987B\u590D\u7528\u7A33\u5B9A topicKey\uFF08t-...\uFF09\uFF0C\u5373\u4F7F\u6807\u9898\u53D8\u5316",
      evidence: "\u9010\u6761\u586B\u5199 claim/url/sourceType/independenceGroup/verified/contradicts\uFF1B\u8F6C\u8F7D\u540C\u7A3F\u5171\u7528 independenceGroup",
      judgment: "\u4E25\u683C\u5206\u5F00 confirmedFacts\u3001inferences\u3001editorialView\u3001counterArguments\u3001uncertainties",
      creationGate: "\u53EA\u6709\u8BC1\u636E\u7B49\u7EA7 A\uFF08\u5B98\u65B9/\u7B2C\u4E00\u65B9\uFF09\u6216 B\uFF08\u81F3\u5C11\u4E24\u4E2A\u72EC\u7ACB\u53EF\u9760\u6765\u6E90\uFF09\u53EF\u8FDB\u5165\u521B\u4F5C",
      batching: "\u9ED8\u8BA4**\u53EA\u5206\u6790 t0**\uFF08\u63D2\u4EF6\u5DF2\u6309\u300C\u8DE8\u6E90\u4F18\u5148 + \u771F\u5B9E\u70ED\u5EA6\u300D\u7B5B\u51FA\u7684\u6709\u754C\u5019\u9009\uFF09\uFF1Bpending \u662F\u5B8C\u6574\u6E05\u5355\uFF0C\u4EC5\u5728\u7528\u6237\u660E\u786E\u8981\u6C42\u5168\u91CF\u5206\u6790\u65F6\u624D\u5904\u7406"
    },
    t0Note: "T0 = \u8DE8\u6E90\uFF08sourceCount\u22652\uFF09\u6216 sourceHeat \u2265 " + T0_MIN_HEAT + "\uFF0C\u6700\u591A " + T0_LIMIT + " \u6761\uFF0C\u8DE8\u6E90\u4F18\u5148\u3002",
    pending,
    t0
  }, null, 2) + "\n");
  return { file: f, pending: pending.length, t0: t0.length };
}
var T0_MIN_HEAT, T0_LIMIT;
var init_cluster = __esm({
  "src/intel/cluster.ts"() {
    "use strict";
    init_security();
    T0_MIN_HEAT = 80;
    T0_LIMIT = 8;
  }
});

// src/storage/database.ts
var database_exports = {};
__export(database_exports, {
  FACTORY_SCHEMA_VERSION: () => FACTORY_SCHEMA_VERSION,
  databaseHealth: () => databaseHealth,
  defaultFactoryDbPath: () => defaultFactoryDbPath,
  openFactoryDatabase: () => openFactoryDatabase
});
import { mkdirSync as mkdirSync6 } from "node:fs";
import path9 from "node:path";
import { DatabaseSync } from "node:sqlite";
function defaultFactoryDbPath() {
  return envPath("SPARKOS_DB_PATH", path9.join(VAULT_ROOT, "data", "sparkos.db"));
}
function migrate(db) {
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);
  const applied = new Set(
    db.prepare("SELECT version FROM schema_migrations").all().map((row) => Number(row.version))
  );
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(migration.sql);
      db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(migration.version, (/* @__PURE__ */ new Date()).toISOString());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}
function openFactoryDatabase(options = {}) {
  const dbPath = options.path ?? defaultFactoryDbPath();
  if (dbPath !== ":memory:") mkdirSync6(path9.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  if (dbPath !== ":memory:") db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  migrate(db);
  return db;
}
function databaseHealth(db, dbPath = defaultFactoryDbPath()) {
  const version = db.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").get();
  const counts = db.prepare("SELECT status, COUNT(*) AS count FROM workflow_jobs GROUP BY status").all();
  return {
    path: dbPath,
    schemaVersion: Number(version.version),
    jobs: Object.fromEntries(counts.map((row) => [row.status, Number(row.count)]))
  };
}
var FACTORY_SCHEMA_VERSION, MIGRATIONS;
var init_database = __esm({
  "src/storage/database.ts"() {
    "use strict";
    init_vault();
    FACTORY_SCHEMA_VERSION = 7;
    MIGRATIONS = [
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
    `
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
    `
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
    `
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
    `
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
    `
      },
      {
        version: 6,
        sql: `
      -- M6.2 controlled retry provenance: one row per retry request created by a
      -- human from the V2 visual card. The row pins the rejected attempt, the
      -- reject note, the optional supplementary instruction and the idempotency
      -- key, so repeated submissions for the same current attempt replay the
      -- same result while a different payload under the same key is a conflict.
      CREATE TABLE IF NOT EXISTS visual_retry_requests (
        id TEXT PRIMARY KEY,
        idempotency_key TEXT NOT NULL UNIQUE,
        package_id TEXT NOT NULL REFERENCES draft_packages(id),
        task_id TEXT NOT NULL REFERENCES visual_asset_tasks(id),
        attempt_id TEXT NOT NULL REFERENCES visual_asset_attempts(id),
        asset_id TEXT NOT NULL,
        reject_note TEXT NOT NULL,
        supplementary_instruction TEXT,
        status TEXT NOT NULL CHECK (status IN ('created', 'claimed', 'superseded')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_visual_retry_requests_task
        ON visual_retry_requests(task_id, created_at DESC);
    `
      },
      {
        version: 7,
        sql: `
      -- \u8BED\u4E49\u6536\u53E3\uFF08additive\uFF09\uFF1A
      -- 1) visual_retry_requests \u589E\u52A0 purpose / human_note\uFF1A
      --    reject_rerun\uFF08\u9ED8\u8BA4\uFF0C\u6309\u4EBA\u5DE5\u9A73\u56DE\u610F\u89C1\u91CD\u8BD5\uFF09
      --    replace_stub_with_production\uFF08\u4EBA\u5DE5\u786E\u8BA4\u628A\u5DF2\u9A73\u56DE stub \u6D4B\u8BD5\u56FE\u66FF\u6362\u4E3A\u771F\u5B9E Provider \u56FE\uFF09
      -- 2) publication_intents\uFF1A\u53D1\u5E03\u53F0\u8D26\u4E13\u7528\u8868\u3002\u53D1\u5E03\u8BB0\u5F55\u7EDD\u4E0D\u518D\u8FDB\u5165 workflow_jobs \u53EF\u6267\u884C\u961F\u5217\uFF1B
      --    \u5386\u53F2 kind='publish' job \u4EC5\u4FDD\u7559\u5BA1\u8BA1\u3002UNIQUE(package_id) \u4FDD\u6301\u540C\u5305\u5E42\u7B49\u3002
      ALTER TABLE visual_retry_requests ADD COLUMN purpose TEXT NOT NULL DEFAULT 'reject_rerun';
      ALTER TABLE visual_retry_requests ADD COLUMN human_note TEXT;

      CREATE TABLE IF NOT EXISTS publication_intents (
        id TEXT PRIMARY KEY,
        package_id TEXT NOT NULL REFERENCES draft_packages(id),
        readiness_json TEXT NOT NULL,
        note TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(package_id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_publication_intents_package
        ON publication_intents(package_id, created_at DESC);
    `
      }
    ];
  }
});

// src/storage/jobs.ts
import { randomUUID } from "node:crypto";
function fromRow(row) {
  return {
    id: row.id,
    kind: row.kind,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    priority: Number(row.priority),
    input: JSON.parse(row.input_json),
    output: row.output_json === null ? null : JSON.parse(row.output_json),
    error: row.error,
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    runAfter: row.run_after,
    workerId: row.worker_id,
    leaseExpiresAt: row.lease_expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
function addEvent(db, jobId, from, to, note, at) {
  db.prepare("INSERT INTO workflow_job_events(job_id, at, from_status, to_status, note) VALUES (?, ?, ?, ?, ?)").run(jobId, at, from, to, note);
}
function createJob(db, spec) {
  if (spec.idempotencyKey) {
    const existing = db.prepare("SELECT * FROM workflow_jobs WHERE idempotency_key = ?").get(spec.idempotencyKey);
    if (existing) return { job: fromRow(existing), created: false };
  }
  const now = (spec.now ?? /* @__PURE__ */ new Date()).toISOString();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO workflow_jobs(
      id, kind, idempotency_key, status, priority, input_json, attempts,
      max_attempts, run_after, created_at, updated_at
    ) VALUES (?, ?, ?, 'queued', ?, ?, 0, ?, ?, ?, ?)
  `).run(
    id,
    spec.kind,
    spec.idempotencyKey ?? null,
    spec.priority ?? 0,
    JSON.stringify(spec.input ?? {}),
    spec.maxAttempts ?? 3,
    (spec.runAfter ?? spec.now ?? /* @__PURE__ */ new Date()).toISOString(),
    now,
    now
  );
  addEvent(db, id, null, "queued", "created", now);
  return { job: getJob(db, id), created: true };
}
function getJob(db, id) {
  const row = db.prepare("SELECT * FROM workflow_jobs WHERE id = ?").get(id);
  return row ? fromRow(row) : null;
}
function listJobs(db, limit = 20) {
  const safeLimit = Math.max(1, Math.min(200, Math.trunc(limit)));
  return db.prepare(`SELECT * FROM workflow_jobs ORDER BY created_at DESC LIMIT ${safeLimit}`).all().map(fromRow);
}
function transitionJob(db, id, to, opts = {}) {
  const current = getJob(db, id);
  if (!current) throw new Error("job not found: " + id);
  if (!ALLOWED[current.status].has(to)) throw new Error(`invalid job transition: ${current.status} -> ${to}`);
  const at = (opts.now ?? /* @__PURE__ */ new Date()).toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    const updated = db.prepare(`
      UPDATE workflow_jobs
      SET status = ?, output_json = ?, error = ?, worker_id = ?, lease_expires_at = ?, updated_at = ?
      WHERE id = ? AND status = ?
    `).run(
      to,
      opts.output === void 0 ? null : JSON.stringify(opts.output),
      opts.error ?? null,
      opts.workerId ?? (to === "running" ? current.workerId : null),
      opts.leaseExpiresAt ?? null,
      at,
      id,
      current.status
    );
    if (Number(updated.changes) !== 1) throw new Error(`job transition conflict: ${id} ${current.status} -> ${to}`);
    addEvent(db, id, current.status, to, opts.note ?? null, at);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getJob(db, id);
}
function startJob(db, id, workerId, now = /* @__PURE__ */ new Date(), leaseSeconds = 300) {
  const nowIso = now.toISOString();
  const lease = new Date(now.getTime() + Math.max(1, leaseSeconds) * 1e3).toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db.prepare("SELECT * FROM workflow_jobs WHERE id = ? AND status = 'queued'").get(id);
    if (!row) throw new Error("queued job not found: " + id);
    if (row.attempts >= row.max_attempts) throw new Error("job attempts exhausted: " + id);
    const updated = db.prepare(`
      UPDATE workflow_jobs
      SET status = 'running', attempts = attempts + 1, worker_id = ?, lease_expires_at = ?, updated_at = ?
      WHERE id = ? AND status = 'queued'
    `).run(workerId, lease, nowIso, id);
    if (Number(updated.changes) !== 1) throw new Error("job start conflict: " + id);
    addEvent(db, id, "queued", "running", "started by " + workerId, nowIso);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getJob(db, id);
}
function recoverExpiredJobs(db, now = /* @__PURE__ */ new Date()) {
  const rows = db.prepare(`
    SELECT * FROM workflow_jobs
    WHERE status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at < ?
  `).all(now.toISOString());
  let requeued = 0;
  let failed2 = 0;
  for (const row of rows) {
    const to = row.attempts < row.max_attempts ? "queued" : "failed";
    transitionJob(db, row.id, to, {
      error: to === "failed" ? "worker lease expired; attempts exhausted" : null,
      note: "worker lease expired",
      now
    });
    if (to === "queued") requeued++;
    else failed2++;
  }
  return { requeued, failed: failed2 };
}
var ALLOWED;
var init_jobs = __esm({
  "src/storage/jobs.ts"() {
    "use strict";
    ALLOWED = {
      queued: /* @__PURE__ */ new Set(["running", "cancelled"]),
      running: /* @__PURE__ */ new Set(["queued", "waiting_approval", "succeeded", "failed", "cancelled"]),
      waiting_approval: /* @__PURE__ */ new Set(["queued", "succeeded", "cancelled"]),
      succeeded: /* @__PURE__ */ new Set(),
      failed: /* @__PURE__ */ new Set(["queued", "cancelled"]),
      cancelled: /* @__PURE__ */ new Set()
    };
  }
});

// src/intel/ranking.ts
import { createHash as createHash2 } from "node:crypto";
function clamp(value, min = 0, max = 100) {
  return Math.round(Math.max(min, Math.min(max, value)) * 100) / 100;
}
function levelScore(level) {
  return level === "high" ? 90 : level === "medium" ? 60 : 30;
}
function normalizeTopic(topic) {
  return topic.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "").slice(0, 160);
}
function topicKeyOf(cluster) {
  if (cluster.topicKey && /^t-[a-z0-9][a-z0-9._-]{2,80}$/i.test(cluster.topicKey)) return cluster.topicKey;
  const normalized = normalizeTopic(cluster.topic || cluster.clusterId);
  return "t-" + createHash2("sha256").update(normalized).digest("hex").slice(0, 16);
}
function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
function verificationGradeOf(evidence, fallbackUrls = []) {
  const all = evidence.length > 0 ? evidence : fallbackUrls.map((url) => ({ url, sourceType: "unknown", verified: false }));
  if (all.some((item) => item.contradicts === true)) return "D";
  const verified = all.filter((item) => item.verified === true);
  if (verified.some((item) => item.sourceType === "primary" || item.sourceType === "official")) return "A";
  const reliable = verified.filter((item) => item.sourceType !== "social" && item.sourceType !== "unknown");
  const groups = new Set(reliable.map((item) => item.independenceGroup || hostOf(item.url)));
  if (groups.size >= 2) return "B";
  if (verified.length >= 1) return "C";
  return "D";
}
function previousRows(db, topicKey, date) {
  return db.prepare(`
    SELECT snapshot_date, rank, mention_count, heat_score
    FROM topic_rank_snapshots
    WHERE topic_key = ? AND snapshot_date < ?
    ORDER BY snapshot_date DESC
    LIMIT 14
  `).all(topicKey, date);
}
function dayBefore(date) {
  const d = /* @__PURE__ */ new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
function consecutiveTopDays(history, date) {
  let expected = dayBefore(date);
  let count = 0;
  for (const row of history) {
    if (row.snapshot_date !== expected || Number(row.rank) > 10) break;
    count++;
    expected = dayBefore(expected);
  }
  return count;
}
function syncCluster(db, cluster, date, topicKey, now) {
  db.prepare(`
    INSERT INTO topic_clusters(
      topic_key, observed_date, cluster_id, topic, heat, novelty, credibility,
      source_count, mention_count, cluster_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(topic_key, observed_date) DO UPDATE SET
      cluster_id=excluded.cluster_id, topic=excluded.topic, heat=excluded.heat,
      novelty=excluded.novelty, credibility=excluded.credibility,
      source_count=excluded.source_count, mention_count=excluded.mention_count,
      cluster_json=excluded.cluster_json, updated_at=excluded.updated_at
  `).run(
    topicKey,
    date,
    cluster.clusterId,
    cluster.topic,
    cluster.heat,
    cluster.novelty,
    cluster.credibility,
    cluster.sourceCount,
    cluster.eventKeys.length,
    JSON.stringify(cluster),
    now
  );
  db.prepare("DELETE FROM topic_evidence WHERE topic_key = ? AND observed_date = ?").run(topicKey, date);
  for (const item of cluster.evidence ?? []) {
    const id = createHash2("sha256").update([topicKey, date, item.url, item.claim ?? ""].join("\0")).digest("hex");
    db.prepare(`
      INSERT INTO topic_evidence(
        id, topic_key, observed_date, url, claim, source_type, independence_group,
        verified, contradicts, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      topicKey,
      date,
      item.url,
      item.claim ?? null,
      item.sourceType ?? "unknown",
      item.independenceGroup || hostOf(item.url),
      item.verified === true ? 1 : 0,
      item.contradicts === true ? 1 : 0,
      now
    );
  }
}
function scoreCluster(db, cluster, date) {
  const topicKey = topicKeyOf(cluster);
  const history = previousRows(db, topicKey, date);
  const previous = history[0];
  const mentions = cluster.eventKeys.length;
  const streakBeforeToday = consecutiveTopDays(history, date);
  const volume = clamp(mentions * 20);
  const velocity = previous ? clamp(50 + (mentions - Number(previous.mention_count)) / Math.max(1, Number(previous.mention_count)) * 50) : clamp(50 + Math.min(30, mentions * 5));
  const sourceDiversity = clamp(cluster.sourceCount / 3 * 100);
  const authority = clamp(cluster.sourceAuthorityScore ?? levelScore(cluster.credibility));
  const persistence = clamp(streakBeforeToday / 3 * 100);
  const audienceFit = clamp(cluster.audienceFitScore ?? 50 + Math.min(30, cluster.platforms.length * 10) + (cluster.knowledgeCards.length > 0 ? 10 : 0));
  const novelty = levelScore(cluster.novelty);
  const knowledgeDepth = clamp(cluster.knowledgeCards.length * 15 + cluster.coreFacts.length * 10 + Math.min(30, cluster.evidenceUrls.length * 10));
  const originalJudgment = clamp(
    cluster.judgment?.editorialView ? 70 + Math.min(20, cluster.judgment.inferences.length * 5) + Math.min(10, cluster.judgment.counterArguments.length * 5) : 20
  );
  const grade = verificationGradeOf(cluster.evidence ?? [], cluster.evidenceUrls);
  const riskPenalty = clamp(cluster.risks.length * 5 + (grade === "C" ? 10 : grade === "D" ? 30 : 0), 0, 40);
  const attention = clamp(cluster.sourceHeat ?? levelScore(cluster.heat));
  const heatScore = clamp(
    attention * 0.25 + velocity * 0.15 + volume * 0.1 + sourceDiversity * 0.15 + authority * 0.15 + persistence * 0.1 + audienceFit * 0.1
  );
  const overallScore = clamp(
    heatScore * 0.3 + novelty * 0.2 + knowledgeDepth * 0.2 + audienceFit * 0.15 + originalJudgment * 0.15 - riskPenalty
  );
  return {
    topicKey,
    clusterId: cluster.clusterId,
    topic: cluster.topic || "(\u5F85\u5206\u6790)",
    heatScore,
    overallScore,
    velocityScore: velocity,
    verificationGrade: grade,
    eligibleForCreation: grade === "A" || grade === "B",
    mentionCount: mentions,
    sourceCount: cluster.sourceCount,
    consecutiveTopDays: streakBeforeToday + 1,
    breakdown: {
      attention,
      volume,
      velocity,
      sourceDiversity,
      authority,
      persistence,
      audienceFit,
      novelty,
      knowledgeDepth,
      originalJudgment,
      riskPenalty
    },
    evidenceUrls: cluster.evidenceUrls,
    angleSuggestions: cluster.angleSuggestions,
    judgment: cluster.judgment
  };
}
function generateDailyRanking(db, clusters, date, now = /* @__PURE__ */ new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("ranking date must be YYYY-MM-DD");
  const nowIso = now.toISOString();
  const unique = /* @__PURE__ */ new Map();
  for (const cluster of clusters.filter((item) => item.topic.trim() !== "")) {
    const key = topicKeyOf(cluster);
    const existing = unique.get(key);
    const richness = cluster.eventKeys.length + cluster.evidenceUrls.length + cluster.coreFacts.length;
    const existingRichness = existing ? existing.eventKeys.length + existing.evidenceUrls.length + existing.coreFacts.length : -1;
    if (!existing || richness > existingRichness) unique.set(key, cluster);
  }
  const selectedClusters = [...unique.values()];
  const candidates = selectedClusters.map((cluster) => scoreCluster(db, cluster, date)).sort((a, b) => b.heatScore - a.heatScore || b.overallScore - a.overallScore).map((item, index) => ({ ...item, rank: index + 1 }));
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM topic_rank_snapshots WHERE snapshot_date = ?").run(date);
    for (const cluster of selectedClusters) {
      syncCluster(db, cluster, date, topicKeyOf(cluster), nowIso);
    }
    const insert = db.prepare(`
      INSERT INTO topic_rank_snapshots(
        snapshot_date, topic_key, cluster_id, topic, rank, heat_score, overall_score,
        velocity_score, mention_count, source_count, consecutive_top_days,
        verification_grade, eligible_for_creation, breakdown_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const item of candidates) {
      insert.run(
        date,
        item.topicKey,
        item.clusterId,
        item.topic,
        item.rank,
        item.heatScore,
        item.overallScore,
        item.velocityScore,
        item.mentionCount,
        item.sourceCount,
        item.consecutiveTopDays,
        item.verificationGrade,
        item.eligibleForCreation ? 1 : 0,
        JSON.stringify(item.breakdown),
        nowIso
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return {
    date,
    generatedAt: nowIso,
    top5: candidates.slice(0, 5),
    rising: [...candidates].sort((a, b) => b.velocityScore - a.velocityScore || a.rank - b.rank).slice(0, 5),
    persistent: candidates.filter((item) => item.consecutiveTopDays >= 2 || item.rank <= 10 && item.consecutiveTopDays >= 3),
    creationCandidates: [...candidates].filter((item) => item.eligibleForCreation).sort((a, b) => b.overallScore - a.overallScore).slice(0, 5),
    all: candidates
  };
}
function rowToRanked(row) {
  return {
    rank: Number(row.rank),
    topicKey: row.topic_key,
    clusterId: row.cluster_id,
    topic: row.topic,
    heatScore: Number(row.heat_score),
    overallScore: Number(row.overall_score),
    velocityScore: Number(row.velocity_score),
    verificationGrade: row.verification_grade,
    eligibleForCreation: Number(row.eligible_for_creation) === 1,
    mentionCount: Number(row.mention_count),
    sourceCount: Number(row.source_count),
    consecutiveTopDays: Number(row.consecutive_top_days),
    breakdown: JSON.parse(row.breakdown_json),
    evidenceUrls: [],
    angleSuggestions: []
  };
}
function latestDailyRanking(db) {
  const latest = db.prepare("SELECT MAX(snapshot_date) AS date FROM topic_rank_snapshots").get();
  if (!latest.date) return null;
  const rows = db.prepare("SELECT * FROM topic_rank_snapshots WHERE snapshot_date = ? ORDER BY rank").all(latest.date).map(rowToRanked);
  return {
    date: latest.date,
    generatedAt: rows.length > 0 ? String(db.prepare("SELECT MAX(created_at) AS at FROM topic_rank_snapshots WHERE snapshot_date = ?").get(latest.date).at) : (/* @__PURE__ */ new Date()).toISOString(),
    top5: rows.slice(0, 5),
    rising: [...rows].sort((a, b) => b.velocityScore - a.velocityScore || a.rank - b.rank).slice(0, 5),
    persistent: rows.filter((item) => item.consecutiveTopDays >= 2),
    creationCandidates: [...rows].filter((item) => item.eligibleForCreation).sort((a, b) => b.overallScore - a.overallScore).slice(0, 5),
    all: rows
  };
}
var init_ranking = __esm({
  "src/intel/ranking.ts"() {
    "use strict";
  }
});

// src/editorial/planner.ts
import { createHash as createHash3, randomUUID as randomUUID2 } from "node:crypto";
function addDays(date, days) {
  const value = /* @__PURE__ */ new Date(date + "T00:00:00Z");
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
function parseArray(json2) {
  try {
    const value = JSON.parse(json2);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}
function parseCluster(json2) {
  return JSON.parse(json2);
}
function reversalSignal(cluster) {
  if ((cluster.evidence ?? []).some((item) => item.contradicts === true)) return true;
  const text = [
    ...cluster.judgment?.uncertainties ?? [],
    ...cluster.judgment?.counterArguments ?? [],
    ...cluster.risks
  ].join(" ");
  return /(反转|辟谣|撤回|更正|争议|冲突|证伪|误读)/.test(text);
}
function trendOf(mode, rows, cluster) {
  const chronological = [...rows].sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
  const latest = chronological.at(-1);
  const first = chronological[0];
  const spanDays = Math.round((Date.parse(latest.snapshot_date) - Date.parse(first.snapshot_date)) / 864e5) + 1;
  const hasGap = chronological.length >= 2 && spanDays > chronological.length;
  if (reversalSignal(cluster)) return "reversal";
  if (mode === "weekly" && chronological.length >= 4 && cluster.knowledgeCards.length > 0) return "structural";
  if (latest.consecutive_top_days >= 3 || chronological.length >= 3) return "persistent";
  if (latest.velocity_score >= 70 || latest.heat_score - first.heat_score >= 12) return "accelerating";
  if (hasGap) return "resurfacing";
  return "emerging";
}
function thesisOf(cluster) {
  return cluster.judgment?.editorialView?.trim() || cluster.angleSuggestions[0]?.trim() || `\u56F4\u7ED5\u201C${cluster.topic}\u201D\u68B3\u7406\u5DF2\u786E\u8BA4\u4E8B\u5B9E\u3001\u5F71\u54CD\u8FB9\u754C\u4E0E\u4E0B\u4E00\u6B65\u89C2\u5BDF\u70B9\u3002`;
}
function evidenceOf(cluster) {
  if ((cluster.evidence ?? []).length > 0) return cluster.evidence ?? [];
  return cluster.evidenceUrls.map((url) => ({ url, sourceType: "unknown", verified: false }));
}
function expectedValue(rows, cluster, pattern) {
  const latest = [...rows].sort((a, b) => b.snapshot_date.localeCompare(a.snapshot_date))[0];
  const patternBonus = {
    structural: 12,
    persistent: 10,
    accelerating: 8,
    reversal: 7,
    resurfacing: 5,
    emerging: 3
  };
  const judgmentBonus = cluster.judgment?.editorialView ? 5 : 0;
  const knowledgeBonus = Math.min(6, cluster.knowledgeCards.length * 2);
  const riskPenalty = Math.min(15, cluster.risks.length * 3);
  return Math.round(Math.max(0, Math.min(100, latest.overall_score + patternBonus[pattern] + judgmentBonus + knowledgeBonus - riskPenalty)) * 100) / 100;
}
function loadRows(db, start, end) {
  return db.prepare(`
    SELECT r.snapshot_date, r.topic_key, r.topic, r.rank, r.heat_score,
      r.overall_score, r.velocity_score, r.consecutive_top_days,
      r.verification_grade, r.eligible_for_creation, c.cluster_json
    FROM topic_rank_snapshots r
    JOIN topic_clusters c
      ON c.topic_key = r.topic_key AND c.observed_date = r.snapshot_date
    WHERE r.snapshot_date BETWEEN ? AND ?
    ORDER BY r.snapshot_date, r.rank
  `).all(start, end);
}
function editorialInputFingerprint(db, mode, periodEnd) {
  const windowDays = mode === "midweek" ? 4 : 7;
  const rows = loadRows(db, addDays(periodEnd, -(windowDays - 1)), periodEnd);
  return createHash3("sha256").update(JSON.stringify(rows)).digest("hex").slice(0, 16);
}
function cardFromRow(row) {
  return {
    id: row.id,
    rank: Number(row.rank),
    topicKey: row.topic_key,
    title: row.title,
    trendPattern: row.trend_pattern,
    coreThesis: row.core_thesis,
    whyNow: row.why_now,
    facts: parseArray(row.facts_json),
    evidence: parseArray(row.evidence_json),
    counterArguments: parseArray(row.counter_arguments_json),
    knowledgeCards: parseArray(row.knowledge_cards_json),
    platforms: parseArray(row.platforms_json),
    contentFormat: row.content_format,
    risks: parseArray(row.risks_json),
    verificationGrade: row.verification_grade,
    expectedValue: Number(row.expected_value),
    decision: row.decision,
    ...row.decided_at ? { decidedAt: row.decided_at } : {}
  };
}
function planFromRun(db, run) {
  const cards = db.prepare("SELECT * FROM editorial_cards WHERE run_id = ? ORDER BY rank").all(run.id).map(cardFromRow);
  return {
    id: run.id,
    mode: run.mode,
    periodStart: run.period_start,
    periodEnd: run.period_end,
    status: run.status,
    generatedAt: run.generated_at,
    summary: JSON.parse(run.summary_json),
    cards
  };
}
function generateEditorialPlan(db, mode, periodEnd, now = /* @__PURE__ */ new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) throw new Error("editorial period end must be YYYY-MM-DD");
  const windowDays = mode === "midweek" ? 4 : 7;
  const periodStart = addDays(periodEnd, -(windowDays - 1));
  const rows = loadRows(db, periodStart, periodEnd);
  if (rows.length === 0) throw new Error(`\u9009\u9898\u7A97\u53E3 ${periodStart}..${periodEnd} \u6682\u65E0\u6392\u540D\u5FEB\u7167`);
  const inputFingerprint = createHash3("sha256").update(JSON.stringify(rows)).digest("hex").slice(0, 16);
  const existing = db.prepare(`
    SELECT * FROM editorial_runs WHERE mode = ? AND period_end = ? AND input_fingerprint = ?
  `).get(mode, periodEnd, inputFingerprint);
  if (existing) return planFromRun(db, existing);
  const grouped = /* @__PURE__ */ new Map();
  for (const row of rows) grouped.set(row.topic_key, [...grouped.get(row.topic_key) ?? [], row]);
  const eligible = [...grouped.entries()].filter(([, history]) => {
    const latest = [...history].sort((a, b) => b.snapshot_date.localeCompare(a.snapshot_date))[0];
    return latest.eligible_for_creation === 1 && (latest.verification_grade === "A" || latest.verification_grade === "B");
  });
  const candidates = eligible.map(([topicKey, history]) => {
    const latest = [...history].sort((a, b) => b.snapshot_date.localeCompare(a.snapshot_date))[0];
    const cluster = parseCluster(latest.cluster_json);
    const pattern = trendOf(mode, history, cluster);
    const value = expectedValue(history, cluster, pattern);
    return { topicKey, history, latest, cluster, pattern, value };
  }).sort((a, b) => b.value - a.value || a.latest.rank - b.latest.rank).slice(0, 5);
  const generatedAt = now.toISOString();
  const runId = "er-" + createHash3("sha256").update(`${mode}:${periodEnd}:${inputFingerprint}`).digest("hex").slice(0, 16);
  const summary = {
    windowDays,
    rankedTopics: grouped.size,
    evidenceEligible: eligible.length,
    selected: candidates.length,
    note: candidates.length < 5 ? `\u4EC5 ${candidates.length} \u4E2A\u8BDD\u9898\u901A\u8FC7 A/B \u8BC1\u636E\u95F8\u95E8\uFF0C\u4E0D\u7528\u4F4E\u53EF\u4FE1\u8BDD\u9898\u8865\u8DB3\u540D\u989D\u3002` : "5 \u4E2A\u8BDD\u9898\u5747\u901A\u8FC7 A/B \u8BC1\u636E\u95F8\u95E8\uFF0C\u7B49\u5F85\u4EBA\u5DE5\u5BA1\u6279\u3002"
  };
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      INSERT INTO editorial_runs(id, mode, period_start, period_end, input_fingerprint, status, generated_at, summary_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(runId, mode, periodStart, periodEnd, inputFingerprint, candidates.length === 0 ? "archived" : "pending_approval", generatedAt, JSON.stringify(summary));
    const insert = db.prepare(`
      INSERT INTO editorial_cards(
        id, run_id, rank, topic_key, title, trend_pattern, core_thesis, why_now,
        facts_json, evidence_json, counter_arguments_json, knowledge_cards_json,
        platforms_json, content_format, risks_json, verification_grade,
        expected_value, decision, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `);
    const approval = db.prepare(`
      INSERT INTO approvals(id, subject_kind, subject_id, decision, created_at)
      VALUES (?, 'editorial_card', ?, 'pending', ?)
      ON CONFLICT(subject_kind, subject_id) DO NOTHING
    `);
    for (let index = 0; index < candidates.length; index++) {
      const item = candidates[index];
      const cardId = "ec-" + createHash3("sha256").update(`${runId}:${item.topicKey}`).digest("hex").slice(0, 16);
      insert.run(
        cardId,
        runId,
        index + 1,
        item.topicKey,
        item.cluster.topic,
        item.pattern,
        thesisOf(item.cluster),
        WHY_NOW[item.pattern],
        JSON.stringify(item.cluster.coreFacts),
        JSON.stringify(evidenceOf(item.cluster)),
        JSON.stringify(item.cluster.judgment?.counterArguments ?? []),
        JSON.stringify(item.cluster.knowledgeCards),
        JSON.stringify(item.cluster.platforms),
        CONTENT_FORMAT[item.pattern],
        JSON.stringify(item.cluster.risks),
        item.latest.verification_grade,
        item.value,
        generatedAt
      );
      approval.run(randomUUID2(), cardId, generatedAt);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return planFromRun(db, db.prepare("SELECT * FROM editorial_runs WHERE id = ?").get(runId));
}
function latestEditorialPlan(db, mode) {
  const run = mode ? db.prepare("SELECT * FROM editorial_runs WHERE mode = ? ORDER BY period_end DESC, generated_at DESC LIMIT 1").get(mode) : db.prepare("SELECT * FROM editorial_runs ORDER BY period_end DESC, generated_at DESC LIMIT 1").get();
  return run ? planFromRun(db, run) : null;
}
function editorialCardById(db, cardId) {
  const row = db.prepare("SELECT * FROM editorial_cards WHERE id = ?").get(cardId);
  return row ? cardFromRow(row) : null;
}
function decideEditorialCard(db, cardId, decision, note, now = /* @__PURE__ */ new Date()) {
  if (!/^ec-[a-f0-9]{16}$/.test(cardId)) throw new Error("\u9009\u9898\u5361 id \u4E0D\u5408\u6CD5");
  const row = db.prepare("SELECT run_id FROM editorial_cards WHERE id = ?").get(cardId);
  if (!row) throw new Error("\u9009\u9898\u5361\u4E0D\u5B58\u5728\uFF1A" + cardId);
  const at = now.toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE editorial_cards SET decision = ?, decided_at = ? WHERE id = ?").run(decision, at, cardId);
    db.prepare(`
      UPDATE approvals SET decision = ?, note = ?, decided_at = ?
      WHERE subject_kind = 'editorial_card' AND subject_id = ?
    `).run(decision, note ?? null, at, cardId);
    const counts = db.prepare(`
      SELECT
        SUM(CASE WHEN decision = 'pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN decision = 'approved' THEN 1 ELSE 0 END) AS approved
      FROM editorial_cards WHERE run_id = ?
    `).get(row.run_id);
    const status = Number(counts.pending) > 0 ? "pending_approval" : Number(counts.approved) > 0 ? "approved" : "archived";
    db.prepare("UPDATE editorial_runs SET status = ? WHERE id = ?").run(status, row.run_id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return cardFromRow(db.prepare("SELECT * FROM editorial_cards WHERE id = ?").get(cardId));
}
var WHY_NOW, CONTENT_FORMAT;
var init_planner = __esm({
  "src/editorial/planner.ts"() {
    "use strict";
    WHY_NOW = {
      persistent: "\u8FDE\u7EED\u591A\u65E5\u8FDB\u5165\u70ED\u699C\uFF0C\u8BA8\u8BBA\u5C1A\u672A\u8870\u51CF\uFF0C\u9002\u5408\u4ECE\u201C\u53D1\u751F\u4E86\u4EC0\u4E48\u201D\u63A8\u8FDB\u5230\u201C\u610F\u5473\u7740\u4EC0\u4E48\u201D\u3002",
      accelerating: "\u70ED\u5EA6\u4E0E\u4F20\u64AD\u901F\u5EA6\u6B63\u5728\u62AC\u5347\uFF0C\u5F53\u524D\u53D1\u5E03\u80FD\u517C\u987E\u65F6\u6548\u4E0E\u4FE1\u606F\u5B8C\u6574\u5EA6\u3002",
      resurfacing: "\u8BDD\u9898\u5728\u6C89\u5BC2\u540E\u91CD\u65B0\u5347\u6E29\uFF0C\u9700\u8981\u89E3\u91CA\u672C\u8F6E\u56DE\u6F6E\u4E0E\u4E0A\u4E00\u8F6E\u7684\u5DEE\u5F02\u3002",
      reversal: "\u4E8B\u5B9E\u6216\u8206\u8BBA\u51FA\u73B0\u5206\u6B67\uFF0C\u8BFB\u8005\u9700\u8981\u8BC1\u636E\u8FB9\u754C\u3001\u4E89\u8BAE\u53CC\u65B9\u4E0E\u4ECD\u672A\u786E\u8BA4\u90E8\u5206\u3002",
      structural: "\u4E00\u5468\u5185\u6301\u7EED\u51FA\u73B0\u4E14\u53EF\u8FDE\u63A5\u65E2\u6709\u77E5\u8BC6\u5361\uFF0C\u5DF2\u4ECE\u5355\u70B9\u65B0\u95FB\u6F14\u5316\u4E3A\u7ED3\u6784\u6027\u8BAE\u9898\u3002",
      emerging: "\u65B0\u8BAE\u9898\u521A\u5F62\u6210\u53EF\u6838\u9A8C\u8BC1\u636E\u94FE\uFF0C\u9002\u5408\u62A2\u5360\u6E05\u6670\u3001\u514B\u5236\u7684\u7B2C\u4E00\u8F6E\u89E3\u8BFB\u3002"
    };
    CONTENT_FORMAT = {
      persistent: "\u7EB5\u6DF1\u89E3\u8BFB / \u65F6\u95F4\u7EBF\u590D\u76D8",
      accelerating: "\u5FEB\u8BC4 + \u5173\u952E\u4E8B\u5B9E\u5361",
      resurfacing: "\u524D\u540E\u5BF9\u7167 / \u4E8C\u6B21\u89E3\u8BFB",
      reversal: "\u4E8B\u5B9E\u6838\u67E5 / \u53CC\u65B9\u89C2\u70B9\u62C6\u89E3",
      structural: "\u6846\u67B6\u957F\u6587 / \u77E5\u8BC6\u5361\u56FE\u89E3",
      emerging: "\u8D8B\u52BF\u901F\u89C8 / \u5165\u95E8\u89E3\u91CA"
    };
  }
});

// src/creation/drafts.ts
var drafts_exports = {};
__export(drafts_exports, {
  CREATION_CONTRACT_VERSION: () => CREATION_CONTRACT_VERSION,
  decideDraftPackage: () => decideDraftPackage,
  ensureDraftRequest: () => ensureDraftRequest,
  listDraftPackageSummaries: () => listDraftPackageSummaries,
  listDraftPackages: () => listDraftPackages,
  pendingDraftRequests: () => pendingDraftRequests,
  readDraftArtifact: () => readDraftArtifact,
  reviseDraftRequest: () => reviseDraftRequest,
  submitDraftPackage: () => submitDraftPackage,
  validateDraftSubmission: () => validateDraftSubmission
});
import { createHash as createHash4, randomUUID as randomUUID3 } from "node:crypto";
import { existsSync as existsSync9, lstatSync, mkdirSync as mkdirSync7, readFileSync as readFileSync10, readdirSync as readdirSync9, realpathSync, renameSync, rmSync as rmSync3, writeFileSync as writeFileSync6 } from "node:fs";
import path10 from "node:path";
function artifactFromRow(row) {
  return { id: row.id, platform: row.platform, format: row.format, relativePath: row.relative_path, sha256: row.sha256, bytes: Number(row.bytes) };
}
function packageFromRow(db, row) {
  const artifacts = db.prepare("SELECT * FROM draft_artifacts WHERE package_id = ? ORDER BY relative_path").all(row.id).map(artifactFromRow);
  const request = JSON.parse(row.request_json);
  const review = db.prepare("SELECT note FROM approvals WHERE subject_kind='draft_package' AND subject_id=?").get(row.id);
  const parentReview = row.parent_package_id ? db.prepare("SELECT note FROM approvals WHERE subject_kind='draft_package' AND subject_id=?").get(row.parent_package_id) : void 0;
  const parentReviewNote = parentReview?.note ?? request.parentReviewNote ?? null;
  return {
    id: row.id,
    cardId: row.card_id,
    revision: Number(row.revision),
    parentPackageId: row.parent_package_id,
    jobId: row.job_id,
    contractVersion: Number(row.contract_version),
    status: row.status,
    request: { ...request, parentReviewNote },
    submission: row.submission_json ? JSON.parse(row.submission_json) : null,
    validation: JSON.parse(row.validation_json),
    artifactDir: row.artifact_dir,
    artifacts,
    reviewNote: review?.note ?? null,
    parentReviewNote,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    decidedAt: row.decided_at
  };
}
function packageById(db, id) {
  const row = db.prepare("SELECT * FROM draft_packages WHERE id = ?").get(id);
  return row ? packageFromRow(db, row) : null;
}
function emptyValidation() {
  return { ok: false, errors: [], warnings: [], stats: { wechatChars: 0, telegramChars: 0, xPosts: 0, xiaohongshuChars: 0, assets: 0, facts: 0 } };
}
function creationRequest(packageId, revision, parentPackageId, parentReviewNote, card, now) {
  return {
    packageId,
    revision,
    parentPackageId,
    parentReviewNote,
    contractVersion: CREATION_CONTRACT_VERSION,
    createdAt: now,
    sourceCard: card,
    requiredPlatforms: ["wechat", "telegram", "x", "xiaohongshu"],
    instructions: [
      ...parentReviewNote ? ["\u8FD9\u662F\u4FEE\u8BA2\u7248\uFF0C\u5FC5\u987B\u9010\u6761\u56DE\u5E94\u7236\u7248\u672C\u9A73\u56DE\u610F\u89C1\uFF1A" + parentReviewNote] : [],
      "\u53EA\u4F7F\u7528 sourceCard \u4E2D\u7684\u4E8B\u5B9E\u4E0E\u8BC1\u636E\uFF1B\u4E0D\u5F97\u628A\u63A8\u65AD\u5199\u6210\u5DF2\u786E\u8BA4\u4E8B\u5B9E\u3002",
      "\u56F4\u7ED5 coreThesis \u4FDD\u6301\u7EDF\u4E00\u89C2\u70B9\uFF0C\u4F46\u6309\u56DB\u4E2A\u5E73\u53F0\u7684\u9605\u8BFB\u4E60\u60EF\u91CD\u65B0\u7EC4\u7EC7\uFF0C\u4E0D\u505A\u673A\u68B0\u622A\u65AD\u3002",
      "\u5FAE\u4FE1\u516C\u4F17\u53F7\u5FC5\u987B\u63D0\u4EA4\u7ED3\u6784\u5316 blocks\uFF0C\u7531\u7CFB\u7EDF\u6E32\u67D3\u5B89\u5168 HTML\uFF1B\u81F3\u5C11\u5305\u542B\u5C01\u9762\u548C\u4E24\u5904\u6B63\u6587\u914D\u56FE\u4EFB\u52A1\u3002",
      "\u6240\u6709 fact \u7C7B\u578B claim \u5FC5\u987B\u56DE\u94FE sourceCard.evidence \u4E2D\u7684 URL\uFF1B\u4E89\u8BAE\u4E0E\u98CE\u9669\u5FC5\u987B\u663E\u5F0F\u4FDD\u7559\u3002",
      "\u8FD9\u662F\u5F85\u5BA1\u8349\u7A3F\uFF0C\u4E0D\u5F97\u5305\u542B\u201C\u5DF2\u53D1\u5E03\u201D\u6216\u7ED5\u8FC7\u4EBA\u5DE5\u5BA1\u6838\u7684\u6307\u4EE4\u3002",
      "\u6700\u4F4E\u5B8C\u6574\u5EA6\uFF1A\u5FAE\u4FE1\u6B63\u6587 600 \u5B57/6 \u4E2A blocks\uFF0CTelegram 150 \u5B57\uFF0C\u5C0F\u7EA2\u4E66 250 \u5B57/3 \u4E2A\u6807\u7B7E\uFF0CX 1-12 \u6761\u4E14\u5355\u6761\u4E0D\u8D85\u8FC7 280 \u5B57\u3002"
    ],
    outputContract: "DraftSubmission: packageId/editorialAngle/keyMessage/factBoundary/factClaims/variants{wechat,telegram,x,xiaohongshu}/assets",
    submissionTemplate: {
      packageId,
      editorialAngle: card.coreThesis,
      keyMessage: "\u4E00\u53E5\u8BDD\u6838\u5FC3\u4FE1\u606F",
      factBoundary: "\u54EA\u4E9B\u5DF2\u786E\u8BA4\uFF0C\u54EA\u4E9B\u4ECD\u662F\u63A8\u65AD\u6216\u672A\u77E5",
      factClaims: [{ text: "\u9010\u6761\u58F0\u660E", kind: "fact|inference|opinion", evidenceUrls: ["\u4EC5\u586B\u5199 sourceCard.evidence \u4E2D\u5DF2\u6709 URL"] }],
      variants: {
        wechat: { title: "5-64\u5B57", dek: "\u5BFC\u8BED", blocks: [{ type: "heading|paragraph|quote|list|image", text: "\u7ED3\u6784\u5316\u6B63\u6587\uFF1B\u56FE\u7247\u5757\u586B\u5199 assetId/caption" }] },
        telegram: { title: "\u6807\u9898", body: "\u5B8C\u6574\u6B63\u6587" },
        x: { posts: ["\u7EBF\u7A0B\u7B2C1\u6761", "\u7EBF\u7A0B\u7B2C2\u6761"] },
        xiaohongshu: { title: "\u4E0D\u8D85\u8FC730\u5B57", body: "\u5B8C\u6574\u6B63\u6587", hashtags: ["\u6807\u7B7E1", "\u6807\u7B7E2", "\u6807\u7B7E3"] }
      },
      assets: [
        { id: "cover-main", kind: "cover", prompt: "\u65E0\u5C0F\u5B57\u7684\u753B\u9762\u63D0\u793A\u8BCD", altText: "\u66FF\u4EE3\u6587\u672C", aspectRatio: "2.35:1", placement: "\u516C\u4F17\u53F7\u5C01\u9762", platforms: ["wechat"], order: 1, required: true, role: "wechat-cover" },
        { id: "inline-one", kind: "inline", prompt: "\u6B63\u6587\u914D\u56FE\u63D0\u793A\u8BCD", altText: "\u66FF\u4EE3\u6587\u672C", aspectRatio: "16:9", placement: "\u5FAE\u4FE1\u6B63\u6587\u4F4D\u7F6E", platforms: ["wechat"], order: 2, required: true, role: "wechat-inline" },
        { id: "xhs-cover", kind: "cover", prompt: "\u5C0F\u7EA2\u4E66\u9996\u56FE\u63D0\u793A\u8BCD", altText: "\u5C0F\u7EA2\u4E66\u9996\u56FE", aspectRatio: "3:4", placement: "\u5C0F\u7EA2\u4E66\u7B2C1\u5F20", platforms: ["xiaohongshu"], order: 1, required: true, role: "xhs-cover" },
        { id: "carousel-one", kind: "carousel", prompt: "\u5C0F\u7EA2\u4E66\u8F6E\u64AD\u63D0\u793A\u8BCD", altText: "\u66FF\u4EE3\u6587\u672C", aspectRatio: "3:4", placement: "\u5C0F\u7EA2\u4E66\u7B2C2\u5F20", platforms: ["xiaohongshu"], order: 2, required: true, role: "xhs-carousel" }
      ]
    }
  };
}
function createDraftRequest(db, card, revision, parentPackageId, parentReviewNote, now) {
  const fingerprint = createHash4("sha256").update(JSON.stringify({ version: CREATION_CONTRACT_VERSION, revision, card })).digest("hex").slice(0, 16);
  const at = now.toISOString();
  const id = "dp-" + createHash4("sha256").update(`${card.id}:${fingerprint}`).digest("hex").slice(0, 16);
  const request = creationRequest(id, revision, parentPackageId, parentReviewNote, card, at);
  db.exec("BEGIN IMMEDIATE");
  try {
    const job = createJob(db, {
      kind: "content.generate-package",
      input: { packageId: id, cardId: card.id, revision, contractVersion: CREATION_CONTRACT_VERSION },
      idempotencyKey: `content.generate-package:${id}`,
      priority: 30,
      now
    }).job;
    db.prepare(`
      INSERT INTO draft_packages(
        id, card_id, revision, parent_package_id, job_id, contract_version, input_fingerprint, status,
        request_json, validation_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'awaiting_generation', ?, ?, ?, ?)
    `).run(id, card.id, revision, parentPackageId, job.id, CREATION_CONTRACT_VERSION, fingerprint, JSON.stringify(request), JSON.stringify(emptyValidation()), at, at);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return packageById(db, id);
}
function ensureDraftRequest(db, cardId, now = /* @__PURE__ */ new Date()) {
  const card = editorialCardById(db, cardId);
  if (!card) throw new Error("\u9009\u9898\u5361\u4E0D\u5B58\u5728\uFF1A" + cardId);
  if (card.decision !== "approved") throw new Error("\u53EA\u6709\u5DF2\u6279\u51C6\u9009\u9898\u5361\u53EF\u4EE5\u8FDB\u5165\u521B\u4F5C\uFF1A" + cardId);
  const existing = db.prepare("SELECT * FROM draft_packages WHERE card_id = ? ORDER BY revision DESC LIMIT 1").get(cardId);
  if (existing) return { package: packageFromRow(db, existing), created: false };
  return { package: createDraftRequest(db, card, 1, null, null, now), created: true };
}
function reviseDraftRequest(db, rejectedPackageId, now = /* @__PURE__ */ new Date()) {
  const rejected = packageById(db, rejectedPackageId);
  if (!rejected) throw new Error("\u8349\u7A3F\u5305\u4E0D\u5B58\u5728\uFF1A" + rejectedPackageId);
  if (rejected.status !== "rejected") throw new Error("\u53EA\u6709\u5DF2\u9A73\u56DE\u8349\u7A3F\u5305\u53EF\u4EE5\u521B\u5EFA\u4FEE\u8BA2\u7248\uFF1A" + rejected.status);
  const existing = db.prepare("SELECT * FROM draft_packages WHERE parent_package_id = ? ORDER BY revision DESC LIMIT 1").get(rejectedPackageId);
  if (existing) return { package: packageFromRow(db, existing), created: false };
  const card = editorialCardById(db, rejected.cardId);
  if (!card || card.decision !== "approved") throw new Error("\u6765\u6E90\u9009\u9898\u5361\u672A\u6279\u51C6\u6216\u4E0D\u5B58\u5728");
  return { package: createDraftRequest(db, card, rejected.revision + 1, rejected.id, rejected.reviewNote, now), created: true };
}
function listDraftPackages(db, limit = 20) {
  const safe = Math.max(1, Math.min(100, Math.trunc(limit)));
  return db.prepare(`SELECT * FROM draft_packages ORDER BY created_at DESC LIMIT ${safe}`).all().map((row) => packageFromRow(db, row));
}
function listDraftPackageSummaries(db, limit = 20) {
  return listDraftPackages(db, limit).map((draftPackage) => ({
    id: draftPackage.id,
    cardId: draftPackage.cardId,
    revision: draftPackage.revision,
    parentPackageId: draftPackage.parentPackageId,
    status: draftPackage.status,
    title: draftPackage.request.sourceCard.title,
    validation: draftPackage.validation,
    assetCount: draftPackage.submission?.assets.length ?? 0,
    artifacts: draftPackage.artifacts,
    reviewNote: draftPackage.reviewNote,
    parentReviewNote: draftPackage.parentReviewNote,
    createdAt: draftPackage.createdAt,
    updatedAt: draftPackage.updatedAt,
    decidedAt: draftPackage.decidedAt
  }));
}
function pendingDraftRequests(db, limit = 10) {
  const safe = Math.max(1, Math.min(50, Math.trunc(limit)));
  return db.prepare(`
    SELECT * FROM draft_packages WHERE status IN ('awaiting_generation', 'validation_failed')
    ORDER BY created_at LIMIT ${safe}
  `).all().map((row) => JSON.parse(row.request_json));
}
function textOfBlocks(blocks) {
  return blocks.flatMap((block) => block.type === "list" ? Array.isArray(block.items) ? block.items.filter((item) => typeof item === "string") : [] : block.type === "image" ? [] : [typeof block.text === "string" ? block.text : ""]).join("\n");
}
function validateDraftSubmission(submission, card, contractVersion = CREATION_CONTRACT_VERSION) {
  const errors = [];
  const warnings = [];
  const knownEvidence = new Set(card.evidence.map((item) => item.url));
  if (submission.packageId === "") errors.push("packageId \u5FC5\u586B");
  if (!submission.editorialAngle?.trim()) errors.push("editorialAngle \u5FC5\u586B");
  if (!submission.keyMessage?.trim()) errors.push("keyMessage \u5FC5\u586B");
  if (!submission.factBoundary?.trim()) errors.push("factBoundary \u5FC5\u586B");
  const rawClaims = Array.isArray(submission.factClaims) ? submission.factClaims : [];
  const claims = rawClaims.filter((claim) => typeof claim === "object" && claim !== null);
  if (claims.length !== rawClaims.length) errors.push("factClaims \u542B\u975E\u5BF9\u8C61\u6761\u76EE");
  if (claims.length < 3) errors.push("factClaims \u81F3\u5C11 3 \u6761");
  for (const [index, claim] of claims.entries()) {
    if (!claim.text?.trim()) errors.push(`factClaims[${index}].text \u5FC5\u586B`);
    if (claim.kind !== "fact" && claim.kind !== "inference" && claim.kind !== "opinion") errors.push(`factClaims[${index}].kind \u4E0D\u5408\u6CD5`);
    const urls = Array.isArray(claim.evidenceUrls) ? claim.evidenceUrls : [];
    if (claim.kind === "fact" && urls.length === 0) errors.push(`factClaims[${index}] \u4E8B\u5B9E\u7F3A\u5C11\u8BC1\u636E URL`);
    for (const url of urls) {
      if (!isSafeExternalUrl(url)) errors.push(`factClaims[${index}] \u8BC1\u636E URL \u5FC5\u987B\u662F http/https \u7EDD\u5BF9\u5730\u5740\uFF1A${url}`);
      else if (!knownEvidence.has(url)) errors.push(`factClaims[${index}] \u4F7F\u7528\u4E86\u9009\u9898\u5361\u4E4B\u5916\u7684\u8BC1\u636E\uFF1A${url}`);
    }
  }
  const variants = submission.variants;
  const rawWechatBlocks = Array.isArray(variants?.wechat?.blocks) ? variants.wechat.blocks : [];
  const wechatBlocks = rawWechatBlocks.filter((block) => typeof block === "object" && block !== null);
  if (wechatBlocks.length !== rawWechatBlocks.length) errors.push("wechat.blocks \u542B\u975E\u5BF9\u8C61\u6761\u76EE");
  for (const [index, block] of wechatBlocks.entries()) {
    if (!["heading", "paragraph", "quote", "list", "image"].includes(block.type)) errors.push(`wechat.blocks[${index}].type \u4E0D\u5408\u6CD5`);
    if (block.type === "heading" && block.level !== 2 && block.level !== 3) errors.push(`wechat.blocks[${index}].level \u53EA\u5141\u8BB8 2/3`);
    if (block.type === "list" && (!Array.isArray(block.items) || block.items.length === 0 || block.items.some((item) => typeof item !== "string" || !item.trim()))) errors.push(`wechat.blocks[${index}].items \u4E0D\u5408\u6CD5`);
    if ((block.type === "heading" || block.type === "paragraph" || block.type === "quote") && !block.text?.trim()) errors.push(`wechat.blocks[${index}].text \u5FC5\u586B`);
    if (block.type === "image" && (!block.assetId?.trim() || !block.caption?.trim())) errors.push(`wechat.blocks[${index}] assetId/caption \u5FC5\u586B`);
  }
  const wechatChars = textOfBlocks(wechatBlocks).length;
  if (!variants?.wechat?.title?.trim() || variants.wechat.title.length > 64) errors.push("wechat.title \u5FC5\u586B\u4E14 \u226464 \u5B57");
  if (!variants?.wechat?.dek?.trim()) errors.push("wechat.dek \u5FC5\u586B");
  if (wechatBlocks.length < 6 || wechatChars < 600) errors.push("wechat.blocks \u81F3\u5C11 6 \u6BB5\u4E14\u6B63\u6587\u4E0D\u5C11\u4E8E 600 \u5B57");
  const telegramChars = variants?.telegram?.body?.length ?? 0;
  if (!variants?.telegram?.title?.trim() || telegramChars < 150) errors.push("telegram \u9700\u8981\u6807\u9898\u4E14\u6B63\u6587\u4E0D\u5C11\u4E8E 150 \u5B57");
  const rawPosts = Array.isArray(variants?.x?.posts) ? variants.x.posts : [];
  const posts = rawPosts.filter((post) => typeof post === "string");
  if (posts.length !== rawPosts.length) errors.push("x.posts \u542B\u975E\u5B57\u7B26\u4E32\u6761\u76EE");
  if (posts.length < 1 || posts.length > 12) errors.push("x.posts \u9700\u8981 1-12 \u6761");
  posts.forEach((post, index) => {
    if (!post.trim() || post.length > 280) errors.push(`x.posts[${index}] \u4E3A\u7A7A\u6216\u8D85\u8FC7 280 \u5B57`);
  });
  const xiaohongshuChars = variants?.xiaohongshu?.body?.length ?? 0;
  if (!variants?.xiaohongshu?.title?.trim() || variants.xiaohongshu.title.length > 30) errors.push("xiaohongshu.title \u5FC5\u586B\u4E14 \u226430 \u5B57");
  if (xiaohongshuChars < 250) errors.push("xiaohongshu.body \u4E0D\u5C11\u4E8E 250 \u5B57");
  if (!Array.isArray(variants?.xiaohongshu?.hashtags) || variants.xiaohongshu.hashtags.length < 3 || variants.xiaohongshu.hashtags.some((tag) => typeof tag !== "string" || !tag.trim())) errors.push("xiaohongshu.hashtags \u81F3\u5C11 3 \u4E2A\u6709\u6548\u6807\u7B7E");
  const rawAssets = Array.isArray(submission.assets) ? submission.assets : [];
  const assets = rawAssets.filter((asset) => typeof asset === "object" && asset !== null);
  if (assets.length !== rawAssets.length) errors.push("assets \u542B\u975E\u5BF9\u8C61\u6761\u76EE");
  const assetIds = /* @__PURE__ */ new Set();
  const platformOrders = /* @__PURE__ */ new Set();
  for (const [index, asset] of assets.entries()) {
    if (!/^[a-z0-9][a-z0-9._-]{2,48}$/i.test(asset.id ?? "")) errors.push(`assets[${index}].id \u4E0D\u5408\u6CD5`);
    if (assetIds.has(asset.id)) errors.push(`assets[${index}].id \u91CD\u590D`);
    assetIds.add(asset.id);
    if (!asset.prompt?.trim() || !asset.altText?.trim() || !asset.placement?.trim()) errors.push(`assets[${index}] prompt/altText/placement \u5FC5\u586B`);
    if (!["cover", "inline", "carousel"].includes(asset.kind)) errors.push(`assets[${index}].kind \u4E0D\u5408\u6CD5`);
    if (!["2.35:1", "16:9", "3:4", "1:1"].includes(asset.aspectRatio)) errors.push(`assets[${index}].aspectRatio \u4E0D\u5408\u6CD5`);
    if (contractVersion >= 2) {
      const platforms = Array.isArray(asset.platforms) ? asset.platforms : [];
      if (platforms.length === 0 || platforms.some((platform) => !["wechat", "telegram", "x", "xiaohongshu"].includes(platform))) {
        errors.push(`assets[${index}].platforms \u5FC5\u987B\u662F\u975E\u7A7A\u5408\u6CD5\u5E73\u53F0\u6570\u7EC4`);
      }
      if (!Number.isSafeInteger(asset.order) || Number(asset.order) < 1) errors.push(`assets[${index}].order \u5FC5\u987B\u662F\u6B63\u6574\u6570`);
      if (typeof asset.required !== "boolean") errors.push(`assets[${index}].required \u5FC5\u987B\u660E\u786E\u4E3A boolean`);
      if (!["wechat-cover", "wechat-inline", "xhs-cover", "xhs-carousel", "telegram-asset", "x-asset"].includes(asset.role ?? "")) {
        errors.push(`assets[${index}].role \u4E0D\u5408\u6CD5`);
      }
      for (const platform of platforms) {
        const key = `${platform}:${asset.order}`;
        if (platformOrders.has(key)) errors.push(`assets[${index}] \u5E73\u53F0/order \u91CD\u590D\uFF1A${key}`);
        platformOrders.add(key);
      }
      const allowedRatios = {
        "wechat-cover": ["2.35:1"],
        "wechat-inline": ["16:9"],
        "xhs-cover": ["3:4"],
        "xhs-carousel": ["3:4", "1:1"],
        "telegram-asset": ["16:9", "1:1"],
        "x-asset": ["16:9", "1:1"]
      };
      if (asset.role && !allowedRatios[asset.role]?.includes(asset.aspectRatio)) errors.push(`assets[${index}] \u6BD4\u4F8B\u4E0E role \u4E0D\u5339\u914D`);
      const expectedPlatform = asset.role?.startsWith("wechat-") ? "wechat" : asset.role?.startsWith("xhs-") ? "xiaohongshu" : asset.role === "telegram-asset" ? "telegram" : asset.role === "x-asset" ? "x" : null;
      if (expectedPlatform && !platforms.includes(expectedPlatform)) errors.push(`assets[${index}] role \u5FC5\u987B\u58F0\u660E\u5E73\u53F0 ${expectedPlatform}`);
    }
  }
  if (!assets.some((asset) => asset.kind === "cover")) errors.push("assets \u81F3\u5C11\u5305\u542B 1 \u5F20\u5C01\u9762\u56FE");
  if (assets.filter((asset) => asset.kind === "inline" || asset.kind === "carousel").length < 2) errors.push("assets \u81F3\u5C11\u5305\u542B 2 \u5F20\u6B63\u6587/\u8F6E\u64AD\u914D\u56FE");
  for (const block of wechatBlocks) if (block.type === "image" && !assetIds.has(block.assetId)) errors.push(`wechat image \u5F15\u7528\u4E86\u672A\u77E5 assetId\uFF1A${block.assetId}`);
  if (contractVersion >= 2) {
    const required = (role, predicate = () => true) => assets.some((asset) => asset.role === role && asset.required === true && predicate(asset));
    if (!required("wechat-cover")) errors.push("contract v2 \u5FAE\u4FE1\u81F3\u5C11\u9700\u8981 required wechat-cover");
    if (!required("wechat-inline")) errors.push("contract v2 \u5FAE\u4FE1\u81F3\u5C11\u9700\u8981 required wechat-inline");
    if (!required("xhs-cover", (asset) => asset.order === 1)) errors.push("contract v2 \u5C0F\u7EA2\u4E66\u9700\u8981 required xhs-cover(order=1)");
    if (!required("xhs-carousel", (asset) => Number(asset.order) >= 2)) errors.push("contract v2 \u5C0F\u7EA2\u4E66\u9700\u8981 required xhs-carousel(order\u22652)");
    const references = [...(variants?.xiaohongshu?.body ?? "").matchAll(/(?:asset:\/\/|\{\{asset:)([a-z0-9][a-z0-9._-]{2,48})/gi)].map((match) => match[1]);
    for (const assetId of references) if (!assetIds.has(assetId)) errors.push(`xiaohongshu \u6B63\u6587\u5F15\u7528\u4E86\u672A\u77E5 assetId\uFF1A${assetId}`);
  }
  if (!wechatBlocks.some((block) => block.type === "image")) warnings.push("\u5FAE\u4FE1\u516C\u4F17\u53F7\u6B63\u6587\u6CA1\u6709\u56FE\u7247\u5360\u4F4D\u5757");
  const allText = JSON.stringify(submission);
  if (/自动发布|无需人工审核|绕过审核/.test(allText)) errors.push("\u8349\u7A3F\u89E6\u53D1\u4EBA\u5DE5\u53D1\u5E03\u7EA2\u7EBF");
  if (card.risks.length > 0 && !card.risks.some((risk) => allText.includes(risk))) warnings.push("\u9009\u9898\u98CE\u9669\u672A\u9010\u5B57\u51FA\u73B0\u5728\u8349\u7A3F\u4E2D\uFF0C\u8BF7\u4EBA\u5DE5\u91CD\u70B9\u590D\u6838");
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    stats: { wechatChars, telegramChars, xPosts: posts.length, xiaohongshuChars, assets: assets.length, facts: claims.length }
  };
}
function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
function wechatHtml(submission) {
  const block = (item) => {
    if (item.type === "heading") return `<h${item.level}>${escapeHtml(item.text)}</h${item.level}>`;
    if (item.type === "paragraph") return `<p>${escapeHtml(item.text).replaceAll("\n", "<br>")}</p>`;
    if (item.type === "quote") return `<blockquote>${escapeHtml(item.text)}${item.sourceUrl ? `<small>${escapeHtml(item.sourceUrl)}</small>` : ""}</blockquote>`;
    if (item.type === "list") return `<ul>${item.items.map((value) => `<li>${escapeHtml(value)}</li>`).join("")}</ul>`;
    const asset = submission.assets.find((value) => value.id === item.assetId);
    return `<figure data-asset-id="${escapeHtml(item.assetId)}"><div class="image-slot">\u914D\u56FE\uFF1A${escapeHtml(asset?.altText ?? item.assetId)}</div><figcaption>${escapeHtml(item.caption)}</figcaption></figure>`;
  };
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(submission.variants.wechat.title)}</title><style>body{margin:0;background:#f5f2ec;color:#2f2a24;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}.article{max-width:720px;margin:0 auto;background:#fff;padding:36px 28px 64px}h1{font-size:28px;line-height:1.35;margin:0 0 12px}h2{font-size:21px;margin:34px 0 12px;border-left:4px solid #e8563d;padding-left:10px}h3{font-size:18px;margin:26px 0 10px}.dek{color:#766b5d;font-size:15px;border-bottom:1px solid #e8dcc8;padding-bottom:22px}p,li{font-size:16px;line-height:1.9}blockquote{margin:22px 0;padding:14px 18px;background:#fff8ef;border-left:3px solid #f5a95c;color:#5f5548}blockquote small{display:block;margin-top:8px;color:#8a7b63}.image-slot{min-height:220px;border:1px dashed #b5a78e;background:#fff8ef;display:flex;align-items:center;justify-content:center;color:#8a7b63;padding:20px;text-align:center}figure{margin:26px 0}figcaption{font-size:12px;color:#8a7b63;text-align:center;margin-top:6px}.boundary{margin-top:36px;padding:14px;background:#f5f2ec;font-size:13px;line-height:1.7;color:#766b5d}</style></head><body><article class="article"><h1>${escapeHtml(submission.variants.wechat.title)}</h1><div class="dek">${escapeHtml(submission.variants.wechat.dek)}</div>${submission.variants.wechat.blocks.map(block).join("")}<div class="boundary"><b>\u4E8B\u5B9E\u8FB9\u754C\uFF1A</b>${escapeHtml(submission.factBoundary)}</div></article></body></html>`;
}
function wechatMarkdown(submission) {
  const lines = [`# ${submission.variants.wechat.title}`, "", `> ${submission.variants.wechat.dek}`, ""];
  for (const item of submission.variants.wechat.blocks) {
    if (item.type === "heading") lines.push(`${"#".repeat(item.level)} ${item.text}`, "");
    else if (item.type === "paragraph") lines.push(item.text, "");
    else if (item.type === "quote") lines.push(`> ${item.text}${item.sourceUrl ? `\uFF08${item.sourceUrl}\uFF09` : ""}`, "");
    else if (item.type === "list") lines.push(...item.items.map((value) => `- ${value}`), "");
    else lines.push(`![${item.caption}](asset://${item.assetId})`, "");
  }
  lines.push("---", `\u4E8B\u5B9E\u8FB9\u754C\uFF1A${submission.factBoundary}`);
  return lines.join("\n") + "\n";
}
function artifactContents(submission) {
  return {
    "wechat.html": { platform: "wechat", format: "html", content: wechatHtml(submission) },
    "wechat.md": { platform: "wechat", format: "markdown", content: wechatMarkdown(submission) },
    "telegram.md": { platform: "telegram", format: "markdown", content: `# ${submission.variants.telegram.title}

${submission.variants.telegram.body}
` },
    "x-thread.md": { platform: "x", format: "markdown", content: submission.variants.x.posts.map((post, index) => `${index + 1}/${submission.variants.x.posts.length} ${post}`).join("\n\n---\n\n") + "\n" },
    "xiaohongshu.md": { platform: "xiaohongshu", format: "markdown", content: `# ${submission.variants.xiaohongshu.title}

${submission.variants.xiaohongshu.body}

${submission.variants.xiaohongshu.hashtags.map((tag) => tag.startsWith("#") ? tag : "#" + tag).join(" ")}
` },
    "assets.json": { platform: "shared", format: "json", content: JSON.stringify(submission.assets, null, 2) + "\n" },
    "package.json": { platform: "shared", format: "json", content: JSON.stringify(submission, null, 2) + "\n" }
  };
}
function sha256(content) {
  return createHash4("sha256").update(content).digest("hex");
}
function writeArtifacts(packageId, submission, now, folderDate) {
  const date = folderDate.slice(0, 10);
  const relativeDir = path10.join("drafts", "factory", date, packageId);
  const target = path10.join(VAULT_ROOT, relativeDir);
  const contents = artifactContents(submission);
  let created = false;
  if (existsSync9(target)) {
    verifyArtifactDir(target, relativeDir, packageId, contents);
  } else {
    created = true;
    const parent = path10.dirname(target);
    mkdirSync7(parent, { recursive: true });
    const staging = path10.join(parent, "." + packageId + "-" + randomUUID3() + ".tmp");
    mkdirSync7(staging, { recursive: true });
    try {
      for (const [file, spec] of Object.entries(contents)) writeFileSync6(path10.join(staging, file), spec.content, "utf8");
      const manifest = Object.entries(contents).map(([file, spec]) => ({ file, platform: spec.platform, format: spec.format, sha256: sha256(spec.content), bytes: Buffer.byteLength(spec.content) }));
      writeFileSync6(path10.join(staging, "manifest.json"), JSON.stringify({ packageId, generatedAt: now.toISOString(), artifacts: manifest }, null, 2) + "\n", "utf8");
      renameSync(staging, target);
    } catch (error) {
      rmSync3(staging, { recursive: true, force: true });
      throw error;
    }
  }
  const all = { ...contents, "manifest.json": { platform: "shared", format: "json", content: readFileSync10(path10.join(target, "manifest.json"), "utf8") } };
  const artifacts = Object.entries(all).map(([file, spec]) => ({
    id: randomUUID3(),
    platform: spec.platform,
    format: spec.format,
    relativePath: path10.join(relativeDir, file),
    sha256: sha256(spec.content),
    bytes: Buffer.byteLength(spec.content)
  }));
  return { dir: relativeDir, artifacts, created };
}
function verifyArtifactDir(target, relativeDir, packageId, contents) {
  const fail = (reason) => {
    throw new Error("\u8349\u7A3F\u4EA7\u7269\u76EE\u5F55\u5B8C\u6574\u6027\u6821\u9A8C\u5931\u8D25\uFF08" + reason + "\uFF09\uFF0C\u62D2\u7EDD\u590D\u7528\uFF1A" + relativeDir);
  };
  const rootReal = realpathSync(VAULT_ROOT);
  const targetReal = realpathSync(target);
  if (targetReal !== realpathSync(path10.resolve(VAULT_ROOT, relativeDir)) || !targetReal.startsWith(rootReal + path10.sep)) fail("\u76EE\u5F55 realpath \u8D8A\u754C");
  if (lstatSync(target).isSymbolicLink()) fail("\u76EE\u5F55\u662F symlink");
  const present = readdirSync9(target);
  const expectedFiles = [...Object.keys(contents), "manifest.json"];
  const extra = present.filter((file) => !expectedFiles.includes(file));
  if (extra.length > 0) fail("\u5B58\u5728\u672A\u58F0\u660E\u6587\u4EF6\uFF1A" + extra.join(", "));
  const missing = expectedFiles.filter((file) => !present.includes(file));
  if (missing.length > 0) fail("\u7F3A\u5931\u6587\u4EF6\uFF1A" + missing.join(", "));
  for (const file of expectedFiles) {
    const info = lstatSync(path10.join(target, file));
    if (!info.isFile() || info.isSymbolicLink()) fail("\u4EA7\u7269\u4E0D\u662F\u666E\u901A\u6587\u4EF6\uFF1A" + file);
  }
  const manifest = (() => {
    try {
      return JSON.parse(readFileSync10(path10.join(target, "manifest.json"), "utf8"));
    } catch {
      return fail("manifest.json \u4E0D\u53EF\u89E3\u6790");
    }
  })();
  if (manifest.packageId !== packageId) fail("manifest packageId \u4E0D\u5339\u914D");
  const declared = Array.isArray(manifest.artifacts) ? manifest.artifacts : [];
  const declaredFiles = declared.map((item) => String(item.file));
  const contentFiles = Object.keys(contents);
  if (declaredFiles.length !== contentFiles.length || contentFiles.some((file, index) => declaredFiles[index] !== file)) fail("manifest \u672A\u5B8C\u6574\u8986\u76D6 7 \u4E2A\u4EA7\u7269\u6587\u4EF6");
  for (const item of declared) {
    const file = String(item.file);
    const info = lstatSync(path10.join(target, file));
    if (!info.isFile() || info.isSymbolicLink()) fail("\u4EA7\u7269\u4E0D\u662F\u666E\u901A\u6587\u4EF6\uFF1A" + file);
    const data = readFileSync10(path10.join(target, file));
    if (String(item.bytes) !== String(data.byteLength)) fail("manifest bytes \u4E0D\u5339\u914D\uFF1A" + file);
    if (item.sha256 !== sha256(data)) fail("manifest SHA \u4E0D\u5339\u914D\uFF1A" + file);
  }
  for (const [file, spec] of Object.entries(contents)) {
    const data = readFileSync10(path10.join(target, file));
    if (sha256(data) !== sha256(spec.content) || data.byteLength !== Buffer.byteLength(spec.content)) fail("\u5185\u5BB9\u4E0E\u672C\u6B21\u63D0\u4EA4\u4E0D\u4E00\u81F4\uFF1A" + file);
  }
}
function submitDraftPackage(db, submission, now = /* @__PURE__ */ new Date()) {
  const current = packageById(db, submission.packageId);
  if (!current) throw new Error("\u8349\u7A3F\u5305\u4E0D\u5B58\u5728\uFF1A" + submission.packageId);
  if (current.status !== "awaiting_generation" && current.status !== "validation_failed") throw new Error("\u8349\u7A3F\u5305\u5F53\u524D\u72B6\u6001\u4E0D\u53EF\u63D0\u4EA4\uFF1A" + current.status);
  const card = editorialCardById(db, current.cardId);
  if (!card || card.decision !== "approved") throw new Error("\u6765\u6E90\u9009\u9898\u5361\u672A\u6279\u51C6\u6216\u4E0D\u5B58\u5728");
  const validation = validateDraftSubmission(submission, card, current.contractVersion);
  const at = now.toISOString();
  if (!validation.ok) {
    db.prepare(`UPDATE draft_packages SET status='validation_failed', submission_json=?, validation_json=?, updated_at=? WHERE id=?`).run(JSON.stringify(submission), JSON.stringify(validation), at, current.id);
    return { package: packageById(db, current.id), validation };
  }
  let job = getJob(db, current.jobId);
  if (!job) throw new Error("\u8349\u7A3F\u751F\u6210\u4EFB\u52A1\u4E0D\u5B58\u5728\uFF1A" + current.jobId);
  if (job.status === "failed") job = transitionJob(db, job.id, "queued", { note: "valid resubmission retry", now });
  if (job.status === "queued") job = startJob(db, job.id, "sparkos-content-inline", now);
  if (job.status !== "running") throw new Error("\u8349\u7A3F\u751F\u6210\u4EFB\u52A1\u5F53\u524D\u72B6\u6001\u4E0D\u53EF\u63D0\u4EA4\uFF1A" + job.status);
  let createdDirThisCall = null;
  let dbCommitted = false;
  try {
    const written = writeArtifacts(current.id, submission, now, current.createdAt);
    if (written.created) createdDirThisCall = written.dir;
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(`
        UPDATE draft_packages SET status='waiting_approval', submission_json=?, validation_json=?, artifact_dir=?, updated_at=? WHERE id=?
      `).run(JSON.stringify(submission), JSON.stringify(validation), written.dir, at, current.id);
      db.prepare("DELETE FROM draft_artifacts WHERE package_id = ?").run(current.id);
      const insert = db.prepare(`
        INSERT INTO draft_artifacts(id, package_id, platform, format, relative_path, sha256, bytes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const artifact of written.artifacts) insert.run(artifact.id, current.id, artifact.platform, artifact.format, artifact.relativePath, artifact.sha256, artifact.bytes, at);
      db.prepare(`
        INSERT INTO approvals(id, subject_kind, subject_id, decision, created_at)
        VALUES (?, 'draft_package', ?, 'pending', ?)
        ON CONFLICT(subject_kind, subject_id) DO UPDATE SET decision='pending', note=NULL, decided_at=NULL
      `).run(randomUUID3(), current.id, at);
      db.exec("COMMIT");
      dbCommitted = true;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    transitionJob(db, job.id, "waiting_approval", { output: { packageId: current.id, artifacts: written.artifacts.length }, now });
  } catch (error) {
    if (createdDirThisCall !== null && !dbCommitted) {
      const absoluteDir = path10.join(VAULT_ROOT, createdDirThisCall);
      rmSync3(absoluteDir, { recursive: true, force: true });
    }
    transitionJob(db, job.id, "failed", { error: error instanceof Error ? error.message : String(error), now });
    db.prepare(`UPDATE draft_packages SET status='validation_failed', validation_json=?, updated_at=? WHERE id=?`).run(JSON.stringify({ ...validation, ok: false, errors: [...validation.errors, "artifact-write: " + (error instanceof Error ? error.message : String(error))] }), at, current.id);
    throw error;
  }
  return { package: packageById(db, current.id), validation };
}
function decideDraftPackage(db, packageId, decision, note, now = /* @__PURE__ */ new Date()) {
  if (!/^dp-[a-f0-9]{16}$/.test(packageId)) throw new Error("\u8349\u7A3F\u5305 id \u4E0D\u5408\u6CD5");
  const current = packageById(db, packageId);
  if (!current) throw new Error("\u8349\u7A3F\u5305\u4E0D\u5B58\u5728\uFF1A" + packageId);
  if (current.status !== "waiting_approval") throw new Error("\u8349\u7A3F\u5305\u4E0D\u5728\u5F85\u5BA1\u72B6\u6001\uFF1A" + current.status);
  const normalizedNote = note?.trim() || null;
  if (decision === "rejected" && normalizedNote === null) throw new Error("\u9A73\u56DE\u8349\u7A3F\u5FC5\u987B\u586B\u5199\u5BA1\u6838\u610F\u89C1");
  const at = now.toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE draft_packages SET status=?, decided_at=?, updated_at=? WHERE id=?").run(decision, at, at, packageId);
    db.prepare(`UPDATE approvals SET decision=?, note=?, decided_at=? WHERE subject_kind='draft_package' AND subject_id=?`).run(decision, normalizedNote, at, packageId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  const job = getJob(db, current.jobId);
  if (job?.status === "waiting_approval") transitionJob(db, job.id, decision === "approved" ? "succeeded" : "cancelled", { note: `draft package ${decision}`, now });
  return packageById(db, packageId);
}
function readDraftArtifact(db, packageId, file) {
  if (!/^dp-[a-f0-9]{16}$/.test(packageId) || !/^[a-z0-9][a-z0-9._-]{1,80}$/i.test(file)) return null;
  const rows = db.prepare(`
    SELECT platform, format, relative_path, sha256, bytes FROM draft_artifacts WHERE package_id = ?
  `).all(packageId);
  const row = rows.find((item) => path10.basename(item.relative_path) === file);
  if (!row) return null;
  const root = path10.resolve(VAULT_ROOT);
  const absolute = path10.resolve(VAULT_ROOT, row.relative_path);
  if (!absolute.startsWith(root + path10.sep)) return null;
  let info;
  let real;
  let data;
  try {
    info = lstatSync(absolute);
    real = realpathSync(absolute);
    data = readFileSync10(absolute);
  } catch {
    throw new Error("draft-artifact-integrity: \u4EA7\u7269\u6587\u4EF6\u4E0D\u53EF\u8BFB\uFF1A" + row.relative_path);
  }
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("draft-artifact-integrity: \u4EA7\u7269\u5FC5\u987B\u662F\u666E\u901A\u6587\u4EF6\uFF08\u62D2\u7EDD symlink\uFF09\uFF1A" + row.relative_path);
  const rootReal = realpathSync(root);
  if (real !== realpathSync(absolute) || !real.startsWith(rootReal + path10.sep)) throw new Error("draft-artifact-integrity: \u4EA7\u7269 realpath \u8D8A\u754C\uFF1A" + row.relative_path);
  if (data.byteLength !== Number(row.bytes)) throw new Error("draft-artifact-integrity: \u4EA7\u7269\u5927\u5C0F\u4E0E\u6570\u636E\u5E93\u8BB0\u5F55\u4E0D\u4E00\u81F4\uFF1A" + row.relative_path);
  if (sha256(data) !== row.sha256) throw new Error("draft-artifact-integrity: \u4EA7\u7269 SHA-256 \u4E0E\u6570\u636E\u5E93\u8BB0\u5F55\u4E0D\u4E00\u81F4\uFF1A" + row.relative_path);
  return { content: data, format: row.format, platform: row.platform };
}
var CREATION_CONTRACT_VERSION;
var init_drafts = __esm({
  "src/creation/drafts.ts"() {
    "use strict";
    init_planner();
    init_vault();
    init_jobs();
    init_security();
    CREATION_CONTRACT_VERSION = 2;
  }
});

// src/visual/errors.ts
var VisualPipelineError;
var init_errors = __esm({
  "src/visual/errors.ts"() {
    "use strict";
    VisualPipelineError = class extends Error {
      code;
      httpStatus;
      constructor(code, message, httpStatus = 422, options) {
        super(message, options);
        this.name = "VisualPipelineError";
        this.code = code;
        this.httpStatus = httpStatus;
      }
    };
  }
});

// src/visual/review.ts
var review_exports = {};
__export(review_exports, {
  attemptApproval: () => attemptApproval,
  createPublishTask: () => createPublishTask,
  decideVisualAttempt: () => decideVisualAttempt,
  latestPublishTask: () => latestPublishTask,
  latestRetryRequestForTask: () => latestRetryRequestForTask,
  logicalTaskState: () => logicalTaskState,
  markRetryRequestClaimed: () => markRetryRequestClaimed,
  publicationReadiness: () => publicationReadiness,
  requestVisualRetry: () => requestVisualRetry,
  retryVisualTask: () => retryVisualTask,
  visualRetryEligibility: () => visualRetryEligibility,
  visualReviewAggregate: () => visualReviewAggregate
});
import { randomUUID as randomUUID4 } from "node:crypto";
function parseJsonObject(value) {
  if (value === null) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
function attemptApproval(db, attemptId) {
  const row = db.prepare(`
    SELECT decision, note, decided_at FROM approvals
    WHERE subject_kind='visual_attempt' AND subject_id=?
  `).get(attemptId);
  return row ? { decision: row.decision, note: row.note, decidedAt: row.decided_at } : { decision: "pending", note: null, decidedAt: null };
}
function requiredAssetIds(db, packageId) {
  const row = db.prepare("SELECT contract_version, submission_json FROM draft_packages WHERE id=?").get(packageId);
  const submission = parseJsonObject(row?.submission_json ?? null);
  const rawAssets = Array.isArray(submission?.assets) ? submission.assets : [];
  const ids = rawAssets.flatMap((raw) => {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return [];
    const asset = raw;
    if (typeof asset.id !== "string") return [];
    return Number(row?.contract_version ?? 1) >= 2 && asset.required === false ? [] : [asset.id];
  });
  return new Set(ids);
}
function visualReviewAggregate(db, batchId) {
  const batch = db.prepare("SELECT package_id, status, required_count FROM visual_batches WHERE id=?").get(batchId);
  if (!batch) throw new VisualPipelineError("not-found", "\u89C6\u89C9\u6279\u6B21\u4E0D\u5B58\u5728", 404);
  const required = requiredAssetIds(db, batch.package_id);
  const rows = db.prepare(`
    SELECT t.asset_id, t.state, t.current_attempt, a.id AS attempt_id, a.provider, a.imported_relative_path,
           p.decision
    FROM visual_asset_tasks t
    LEFT JOIN visual_asset_attempts a ON a.task_id=t.id AND a.attempt_no=t.current_attempt
    LEFT JOIN approvals p ON p.subject_kind='visual_attempt' AND p.subject_id=a.id
    WHERE t.batch_id=? ORDER BY t.asset_id
  `).all(batchId);
  const requiredRows = required.size === 0 ? rows : rows.filter((row) => required.has(row.asset_id));
  const approvedCount = requiredRows.filter((row) => row.state === "waiting_visual_approval" && row.decision === "approved").length;
  const rejectedCount = requiredRows.filter((row) => row.state === "waiting_visual_approval" && row.decision === "rejected").length;
  const visualApproved = requiredRows.length > 0 && approvedCount === requiredRows.length;
  const testOnly = rows.some((row) => row.imported_relative_path !== null && row.provider === "stub");
  let status;
  if (visualApproved) status = testOnly ? "visual_approved_test" : "visual_approved";
  else if (rejectedCount > 0) status = "rejected";
  else if (approvedCount > 0) status = "partially_approved";
  else status = batch.status;
  return {
    status,
    approvedCount,
    requiredCount: requiredRows.length || Number(batch.required_count),
    rejectedCount,
    visualApproved,
    testOnly
  };
}
function refreshStoredBatch(db, batchId, at) {
  const aggregate = visualReviewAggregate(db, batchId);
  const storedStatus = aggregate.visualApproved ? "approved" : aggregate.rejectedCount > 0 ? "rejected" : aggregate.approvedCount > 0 ? "waiting_visual_approval" : null;
  if (storedStatus !== null) {
    db.prepare("UPDATE visual_batches SET status=?, approved_count=?, updated_at=? WHERE id=?").run(storedStatus, aggregate.approvedCount, at, batchId);
  } else {
    db.prepare("UPDATE visual_batches SET approved_count=?, updated_at=? WHERE id=?").run(aggregate.approvedCount, at, batchId);
  }
  return { ...aggregate, status: aggregate.visualApproved ? aggregate.testOnly ? "visual_approved_test" : "visual_approved" : aggregate.status };
}
function decideVisualAttempt(db, input, now = /* @__PURE__ */ new Date()) {
  if (!ATTEMPT_ID.test(input.attemptId) || input.decision !== "approved" && input.decision !== "rejected") {
    throw new VisualPipelineError("bad-request", "attemptId \u6216 decision \u4E0D\u5408\u6CD5", 400);
  }
  const note = input.note?.trim() || null;
  if (note !== null && note.length > 2e3) throw new VisualPipelineError("bad-request", "note \u4E0D\u5F97\u8D85\u8FC7 2000 \u5B57", 400);
  if (input.decision === "rejected" && note === null) throw new VisualPipelineError("review-note-required", "\u9A73\u56DE\u56FE\u7247\u5FC5\u987B\u586B\u5199\u5BA1\u6838\u610F\u89C1", 400);
  const joined = db.prepare(`
    SELECT t.*, a.id AS attempt_id, a.task_id AS attempt_task_id, a.attempt_no, a.status AS attempt_status,
           a.provider, a.imported_relative_path
    FROM visual_asset_attempts a JOIN visual_asset_tasks t ON t.id=a.task_id WHERE a.id=?
  `).get(input.attemptId);
  if (!joined) throw new VisualPipelineError("not-found", "\u89C6\u89C9 attempt \u4E0D\u5B58\u5728", 404);
  if (Number(joined.current_attempt) !== Number(joined.attempt_no)) throw new VisualPipelineError("not-current-attempt", "\u53EA\u80FD\u5BA1\u6838\u4EFB\u52A1\u7684\u5F53\u524D attempt", 409);
  const existing = attemptApproval(db, input.attemptId);
  if (existing.decision !== "pending") {
    if (existing.decision !== input.decision) throw new VisualPipelineError("decision-conflict", "\u8BE5 attempt \u5DF2\u6709\u4E0D\u540C\u5BA1\u6838\u51B3\u5B9A\uFF0C\u62D2\u7EDD\u8986\u76D6", 409);
    const aggregate = visualReviewAggregate(db, joined.batch_id);
    return {
      taskId: joined.id,
      attemptId: joined.attempt_id,
      decision: input.decision,
      note: existing.note,
      idempotent: true,
      taskState: input.decision,
      batchStatus: aggregate.status,
      approvedCount: aggregate.approvedCount,
      requiredCount: aggregate.requiredCount
    };
  }
  if (joined.state !== "waiting_visual_approval" || joined.attempt_status !== "waiting_visual_approval" || joined.imported_relative_path === null) {
    throw new VisualPipelineError("invalid-state", "\u89C6\u89C9\u4EFB\u52A1\u4E0D\u5728 waiting_visual_approval", 409);
  }
  const at = now.toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      INSERT INTO approvals(id, subject_kind, subject_id, decision, note, created_at, decided_at)
      VALUES (?, 'visual_attempt', ?, ?, ?, ?, ?)
      ON CONFLICT(subject_kind, subject_id) DO UPDATE SET
        decision=excluded.decision, note=excluded.note, decided_at=excluded.decided_at
      WHERE approvals.decision='pending'
    `).run(randomUUID4(), input.attemptId, input.decision, note, at, at);
    const stored = attemptApproval(db, input.attemptId);
    if (stored.decision !== input.decision) throw new VisualPipelineError("decision-conflict", "\u5BA1\u6838\u51B3\u5B9A\u53D1\u751F\u5E76\u53D1\u51B2\u7A81", 409);
    db.prepare(`
      INSERT INTO visual_asset_events(task_id, attempt_id, from_state, to_state, reason, created_at)
      VALUES (?, ?, 'waiting_visual_approval', ?, ?, ?)
    `).run(joined.id, joined.attempt_id, input.decision, note ?? `human visual ${input.decision}`, at);
    const aggregate = refreshStoredBatch(db, joined.batch_id, at);
    db.exec("COMMIT");
    return {
      taskId: joined.id,
      attemptId: joined.attempt_id,
      decision: input.decision,
      note,
      idempotent: false,
      taskState: input.decision,
      batchStatus: aggregate.status,
      approvedCount: aggregate.approvedCount,
      requiredCount: aggregate.requiredCount
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
function retryVisualTask(db, taskId, now = /* @__PURE__ */ new Date()) {
  if (!TASK_ID.test(taskId)) throw new VisualPipelineError("bad-request", "taskId \u4E0D\u5408\u6CD5", 400);
  const row = retryJoin(db, taskId);
  if (!row || row.attempt_id === null) throw new VisualPipelineError("not-found", "\u89C6\u89C9\u4EFB\u52A1\u6216\u5F53\u524D attempt \u4E0D\u5B58\u5728", 404);
  const result = requestVisualRetry(db, {
    packageId: row.package_id,
    taskId,
    currentAttemptId: row.attempt_id,
    assetId: row.asset_id,
    idempotencyKey: "auto:" + taskId + ":" + row.attempt_id
  }, now);
  return { taskId, previousAttemptId: row.attempt_id, state: "retry", previousNote: result.previousNote };
}
function retryJoin(db, taskId) {
  return db.prepare(`
    SELECT t.*, a.id AS attempt_id, a.status AS attempt_status, a.attempt_no, a.provider AS attempt_provider,
           p.decision, p.note AS review_note, p.decided_at
    FROM visual_asset_tasks t
    LEFT JOIN visual_asset_attempts a ON a.task_id=t.id AND a.attempt_no=t.current_attempt
    LEFT JOIN approvals p ON p.subject_kind='visual_attempt' AND p.subject_id=a.id
    WHERE t.id=?
  `).get(taskId);
}
function visualRetryEligibility(db, taskId, purpose = "reject_rerun") {
  const row = retryJoin(db, taskId);
  if (!row || row.attempt_id === null) {
    return { eligible: false, reason: "\u6CA1\u6709\u5F53\u524D attempt", code: "no-current-attempt", expectedNextAttemptNo: null };
  }
  const expectedNextAttemptNo = Number(row.current_attempt) + 1;
  const refused = (code, reason) => ({ eligible: false, reason, code, expectedNextAttemptNo });
  if (row.decision === "approved") return refused("approved-cannot-retry", "\u5DF2\u6279\u51C6\u7684\u4EFB\u52A1\u4E0D\u80FD\u91CD\u8BD5");
  if (row.decision === null || row.decision === "pending") {
    if (row.state !== "failed") return refused("invalid-state", "\u53EA\u6709\u88AB\u9A73\u56DE\u7684\u5F53\u524D attempt \u53EF\u4EE5\u91CD\u8BD5");
    const failureNote = row.last_error?.trim() ?? "";
    if (!failureNote) return refused("retry-note-required", "\u5931\u8D25\u610F\u89C1\u4E3A\u7A7A\uFF0C\u4E0D\u80FD\u91CD\u8BD5");
    return { eligible: true, reason: null, code: null, expectedNextAttemptNo };
  }
  if (row.decision === "rejected") {
    if (row.state !== "waiting_visual_approval" || row.attempt_status !== "waiting_visual_approval") {
      return refused("invalid-state", "\u4EFB\u52A1\u72B6\u6001\u5DF2\u53D8\u5316\uFF0C\u4E0D\u80FD\u91CD\u8BD5");
    }
    const note = row.review_note?.trim() ?? "";
    if (!note) return refused("retry-note-required", "\u9A73\u56DE\u610F\u89C1\u4E3A\u7A7A\uFF0C\u4E0D\u80FD\u91CD\u8BD5");
    if (row.attempt_provider === "stub" && purpose !== "replace_stub_with_production") return refused("stub-cannot-retry", "\u6D4B\u8BD5\u56FE\u7247\u4E0D\u80FD\u91CD\u8BD5\uFF08\u4EBA\u5DE5\u786E\u8BA4\u66FF\u6362\u8BF7\u7528 replace_stub_with_production\uFF09");
    if (Number(row.current_attempt) >= Number(row.max_attempts)) return refused("max-attempts-reached", "\u5DF2\u8FBE\u5230\u6700\u5927\u91CD\u8BD5\u6B21\u6570");
    return { eligible: true, reason: null, code: null, expectedNextAttemptNo };
  }
  return refused("invalid-state", "\u53EA\u6709\u88AB\u9A73\u56DE\u7684\u5F53\u524D attempt \u53EF\u4EE5\u91CD\u8BD5");
}
function validateSupplementary(value) {
  if (value === void 0 || value === null) return null;
  if (typeof value !== "string") throw new VisualPipelineError("bad-request", "supplementaryInstruction \u5FC5\u987B\u662F\u5B57\u7B26\u4E32", 400);
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_SUPPLEMENTARY_CHARS) {
    throw new VisualPipelineError("supplementary-too-long", `\u8865\u5145\u8981\u6C42\u4E0D\u80FD\u8D85\u8FC7 ${MAX_SUPPLEMENTARY_CHARS} \u5B57`, 413);
  }
  const forbidden = [
    [/^(?:[a-z]:[\\/]|\/)/i, "\u672C\u5730\u8DEF\u5F84"],
    [/^(?:https?|file):\/\//i, "URL"],
    [/sha256:[a-f0-9]{64}/i, "\u9644\u4EF6 ID"],
    [/attachment\s*id/i, "\u9644\u4EF6 ID"],
    [/(?:api[_-]?key|secret|access[_-]?token|bearer)\s*[:=]/i, "Provider \u5BC6\u94A5"]
  ];
  for (const [pattern, label] of forbidden) {
    if (pattern.test(trimmed)) throw new VisualPipelineError("supplementary-forbidden", `\u8865\u5145\u8981\u6C42\u4E0D\u5F97\u5305\u542B${label}`, 400);
  }
  return trimmed;
}
function latestRetryRequestForTask(db, taskId) {
  const row = db.prepare(`
    SELECT * FROM visual_retry_requests WHERE task_id=? ORDER BY created_at DESC, id DESC LIMIT 1
  `).get(taskId);
  if (!row) return null;
  return {
    id: row.id,
    taskId: row.task_id,
    attemptId: row.attempt_id,
    rejectNote: row.reject_note,
    supplementaryInstruction: row.supplementary_instruction,
    purpose: row.purpose ?? "reject_rerun",
    humanNote: row.human_note ?? null
  };
}
function markRetryRequestClaimed(db, requestId, at) {
  db.prepare(`
    UPDATE visual_retry_requests SET status='claimed', updated_at=? WHERE id=? AND status='created'
  `).run(at, requestId);
}
function requestVisualRetry(db, input, now = /* @__PURE__ */ new Date()) {
  if (!PACKAGE_ID.test(input.packageId) || !TASK_ID.test(input.taskId) || !ATTEMPT_ID.test(input.currentAttemptId) || !ASSET_ID.test(input.assetId)) {
    throw new VisualPipelineError("bad-request", "packageId\u3001taskId\u3001currentAttemptId \u6216 assetId \u4E0D\u5408\u6CD5", 400);
  }
  if (typeof input.idempotencyKey !== "string" || !IDEMPOTENCY_KEY_RE.test(input.idempotencyKey)) {
    throw new VisualPipelineError("bad-request", "idempotencyKey \u4E0D\u5408\u6CD5\uFF081\u2013128 \u4F4D\u5B57\u6BCD\u6570\u5B57 . _ : -\uFF09", 400);
  }
  const purpose = input.purpose ?? "reject_rerun";
  if (purpose !== "reject_rerun" && purpose !== "replace_stub_with_production") {
    throw new VisualPipelineError("bad-request", "purpose \u53EA\u5141\u8BB8 reject_rerun / replace_stub_with_production", 400);
  }
  let humanConfirmation = null;
  if (input.humanConfirmation !== void 0 && input.humanConfirmation !== null) {
    if (typeof input.humanConfirmation !== "string") throw new VisualPipelineError("bad-request", "humanConfirmation \u5FC5\u987B\u662F\u5B57\u7B26\u4E32", 400);
    humanConfirmation = input.humanConfirmation.trim();
    if (humanConfirmation.length > MAX_SUPPLEMENTARY_CHARS) throw new VisualPipelineError("supplementary-too-long", "\u4EBA\u5DE5\u786E\u8BA4\u610F\u89C1\u4E0D\u80FD\u8D85\u8FC7 " + MAX_SUPPLEMENTARY_CHARS + " \u5B57", 413);
    if (humanConfirmation.length === 0) humanConfirmation = null;
  }
  if (purpose === "replace_stub_with_production" && humanConfirmation === null) {
    throw new VisualPipelineError("human-confirmation-required", "replace_stub_with_production \u5FC5\u987B\u643A\u5E26\u4EBA\u5DE5\u4F5C\u51FA\u7684\u660E\u786E\u786E\u8BA4\u610F\u89C1", 400);
  }
  const supplementary = validateSupplementary(input.supplementaryInstruction);
  const existing = db.prepare("SELECT * FROM visual_retry_requests WHERE idempotency_key=?").get(input.idempotencyKey);
  if (existing) {
    const same = existing.package_id === input.packageId && existing.task_id === input.taskId && existing.attempt_id === input.currentAttemptId && existing.asset_id === input.assetId && (existing.supplementary_instruction ?? null) === supplementary && (existing.purpose ?? "reject_rerun") === purpose && (existing.human_note ?? null) === humanConfirmation;
    if (!same) throw new VisualPipelineError("idempotency-conflict", "\u76F8\u540C\u5E42\u7B49\u952E\u4F46\u5185\u5BB9\u4E0D\u540C\uFF0C\u62D2\u7EDD\u51B2\u7A81\u8BF7\u6C42", 409);
    const live = retryJoin(db, input.taskId);
    return {
      requestId: existing.id,
      taskId: input.taskId,
      previousAttemptId: existing.attempt_id,
      state: "retry",
      previousNote: existing.reject_note,
      supplementaryInstruction: existing.supplementary_instruction,
      purpose: existing.purpose ?? "reject_rerun",
      expectedNextAttemptNo: live ? Number(live.current_attempt) + 1 : 0,
      idempotent: true,
      currentAttempt: live ? Number(live.current_attempt) : 0,
      maxAttempts: live ? Number(live.max_attempts) : 0
    };
  }
  const row = retryJoin(db, input.taskId);
  if (!row || row.attempt_id === null) throw new VisualPipelineError("not-found", "\u89C6\u89C9\u4EFB\u52A1\u6216\u5F53\u524D attempt \u4E0D\u5B58\u5728", 404);
  if (row.package_id !== input.packageId || row.asset_id !== input.assetId) {
    throw new VisualPipelineError("retry-identity-mismatch", "packageId \u6216 assetId \u4E0E\u4EFB\u52A1\u4E0D\u4E00\u81F4", 409);
  }
  if (row.attempt_id !== input.currentAttemptId || Number(row.attempt_no) !== Number(row.current_attempt)) {
    throw new VisualPipelineError("not-current-attempt", "\u53EA\u80FD\u91CD\u8BD5\u4EFB\u52A1\u7684\u5F53\u524D attempt", 409);
  }
  const eligibility = visualRetryEligibility(db, input.taskId, purpose);
  if (!eligibility.eligible) {
    const status = eligibility.code === "max-attempts-reached" || eligibility.code === "retry-note-required" ? 422 : eligibility.code === "no-current-attempt" ? 404 : 409;
    throw new VisualPipelineError(eligibility.code ?? "invalid-state", eligibility.reason ?? "\u4EFB\u52A1\u5F53\u524D\u4E0D\u53EF\u91CD\u8BD5", status);
  }
  const at = now.toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    const fresh = retryJoin(db, input.taskId);
    const freshEligible = fresh ? visualRetryEligibility(db, input.taskId, purpose).eligible : false;
    if (!fresh || !freshEligible || fresh.attempt_id !== input.currentAttemptId || fresh.package_id !== input.packageId || fresh.asset_id !== input.assetId) {
      throw new VisualPipelineError("retry-conflict", "\u89C6\u89C9\u4EFB\u52A1\u72B6\u6001\u5728\u63D0\u4EA4\u671F\u95F4\u53D1\u751F\u53D8\u5316", 409);
    }
    const freshNote = (fresh.review_note ?? fresh.last_error ?? "").trim();
    if (!freshNote) throw new VisualPipelineError("retry-note-required", "\u9A73\u56DE\u6216\u5931\u8D25\u610F\u89C1\u4E3A\u7A7A\uFF0C\u62D2\u7EDD\u91CD\u8BD5", 422);
    const requestId = randomUUID4();
    db.prepare(`
      INSERT INTO visual_retry_requests(
        id, idempotency_key, package_id, task_id, attempt_id, asset_id,
        reject_note, supplementary_instruction, purpose, human_note, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'created', ?, ?)
    `).run(
      requestId,
      input.idempotencyKey,
      input.packageId,
      input.taskId,
      input.currentAttemptId,
      input.assetId,
      freshNote,
      supplementary,
      purpose,
      humanConfirmation,
      at,
      at
    );
    const updated = db.prepare(`
      UPDATE visual_asset_tasks SET state='retry', lease_token_hash=NULL, lease_expires_at=NULL,
        last_error=?, max_attempts=CASE WHEN max_attempts <= current_attempt THEN current_attempt + 1 ELSE max_attempts END,
        updated_at=? WHERE id=? AND current_attempt=?
    `).run(freshNote, at, input.taskId, row.current_attempt);
    if (Number(updated.changes) !== 1) throw new VisualPipelineError("retry-conflict", "\u89C6\u89C9\u4EFB\u52A1\u91CD\u8BD5\u53D1\u751F\u5E76\u53D1\u51B2\u7A81", 409);
    db.prepare(`
      INSERT INTO visual_asset_events(task_id, attempt_id, from_state, to_state, reason, created_at)
      VALUES (?, ?, ?, 'retry', ?, ?)
    `).run(
      input.taskId,
      input.currentAttemptId,
      fresh.decision === "rejected" ? "rejected" : "failed",
      `\u6309\u9A73\u56DE\u610F\u89C1\u91CD\u8BD5\uFF08purpose=${purpose}${purpose === "replace_stub_with_production" ? "\uFF1B\u4EBA\u5DE5\u786E\u8BA4\uFF1A" + humanConfirmation : ""}\uFF09\uFF1B\u610F\u89C1\uFF1A${freshNote}${supplementary ? `\uFF1B\u8865\u5145\u8981\u6C42\uFF1A${supplementary}` : ""}`,
      at
    );
    db.prepare(`UPDATE visual_batches SET status='queued', updated_at=? WHERE id=?`).run(at, row.batch_id);
    refreshStoredBatch(db, row.batch_id, at);
    db.exec("COMMIT");
    return {
      requestId,
      taskId: input.taskId,
      previousAttemptId: input.currentAttemptId,
      state: "retry",
      previousNote: freshNote,
      supplementaryInstruction: supplementary,
      purpose,
      expectedNextAttemptNo: Number(row.current_attempt) + 1,
      idempotent: false,
      currentAttempt: Number(row.current_attempt),
      maxAttempts: Number(row.max_attempts)
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
function hasProductionDelivery(db, packageId, platform) {
  const row = db.prepare(`
    SELECT 1 FROM visual_delivery_artifacts
    WHERE package_id=? AND mode='production' AND platform=? LIMIT 1
  `).get(packageId, platform);
  return row !== void 0;
}
function contractV2Complete(db, packageId) {
  const row = db.prepare("SELECT contract_version, submission_json FROM draft_packages WHERE id=?").get(packageId);
  if (!row) return { complete: false, legacy: false, missing: ["draft-package-missing"] };
  const submission = parseJsonObject(row.submission_json);
  const assets = Array.isArray(submission?.assets) ? submission.assets.filter((item) => item !== null && typeof item === "object" && !Array.isArray(item)) : [];
  if (Number(row.contract_version) < 2) {
    return { complete: false, legacy: true, missing: ["legacy-contract-v1-cannot-prove-xiaohongshu-complete"] };
  }
  const missing = [];
  if (!assets.some((asset) => asset.role === "wechat-cover" && asset.required === true)) missing.push("wechat-cover");
  if (!assets.some((asset) => asset.role === "wechat-inline" && asset.required === true)) missing.push("wechat-inline");
  if (!assets.some((asset) => asset.role === "xhs-cover" && asset.required === true && asset.order === 1)) missing.push("xiaohongshu-order-1");
  if (!assets.some((asset) => asset.role === "xhs-carousel" && asset.required === true && typeof asset.order === "number" && asset.order >= 2)) missing.push("xiaohongshu-carousel-order-2+");
  return { complete: missing.length === 0, legacy: false, missing };
}
function publicationReadiness(db, batchId) {
  const batch = db.prepare(`
    SELECT b.package_id, p.status AS package_status FROM visual_batches b
    JOIN draft_packages p ON p.id=b.package_id WHERE b.id=?
  `).get(batchId);
  if (!batch) throw new VisualPipelineError("not-found", "\u89C6\u89C9\u6279\u6B21\u4E0D\u5B58\u5728", 404);
  const aggregate = visualReviewAggregate(db, batchId);
  const contract = contractV2Complete(db, batch.package_id);
  const wechatDelivery = hasProductionDelivery(db, batch.package_id, "wechat");
  const xhsDelivery = hasProductionDelivery(db, batch.package_id, "xiaohongshu");
  const textApproved = batch.package_status === "approved";
  const readyByPlatform = {
    wechat: textApproved && wechatDelivery && !aggregate.testOnly,
    telegram: textApproved,
    x: textApproved,
    xiaohongshu: textApproved && xhsDelivery && contract.complete && !aggregate.testOnly
  };
  const blockers = [];
  if (!textApproved) blockers.push("draft-package-not-approved");
  if (!aggregate.visualApproved) blockers.push("required-visual-assets-not-approved");
  if (aggregate.testOnly) blockers.push("stub-visual-assets-test-only");
  if (!wechatDelivery) blockers.push("wechat-production-delivery-missing");
  if (contract.legacy) blockers.push(...contract.missing);
  else if (!contract.complete) blockers.push(...contract.missing.map((item) => `contract-v2-missing:${item}`));
  if (!xhsDelivery) blockers.push("xiaohongshu-production-delivery-missing");
  const deliveryReady = textApproved && aggregate.visualApproved && !aggregate.testOnly && contract.complete;
  const readyForPublication = !aggregate.testOnly && Object.values(readyByPlatform).every(Boolean);
  return {
    visualApproved: aggregate.visualApproved,
    testOnly: aggregate.testOnly,
    deliveryReady,
    readyByPlatform,
    readyForPublication,
    blockers: [...new Set(blockers)]
  };
}
function logicalTaskState(db, taskId, attemptId, pipelineState) {
  if (attemptId === null) return pipelineState;
  const approval = attemptApproval(db, attemptId);
  return approval.decision === "approved" || approval.decision === "rejected" ? approval.decision : pipelineState;
}
function createPublishTask(db, packageId, now = /* @__PURE__ */ new Date()) {
  if (!PACKAGE_ID.test(packageId)) throw new VisualPipelineError("bad-request", "packageId \u4E0D\u5408\u6CD5", 400);
  const batch = db.prepare("SELECT id FROM visual_batches WHERE package_id=?").get(packageId);
  if (!batch) throw new VisualPipelineError("not-found", "\u89C6\u89C9\u6279\u6B21\u4E0D\u5B58\u5728\uFF1A" + packageId, 404);
  const readiness = publicationReadiness(db, batch.id);
  if (!readiness.readyForPublication || readiness.testOnly) {
    const reason = readiness.testOnly ? "\u6D4B\u8BD5\u56FE\u7247\uFF08stub\uFF09\u4E0D\u53EF\u521B\u5EFA\u53D1\u5E03\u4EFB\u52A1" : readiness.blockers.length > 0 ? readiness.blockers[0] : "\u53D1\u5E03\u5C1A\u672A\u5C31\u7EEA";
    throw new VisualPipelineError("publish-not-ready", reason, 409);
  }
  const existing = db.prepare("SELECT * FROM publication_intents WHERE package_id=?").get(packageId);
  const at = now.toISOString();
  if (existing) {
    return { jobId: existing.id, intentId: existing.id, packageId, status: "recorded", created: false, readyForPublication: true };
  }
  const intentId = randomUUID4();
  db.prepare(`
    INSERT INTO publication_intents(id, package_id, readiness_json, note, created_at, updated_at)
    VALUES (?, ?, ?, 'manual publish record (audit only, never queued for workers)', ?, ?)
  `).run(intentId, packageId, JSON.stringify(readiness), at, at);
  return { jobId: intentId, intentId, packageId, status: "recorded", created: true, readyForPublication: true };
}
function latestPublishTask(db, packageId) {
  const intent = db.prepare("SELECT id, created_at, updated_at FROM publication_intents WHERE package_id=?").get(packageId);
  if (intent) return { id: intent.id, status: "recorded", createdAt: intent.created_at, updatedAt: intent.updated_at };
  const row = db.prepare("SELECT id, status, created_at, updated_at FROM workflow_jobs WHERE kind='publish' AND idempotency_key=? ORDER BY created_at DESC LIMIT 1").get(`publish:${packageId}`);
  return row ? { id: row.id, status: "audit-only", createdAt: row.created_at, updatedAt: row.updated_at } : null;
}
var ATTEMPT_ID, TASK_ID, PACKAGE_ID, ASSET_ID, IDEMPOTENCY_KEY_RE, MAX_SUPPLEMENTARY_CHARS;
var init_review = __esm({
  "src/visual/review.ts"() {
    "use strict";
    init_errors();
    ATTEMPT_ID = /^va-[a-f0-9]{20}$/;
    TASK_ID = /^vt-[a-f0-9]{20}$/;
    PACKAGE_ID = /^dp-[a-f0-9]{16}$/;
    ASSET_ID = /^[a-z0-9][a-z0-9._-]{2,48}$/i;
    IDEMPOTENCY_KEY_RE = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
    MAX_SUPPLEMENTARY_CHARS = 500;
  }
});

// src/visual/service.ts
import { createHash as createHash5, randomBytes as randomBytes2, randomUUID as randomUUID5, timingSafeEqual } from "node:crypto";
import {
  closeSync,
  existsSync as existsSync10,
  fsyncSync,
  lstatSync as lstatSync2,
  mkdirSync as mkdirSync8,
  openSync,
  readFileSync as readFileSync11,
  readdirSync as readdirSync10,
  realpathSync as realpathSync2,
  renameSync as renameSync2,
  rmSync as rmSync4,
  writeFileSync as writeFileSync7
} from "node:fs";
import path11 from "node:path";
import { isDeepStrictEqual } from "node:util";
function sha2562(data) {
  return createHash5("sha256").update(data).digest("hex");
}
function deterministicId(prefix, value, length = 20) {
  return `${prefix}-${sha2562(value).slice(0, length)}`;
}
function batchFromRow(row) {
  return {
    id: row.id,
    packageId: row.package_id,
    revision: Number(row.revision),
    sourceAssetsSha256: row.source_assets_sha256,
    status: row.status,
    requiredCount: Number(row.required_count),
    approvedCount: Number(row.approved_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
function taskFromRow(row) {
  return {
    id: row.id,
    batchId: row.batch_id,
    packageId: row.package_id,
    assetId: row.asset_id,
    kind: row.kind,
    placement: row.placement,
    prompt: row.prompt,
    altText: row.alt_text,
    aspectRatio: row.aspect_ratio,
    targetWidth: Number(row.target_width),
    targetHeight: Number(row.target_height),
    state: row.state,
    idempotencyKey: row.idempotency_key,
    currentAttempt: Number(row.current_attempt),
    maxAttempts: Number(row.max_attempts),
    leaseExpiresAt: row.lease_expires_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
function attemptFromRow(row) {
  return {
    id: row.id,
    taskId: row.task_id,
    jobId: row.job_id,
    attemptNo: Number(row.attempt_no),
    sourceAttachmentId: row.source_attachment_id,
    sourceMediaType: row.source_media_type,
    sourceBytes: row.source_bytes === null ? null : Number(row.source_bytes),
    sourceWidth: row.source_width === null ? null : Number(row.source_width),
    sourceHeight: row.source_height === null ? null : Number(row.source_height),
    provider: row.provider,
    model: row.model,
    sourceTool: row.source_tool,
    sourceCallId: row.source_call_id,
    promptOriginal: row.prompt_original,
    promptEffective: row.prompt_effective,
    negativePrompt: row.negative_prompt,
    seedRequested: row.seed_requested === null ? null : Number(row.seed_requested),
    seedEffective: row.seed_effective === null ? null : row.seed_effective === 1,
    revisedPrompt: row.revised_prompt,
    contentFilter: row.content_filter,
    importedRelativePath: row.imported_relative_path,
    importedSha256: row.imported_sha256,
    validation: JSON.parse(row.validation_json),
    status: row.status,
    generatedAt: row.generated_at,
    importedAt: row.imported_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
function visualEvent(db, taskId, attemptId, from, to, reason, at) {
  db.prepare(`
    INSERT INTO visual_asset_events(task_id, attempt_id, from_state, to_state, reason, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(taskId, attemptId, from, to, reason, at);
}
function safeExistingFile(relativePath) {
  if (path11.isAbsolute(relativePath)) throw new VisualPipelineError("artifact-integrity-failed", "\u8349\u7A3F\u4EA7\u7269\u8DEF\u5F84\u4E0D\u5F97\u4E3A\u7EDD\u5BF9\u8DEF\u5F84");
  const root = path11.resolve(VAULT_ROOT);
  const absolute = path11.resolve(root, relativePath);
  if (!absolute.startsWith(root + path11.sep)) throw new VisualPipelineError("artifact-integrity-failed", "\u8349\u7A3F\u4EA7\u7269\u8DEF\u5F84\u8D8A\u754C");
  let info;
  try {
    info = lstatSync2(absolute);
  } catch (error) {
    throw new VisualPipelineError("artifact-integrity-failed", "\u8349\u7A3F\u4EA7\u7269\u7F3A\u5931\uFF1A" + relativePath, 422, { cause: error });
  }
  if (!info.isFile() || info.isSymbolicLink()) throw new VisualPipelineError("artifact-integrity-failed", "\u8349\u7A3F\u4EA7\u7269\u5FC5\u987B\u662F\u666E\u901A\u6587\u4EF6\uFF1A" + relativePath);
  const canonical = realpathSync2(absolute);
  if (!canonical.startsWith(realpathSync2(root) + path11.sep)) throw new VisualPipelineError("artifact-integrity-failed", "\u8349\u7A3F\u4EA7\u7269\u771F\u5B9E\u8DEF\u5F84\u8D8A\u754C");
  return absolute;
}
function validateAssets(value, contractVersion) {
  if (!Array.isArray(value) || value.length === 0) throw new VisualPipelineError("invalid-assets", "assets.json \u5FC5\u987B\u662F\u975E\u7A7A\u6570\u7EC4");
  const seen = /* @__PURE__ */ new Set();
  return value.map((raw, index) => {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new VisualPipelineError("invalid-assets", `assets[${index}] \u5FC5\u987B\u662F\u5BF9\u8C61`);
    const asset = raw;
    if (typeof asset.id !== "string" || !ASSET_ID2.test(asset.id) || seen.has(asset.id)) throw new VisualPipelineError("invalid-assets", `assets[${index}].id \u4E0D\u5408\u6CD5\u6216\u91CD\u590D`);
    seen.add(asset.id);
    if (asset.kind !== "cover" && asset.kind !== "inline" && asset.kind !== "carousel") throw new VisualPipelineError("invalid-assets", `assets[${index}].kind \u4E0D\u5408\u6CD5`);
    if (typeof asset.prompt !== "string" || asset.prompt.trim() === "") throw new VisualPipelineError("invalid-assets", `assets[${index}].prompt \u5FC5\u586B`);
    if (typeof asset.altText !== "string" || asset.altText.trim() === "") throw new VisualPipelineError("invalid-assets", `assets[${index}].altText \u5FC5\u586B`);
    if (typeof asset.placement !== "string" || asset.placement.trim() === "") throw new VisualPipelineError("invalid-assets", `assets[${index}].placement \u5FC5\u586B`);
    if (typeof asset.aspectRatio !== "string" || !(asset.aspectRatio in TARGETS)) throw new VisualPipelineError("invalid-assets", `assets[${index}].aspectRatio \u4E0D\u5408\u6CD5`);
    const base = {
      id: asset.id,
      kind: asset.kind,
      prompt: asset.prompt.trim(),
      altText: asset.altText.trim(),
      aspectRatio: asset.aspectRatio,
      placement: asset.placement.trim()
    };
    if (contractVersion >= 2) {
      if (!Array.isArray(asset.platforms) || asset.platforms.some((platform) => !["wechat", "telegram", "x", "xiaohongshu"].includes(platform))) {
        throw new VisualPipelineError("invalid-assets", `assets[${index}].platforms \u4E0D\u5408\u6CD5`);
      }
      if (!Number.isSafeInteger(asset.order) || Number(asset.order) < 1 || typeof asset.required !== "boolean" || typeof asset.role !== "string") {
        throw new VisualPipelineError("invalid-assets", `assets[${index}] contract v2 \u5B57\u6BB5\u4E0D\u5408\u6CD5`);
      }
      base.platforms = [...asset.platforms];
      base.order = Number(asset.order);
      base.required = asset.required;
      base.role = asset.role;
    }
    return base;
  });
}
function verifyApprovedPackage(db, packageId) {
  if (!PACKAGE_ID2.test(packageId)) throw new VisualPipelineError("bad-request", "packageId \u4E0D\u5408\u6CD5", 400);
  const draft = db.prepare("SELECT id, revision, status, contract_version, artifact_dir, created_at FROM draft_packages WHERE id = ?").get(packageId);
  if (!draft) throw new VisualPipelineError("not-found", "\u8349\u7A3F\u5305\u4E0D\u5B58\u5728\uFF1A" + packageId, 404);
  if (draft.status !== "approved") throw new VisualPipelineError("package-not-approved", "\u53EA\u6709\u5DF2\u6279\u51C6\u8349\u7A3F\u5305\u53EF\u4EE5\u521B\u5EFA\u89C6\u89C9\u4EFB\u52A1");
  if (draft.artifact_dir === null || path11.isAbsolute(draft.artifact_dir) || path11.basename(draft.artifact_dir) !== packageId || !/^drafts[/\\]factory[/\\]\d{4}-\d{2}-\d{2}[/\\]dp-[a-f0-9]{16}$/.test(draft.artifact_dir)) {
    throw new VisualPipelineError("artifact-integrity-failed", "\u8349\u7A3F\u5305 artifact_dir \u4E0D\u5408\u6CD5");
  }
  const rows = db.prepare(`
    SELECT relative_path, sha256, bytes FROM draft_artifacts WHERE package_id = ? ORDER BY relative_path
  `).all(packageId);
  if (rows.length !== 8) throw new VisualPipelineError("artifact-integrity-failed", `\u8349\u7A3F\u5305\u5E94\u6709 8 \u4E2A\u4EA7\u7269\uFF0C\u5B9E\u9645 ${rows.length} \u4E2A`);
  const expectedNames = /* @__PURE__ */ new Set(["wechat.html", "wechat.md", "telegram.md", "x-thread.md", "xiaohongshu.md", "assets.json", "package.json", "manifest.json"]);
  const byName = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const name2 = path11.basename(row.relative_path);
    if (!expectedNames.has(name2) || path11.dirname(row.relative_path) !== draft.artifact_dir || byName.has(name2)) {
      throw new VisualPipelineError("artifact-integrity-failed", "\u8349\u7A3F\u5305\u4EA7\u7269\u6587\u4EF6\u540D\u3001\u76EE\u5F55\u4E0D\u5408\u6CD5\u6216\u91CD\u590D\uFF1A" + name2);
    }
    const absolute = safeExistingFile(row.relative_path);
    const data = readFileSync11(absolute);
    if (data.byteLength !== Number(row.bytes) || sha2562(data) !== row.sha256) {
      throw new VisualPipelineError("artifact-integrity-failed", "\u8349\u7A3F\u4EA7\u7269\u4E0E SQLite \u54C8\u5E0C\u4E0D\u4E00\u81F4\uFF1A" + name2);
    }
    byName.set(name2, { ...row, data });
  }
  for (const required of ["assets.json", "package.json", "manifest.json"]) {
    if (!byName.has(required)) throw new VisualPipelineError("artifact-integrity-failed", "\u8349\u7A3F\u5305\u7F3A\u5C11\uFF1A" + required);
  }
  let manifest;
  try {
    manifest = JSON.parse(byName.get("manifest.json").data.toString("utf8"));
  } catch (error) {
    throw new VisualPipelineError("artifact-integrity-failed", "manifest.json \u4E0D\u662F\u5408\u6CD5 JSON", 422, { cause: error });
  }
  if (manifest.packageId !== packageId || !Array.isArray(manifest.artifacts) || manifest.artifacts.length !== 7) {
    throw new VisualPipelineError("artifact-integrity-failed", "manifest.json \u5305\u6807\u8BC6\u6216\u4EA7\u7269\u6570\u91CF\u4E0D\u5408\u6CD5");
  }
  const declared = /* @__PURE__ */ new Set();
  for (const raw of manifest.artifacts) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new VisualPipelineError("artifact-integrity-failed", "manifest artifact \u4E0D\u5408\u6CD5");
    const item = raw;
    if (typeof item.file !== "string" || path11.basename(item.file) !== item.file || item.file === "manifest.json" || declared.has(item.file)) {
      throw new VisualPipelineError("artifact-integrity-failed", "manifest \u6587\u4EF6\u540D\u4E0D\u5408\u6CD5\u6216\u91CD\u590D");
    }
    declared.add(item.file);
    const stored = byName.get(item.file);
    if (!stored || item.sha256 !== stored.sha256 || item.bytes !== Number(stored.bytes)) {
      throw new VisualPipelineError("artifact-integrity-failed", "manifest \u4E0E\u78C1\u76D8/SQLite \u4E0D\u4E00\u81F4\uFF1A" + item.file);
    }
  }
  if ([...byName.keys()].some((name2) => name2 !== "manifest.json" && !declared.has(name2))) {
    throw new VisualPipelineError("artifact-integrity-failed", "manifest \u672A\u8986\u76D6\u5168\u90E8\u8349\u7A3F\u4EA7\u7269");
  }
  const assetsData = byName.get("assets.json").data;
  let assetsRaw;
  let packageRaw;
  try {
    assetsRaw = JSON.parse(assetsData.toString("utf8"));
    packageRaw = JSON.parse(byName.get("package.json").data.toString("utf8"));
  } catch (error) {
    throw new VisualPipelineError("artifact-integrity-failed", "package/assets JSON \u65E0\u6CD5\u89E3\u6790", 422, { cause: error });
  }
  const assets = validateAssets(assetsRaw, Number(draft.contract_version));
  const packageAssets = packageRaw !== null && typeof packageRaw === "object" && !Array.isArray(packageRaw) ? packageRaw.assets : void 0;
  if (!isDeepStrictEqual(packageAssets, assetsRaw)) throw new VisualPipelineError("artifact-integrity-failed", "package.json \u4E0E assets.json \u7684\u89C6\u89C9\u8BA1\u5212\u4E0D\u4E00\u81F4");
  return { packageId, revision: Number(draft.revision), createdAt: draft.created_at, assets, assetsSha256: sha2562(assetsData) };
}
function queueVisualBatch(db, packageId, now = /* @__PURE__ */ new Date()) {
  const verified = verifyApprovedPackage(db, packageId);
  const at = now.toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    const currentDraft = db.prepare("SELECT status FROM draft_packages WHERE id = ?").get(packageId);
    if (currentDraft?.status !== "approved") throw new VisualPipelineError("package-not-approved", "\u8349\u7A3F\u5305\u5728\u521B\u5EFA\u89C6\u89C9\u4EFB\u52A1\u524D\u4E0D\u518D\u662F approved");
    const existing = db.prepare("SELECT * FROM visual_batches WHERE package_id = ?").get(packageId);
    if (existing) {
      if (existing.source_assets_sha256 !== verified.assetsSha256) throw new VisualPipelineError("conflict", "\u5DF2\u5B58\u5728\u89C6\u89C9\u6279\u6B21\uFF0C\u4F46 assets.json \u54C8\u5E0C\u4E0D\u540C", 409);
      const tasks2 = db.prepare("SELECT * FROM visual_asset_tasks WHERE batch_id = ? ORDER BY asset_id").all(existing.id).map(taskFromRow);
      const expectedTaskIds = verified.assets.map((asset) => deterministicId("vt", `visual-task:${packageId}:${asset.id}:${verified.assetsSha256}`)).sort();
      if (tasks2.length !== verified.assets.length || !isDeepStrictEqual(tasks2.map((task) => task.id).sort(), expectedTaskIds)) {
        throw new VisualPipelineError("conflict", "\u5DF2\u5B58\u5728\u89C6\u89C9\u6279\u6B21\uFF0C\u4F46\u4EFB\u52A1\u96C6\u5408\u4E0E\u51BB\u7ED3 assets.json \u4E0D\u4E00\u81F4", 409);
      }
      for (const asset of verified.assets) {
        const task = tasks2.find((candidate) => candidate.assetId === asset.id);
        const target = TARGETS[asset.aspectRatio];
        const idempotencyKey = `visual-task:${packageId}:${asset.id}:${verified.assetsSha256}`;
        if (task === void 0 || task.batchId !== existing.id || task.packageId !== packageId || task.kind !== asset.kind || task.placement !== asset.placement || task.prompt !== asset.prompt || task.altText !== asset.altText || task.aspectRatio !== asset.aspectRatio || task.targetWidth !== target.width || task.targetHeight !== target.height || task.idempotencyKey !== idempotencyKey) {
          throw new VisualPipelineError("conflict", "\u5DF2\u5B58\u5728\u89C6\u89C9\u6279\u6B21\uFF0C\u4F46\u4EFB\u52A1\u5185\u5BB9\u4E0E\u51BB\u7ED3 assets.json \u4E0D\u4E00\u81F4", 409);
        }
      }
      db.exec("COMMIT");
      return { batch: batchFromRow(existing), tasks: tasks2, created: false };
    }
    const batchId = deterministicId("vb", `${packageId}:${verified.assetsSha256}`);
    db.prepare(`
      INSERT INTO visual_batches(id, package_id, revision, source_assets_sha256, status, required_count, approved_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'queued', ?, 0, ?, ?)
    `).run(batchId, packageId, verified.revision, verified.assetsSha256, verified.assets.filter((asset) => asset.required !== false).length, at, at);
    for (const asset of verified.assets) {
      const target = TARGETS[asset.aspectRatio];
      const idempotencyKey = `visual-task:${packageId}:${asset.id}:${verified.assetsSha256}`;
      const taskId = deterministicId("vt", idempotencyKey);
      db.prepare(`
        INSERT INTO visual_asset_tasks(
          id, batch_id, package_id, asset_id, kind, placement, prompt, alt_text, aspect_ratio,
          target_width, target_height, state, idempotency_key, current_attempt, max_attempts,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, 0, 3, ?, ?)
      `).run(
        taskId,
        batchId,
        packageId,
        asset.id,
        asset.kind,
        asset.placement,
        asset.prompt,
        asset.altText,
        asset.aspectRatio,
        target.width,
        target.height,
        idempotencyKey,
        at,
        at
      );
      visualEvent(db, taskId, null, null, "queued", "created from approved immutable draft package", at);
    }
    const batch = batchFromRow(db.prepare("SELECT * FROM visual_batches WHERE id = ?").get(batchId));
    const tasks = db.prepare("SELECT * FROM visual_asset_tasks WHERE batch_id = ? ORDER BY asset_id").all(batchId).map(taskFromRow);
    db.exec("COMMIT");
    return { batch, tasks, created: true };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
function leaseHash(token) {
  return sha2562(token);
}
function sameHash(actual, token) {
  if (actual === null) return false;
  const expected = leaseHash(token);
  return actual.length === expected.length && timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}
function clampLeaseSeconds(value) {
  const seconds = value ?? DEFAULT_LEASE_SECONDS;
  if (!Number.isInteger(seconds) || seconds < 60 || seconds > 900) throw new VisualPipelineError("bad-request", "leaseSeconds \u5FC5\u987B\u662F 60\u2013900 \u7684\u6574\u6570", 400);
  return seconds;
}
function refreshBatchStatus(db, batchId, at) {
  const states = db.prepare("SELECT state, COUNT(*) AS count FROM visual_asset_tasks WHERE batch_id = ? GROUP BY state").all(batchId);
  const counts = Object.fromEntries(states.map((row) => [row.state, Number(row.count)]));
  const total = states.reduce((sum, row) => sum + Number(row.count), 0);
  let status;
  if ((counts.waiting_visual_approval ?? 0) === total && total > 0) status = "waiting_visual_approval";
  else if ((counts.generating ?? 0) > 0 || (counts.generated ?? 0) > 0 || (counts.waiting_visual_approval ?? 0) > 0) status = "generating";
  else if ((counts.failed ?? 0) > 0 && (counts.queued ?? 0) === 0 && (counts.retry ?? 0) === 0) status = "failed";
  else status = "queued";
  db.prepare("UPDATE visual_batches SET status = ?, updated_at = ? WHERE id = ?").run(status, at, batchId);
}
function insertRunningWorkflowJob(db, task, attemptNo, attemptId, leaseExpiresAt, at) {
  const jobId = randomUUID5();
  const key = `visual.generate:${task.id}:${attemptNo}`;
  db.prepare(`
    INSERT INTO workflow_jobs(
      id, kind, idempotency_key, status, priority, input_json, attempts, max_attempts,
      run_after, worker_id, lease_expires_at, created_at, updated_at
    ) VALUES (?, 'visual.generate', ?, 'queued', 20, ?, 0, 1, ?, NULL, NULL, ?, ?)
  `).run(jobId, key, JSON.stringify({ packageId: task.package_id, taskId: task.id, attemptId, assetId: task.asset_id }), at, at, at);
  db.prepare("INSERT INTO workflow_job_events(job_id, at, from_status, to_status, note) VALUES (?, ?, NULL, ?, ?)").run(jobId, at, "queued", "visual attempt created");
  db.prepare(`
    UPDATE workflow_jobs
    SET status='running', attempts=1, worker_id=?, lease_expires_at=?, updated_at=?
    WHERE id=? AND status='queued'
  `).run(`visual:${task.id}`, leaseExpiresAt, at, jobId);
  db.prepare("INSERT INTO workflow_job_events(job_id, at, from_status, to_status, note) VALUES (?, ?, ?, ?, ?)").run(jobId, at, "queued", "running", "visual attempt claimed");
  return jobId;
}
function claimVisualTask(db, options = {}, now = /* @__PURE__ */ new Date()) {
  if (options.packageId !== void 0 && !PACKAGE_ID2.test(options.packageId)) throw new VisualPipelineError("bad-request", "packageId \u4E0D\u5408\u6CD5", 400);
  const leaseSeconds = clampLeaseSeconds(options.leaseSeconds);
  recoverExpiredVisualTasks(db, now);
  const at = now.toISOString();
  const leaseExpiresAt = new Date(now.getTime() + leaseSeconds * 1e3).toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    const sql = `
      SELECT t.* FROM visual_asset_tasks t
      JOIN visual_batches b ON b.id = t.batch_id
      WHERE t.state IN ('queued', 'retry')
        AND t.current_attempt < t.max_attempts
        ${options.packageId === void 0 ? "" : "AND t.package_id = ?"}
      ORDER BY b.created_at, t.created_at, t.asset_id
      LIMIT 1
    `;
    const row = options.packageId === void 0 ? db.prepare(sql).get() : db.prepare(sql).get(options.packageId);
    if (!row) {
      db.exec("COMMIT");
      return null;
    }
    const from = row.state;
    const attemptNo = Number(row.current_attempt) + 1;
    const attemptId = deterministicId("va", `${row.id}:${attemptNo}`);
    const token = randomBytes2(32).toString("hex");
    const jobId = insertRunningWorkflowJob(db, row, attemptNo, attemptId, leaseExpiresAt, at);
    const updated = db.prepare(`
      UPDATE visual_asset_tasks
      SET state='generating', current_attempt=?, lease_token_hash=?, lease_expires_at=?, last_error=NULL, updated_at=?
      WHERE id=? AND state=? AND current_attempt=?
    `).run(attemptNo, leaseHash(token), leaseExpiresAt, at, row.id, from, row.current_attempt);
    if (Number(updated.changes) !== 1) throw new VisualPipelineError("claim-conflict", "\u89C6\u89C9\u4EFB\u52A1\u5DF2\u88AB\u5176\u4ED6 worker \u9886\u53D6", 409);
    db.prepare(`
      INSERT INTO visual_asset_attempts(
        id, task_id, job_id, attempt_no, prompt_original, validation_json, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, '{}', 'generating', ?, ?)
    `).run(attemptId, row.id, jobId, attemptNo, row.prompt, at, at);
    visualEvent(db, row.id, attemptId, from, "generating", "claimed with a hashed lease token", at);
    refreshBatchStatus(db, row.batch_id, at);
    const retryRef = from === "retry" ? latestRetryRequestForTask(db, row.id) : null;
    const target = TARGETS[row.aspect_ratio];
    let authoritativePrompt = `${row.prompt}
[\u56FA\u5B9A\u89C4\u683C] ${row.aspect_ratio}\uFF08${target.width}x${target.height}px\uFF09
[\u4E8B\u5B9E\u8FB9\u754C] \u4E0D\u5F97\u6539\u53D8\u4E8B\u5B9E\u8FB9\u754C\uFF1B\u4E0D\u5F97\u5220\u9664\u6216\u8986\u76D6\u539F\u9A73\u56DE\u610F\u89C1\u4E0E\u8865\u5145\u8981\u6C42`;
    if (retryRef) {
      const previous = db.prepare(`
        SELECT provider, model, attempt_no FROM visual_asset_attempts WHERE task_id=? AND attempt_no=?
      `).get(row.id, row.current_attempt);
      authoritativePrompt += `
[\u9A73\u56DE\u610F\u89C1] ${retryRef.rejectNote}
[\u8865\u5145\u8981\u6C42] ${retryRef.supplementaryInstruction ?? "\u65E0"}`;
      if (previous) {
        authoritativePrompt += `
[\u4E0A\u4E00 attempt] #${previous.attempt_no} provider=${previous.provider ?? "\u2014"} model=${previous.model ?? "\u2014"}`;
      }
      markRetryRequestClaimed(db, retryRef.id, at);
    }
    const task = taskFromRow(db.prepare("SELECT * FROM visual_asset_tasks WHERE id = ?").get(row.id));
    const attempt = attemptFromRow(db.prepare("SELECT * FROM visual_asset_attempts WHERE id = ?").get(attemptId));
    const batch = batchFromRow(db.prepare("SELECT * FROM visual_batches WHERE id = ?").get(row.batch_id));
    db.exec("COMMIT");
    return {
      batch,
      task,
      attempt,
      leaseToken: token,
      imageStudioAspect: target.preset,
      previousNote: row.last_error,
      authoritativePrompt
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
function activeLease(db, taskId, attemptId, token, now) {
  if (!TASK_ID2.test(taskId) || !ATTEMPT_ID2.test(attemptId) || !/^[a-f0-9]{64}$/.test(token)) throw new VisualPipelineError("bad-request", "taskId\u3001attemptId \u6216 leaseToken \u4E0D\u5408\u6CD5", 400);
  const task = db.prepare("SELECT * FROM visual_asset_tasks WHERE id = ?").get(taskId);
  const attempt = db.prepare("SELECT * FROM visual_asset_attempts WHERE id = ? AND task_id = ?").get(attemptId, taskId);
  if (!task || !attempt) throw new VisualPipelineError("not-found", "\u89C6\u89C9\u4EFB\u52A1\u6216 attempt \u4E0D\u5B58\u5728", 404);
  if (task.state !== "generating" || attempt.status !== "generating" || Number(task.current_attempt) !== Number(attempt.attempt_no)) {
    throw new VisualPipelineError("invalid-state", "\u89C6\u89C9\u4EFB\u52A1\u4E0D\u5728\u5F53\u524D generating attempt");
  }
  if (!sameHash(task.lease_token_hash, token)) throw new VisualPipelineError("lease-invalid", "\u89C6\u89C9\u4EFB\u52A1\u79DF\u7EA6\u65E0\u6548", 409);
  if (task.lease_expires_at === null || task.lease_expires_at <= now.toISOString()) throw new VisualPipelineError("lease-expired", "\u89C6\u89C9\u4EFB\u52A1\u79DF\u7EA6\u5DF2\u8FC7\u671F", 409);
  return { task, attempt };
}
function heartbeatVisualTask(db, taskId, attemptId, leaseToken, now = /* @__PURE__ */ new Date(), leaseSeconds = DEFAULT_LEASE_SECONDS) {
  const seconds = clampLeaseSeconds(leaseSeconds);
  const at = now.toISOString();
  const expires = new Date(now.getTime() + seconds * 1e3).toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    const { task, attempt } = activeLease(db, taskId, attemptId, leaseToken, now);
    db.prepare("UPDATE visual_asset_tasks SET lease_expires_at=?, updated_at=? WHERE id=?").run(expires, at, task.id);
    db.prepare("UPDATE workflow_jobs SET lease_expires_at=?, updated_at=? WHERE id=? AND status=?").run(expires, at, attempt.job_id, "running");
    db.exec("COMMIT");
    return { taskId, attemptId, leaseExpiresAt: expires };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
function finishWorkflowJob(db, jobId, status, at, note, output2, error) {
  const current = db.prepare("SELECT status FROM workflow_jobs WHERE id = ?").get(jobId);
  if (!current || current.status !== "running") throw new VisualPipelineError("job-state-conflict", "\u89C6\u89C9 workflow job \u4E0D\u5728 running \u72B6\u6001", 409);
  db.prepare(`
    UPDATE workflow_jobs SET status=?, output_json=?, error=?, worker_id=NULL, lease_expires_at=NULL, updated_at=? WHERE id=? AND status='running'
  `).run(status, output2 === void 0 ? null : JSON.stringify(output2), error ?? null, at, jobId);
  db.prepare("INSERT INTO workflow_job_events(job_id, at, from_status, to_status, note) VALUES (?, ?, ?, ?, ?)").run(jobId, at, "running", status, note);
}
function failVisualTask(db, input, now = /* @__PURE__ */ new Date()) {
  if (!/^[a-z0-9][a-z0-9._-]{1,63}$/i.test(input.code) || input.message.trim() === "" || input.message.length > 2e3) {
    throw new VisualPipelineError("bad-request", "code \u6216 message \u4E0D\u5408\u6CD5", 400);
  }
  const at = now.toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    const { task, attempt } = activeLease(db, input.taskId, input.attemptId, input.leaseToken, now);
    const state = input.retryable && task.current_attempt < task.max_attempts ? "retry" : "failed";
    const error = `[${input.code}] ${input.message.trim()}`;
    db.prepare(`UPDATE visual_asset_attempts SET status=?, validation_json=?, updated_at=? WHERE id=?`).run(state, JSON.stringify({ ok: false, error: { code: input.code, message: input.message.trim(), retryable: input.retryable } }), at, attempt.id);
    db.prepare(`
      UPDATE visual_asset_tasks SET state=?, lease_token_hash=NULL, lease_expires_at=NULL, last_error=?, updated_at=? WHERE id=?
    `).run(state, error, at, task.id);
    finishWorkflowJob(db, attempt.job_id, "failed", at, `visual attempt ${state}`, void 0, error);
    visualEvent(db, task.id, attempt.id, "generating", state, error, at);
    refreshBatchStatus(db, task.batch_id, at);
    db.exec("COMMIT");
    return { taskId: task.id, attemptId: attempt.id, state };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
function recoverExpiredVisualTasks(db, now = /* @__PURE__ */ new Date()) {
  const at = now.toISOString();
  let retried = 0;
  let failed2 = 0;
  db.exec("BEGIN IMMEDIATE");
  try {
    const rows = db.prepare(`
      SELECT * FROM visual_asset_tasks
      WHERE state='generating' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?
      ORDER BY id
    `).all(at);
    const batchIds = /* @__PURE__ */ new Set();
    for (const task of rows) {
      const attempt = db.prepare("SELECT * FROM visual_asset_attempts WHERE task_id=? AND attempt_no=?").get(task.id, task.current_attempt);
      if (!attempt || attempt.status !== "generating") continue;
      const state = task.current_attempt < task.max_attempts ? "retry" : "failed";
      db.prepare(`UPDATE visual_asset_attempts SET status=?, validation_json=?, updated_at=? WHERE id=? AND status='generating'`).run(state, JSON.stringify({ ok: false, error: { code: "lease-expired", message: "worker lease expired", retryable: state === "retry" } }), at, attempt.id);
      db.prepare(`
        UPDATE visual_asset_tasks SET state=?, lease_token_hash=NULL, lease_expires_at=NULL, last_error=?, updated_at=?
        WHERE id=? AND state='generating'
      `).run(state, "[lease-expired] worker lease expired", at, task.id);
      finishWorkflowJob(db, attempt.job_id, "failed", at, `visual attempt ${state}`, void 0, "worker lease expired");
      visualEvent(db, task.id, attempt.id, "generating", state, "worker lease expired", at);
      batchIds.add(task.batch_id);
      if (state === "retry") retried += 1;
      else failed2 += 1;
    }
    for (const batchId of batchIds) refreshBatchStatus(db, batchId, at);
    db.exec("COMMIT");
    return { retried, failed: failed2 };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
function validateSubmittedAttachment(value) {
  const allowed = /* @__PURE__ */ new Set(["attachmentId", "mediaType", "bytes", "width", "height", "name"]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new VisualPipelineError("bad-request", `attachment.${key} \u4E0D\u5141\u8BB8\uFF1B\u7981\u6B62\u63D0\u4EA4 path/URL/base64`, 400);
  if (!/^sha256:[a-f0-9]{64}$/.test(value.attachmentId) || typeof value.mediaType !== "string" || !Number.isInteger(value.bytes) || value.bytes <= 0 || !Number.isInteger(value.width) || value.width <= 0 || !Number.isInteger(value.height) || value.height <= 0 || value.name !== void 0 && (typeof value.name !== "string" || value.name.length > 255)) {
    throw new VisualPipelineError("bad-request", "attachment \u5FC5\u987B\u662F\u5B8C\u6574\u5408\u6CD5\u7684 DSH \u56FE\u7247\u9644\u4EF6\u5F15\u7528", 400);
  }
}
function signatureMediaType(data) {
  if (data.length >= 24 && Buffer.from(data.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (data.length >= 4 && data[0] === 255 && data[1] === 216 && data[2] === 255) return "image/jpeg";
  if (data.length >= 12 && Buffer.from(data.subarray(0, 4)).toString("ascii") === "RIFF" && Buffer.from(data.subarray(8, 12)).toString("ascii") === "WEBP") return "image/webp";
  if (data.length >= 6 && /^GIF8[79]a$/.test(Buffer.from(data.subarray(0, 6)).toString("ascii"))) return "image/gif";
  const prefix = Buffer.from(data.subarray(0, Math.min(data.length, 256))).toString("utf8").trimStart().toLowerCase();
  if (prefix.startsWith("<svg") || prefix.startsWith("<?xml")) return "image/svg+xml";
  return null;
}
function parseImagePixels(data) {
  const sane = (width, height) => Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 && width <= MAX_IMAGE_PIXELS && height <= MAX_IMAGE_PIXELS ? { width, height } : null;
  if (data.length >= 33 && Buffer.from(data.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    const pbuf = Buffer.from(data);
    const chunkLength = pbuf.readUInt32BE(8);
    const chunkType = pbuf.subarray(12, 16).toString("ascii");
    if (chunkLength !== 13 || chunkType !== "IHDR") return null;
    if (data.length < 8 + 4 + 4 + 13 + 4) return null;
    return sane(pbuf.readUInt32BE(16), pbuf.readUInt32BE(20));
  }
  if (data.length >= 4 && data[0] === 255 && data[1] === 216 && data[2] === 255) {
    const jbuf = Buffer.from(data);
    let offset = 2;
    while (offset + 9 < data.length) {
      if (data[offset] !== 255) {
        offset += 1;
        continue;
      }
      const marker = data[offset + 1];
      if (marker === 216 || marker >= 208 && marker <= 217) {
        offset += 2;
        continue;
      }
      if (marker === 0 || marker === 255) {
        offset += 1;
        continue;
      }
      if (offset + 4 > data.length) return null;
      const length = jbuf.readUInt16BE(offset + 2);
      if (length < 2 || offset + 2 + length > data.length) return null;
      if (marker >= 192 && marker <= 207 && marker !== 196 && marker !== 200 && marker !== 204) {
        if (length < 7) return null;
        return sane(jbuf.readUInt16BE(offset + 7), jbuf.readUInt16BE(offset + 5));
      }
      offset += 2 + length;
    }
    return null;
  }
  if (data.length >= 30 && Buffer.from(data.subarray(0, 4)).toString("ascii") === "RIFF" && Buffer.from(data.subarray(8, 12)).toString("ascii") === "WEBP") {
    const wbuf = Buffer.from(data);
    const riffSize = wbuf.readUInt32LE(4);
    if (riffSize < 4 || 8 + riffSize > data.length) return null;
    const chunk = wbuf.subarray(12, 16).toString("ascii");
    const chunkSize = wbuf.readUInt32LE(16);
    if (20 + chunkSize > data.length) return null;
    if (chunk === "VP8 ") {
      if (chunkSize < 10) return null;
      if (data[23] !== 157 || data[24] !== 1 || data[25] !== 42) return null;
      return sane(data[26] | (data[27] & 63) << 8, data[28] | (data[29] & 63) << 8);
    }
    if (chunk === "VP8L") {
      if (chunkSize < 5) return null;
      if (data[20] !== 47) return null;
      const b0 = data[21], b1 = data[22], b2 = data[23], b3 = data[24];
      return sane(1 + (b0 | (b1 & 63) << 8), 1 + (b1 >> 6 | b2 << 2 | (b3 & 15) << 10));
    }
    if (chunk === "VP8X") {
      if (chunkSize !== 10) return null;
      return sane(1 + (data[24] | data[25] << 8 | data[26] << 16), 1 + (data[27] | data[28] << 8 | data[29] << 16));
    }
  }
  return null;
}
function verifiedImage(input, stored, task) {
  const ref = stored.ref;
  const declaredMatches = ref.attachmentId === input.attachmentId && ref.mediaType === input.mediaType && ref.bytes === input.bytes && ref.width === input.width && ref.height === input.height && (input.name === void 0 || ref.name === input.name);
  if (!declaredMatches) throw new VisualPipelineError("attachment-metadata-mismatch", "\u63D0\u4EA4\u7684\u9644\u4EF6\u58F0\u660E\u4E0E\u9644\u4EF6\u670D\u52A1\u9A8C\u8BC1\u7ED3\u679C\u4E0D\u4E00\u81F4");
  if (ref.mediaType !== "image/png" && ref.mediaType !== "image/jpeg" && ref.mediaType !== "image/webp") {
    throw new VisualPipelineError("unsupported-image", "\u53EA\u5141\u8BB8 PNG/JPEG/WebP\uFF1BGIF/SVG \u88AB\u62D2\u7EDD");
  }
  const data = Buffer.from(stored.data);
  const sniffed = signatureMediaType(data);
  if (sniffed !== ref.mediaType) throw new VisualPipelineError("attachment-invalid", `\u56FE\u7247\u7B7E\u540D\u4E0E\u9644\u4EF6 MIME \u4E0D\u4E00\u81F4\uFF1A${sniffed ?? "unknown"} / ${ref.mediaType}`);
  if (data.byteLength !== ref.bytes) throw new VisualPipelineError("attachment-metadata-mismatch", "\u9644\u4EF6\u5B57\u8282\u6570\u4E0E\u5B9E\u9645\u6570\u636E\u4E0D\u4E00\u81F4");
  if (data.byteLength > MAX_IMAGE_BYTES) throw new VisualPipelineError("image-too-large", "\u56FE\u7247\u8D85\u8FC7 5MiB \u4E0A\u9650");
  if (ref.width * ref.height > MAX_IMAGE_PIXELS) throw new VisualPipelineError("pixel-limit", "\u56FE\u7247\u89E3\u7801\u50CF\u7D20\u8D85\u8FC7 40M \u4E0A\u9650");
  const actual = parseImagePixels(data);
  if (actual === null) throw new VisualPipelineError("attachment-invalid", "\u65E0\u6CD5\u4ECE\u56FE\u7247\u5B57\u8282\u89E3\u6790\u771F\u5B9E\u50CF\u7D20\u5C3A\u5BF8");
  if (actual.width !== ref.width || actual.height !== ref.height) {
    throw new VisualPipelineError("pixel-mismatch", `\u9644\u4EF6 ref \u58F0\u660E ${ref.width}x${ref.height}\uFF0C\u5B9E\u9645\u5B57\u8282\u89E3\u7801 ${actual.width}x${actual.height}`);
  }
  if (actual.width * actual.height > MAX_IMAGE_PIXELS) throw new VisualPipelineError("pixel-limit", "\u56FE\u7247\u5B9E\u9645\u89E3\u7801\u50CF\u7D20\u8D85\u8FC7 40M \u4E0A\u9650");
  if (ref.width !== task.target_width || ref.height !== task.target_height) {
    throw new VisualPipelineError("dimension-mismatch", `\u56FE\u7247\u5FC5\u987B\u4E3A ${task.target_width}x${task.target_height}\uFF0C\u5B9E\u9645 ${ref.width}x${ref.height}`);
  }
  const sha = sha2562(data);
  if (ref.attachmentId !== `sha256:${sha}`) throw new VisualPipelineError("attachment-digest-mismatch", "\u9644\u4EF6 ID \u4E0E\u5B9E\u9645 SHA-256 \u4E0D\u4E00\u81F4");
  const extension = ref.mediaType === "image/png" ? "png" : ref.mediaType === "image/jpeg" ? "jpg" : "webp";
  return {
    data,
    sha,
    mediaType: ref.mediaType,
    extension,
    validation: {
      ok: true,
      mediaType: ref.mediaType,
      bytes: data.byteLength,
      width: ref.width,
      height: ref.height,
      actualPixels: { width: actual.width, height: actual.height, verifiedAgainst: ["image-bytes", "attachment-ref", "task-target"] },
      pixels: ref.width * ref.height,
      sha256: sha,
      limits: { maxBytes: MAX_IMAGE_BYTES, maxPixels: MAX_IMAGE_PIXELS }
    }
  };
}
function ensureDirectoryNoSymlink(parent, name2) {
  const next = path11.join(parent, name2);
  if (existsSync10(next)) {
    const info = lstatSync2(next);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new VisualPipelineError("unsafe-path", "\u89C6\u89C9\u8D44\u4EA7\u76EE\u5F55\u5305\u542B symlink \u6216\u975E\u76EE\u5F55\u8282\u70B9\uFF1A" + next);
  } else {
    mkdirSync8(next, { mode: 448 });
  }
  return next;
}
function immutableDestination(task, attempt, extension, sha) {
  const draft = task.package_id;
  if (!PACKAGE_ID2.test(draft) || !ASSET_ID2.test(task.asset_id) || attempt.attempt_no < 1) throw new VisualPipelineError("unsafe-path", "\u89C6\u89C9\u8D44\u4EA7\u7CFB\u7EDF\u8DEF\u5F84\u6807\u8BC6\u4E0D\u5408\u6CD5");
  const created = task.created_at.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(created)) throw new VisualPipelineError("unsafe-path", "\u89C6\u89C9\u4EFB\u52A1\u65E5\u671F\u4E0D\u5408\u6CD5");
  const root = path11.resolve(VAULT_ROOT);
  if (lstatSync2(root).isSymbolicLink()) throw new VisualPipelineError("unsafe-path", "VAULT_ROOT \u4E0D\u5F97\u4E3A symlink");
  let dir = ensureDirectoryNoSymlink(root, "visual");
  dir = ensureDirectoryNoSymlink(dir, "factory");
  dir = ensureDirectoryNoSymlink(dir, created);
  dir = ensureDirectoryNoSymlink(dir, draft);
  dir = ensureDirectoryNoSymlink(dir, task.asset_id);
  dir = ensureDirectoryNoSymlink(dir, `attempt-${String(attempt.attempt_no).padStart(3, "0")}`);
  const canonicalRoot = realpathSync2(root);
  const canonicalDir = realpathSync2(dir);
  if (!canonicalDir.startsWith(canonicalRoot + path11.sep)) throw new VisualPipelineError("unsafe-path", "\u89C6\u89C9\u8D44\u4EA7\u76EE\u5F55\u771F\u5B9E\u8DEF\u5F84\u8D8A\u754C");
  const absolute = path11.resolve(dir, `${sha.slice(0, 16)}.${extension}`);
  if (!absolute.startsWith(root + path11.sep)) throw new VisualPipelineError("unsafe-path", "\u89C6\u89C9\u8D44\u4EA7\u76EE\u6807\u8DEF\u5F84\u8D8A\u754C");
  return { absolute, relative: path11.relative(root, absolute) };
}
function persistImmutable(task, attempt, data, extension, sha) {
  const destination = immutableDestination(task, attempt, extension, sha);
  const otherFiles = readdirSync10(path11.dirname(destination.absolute)).filter((name2) => !name2.startsWith("."));
  if (existsSync10(destination.absolute)) {
    const info = lstatSync2(destination.absolute);
    if (!info.isFile() || info.isSymbolicLink() || sha2562(readFileSync11(destination.absolute)) !== sha) {
      throw new VisualPipelineError("storage-conflict", "\u89C6\u89C9\u8D44\u4EA7\u76EE\u6807\u5DF2\u5B58\u5728\u4F46\u5185\u5BB9\u4E0D\u540C", 409);
    }
    return { ...destination, created: false };
  }
  if (otherFiles.length > 0) throw new VisualPipelineError("storage-conflict", "\u540C\u4E00 attempt \u5DF2\u5B58\u5728\u4E0D\u540C\u89C6\u89C9\u8D44\u4EA7\uFF0C\u62D2\u7EDD\u8986\u76D6", 409);
  const temporary = path11.join(path11.dirname(destination.absolute), `.${path11.basename(destination.absolute)}-${randomUUID5()}.tmp`);
  let descriptor;
  try {
    descriptor = openSync(temporary, "wx", 384);
    writeFileSync7(descriptor, data);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = void 0;
    if (existsSync10(destination.absolute)) throw new VisualPipelineError("storage-conflict", "\u89C6\u89C9\u8D44\u4EA7\u76EE\u6807\u5728\u63D0\u4EA4\u671F\u95F4\u88AB\u5360\u7528", 409);
    renameSync2(temporary, destination.absolute);
    return { ...destination, created: true };
  } catch (error) {
    if (descriptor !== void 0) closeSync(descriptor);
    rmSync4(temporary, { force: true });
    throw error;
  }
}
function submissionResult(task, attempt) {
  return {
    taskId: task.id,
    attemptId: attempt.id,
    state: "waiting_visual_approval",
    attachmentId: attempt.source_attachment_id,
    relativePath: attempt.imported_relative_path,
    sha256: attempt.imported_sha256,
    mediaType: attempt.source_media_type,
    bytes: Number(attempt.source_bytes),
    width: Number(attempt.source_width),
    height: Number(attempt.source_height)
  };
}
async function submitVisualAttachment(db, attachments, input, options = {}) {
  validateSubmittedAttachment(input.attachment);
  if (typeof input.sourceTool !== "string" || !/^[a-z][a-z0-9_-]{1,63}$/.test(input.sourceTool)) throw new VisualPipelineError("bad-request", "sourceTool \u4E0D\u5408\u6CD5", 400);
  if (input.seedRequested !== void 0 && !Number.isSafeInteger(input.seedRequested)) throw new VisualPipelineError("bad-request", "seedRequested \u5FC5\u987B\u662F\u5B89\u5168\u6574\u6570", 400);
  if (input.generatedAt !== void 0 && Number.isNaN(Date.parse(input.generatedAt))) throw new VisualPipelineError("bad-request", "generatedAt \u5FC5\u987B\u662F\u5408\u6CD5\u65F6\u95F4", 400);
  const existingAttempt = db.prepare("SELECT * FROM visual_asset_attempts WHERE id=? AND task_id=?").get(input.attemptId, input.taskId);
  const existingTask = db.prepare("SELECT * FROM visual_asset_tasks WHERE id=?").get(input.taskId);
  if (!existingAttempt || !existingTask) throw new VisualPipelineError("not-found", "\u89C6\u89C9\u4EFB\u52A1\u6216 attempt \u4E0D\u5B58\u5728", 404);
  if (existingAttempt.source_attachment_id !== null) {
    if (existingAttempt.source_attachment_id !== input.attachment.attachmentId) throw new VisualPipelineError("submission-conflict", "\u540C\u4E00 attempt \u5DF2\u63D0\u4EA4\u4E0D\u540C\u9644\u4EF6", 409);
    if (existingAttempt.status !== "waiting_visual_approval") throw new VisualPipelineError("invalid-state", "attempt \u5DF2\u6709\u9644\u4EF6\u4F46\u72B6\u6001\u4E0D\u5B8C\u6574", 409);
    return submissionResult(existingTask, existingAttempt);
  }
  if (input.provider === "stub") {
    const { latestRetryRequestForTask: latestRetryRequestForTask2 } = await Promise.resolve().then(() => (init_review(), review_exports));
    const retryRequest = latestRetryRequestForTask2(db, input.taskId);
    if (retryRequest !== null && retryRequest.purpose === "replace_stub_with_production") {
      throw new VisualPipelineError("replace-stub-requires-production", "\u8BE5\u4EFB\u52A1\u6309\u4EBA\u5DE5\u786E\u8BA4\u8FDB\u5165 replace_stub_with_production \u91CD\u8BD5\uFF0C\u65B0\u63D0\u4EA4\u4E0D\u5F97\u518D\u4F7F\u7528 stub \u6D4B\u8BD5\u56FE", 422);
    }
  }
  const now = options.now ?? /* @__PURE__ */ new Date();
  activeLease(db, input.taskId, input.attemptId, input.leaseToken, now);
  if (attachments === void 0) throw new VisualPipelineError("attachment-service-unavailable", "DSH attachments \u670D\u52A1\u4E0D\u53EF\u7528\uFF0C\u65E0\u6CD5\u56DE\u8BFB\u89C6\u89C9\u9644\u4EF6", 503);
  let stored;
  try {
    stored = await attachments.readImage(input.attachment, options.signal);
  } catch (error) {
    throw new VisualPipelineError("attachment-invalid", "DSH attachments \u670D\u52A1\u62D2\u7EDD\u6216\u65E0\u6CD5\u8BFB\u53D6\u8BE5\u9644\u4EF6", 422, { cause: error });
  }
  const checkedAt = options.now ?? /* @__PURE__ */ new Date();
  const before = activeLease(db, input.taskId, input.attemptId, input.leaseToken, checkedAt);
  const image = verifiedImage(input.attachment, stored, before.task);
  const at = checkedAt.toISOString();
  let persisted;
  db.exec("BEGIN IMMEDIATE");
  try {
    const { task, attempt } = activeLease(db, input.taskId, input.attemptId, input.leaseToken, checkedAt);
    persisted = persistImmutable(task, attempt, image.data, image.extension, image.sha);
    const generatedAt = input.generatedAt === void 0 ? at : new Date(input.generatedAt).toISOString();
    db.prepare(`
      UPDATE visual_asset_attempts SET
        source_attachment_id=?, source_media_type=?, source_bytes=?, source_width=?, source_height=?,
        provider=?, model=?, source_tool=?, source_call_id=?, prompt_effective=?, negative_prompt=?,
        seed_requested=?, seed_effective=?, revised_prompt=?, content_filter=?, imported_relative_path=?,
        imported_sha256=?, validation_json=?, status='generated', generated_at=?, imported_at=?, updated_at=?
      WHERE id=? AND status='generating'
    `).run(
      stored.ref.attachmentId,
      image.mediaType,
      image.data.byteLength,
      stored.ref.width,
      stored.ref.height,
      input.provider ?? null,
      input.model ?? null,
      input.sourceTool,
      input.sourceCallId ?? null,
      input.promptEffective ?? null,
      input.negativePrompt ?? null,
      input.seedRequested ?? null,
      input.seedEffective === void 0 ? null : input.seedEffective ? 1 : 0,
      input.revisedPrompt ?? null,
      input.contentFilter ?? null,
      persisted.relative,
      image.sha,
      JSON.stringify(image.validation),
      generatedAt,
      at,
      at,
      attempt.id
    );
    db.prepare(`UPDATE visual_asset_tasks SET state='generated', lease_token_hash=NULL, lease_expires_at=NULL, updated_at=? WHERE id=? AND state='generating'`).run(at, task.id);
    visualEvent(db, task.id, attempt.id, "generating", "generated", "verified attachment imported immutably", at);
    db.prepare(`UPDATE visual_asset_attempts SET status='waiting_visual_approval', updated_at=? WHERE id=? AND status='generated'`).run(at, attempt.id);
    db.prepare(`UPDATE visual_asset_tasks SET state='waiting_visual_approval', updated_at=? WHERE id=? AND state='generated'`).run(at, task.id);
    visualEvent(db, task.id, attempt.id, "generated", "waiting_visual_approval", "M5A stops at human visual review gate", at);
    db.prepare(`
      INSERT INTO approvals(id, subject_kind, subject_id, decision, created_at)
      VALUES (?, 'visual_attempt', ?, 'pending', ?)
      ON CONFLICT(subject_kind, subject_id) DO NOTHING
    `).run(randomUUID5(), attempt.id, at);
    finishWorkflowJob(db, attempt.job_id, "waiting_approval", at, "visual attachment waiting for human approval", {
      taskId: task.id,
      attemptId: attempt.id,
      attachmentId: stored.ref.attachmentId,
      sha256: image.sha
    });
    refreshBatchStatus(db, task.batch_id, at);
    const finalTask = db.prepare("SELECT * FROM visual_asset_tasks WHERE id=?").get(task.id);
    const finalAttempt = db.prepare("SELECT * FROM visual_asset_attempts WHERE id=?").get(attempt.id);
    db.exec("COMMIT");
    return submissionResult(finalTask, finalAttempt);
  } catch (error) {
    db.exec("ROLLBACK");
    if (persisted?.created === true) rmSync4(persisted.absolute, { force: true });
    throw error;
  }
}
function latestDeliveryLink(db, packageId) {
  const row = db.prepare(`
    SELECT id FROM visual_delivery_artifacts
    WHERE package_id=? AND platform='shared' AND format='manifest'
    ORDER BY version DESC LIMIT 1
  `).get(packageId);
  return row ? `/sparkos/visual/download?deliveryId=${row.id}` : null;
}
function visualStatus(db, packageId) {
  if (packageId !== void 0 && !PACKAGE_ID2.test(packageId)) throw new VisualPipelineError("bad-request", "packageId \u4E0D\u5408\u6CD5", 400);
  const rows = packageId === void 0 ? db.prepare("SELECT * FROM visual_batches ORDER BY created_at DESC").all() : db.prepare("SELECT * FROM visual_batches WHERE package_id=? ORDER BY created_at DESC").all(packageId);
  return {
    batches: rows.map((row) => {
      const tasks = db.prepare("SELECT * FROM visual_asset_tasks WHERE batch_id=? ORDER BY asset_id").all(row.id).map((taskRow) => {
        const attempts = db.prepare("SELECT * FROM visual_asset_attempts WHERE task_id=? ORDER BY attempt_no").all(taskRow.id).map((attemptRow) => ({ ...attemptFromRow(attemptRow), approval: attemptApproval(db, attemptRow.id) }));
        const current = attempts.find((attempt) => attempt.attemptNo === Number(taskRow.current_attempt)) ?? null;
        const reviewNote = current?.approval?.note ?? taskRow.last_error;
        const events = db.prepare(`
          SELECT id, task_id, attempt_id, from_state, to_state, reason, created_at
          FROM visual_asset_events WHERE task_id=? ORDER BY id
        `).all(taskRow.id).map((event) => ({
          id: Number(event.id),
          taskId: event.task_id,
          attemptId: event.attempt_id,
          fromState: event.from_state,
          toState: event.to_state,
          reason: event.reason,
          createdAt: event.created_at
        }));
        return {
          ...taskFromRow(taskRow),
          state: logicalTaskState(db, taskRow.id, current?.id ?? null, taskRow.state),
          pipelineState: taskRow.state,
          failureCount: attempts.filter((attempt) => attempt.status === "failed" || attempt.status === "retry").length,
          retryCount: attempts.filter((attempt) => attempt.status === "retry").length,
          reviewNote,
          attempts,
          retry: visualRetryEligibility(db, taskRow.id),
          events
        };
      });
      const pipelineCount = (state) => tasks.filter((task) => task.pipelineState === state).length;
      const waiting = pipelineCount("waiting_visual_approval");
      const aggregate = visualReviewAggregate(db, row.id);
      const publication = publicationReadiness(db, row.id);
      return {
        ...batchFromRow(row),
        status: aggregate.status,
        approvedCount: aggregate.approvedCount,
        requiredCount: aggregate.requiredCount,
        // M6.4 只读交付下载链接（最新 manifest 交付包；无则 null）
        deliveryLink: latestDeliveryLink(db, row.package_id),
        // M6.6 最近发布任务台账（无则 null；只读展示，不自动发布）
        publishTask: latestPublishTask(db, row.package_id),
        tasks,
        readiness: {
          required: aggregate.requiredCount,
          queued: pipelineCount("queued") + pipelineCount("retry"),
          generating: pipelineCount("generating") + pipelineCount("generated"),
          waitingVisualApproval: waiting,
          failed: pipelineCount("failed"),
          readyForVisualApproval: tasks.length > 0 && waiting === tasks.length,
          ...publication
        }
      };
    })
  };
}
function readVisualAsset(db, attemptId) {
  if (!ATTEMPT_ID2.test(attemptId)) return null;
  const row = db.prepare(`
    SELECT a.imported_relative_path, a.imported_sha256, a.source_media_type, a.source_bytes, t.state
    FROM visual_asset_attempts a JOIN visual_asset_tasks t ON t.id=a.task_id WHERE a.id=?
  `).get(attemptId);
  if (!row || row.imported_relative_path === null || row.imported_sha256 === null || row.source_media_type === null || !["waiting_visual_approval", "approved", "rejected"].includes(row.state)) return null;
  const root = path11.resolve(VAULT_ROOT);
  const absolute = path11.resolve(root, row.imported_relative_path);
  if (!absolute.startsWith(root + path11.sep)) return null;
  try {
    const info = lstatSync2(absolute);
    if (!info.isFile() || info.isSymbolicLink()) return null;
    if (!realpathSync2(absolute).startsWith(realpathSync2(root) + path11.sep)) return null;
    const content = readFileSync11(absolute);
    if (content.byteLength !== Number(row.source_bytes) || sha2562(content) !== row.imported_sha256) return null;
    return { content, mediaType: row.source_media_type, bytes: content.byteLength, sha256: row.imported_sha256 };
  } catch {
    return null;
  }
}
var PACKAGE_ID2, TASK_ID2, ATTEMPT_ID2, ASSET_ID2, MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS, DEFAULT_LEASE_SECONDS, TARGETS;
var init_service = __esm({
  "src/visual/service.ts"() {
    "use strict";
    init_vault();
    init_errors();
    init_review();
    init_errors();
    PACKAGE_ID2 = /^dp-[a-f0-9]{16}$/;
    TASK_ID2 = /^vt-[a-f0-9]{20}$/;
    ATTEMPT_ID2 = /^va-[a-f0-9]{20}$/;
    ASSET_ID2 = /^[a-z0-9][a-z0-9._-]{2,48}$/i;
    MAX_IMAGE_BYTES = 5 * 1024 * 1024;
    MAX_IMAGE_PIXELS = 4e7;
    DEFAULT_LEASE_SECONDS = 300;
    TARGETS = {
      "2.35:1": { width: 900, height: 383, preset: "wechat_cover" },
      "16:9": { width: 1280, height: 720, preset: "article" },
      "3:4": { width: 1080, height: 1440, preset: "xhs_34" },
      "1:1": { width: 1080, height: 1080, preset: "xhs_square" }
    };
  }
});

// src/factory/service.ts
var service_exports = {};
__export(service_exports, {
  buildFactorySnapshot: () => buildFactorySnapshot,
  listPendingDraftRequests: () => listPendingDraftRequests,
  requestDraftPackage: () => requestDraftPackage,
  requestDraftRevision: () => requestDraftRevision,
  reviewDraftPackage: () => reviewDraftPackage,
  reviewEditorialCard: () => reviewEditorialCard,
  runDraftSubmission: () => runDraftSubmission,
  runEditorialPlanning: () => runEditorialPlanning,
  runLatestRanking: () => runLatestRanking
});
import { createHash as createHash6 } from "node:crypto";
function dateFromStamp(stamp) {
  return stamp.slice(0, 4) + "-" + stamp.slice(4, 6) + "-" + stamp.slice(6, 8);
}
function runLatestRanking() {
  const latest = latestClusters(defaultIntelConfig());
  if (!latest || latest.clusters.length === 0) throw new Error("\u6682\u65E0\u5DF2\u5206\u6790\u60C5\u62A5\u7C07\uFF1A\u5148\u6267\u884C intel analyze \u5E76 submitCluster");
  const date = dateFromStamp(latest.date);
  const fingerprint = createHash6("sha256").update(JSON.stringify(latest.clusters)).digest("hex").slice(0, 12);
  const db = openFactoryDatabase();
  try {
    recoverExpiredJobs(db);
    const created = createJob(db, {
      kind: "intel.daily-ranking",
      input: { date, clusters: latest.clusters.length },
      idempotencyKey: `intel.daily-ranking:${date}:${fingerprint}`,
      priority: 50
    });
    if (!created.created && created.job.status === "succeeded") {
      const ranking = latestDailyRanking(db);
      if (!ranking) throw new Error("\u6392\u540D\u4EFB\u52A1\u5DF2\u5B8C\u6210\u4F46\u6570\u636E\u5E93\u65E0\u6392\u540D\u5FEB\u7167");
      return { ranking, jobId: created.job.id, reused: true };
    }
    if (!created.created && created.job.status === "failed") {
      transitionJob(db, created.job.id, "queued", { note: "manual retry" });
    }
    const started = startJob(db, created.job.id, "sparkos-inline");
    try {
      const ranking = generateDailyRanking(db, latest.clusters, date);
      transitionJob(db, started.id, "succeeded", {
        output: {
          top5: ranking.top5.length,
          persistent: ranking.persistent.length,
          creationCandidates: ranking.creationCandidates.length
        }
      });
      return { ranking, jobId: started.id, reused: false };
    } catch (error) {
      transitionJob(db, started.id, "failed", { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  } finally {
    db.close();
  }
}
function runEditorialPlanning(mode, periodEnd) {
  const db = openFactoryDatabase();
  try {
    recoverExpiredJobs(db);
    const latest = db.prepare("SELECT MAX(snapshot_date) AS date FROM topic_rank_snapshots").get();
    const end = periodEnd ?? latest.date;
    if (!end) throw new Error("\u6682\u65E0\u6BCF\u65E5\u6392\u540D\uFF1A\u5148\u5B8C\u6210\u60C5\u62A5\u7C07\u5206\u6790\u5E76\u6267\u884C intel rank");
    const fingerprint = editorialInputFingerprint(db, mode, end);
    const created = createJob(db, {
      kind: `editorial.${mode}`,
      input: { mode, periodEnd: end },
      idempotencyKey: `editorial.${mode}:${end}:${fingerprint}`,
      priority: 40
    });
    if (!created.created && (created.job.status === "succeeded" || created.job.status === "waiting_approval")) {
      const plan = generateEditorialPlan(db, mode, end);
      return { plan, jobId: created.job.id, reused: true };
    }
    if (!created.created && created.job.status === "failed") transitionJob(db, created.job.id, "queued", { note: "manual retry" });
    const started = startJob(db, created.job.id, "sparkos-inline");
    try {
      const plan = generateEditorialPlan(db, mode, end);
      transitionJob(db, started.id, plan.cards.length === 0 ? "succeeded" : "waiting_approval", {
        output: { runId: plan.id, selected: plan.cards.length, periodEnd: plan.periodEnd }
      });
      return { plan, jobId: started.id, reused: false };
    } catch (error) {
      transitionJob(db, started.id, "failed", { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  } finally {
    db.close();
  }
}
function reviewEditorialCard(cardId, decision, note) {
  const db = openFactoryDatabase();
  try {
    const card = decideEditorialCard(db, cardId, decision, note);
    if (decision === "approved") ensureDraftRequest(db, cardId);
    const run = db.prepare(`
      SELECT r.id, r.status FROM editorial_runs r
      JOIN editorial_cards c ON c.run_id = r.id WHERE c.id = ?
    `).get(cardId);
    if (run.status !== "pending_approval") {
      const job = db.prepare(`
        SELECT id FROM workflow_jobs
        WHERE status = 'waiting_approval' AND json_extract(output_json, '$.runId') = ?
        ORDER BY created_at DESC LIMIT 1
      `).get(run.id);
      if (job) transitionJob(db, job.id, "succeeded", { note: `editorial run ${run.status}` });
    }
    return card;
  } finally {
    db.close();
  }
}
function requestDraftPackage(cardId) {
  const db = openFactoryDatabase();
  try {
    return ensureDraftRequest(db, cardId);
  } finally {
    db.close();
  }
}
function requestDraftRevision(packageId) {
  const db = openFactoryDatabase();
  try {
    return reviseDraftRequest(db, packageId);
  } finally {
    db.close();
  }
}
function listPendingDraftRequests(limit = 10) {
  const db = openFactoryDatabase();
  try {
    return pendingDraftRequests(db, limit);
  } finally {
    db.close();
  }
}
function runDraftSubmission(submission) {
  const db = openFactoryDatabase();
  try {
    return submitDraftPackage(db, submission);
  } finally {
    db.close();
  }
}
function reviewDraftPackage(packageId, decision, note) {
  const db = openFactoryDatabase();
  try {
    return decideDraftPackage(db, packageId, decision, note);
  } finally {
    db.close();
  }
}
function buildFactorySnapshot() {
  const dbPath = defaultFactoryDbPath();
  const db = openFactoryDatabase({ path: dbPath });
  try {
    return {
      database: databaseHealth(db, dbPath),
      jobs: listJobs(db, 10),
      ranking: latestDailyRanking(db),
      editorial: latestEditorialPlan(db),
      drafts: listDraftPackageSummaries(db, 10),
      visual: visualStatus(db)
    };
  } finally {
    db.close();
  }
}
var init_service2 = __esm({
  "src/factory/service.ts"() {
    "use strict";
    init_database();
    init_jobs();
    init_cluster();
    init_ingest();
    init_ranking();
    init_planner();
    init_drafts();
    init_service();
  }
});

// src/intel/tick.ts
var tick_exports = {};
__export(tick_exports, {
  runIntelTick: () => runIntelTick
});
function runIntelTick() {
  const cfg = defaultIntelConfig();
  initOpsIntel();
  const ingest = runIngest(cfg);
  const run = fromIngest(ingest);
  writeRun(cfg.runsDir, run);
  const health = computeHealth(cfg);
  run.ok = run.ok && health.overall !== "red";
  if (health.overall === "red") run.error = "health-red";
  else delete run.error;
  writeRun(cfg.runsDir, run);
  pruneRuns(cfg.runsDir);
  return { ingest, overall: health.overall, report: buildIntelReport(cfg) };
}
var init_tick = __esm({
  "src/intel/tick.ts"() {
    "use strict";
    init_ingest();
    init_runs();
    init_health();
    init_report();
  }
});

// src/intel/fusion.ts
var fusion_exports = {};
__export(fusion_exports, {
  breakingOf: () => breakingOf,
  clusterDuplicates: () => clusterDuplicates,
  collectDailyItems: () => collectDailyItems,
  fuseDaily: () => fuseDaily,
  sourceHeatOf: () => sourceHeatOf,
  titleSimilarity: () => titleSimilarity,
  topicsOf: () => topicsOf
});
import { existsSync as existsSync11, mkdirSync as mkdirSync9, readdirSync as readdirSync11, readFileSync as readFileSync12, writeFileSync as writeFileSync8, statSync as statSync3 } from "node:fs";
import path12 from "node:path";
function localDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return y + m + day;
}
function localDateOf(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return localDate(d);
}
function evidenceUrlOf(raw) {
  const sh = raw.source_hint;
  const item = raw.item;
  const draft = raw.draft;
  const direct = sh?.url ?? raw.url ?? raw.link ?? item?.url;
  if (typeof direct === "string" && direct !== "") return direct;
  for (const t of [raw.channel_text, raw.text, item?.text, draft?.text]) {
    if (typeof t === "string") {
      const m = /https?:\/\/[^\s"'<>()]+/.exec(t);
      if (m) return m[0];
    }
  }
  return "";
}
function titleOf(raw) {
  const draft = raw.draft;
  const item = raw.item;
  const t = draft?.title ?? item?.title ?? raw.title;
  return typeof t === "string" && t !== "" ? t : "(\u65E0\u6807\u9898)";
}
function sourceHeatOf(raw) {
  const score = raw.score;
  if (typeof score === "number" && Number.isFinite(score)) {
    if (raw.source === "github") return GITHUB_TRENDING_HEAT;
    const mapped = 100 * Math.log10(score + 1) / Math.log10(HN_POINTS_REF);
    return Math.max(0, Math.min(100, Math.round(mapped)));
  }
  const item = raw.item;
  if (item !== void 0 && item !== null && typeof item === "object") {
    if (raw.strong === true && raw.breaking === true) return 70;
    if (raw.strong === true) return 60;
    if (raw.breaking === true) return 45;
    return 25;
  }
  return null;
}
function breakingOf(raw) {
  const sh = raw.source_hint;
  const item = raw.item;
  return raw.breaking === true || sh?.breaking === true || item?.breaking === true;
}
function topicsOf(raw) {
  const wh = raw.watch_hits;
  const t = wh?.topics;
  if (!Array.isArray(t)) return [];
  return t.filter((x) => typeof x === "string" && x.trim() !== "");
}
function titleKey(title) {
  return title.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}
function grams(s) {
  const out = /* @__PURE__ */ new Set();
  const token = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[\p{L}\p{N}]+/gu;
  for (const m of s.matchAll(token)) {
    const tok = m[0];
    if (tok.length === 1) {
      out.add(tok);
      continue;
    }
    for (let i = 0; i < tok.length - 1; i++) out.add(tok.slice(i, i + 2));
  }
  return out;
}
function titleSimilarity(a, b) {
  const A = grams(titleKey(a));
  const B = grams(titleKey(b));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  const sum = A.size + B.size;
  return sum === 0 ? 0 : 2 * inter / sum;
}
function clusterDuplicates(items, threshold = 0.5) {
  const groups = [];
  for (const it of items) {
    const hit = groups.find((g) => titleSimilarity(g.rep, it.title) >= threshold);
    if (hit) hit.keys.push(it.eventKey);
    else groups.push({ rep: it.title, keys: [it.eventKey] });
  }
  return groups.filter((g) => g.keys.length > 1).map((g) => g.keys);
}
function categoryOf(raw) {
  const item = raw.item;
  const sh = raw.source_hint;
  const c = item?.category ?? sh?.category;
  return typeof c === "string" ? c.trim() : "";
}
function passesSourceGate(def, raw) {
  const cats = def?.categories;
  const tops = def?.topicsAllow;
  const hasCat = Array.isArray(cats) && cats.length > 0;
  const hasTop = Array.isArray(tops) && tops.length > 0;
  if (!hasCat && !hasTop) return true;
  if (hasCat && cats.includes(categoryOf(raw))) return true;
  if (hasTop && topicsOf(raw).some((t) => tops.includes(t))) return true;
  return false;
}
function collectDailyItems(cfg, date, stats) {
  const day = localDate(date);
  const items = [];
  if (!existsSync11(cfg.outDir)) return items;
  for (const source of readdirSync11(cfg.outDir)) {
    const sub = path12.join(cfg.outDir, source);
    try {
      if (!statSync3(sub).isDirectory()) continue;
    } catch {
      continue;
    }
    const gate = cfg.sources.find((s) => s.id === source);
    for (const f of readdirSync11(sub)) {
      if (!f.endsWith(".snapshot.json")) continue;
      let snap;
      try {
        snap = JSON.parse(readFileSync12(path12.join(sub, f), "utf8"));
      } catch {
        continue;
      }
      const observedAt = typeof snap.observedAt === "string" ? snap.observedAt : "";
      if (observedAt === "" || localDateOf(observedAt) !== day) continue;
      const raw = snap.raw ?? {};
      if (!passesSourceGate(gate, raw)) {
        if (stats) stats.filtered[source] = (stats.filtered[source] ?? 0) + 1;
        continue;
      }
      items.push({
        eventKey: String(snap.eventKey ?? f.slice(0, -".snapshot.json".length)),
        source: String(snap.source ?? source),
        status: String(snap.status ?? "unknown"),
        title: titleOf(raw),
        observedAt,
        evidenceUrl: evidenceUrlOf(raw),
        heat: sourceHeatOf(raw),
        breaking: breakingOf(raw),
        topics: topicsOf(raw)
      });
    }
  }
  return items.sort((a, b) => a.eventKey.localeCompare(b.eventKey));
}
function fuseDaily(cfg, date = /* @__PURE__ */ new Date()) {
  const fusionDir = path12.join(path12.dirname(cfg.outDir), "fusion");
  mkdirSync9(fusionDir, { recursive: true });
  const stamp = localDate(date);
  const filtered = {};
  const items = collectDailyItems(cfg, date, { filtered });
  const dupGroups = clusterDuplicates(items);
  const filteredTotal = Object.values(filtered).reduce((a, b) => a + b, 0);
  const notes = [
    "\u673A\u68B0\u88C5\u914D\u6E05\u5355\uFF1A\u6BCF\u6761\u5E26 eventKey \u56DE\u94FE\uFF1B\u5224\u65AD\u4E0E\u63AA\u8F9E\u7531 agent \u5B8C\u6210\uFF08intel \u84DD\u56FE\uFF1A\u4E0D\u81EA\u52A8\u5916\u53D1\uFF09\u3002",
    "\u53C2\u7167\uFF1A\u661F\u706B\u77E5\u8BC6\u5E93\u53EA\u8BFB\uFF08SPARKOS_KNOWLEDGE_ROOT\uFF09\uFF0C\u672C\u878D\u5408\u4E0D\u5199\u5165\u661F\u706B\u5E93\u3002",
    "\u6570\u636E\u6E90\uFF1A\u5F53\u65E5 ingest \u5FEB\u7167\uFF08observedAt \u672C\u5730\u65E5\u671F\u5F52\u7C7B\uFF1B\u665A\u843D\u76D8\u53EF\u91CD\u8DD1\u878D\u5408\u8865\u9F50\uFF09\u3002",
    items.length === 0 ? "\u5F53\u65E5\u65E0\u65B0\u7A3F\u3002" : "\u5F53\u65E5\u65B0\u7A3F " + items.length + " \u6761\uFF0C\u8986\u76D6\u6E90 " + new Set(items.map((i) => i.source)).size + " \u4E2A\u3002",
    ...filteredTotal > 0 ? ["\u6E90\u95F8\u95E8\uFF08\u5206\u7C7B/\u4E3B\u9898\uFF09\u8FC7\u6EE4 " + filteredTotal + " \u6761\uFF08" + Object.entries(filtered).map(([s, n]) => s + " " + n).join("\u3001") + "\uFF09\uFF1B\u5FEB\u7167\u4ECD\u5168\u91CF\u4FDD\u7559\uFF0C\u53EF\u8C03\u767D\u540D\u5355\u91CD\u8DD1\u3002"] : [],
    dupGroups.length > 0 ? "\u7591\u4F3C\u91CD\u590D\u4E3B\u9898 " + dupGroups.length + " \u7EC4\uFF08\u89C1\u6587\u672B\uFF0C\u4EC5\u4F9B\u5224\u65AD\uFF09\u3002" : "\u65E0\u7591\u4F3C\u91CD\u590D\u4E3B\u9898\u3002"
  ];
  const out = {
    date: stamp,
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    items,
    notes,
    dupGroups,
    files: []
  };
  const jsonFile = path12.join(fusionDir, "fusion-" + stamp + ".json");
  const mdFile = path12.join(fusionDir, "fusion-" + stamp + ".md");
  writeFileSync8(jsonFile, JSON.stringify({ date: out.date, generatedAt: out.generatedAt, items, notes, dupGroups }, null, 2) + "\n");
  const byKey = new Map(items.map((i) => [i.eventKey, i]));
  const dupSection = dupGroups.length > 0 ? [
    "",
    "## \u26A0\uFE0F \u7591\u4F3C\u91CD\u590D\u4E3B\u9898\uFF08\u673A\u68B0\u805A\u7C7B\u63D0\u793A\uFF0C\u4F9B\u5224\u65AD\uFF0C\u4E0D\u81EA\u52A8\u5408\u5E76\uFF09",
    "",
    ...dupGroups.map((g) => "- " + g.map((k) => byKey.get(k)?.title ?? k).join("  ~  ")),
    ""
  ].join("\n") : "";
  const md = [
    "# \u60C5\u62A5\u878D\u5408 " + stamp.slice(0, 4) + "-" + stamp.slice(4, 6) + "-" + stamp.slice(6, 8),
    "",
    ...notes.map((n) => "> " + n),
    "",
    ...items.length === 0 ? ["\uFF08\u5F53\u65E5\u65E0\u65B0\u7A3F\uFF09"] : [
      "| eventKey | \u6E90 | \u72B6\u6001 | \u70ED\u5EA6 | \u6807\u9898 |",
      "| --- | --- | --- | --- | --- |",
      ...items.map((i) => "| " + i.eventKey + " | " + i.source + " | " + i.status + " | " + (i.heat === null ? "\u2014" : String(i.heat)) + " | " + i.title.replace(/\|/g, "\\|") + " |")
    ],
    dupSection
  ].join("\n");
  writeFileSync8(mdFile, md);
  out.files = [jsonFile, mdFile];
  return out;
}
var HN_POINTS_REF, GITHUB_TRENDING_HEAT;
var init_fusion = __esm({
  "src/intel/fusion.ts"() {
    "use strict";
    HN_POINTS_REF = 1201;
    GITHUB_TRENDING_HEAT = 55;
  }
});

// src/intel/cards.ts
var cards_exports = {};
__export(cards_exports, {
  CARD_REQUEST_LIMIT: () => CARD_REQUEST_LIMIT,
  CARD_REQUEST_MIN_HEAT: () => CARD_REQUEST_MIN_HEAT,
  buildCardRequests: () => buildCardRequests,
  nextCardNumbers: () => nextCardNumbers,
  writeCardRequests: () => writeCardRequests
});
import { existsSync as existsSync12, mkdirSync as mkdirSync10, readdirSync as readdirSync12, writeFileSync as writeFileSync9 } from "node:fs";
import path13 from "node:path";
function pad3(n) {
  return String(n).padStart(3, "0");
}
function nextCardNumbers(knowledgeRoot = KNOWLEDGE_ROOT) {
  const scan = (dir, pattern) => {
    let max = 0;
    const base = path13.join(knowledgeRoot, "spark-notes", dir);
    if (!existsSync12(base)) return 1;
    for (const f of readdirSync12(base)) {
      const m = pattern.exec(f);
      if (m) max = Math.max(max, Number.parseInt(m[1], 10));
    }
    return max + 1;
  };
  return {
    obs: scan("observations", /^(\d{1,4})-/),
    model: scan("models", /^(\d{1,4})-/)
  };
}
function stampOf(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function buildCardRequests(clusters, opts = {}) {
  const minHeat = opts.minHeat ?? CARD_REQUEST_MIN_HEAT;
  const limit = opts.limit ?? CARD_REQUEST_LIMIT;
  const date = opts.date ?? /* @__PURE__ */ new Date();
  const { obs } = nextCardNumbers(opts.knowledgeRoot ?? KNOWLEDGE_ROOT);
  const stamp = stampOf(date);
  const targets = clusters.filter((c) => c.knowledgeCards.length === 0).filter((c) => typeof c.sourceHeat === "number" ? c.sourceHeat >= minHeat : c.heat === "high").sort((a, b) => (b.sourceHeat ?? 0) - (a.sourceHeat ?? 0) || b.sourceCount - a.sourceCount).slice(0, limit);
  return targets.map((c, i) => {
    const heatText = typeof c.sourceHeat === "number" ? c.sourceHeat + " \u5206" : c.heat + " \u6863";
    const fromFusion = c.eventKeys.map((k) => opts.titles?.get(k)).find((t) => t !== void 0 && t !== "");
    const title = c.topic.trim() !== "" ? c.topic : fromFusion ?? "(\u5F85\u5206\u6790\uFF1A\u9700\u5148\u8DD1 sparkos-intel-cluster-analysis)";
    return {
      clusterId: c.clusterId,
      suggestedUri: "obs://" + pad3(obs + i),
      suggestedFile: pad3(obs + i) + "-<slug>-" + stamp + ".md",
      title,
      reason: "\u70ED\u5EA6 " + heatText + " / " + c.sourceCount + " \u4E2A\u6765\u6E90\uFF0C\u4F46 0 \u5F20\u77E5\u8BC6\u5361 \u2192 knowledgeDepth=0\uFF0C\u8BE5\u4E3B\u9898\u8FDB\u4E0D\u4E86\u521B\u4F5C\u5019\u9009\u3002\u8865 1 \u5F20\u5361\u5373\u53EF\u8BA9\u5B83\u5177\u5907\u8BBA\u8BC1\u5C42\u3002",
      heat: c.heat,
      sourceHeat: c.sourceHeat ?? null,
      sourceCount: c.sourceCount,
      evidenceUrls: c.evidenceUrls,
      eventKeys: c.eventKeys
    };
  });
}
function writeCardRequests(cfg, requests, date = /* @__PURE__ */ new Date()) {
  const outDir = path13.dirname(cfg.outDir);
  mkdirSync10(outDir, { recursive: true });
  const stamp = stampOf(date).replace(/-/g, "");
  const jsonFile = path13.join(outDir, "card-requests-" + stamp + ".json");
  const mdFile = path13.join(outDir, "card-requests-" + stamp + ".md");
  writeFileSync9(jsonFile, JSON.stringify({
    date: stamp,
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    note: "\u8865\u5361\u5EFA\u8BAE\uFF0C\u4EBA\u5DE5\u786E\u8BA4\u540E\u81EA\u884C\u5728\u661F\u706B\u5E93\u5EFA\u5361\uFF1B\u63D2\u4EF6\u4E0D\u5199\u77E5\u8BC6\u5E93\u3002",
    requests
  }, null, 2) + "\n");
  const md = requests.length === 0 ? "# \u8865\u5361\u6E05\u5355 " + stamp + "\n\n> \u4ECA\u65E5\u6CA1\u6709\u300C\u591F\u70ED\u4F46\u7F3A\u5361\u300D\u7684\u4E3B\u9898\u3002\n" : [
    "# \u8865\u5361\u6E05\u5355 " + stamp,
    "",
    "> \u70ED\u5EA6\u591F\u4F46 0 \u5F20\u77E5\u8BC6\u5361\u7684\u4E3B\u9898\u3002\u8865 1 \u5F20\u5361\u5373\u53EF\u8BA9\u8BE5\u4E3B\u9898\u8FDB\u5165\u521B\u4F5C\u5019\u9009\uFF08knowledgeDepth \u7531\u6B64\u800C\u6765\uFF09\u3002",
    "> \u661F\u706B\u77E5\u8BC6\u5E93\u5BF9\u63D2\u4EF6\u53EA\u8BFB\uFF1A\u4EE5\u4E0B\u5747\u4E3A**\u5EFA\u8BAE**\uFF0C\u9700\u4EBA\u5DE5\u786E\u8BA4\u540E\u81EA\u884C\u5EFA\u5361\u3002",
    "",
    "| \u5EFA\u8BAE\u7F16\u53F7 | \u5EFA\u8BAE\u6587\u4EF6 | \u70ED\u5EA6 | \u6765\u6E90 | \u4E3B\u9898 |",
    "| --- | --- | --- | --- | --- |",
    ...requests.map((r) => "| " + r.suggestedUri + " | " + r.suggestedFile + " | " + (r.sourceHeat === null ? r.heat : String(r.sourceHeat)) + " | " + r.sourceCount + " | " + r.title.replace(/\|/g, "\\|") + " |"),
    "",
    ...requests.flatMap((r) => [
      "## " + r.suggestedUri + " \xB7 " + r.title,
      "",
      "\u5EFA\u8BAE\u6587\u4EF6\uFF1A`" + r.suggestedFile + "`",
      "",
      "\u7406\u7531\uFF1A" + r.reason,
      "",
      ...r.evidenceUrls.length > 0 ? ["\u8BC1\u636E\uFF1A", ...r.evidenceUrls.map((u) => "- " + u), ""] : []
    ])
  ].join("\n");
  writeFileSync9(mdFile, md);
  return { files: [jsonFile, mdFile], pending: requests.length };
}
var CARD_REQUEST_MIN_HEAT, CARD_REQUEST_LIMIT;
var init_cards = __esm({
  "src/intel/cards.ts"() {
    "use strict";
    init_vault();
    CARD_REQUEST_MIN_HEAT = 70;
    CARD_REQUEST_LIMIT = 10;
  }
});

// src/intel/dispatch.ts
var dispatch_exports = {};
__export(dispatch_exports, {
  generateDispatch: () => generateDispatch,
  latestDispatch: () => latestDispatch,
  latestFusionItems: () => latestFusionItems
});
import { existsSync as existsSync13, mkdirSync as mkdirSync11, readdirSync as readdirSync13, readFileSync as readFileSync13, writeFileSync as writeFileSync10 } from "node:fs";
import path14 from "node:path";
function latestFusionItems(cfg) {
  const dir = path14.join(path14.dirname(cfg.outDir), "fusion");
  if (!existsSync13(dir)) return [];
  const files = readdirSync13(dir).filter((f) => f.startsWith("fusion-") && f.endsWith(".json")).sort().reverse();
  if (files.length === 0) return [];
  try {
    const data = JSON.parse(readFileSync13(path14.join(dir, files[0]), "utf8"));
    return (data.items ?? []).filter((i) => i.eventKey && i.source && i.title).map((i) => ({ source: String(i.source), title: String(i.title), eventKey: String(i.eventKey) }));
  } catch {
    return [];
  }
}
function latestDispatch() {
  const dir = path14.join(path14.dirname(defaultIntelConfig().outDir), "dispatch");
  try {
    return JSON.parse(readFileSync13(path14.join(dir, "preferences.json"), "utf8"));
  } catch {
    return null;
  }
}
function generateDispatch(cfg, now = /* @__PURE__ */ new Date()) {
  const items = latestFusionItems(cfg);
  const out = {
    generatedAt: now.toISOString(),
    mode: "manual-optional",
    ownerNote: "\u672C\u6587\u4EF6\u4EC5\u4F5C\u9009\u9898\u65B9\u5411\u53C2\u8003\uFF0C\u5916\u90E8\u5F52\u6863\u9ED8\u8BA4\u4E0D\u6D88\u8D39\uFF1B\u53D1\u5E03\u6743\u4E0E\u6700\u7EC8\u88C1\u51B3\u5F52\u539F Owner \u4E0E\u7528\u6237\u3002",
    redLine: "\u7EA2\u7EBFA/C/D\uFF1A\u4E0D\u5199\u7BA1\u9053 state/\u3001\u4E0D\u78B0 token/launchd\u3001\u4E0D\u81EA\u52A8\u5B9A\u593A\u53D1\u5E03\u3002",
    items,
    suggestion: items.length > 0 ? `\u6700\u8FD1\u878D\u5408 ${items.length} \u6761\uFF0C\u5EFA\u8BAE\u4F18\u5148\u5173\u6CE8\u6765\u6E90\uFF1A${[...new Set(items.map((i) => i.source))].join("\u3001")}\u3002` : "\u6682\u65E0\u878D\u5408\u4EA7\u7269\uFF1A\u5148\u6267\u884C sparkos_run intel payload.fusion=true \u751F\u6210\u4ECA\u65E5\u4E8B\u5B9E\u6E05\u5355\u3002"
  };
  const dir = path14.join(path14.dirname(cfg.outDir), "dispatch");
  mkdirSync11(dir, { recursive: true });
  writeFileSync10(path14.join(dir, "preferences.json"), `${JSON.stringify(out, null, 2)}
`);
  return out;
}
var init_dispatch = __esm({
  "src/intel/dispatch.ts"() {
    "use strict";
    init_ingest();
  }
});

// src/tools/run.ts
init_vault();
import { defineTool } from "@deepseek-ai/dsh-tools";

// src/guards.ts
init_vault();
import { existsSync as existsSync2, readFileSync as readFileSync2, appendFileSync, readdirSync as readdirSync2 } from "node:fs";
import path2 from "node:path";
function eventsFile(vaultRoot) {
  return path2.join(vaultRoot, "archive", "events.jsonl");
}
function loadKnown(vaultRoot) {
  const known = /* @__PURE__ */ new Map();
  const f = eventsFile(vaultRoot);
  if (!existsSync2(f)) return known;
  for (const line of readFileSync2(f, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      known.set(e.event_id, e.date ?? "");
    } catch {
    }
  }
  return known;
}
function cardExists(uri, knowledgeRoot = KNOWLEDGE_ROOT) {
  if (!knowledgeRoot) return false;
  const m = /^(obs|model):\/\/(\d+)$/.exec(uri);
  if (!m) return false;
  const kind = m[1];
  const num = Number.parseInt(m[2], 10);
  const dir = kind === "obs" ? "observations" : "models";
  const base = path2.join(knowledgeRoot, "spark-notes", dir);
  if (!existsSync2(base)) return false;
  const prefix = String(num).padStart(3, "0");
  return readdirSync2(base).some((f) => f.startsWith(`${prefix}-`) && f.endsWith(".md"));
}
function knownLines(vaultRoot = VAULT_ROOT) {
  const f = path2.join(vaultRoot, "config", "narrative_lines.json");
  const cfg = JSON.parse(readFileSync2(f, "utf-8"));
  return new Set(cfg.lines.map((l) => l.id));
}
function validateDaily(dd, opts = {}) {
  const vaultRoot = opts.vaultRoot ?? VAULT_ROOT;
  const errors = [];
  const warnings = [];
  const known = loadKnown(vaultRoot);
  const seen = /* @__PURE__ */ new Set();
  for (const mr of dd.must_reads ?? []) {
    const eid = mr.event_id;
    if (!eid) {
      errors.push(`G2 \u7F3A event_id: ${mr.title ?? "?"}`);
      continue;
    }
    const knownDate = known.get(eid);
    if (knownDate !== void 0 && !(opts.recheck && knownDate === dd.date)) {
      errors.push(`G2 event_id \u91CD\u590D(\u5DF2\u5728\u4E8B\u4EF6\u5E93 ${knownDate}): ${eid}`);
    }
    if (seen.has(eid)) errors.push(`G2 event_id \u5F53\u65E5\u91CD\u590D: ${eid}`);
    seen.add(eid);
    const fh = mr.fresh_hours;
    if (fh === void 0 || fh > 48) {
      errors.push(`G1 \u8D85\u51FA48h\u786C\u7A97\u53E3\u6216\u7F3A\u5931 fresh_hours=${fh}: ${mr.title ?? "?"}`);
    }
  }
  for (const d of dd.drafts ?? []) {
    const cards = d.cited_cards ?? [];
    for (const c of cards) {
      if (!cardExists(c, opts.knowledgeRoot ?? KNOWLEDGE_ROOT)) errors.push(`G3 \u5F15\u7528\u5361\u4E0D\u5B58\u5728: ${c} (draft=${d.platform ?? "?"})`);
    }
    if (cards.length === 0) warnings.push(`G3 \u8349\u7A3F\u65E0\u77E5\u8BC6\u5361\u5F15\u7528(\u6DF1\u5EA6\u5C42\u7F3A\u5931): ${d.platform ?? "?"}`);
  }
  let lineIds;
  try {
    lineIds = knownLines(vaultRoot);
  } catch {
    lineIds = /* @__PURE__ */ new Set();
    errors.push("G4 \u4E3B\u7EBF\u914D\u7F6E\u7F3A\u5931\u6216\u4E0D\u53EF\u8BFB: config/narrative_lines.json");
  }
  for (const lu of dd.line_updates ?? []) {
    if (!lineIds.has(lu.line)) errors.push(`G4 \u672A\u77E5\u4E3B\u7EBF: ${lu.line}`);
  }
  const report = {
    ok: errors.length === 0,
    errors,
    warnings,
    stats: {
      must_reads: (dd.must_reads ?? []).length,
      drafts: (dd.drafts ?? []).length,
      suggestions: (dd.suggestions ?? []).length,
      distill_candidates: (dd.distill_candidates ?? []).length
    }
  };
  if (report.ok && opts.commit) {
    const file = eventsFile(vaultRoot);
    let appended = 0;
    const out = [];
    for (const mr of dd.must_reads ?? []) {
      if (known.has(mr.event_id)) continue;
      appended += 1;
      out.push(JSON.stringify({
        event_id: mr.event_id,
        date: dd.date,
        title: mr.title ?? "",
        line: mr.primary_line
      }));
    }
    if (out.length > 0) appendFileSync(file, `${out.join("\n")}
`);
    report.committed = appended;
    report.skipped = (dd.must_reads ?? []).length - appended;
  }
  return report;
}

// src/daily.ts
init_vault();
import { existsSync as existsSync3, readFileSync as readFileSync3, readdirSync as readdirSync3, statSync } from "node:fs";
import path3 from "node:path";
function listBy(dir, re) {
  try {
    return readdirSync3(dir).filter((f) => re.test(f)).sort().reverse().map((f) => path3.join(dir, f));
  } catch {
    return [];
  }
}
function readIf(file) {
  try {
    return readFileSync3(file, "utf8");
  } catch {
    return null;
  }
}
function jsonIf(file) {
  const raw = readIf(file);
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function listDailyDataFiles() {
  return listBy(DAILY_BRIEF_DIR, /^daily_data_\d{4}-\d{2}-\d{2}\.json$/);
}
function latestDailyData() {
  const files = listDailyDataFiles();
  if (files.length === 0) return null;
  return jsonIf(files[0]);
}
function listBriefings() {
  return listBy(DAILY_BRIEF_DIR, /^daily_briefing_.*\.md$/).flatMap((p) => {
    const text = readIf(p);
    if (text === null) return [];
    const base = path3.basename(p);
    const m = /^daily_briefing_(\d{4}-\d{2}-\d{2})/.exec(base);
    return [{ date: m?.[1] ?? base, text, path: p }];
  });
}
function latestBriefing() {
  return listBriefings()[0] ?? null;
}
function draftsOf(dir) {
  try {
    return readdirSync3(dir).filter((f) => f.endsWith(".md") && !f.startsWith(".")).map((f) => {
      const p = path3.join(dir, f);
      const raw = readIf(p) ?? "";
      const st = (() => {
        try {
          return statSync(p);
        } catch {
          return null;
        }
      })();
      return {
        file: f,
        path: p,
        platform: f.replace(/\.md$/, ""),
        preview: raw.split("\n").slice(0, 6).join("\n").slice(0, 400),
        bytes: raw.length,
        mtime: st?.mtimeMs ?? 0
      };
    }).sort((a, b) => b.mtime - a.mtime);
  } catch {
    return [];
  }
}
function listRuntimeDrafts() {
  return draftsOf(path3.join(DAILY_BRIEF_DIR, "drafts"));
}
function listVaultDrafts() {
  return draftsOf(path3.join(VAULT_ROOT, "drafts"));
}
function readDraft(absPath) {
  return readIf(absPath);
}
function isExamplePerfFilename(file) {
  const stem = path3.basename(file, ".json");
  return /(example|sample)/i.test(stem);
}
function isExamplePerfFile(file) {
  return typeof file._comment === "string" && /(示例|example|sample)/i.test(file._comment);
}
function listPerf() {
  const files = listBy(PERF_DIR, /\.json$/).filter((file) => !isExamplePerfFilename(file));
  const realFiles = [];
  const byPlatform = /* @__PURE__ */ new Map();
  let totalPosts = 0;
  for (const p of files) {
    const f = jsonIf(p);
    if (!f || isExamplePerfFile(f)) continue;
    realFiles.push(p);
    const posts = Array.isArray(f.posts) ? f.posts : [];
    const platform = f.platform ?? path3.basename(p, ".json");
    const acc = byPlatform.get(platform) ?? { posts: 0, totalReads: 0, last: "" };
    for (const post of posts) {
      acc.posts += 1;
      totalPosts += 1;
      acc.totalReads += Number(post.read_count) || 0;
      if (typeof post.published_at === "string" && post.published_at > acc.last) acc.last = post.published_at;
    }
    byPlatform.set(platform, acc);
  }
  return {
    files: realFiles.length,
    totalPosts,
    platforms: [...byPlatform.entries()].map(([platform, acc]) => ({
      platform,
      posts: acc.posts,
      totalReads: acc.totalReads,
      avgReads: acc.posts > 0 ? Math.round(acc.totalReads / acc.posts) : 0,
      last: acc.last
    })).sort((a, b) => b.totalReads - a.totalReads)
  };
}
function parseDistillEntry(file, dir, p) {
  const raw = readIf(p) ?? "";
  const title = /^title:\s*(.+)$/m.exec(raw)?.[1]?.trim() ?? file;
  const targets = [...raw.matchAll(/^lines?:\s*\[(.+)\]$/gm), ...raw.matchAll(/^line:\s*(.+)$/gm)].flatMap((m) => m[1].split(",")).map((s) => s.trim()).filter((s) => s !== "");
  const body = raw.split(/^---\s*$/m)[2]?.trim() ?? raw.trim();
  return { file, dir, path: p, summary: title + (body !== "" ? " \u2014 " + body.slice(0, 120) : ""), targets, content: raw };
}
function listDistillQueue() {
  const merged = /* @__PURE__ */ new Map();
  for (const p of listBy(RUNTIME_DISTILL_QUEUE, /\.md$/)) {
    const f = path3.basename(p);
    merged.set(f, parseDistillEntry(f, "runtime", p));
  }
  for (const p of listBy(path3.join(VAULT_ROOT, "distill_queue"), /\.md$/)) {
    const f = path3.basename(p);
    if (!merged.has(f)) merged.set(f, parseDistillEntry(f, "vault", p));
  }
  return [...merged.values()].sort((a, b) => a.file.localeCompare(b.file));
}
function findDistillEntry(file) {
  if (file === "" || file.includes("/") || file.includes("\\") || file.includes("..") || file.includes("\0")) return null;
  const runtime = path3.join(RUNTIME_DISTILL_QUEUE, file);
  if (existsSync3(runtime)) return parseDistillEntry(file, "runtime", runtime);
  const vault = path3.join(VAULT_ROOT, "distill_queue", file);
  if (existsSync3(vault)) return parseDistillEntry(file, "vault", vault);
  return null;
}
function runtimeEventsCount() {
  const countLines = (p) => {
    const raw = readIf(p);
    if (raw === null) return null;
    return raw.split("\n").filter((l) => l.trim() !== "").length;
  };
  return countLines(RUNTIME_EVENTS) ?? countLines(path3.join(VAULT_ROOT, "archive", "events.jsonl")) ?? 0;
}
function infoSources() {
  if (CONTENTOS_ROOT) {
    const external = jsonIf(path3.join(CONTENTOS_ROOT, "config", "info_sources.json"));
    if (external) return external;
  }
  return jsonIf(path3.join(VAULT_ROOT, "config", "info_sources.json"));
}

// src/tools/workflow.ts
init_vault();
init_report();
import { readFileSync as readFileSync8 } from "node:fs";
function lineName(id) {
  if (!id) return "\u2014";
  try {
    const names = JSON.parse(readFileSync8(VAULT_ROOT + "/config/line_names.json", "utf8"));
    return names[id] ?? id;
  } catch {
    return id;
  }
}
function freshLabel(h) {
  if (h === void 0) return "fresh=?";
  return h <= 24 ? h + "h \u65B0\u9C9C" : h <= 48 ? h + "h \u7A97\u53E3\u5185" : h + "h \u8D85\u7A97!";
}
function cmdBrief(payload) {
  const date = typeof payload.date === "string" ? payload.date : void 0;
  const briefings = listBriefings();
  const target = date ? briefings.find((b) => b.date === date) : briefings[0];
  const data = latestDailyData();
  const out = [];
  if (target) {
    out.push("===== \u6BCF\u65E5\u7B80\u62A5 " + target.date + " =====");
    out.push(target.text.trim());
  } else {
    out.push("\u5C1A\u65E0\u6BCF\u65E5\u7B80\u62A5\uFF08daily_briefing_*.md\uFF09\u3002");
  }
  if (data) {
    out.push("");
    out.push("===== daily_data " + data.date + " =====");
    out.push("\u5FC5\u8BFB " + (data.must_reads?.length ?? 0) + " \u6761 / \u4E3B\u7EBF\u589E\u91CF " + (data.line_updates?.length ?? 0) + " \u6761 / \u8349\u7A3F " + (data.drafts?.length ?? 0) + " \u7BC7 / \u5EFA\u8BAE " + (data.suggestions?.length ?? 0) + " \u6761 / \u84B8\u998F\u5019\u9009 " + (data.distill_candidates?.length ?? 0) + " \u9879");
  }
  return out;
}
function cmdTopics(payload) {
  const data = latestDailyData();
  if (!data || !data.must_reads?.length) return ["\u4ECA\u65E5\u65E0\u5FC5\u8BFB\u9009\u9898\uFF08daily_data \u4E3A\u7A7A\u6216\u7F3A\u5931\uFF09\u3002"];
  const out = ["===== \u9009\u9898\u63A8\u8350 " + data.date + "\uFF08" + data.must_reads.length + " \u6761\uFF0C\u8BC4\u5206=\u65B0\u9C9C\u5EA6\xD7\u8FDE\u8F7D\xD7\u6DF1\u5EA6\uFF09 ====="];
  const lineHeat = new Map((data.line_updates ?? []).map((l) => [l.line, l.status === "heating" ? 2 : l.status === "stable" ? 1 : 0]));
  const cardCount = /* @__PURE__ */ new Map();
  for (const c of data.citations ?? []) for (const card of c.cards ?? []) cardCount.set(card, (cardCount.get(card) ?? 0) + 1);
  const scored = (data.must_reads ?? []).map((mr) => {
    const fresh = Math.max(0, 1 - ((mr.fresh_hours ?? 48) - 24) / 48);
    const serial = lineHeat.get(mr.primary_line ?? "") ?? 1;
    const depth = Math.min(2, (mr.supporting?.length ?? 0) + Math.min(2, cardCount.size > 0 ? 1 : 0));
    return { mr, score: Math.round((fresh * 0.4 + serial * 0.4 + depth * 0.2) * 100) / 100 };
  }).sort((a, b) => b.score - a.score);
  for (const { mr, score } of scored) {
    const line = lineName(mr.primary_line);
    const supporting = mr.supporting?.length ? " \xB7 \u8865\u5145\u89D2\u5EA6 " + mr.supporting.length + " \u4E2A" : "";
    out.push("- [\u8BC4\u5206 " + score.toFixed(2) + " \xB7 " + freshLabel(mr.fresh_hours) + "] " + (mr.title ?? mr.event_id) + "\uFF08" + line + "\uFF09" + supporting);
  }
  if (payload.top !== void 0) {
    const n = Math.max(1, Number(payload.top) || 5);
    out.push("");
    out.push("Top " + n + "\uFF1A" + scored.slice(0, n).map((s) => s.mr.event_id).join(" / "));
  }
  return out;
}
function cmdDraft(payload) {
  const get = typeof payload.get === "string" ? payload.get : void 0;
  if (get) {
    const candidates = [...listRuntimeDrafts(), ...listVaultDrafts()].filter((d) => d.file === get);
    if (candidates.length === 0) return ["\u8349\u7A3F\u4E0D\u5B58\u5728\uFF1A" + get];
    const content = readDraft(candidates[0].path);
    return ["===== \u8349\u7A3F " + get + "\uFF08" + candidates[0].path + "\uFF09 =====", content ?? "(\u7A7A\u6587\u4EF6)"];
  }
  const drafts = [...listRuntimeDrafts(), ...listVaultDrafts()].filter((d, i, arr) => arr.findIndex((x) => x.file === d.file) === i).sort((a, b) => b.mtime - a.mtime);
  if (drafts.length === 0) return ["\u6682\u65E0\u8349\u7A3F\u3002"];
  return [
    "===== \u8349\u7A3F\u5217\u8868\uFF08" + drafts.length + " \u7BC7\uFF0C\u6309\u4FEE\u6539\u65F6\u95F4\u5012\u5E8F\uFF09 =====",
    ...drafts.map((d) => "- " + d.file + "\uFF08" + Math.round(d.bytes / 100) / 10 + "KB \xB7 " + new Date(d.mtime).toISOString().slice(0, 16) + "\uFF09"),
    "",
    '\u67E5\u770B\u5168\u6587\uFF1Apayload.get="<\u6587\u4EF6\u540D>"'
  ];
}
function cmdDistill(payload) {
  const queue = listDistillQueue();
  if (queue.length === 0) return ["\u84B8\u998F\u961F\u5217\u4E3A\u7A7A\u3002"];
  let approved = [];
  let rejected = [];
  try {
    const rev = JSON.parse(readFileSync8(VAULT_ROOT + "/state/distill_reviewed.json", "utf8"));
    approved = rev.approved ?? [];
    rejected = rev.rejected ?? [];
  } catch {
  }
  const pending = queue.filter((e) => !approved.includes(e.file) && !rejected.includes(e.file));
  const out = ["===== \u84B8\u998F\u5BA1\u6838\u961F\u5217 ====="];
  if (pending.length === 0) out.push("\uFF08\u65E0\u5F85\u5BA1\u6761\u76EE\uFF09");
  for (const e of pending) {
    out.push("- [\u5F85\u5BA1] " + e.file + "\uFF08" + e.dir + "\uFF09" + (e.targets.length ? " \u4E3B\u7EBF " + e.targets.join(",") : ""));
    out.push("    " + e.summary.slice(0, 100));
  }
  out.push("");
  out.push("\u5DF2\u91C7\u7EB3 " + approved.length + " \u9879\uFF08\u5F85\u5199\u56DE\u661F\u706B\u5E93\uFF09\xB7 \u5DF2\u9A73\u56DE " + rejected.length + " \u9879");
  out.push("\u91C7\u7EB3/\u9A73\u56DE\u5728\u5DE5\u4F5C\u53F0\u84B8\u998F tab \u64CD\u4F5C\uFF08POST /sparkos/mutate\uFF0C\u8FC7\u56DB\u7EA2\u7EBF\uFF09\u3002");
  return out;
}
function cmdSources(payload) {
  const info = infoSources();
  const out = ["===== \u4FE1\u606F\u6E90\u6CE8\u518C\u8868\uFF08\u53EA\u8BFB\uFF09 ====="];
  if (!info) {
    out.push("\uFF08config/info_sources.json \u7F3A\u5931\u6216\u4E0D\u53EF\u8BFB\uFF09");
  } else {
    if (info.rss?.length) out.push("RSS\uFF1A");
    for (const r of info.rss ?? []) out.push("  - " + (r.name ?? "?") + " <" + (r.url ?? "") + "> " + (r.tags ?? []).join(","));
    if (info.x_lists?.length) out.push("X list\uFF1A");
    for (const x of info.x_lists ?? []) out.push("  - " + (x.name ?? "?") + " \u2192 " + (x.accounts ?? []).join(" "));
    if (info.local_knowledge) {
      out.push("\u672C\u5730\u77E5\u8BC6\uFF1A");
      for (const [k, v] of Object.entries(info.local_knowledge)) out.push("  - " + k + " = " + v);
    }
  }
  const report = buildIntelReport();
  out.push("");
  out.push("===== intel \u5065\u5EB7\u5FEB\u7167\uFF08overall=" + report.health.overall + "\uFF09 =====");
  for (const s of report.health.sources) {
    out.push("- " + s.id + "\uFF1A" + s.status + " \xB7 staleness " + (s.stalenessHours ?? "\u2014") + "h/\u2264" + s.maxStalenessHours + "h \xB7 \u8FDE\u8D25 " + s.failStreak + (s.note ? " \xB7 " + s.note : ""));
  }
  return out;
}
function cmdPublish(payload) {
  const perf = listPerf();
  if (perf.files === 0 || perf.totalPosts === 0) {
    return ["\u6682\u65E0\u771F\u5B9E\u53D1\u5E03\u8868\u73B0\u6570\u636E\uFF08perf/*.json \u7F3A\u5931\u3001\u4E3A\u7A7A\u6216\u4EC5\u542B\u793A\u4F8B\uFF09\u2014\u2014\u4E0D\u963B\u585E\u7B80\u62A5\uFF0CP1 \u81EA\u52A8\u964D\u7EA7\u3002", "\u683C\u5F0F\u53C2\u8003\uFF1Aperf/example.json\uFF08\u793A\u4F8B\u6587\u4EF6\u4E0D\u4F1A\u8BA1\u5165\u7EDF\u8BA1\uFF09\u3002"];
  }
  const out = ["===== \u53D1\u5E03\u8868\u73B0\uFF08" + perf.files + " \u4E2A\u6570\u636E\u6587\u4EF6 \xB7 " + perf.totalPosts + " \u7BC7\uFF09 ====="];
  for (const p of perf.platforms) {
    out.push("- " + p.platform + "\uFF1A" + p.posts + " \u7BC7 \xB7 \u603B\u9605\u8BFB " + p.totalReads + " \xB7 \u5E73\u5747 " + p.avgReads + " \xB7 \u6700\u8FD1 " + (p.last || "\u2014"));
  }
  return out;
}
function cmdAdvise(payload) {
  const data = latestDailyData();
  const out = ["===== \u7CFB\u7EDF\u5EFA\u8BAE\uFF08\u53EA\u8BFB \xB7 \u6C38\u4E0D\u843D\u76D8\u5230 config\uFF09 ====="];
  if (!data?.suggestions?.length) {
    out.push("\uFF08\u5F53\u65E5\u65E0\u5EFA\u8BAE\uFF09");
  } else {
    for (const s of data.suggestions) {
      out.push("- [" + (s.type ?? "generic") + "] " + (s.note ?? ""));
    }
  }
  try {
    const decisions = JSON.parse(readFileSync8(VAULT_ROOT + "/state/decisions.json", "utf8"));
    const advice = decisions.filter((d) => d.kind === "advice");
    out.push("");
    out.push("\u5DF2\u8BB0\u5F55\u5EFA\u8BAE\u51B3\u7B56 " + advice.length + " \u6761\uFF08\u5DE5\u4F5C\u53F0 adopt/ignore \u64CD\u4F5C\u7559\u75D5\uFF09");
  } catch {
  }
  return out;
}

// src/tools/run.ts
var SUBCOMMANDS = ["brief", "topics", "draft", "distill", "sources", "publish", "advise", "intel"];
function usage() {
  return [
    "sparkos_run \u2014 SparkOS \u81EA\u5A92\u4F53\u5DE5\u4F5C\u53F0\u5165\u53E3",
    "\u5B50\u547D\u4EE4\uFF1A" + SUBCOMMANDS.join(" / "),
    "  brief    \u4ECA\u65E5\u7B80\u62A5\uFF08\u8BFB\u6700\u65B0 daily_briefing + daily_data\uFF1Bpayload.daily \u65F6\u8D70\u4E94\u5B88\u536B\uFF0Ccommit=true \u5165\u5E93\uFF09",
    "  topics   \u9009\u9898\u63A8\u8350\uFF1Bpayload.editorial=midweek|weekly \u751F\u6210\u5468\u4E09/\u5468\u516D 5 \u5F20\u53EF\u5BA1\u6279\u9009\u9898\u5361",
    "  draft    \u8349\u7A3F\u4E2D\u5FC3\uFF1Bpending \u67E5\u770B\u5F85\u751F\u6210\u5951\u7EA6\uFF0CsubmitPackage \u63D0\u4EA4\u56DB\u5E73\u53F0\u5B8C\u6574\u8349\u7A3F\u5305\uFF0Cpackages \u67E5\u770B\u72B6\u6001",
    "  distill  \u84B8\u998F\u5BA1\u6838\u961F\u5217\uFF08runtime+vault \u5408\u5E76 + \u5BA1\u6838\u72B6\u6001\uFF09",
    "  sources  \u4FE1\u606F\u6E90\uFF08info_sources.json + intel \u5065\u5EB7\u5FEB\u7167\uFF09",
    "  publish  \u53D1\u5E03\u8868\u73B0\uFF08perf/*.json \u6C47\u603B\uFF0C\u7F3A\u5931\u964D\u7EA7\uFF09",
    "  advise   \u7CFB\u7EDF\u5EFA\u8BAE\uFF08\u53EA\u8BFB\uFF0C\u5B88\u536B\u2464\uFF09",
    "  intel    \u60C5\u62A5\u6307\u6325\u6240\uFF08ingest/health\uFF1Bfusion \u878D\u5408\uFF1Banalyze/submitCluster \u60C5\u62A5\u7C07\uFF1BcardRequests \u8865\u5361\u6E05\u5355\uFF1Brank \u6BCF\u65E5Top5/\u8FDE\u7EED\u699C\uFF1Bjobs \u4EFB\u52A1\u72B6\u6001\uFF1Bdispatch \u751F\u6210\u5EFA\u8BAE\uFF09",
    "\u53C2\u6570\uFF1Aaction(string, \u53EF\u9009) \u5B50\u547D\u4EE4\uFF1Bpayload(object, \u53EF\u9009)\uFF1BdryRun(bool) \u53EA\u6821\u9A8C\u4E0D\u843D\u76D8\uFF088 \u4E2A\u5B50\u547D\u4EE4\u5168\u90E8\u96F6\u5199\u5165\uFF09",
    "VAULT\uFF1A" + VAULT_ROOT
  ].join("\n");
}
function isWriteInvocation(action, payload) {
  if (action === "brief") return payload.daily !== void 0;
  if (action === "topics") return payload.editorial === "midweek" || payload.editorial === "weekly";
  if (action === "draft") return payload.pending !== true && payload.packages !== true && (typeof payload.request === "string" || typeof payload.revise === "string" || payload.submitPackage !== void 0 || Object.keys(payload).length === 0);
  if (action === "intel") return payload.fusion === true || payload.analyze === true || payload.submitCluster !== void 0 || payload.rank === true || payload.dispatch === true || payload.cardRequests === true || Object.keys(payload).length === 0;
  return false;
}
async function previewIntelDryRun(payload) {
  const actions = ["runIntelTick\uFF08ingest / health / run \u65E5\u5FD7\uFF09"];
  if (payload.fusion === true) actions.push("\u751F\u6210\u5F53\u65E5 fusion JSON/Markdown");
  if (payload.analyze === true) actions.push("\u751F\u6210\u60C5\u62A5\u7C07 analyze \u8BF7\u6C42");
  if (payload.clusters === true) actions.push("\u8BFB\u53D6\u6700\u65B0\u60C5\u62A5\u7C07");
  if (payload.cardRequests === true) actions.push("\u751F\u6210\u8865\u5361\u6E05\u5355\uFF08\u53EA\u51FA\u5EFA\u8BAE\uFF0C\u4E0D\u5199\u661F\u706B\u5E93\uFF09");
  if (payload.submitCluster !== void 0) actions.push("\u4FDD\u5B58\u60C5\u62A5\u7C07\u5E76\u5237\u65B0\u6392\u540D");
  if (payload.rank === true) actions.push("\u5237\u65B0\u6BCF\u65E5\u6392\u540D\u4E0E\u521B\u4F5C\u5019\u9009");
  if (payload.jobs === true) actions.push("\u8BFB\u53D6\u5DE5\u5382\u4EFB\u52A1\u5FEB\u7167");
  if (payload.dispatch === true) actions.push("\u751F\u6210 dispatch preferences.json");
  const lines = [
    "[dryRun] intel \u96F6\u5199\u5165\u9884\u89C8\uFF1B\u672A\u6267\u884C runIntelTick\uFF0C\u672A\u6253\u5F00 SQLite\uFF0C\u672A\u8BFB\u5199 VAULT\u3002",
    "\u5B9E\u9645\u6267\u884C\u65F6\u5C06\u8FD0\u884C\uFF1A",
    ...actions.map((action) => "  - " + action)
  ];
  if (payload.submitCluster !== void 0) {
    const { validateCluster: validateCluster2 } = await Promise.resolve().then(() => (init_cluster(), cluster_exports));
    const errors = validateCluster2(payload.submitCluster);
    if (errors.length > 0) lines.push("submit-cluster \u6821\u9A8C\u5931\u8D25\uFF1A" + errors.join("\uFF1B"));
    else lines.push("submit-cluster \u6821\u9A8C\u901A\u8FC7\uFF1BdryRun \u672A\u4FDD\u5B58\u60C5\u62A5\u7C07\u3001\u672A\u5237\u65B0\u6392\u540D\u3002");
  }
  return { text: lines.join("\n") };
}
var DRAFT_PACKAGE_ID = /^dp-[a-f0-9]{16}$/;
async function dispatchDryRun(action, payload) {
  const head = "[dryRun] " + action + " \u96F6\u5199\u5165\u9884\u89C8\uFF08\u672A\u521D\u59CB\u5316 VAULT\u3001\u672A\u6253\u5F00 SQLite\u3001\u672A\u89E6\u53D1\u4EFB\u4F55\u5199\u5165\uFF09\u3002";
  if (action === "intel") return previewIntelDryRun(payload);
  if (action === "brief") {
    if (payload.daily !== void 0) {
      const daily = payload.daily;
      const report = validateDaily(daily, { recheck: payload.recheck === true, commit: false });
      const lines = [
        head,
        "\u5B9E\u9645\u6267\u884C\u65F6\u5C06\u8FD0\u884C\uFF1A\u4E94\u5B88\u536B\u6821\u9A8C" + (payload.commit === true ? " \u5E76\u5728\u901A\u8FC7\u540E\u5165\u5E93\uFF08commit=true\uFF09" : "\uFF08commit \u672A\u8BBE\uFF0C\u4EC5\u6821\u9A8C\u4E0D\u5165\u5E93\uFF09"),
        "\u6821\u9A8C\u7ED3\u679C\uFF1Aok=" + report.ok + " \u9519\u8BEF=" + report.errors.length + " \u8B66\u544A=" + report.warnings.length,
        ...report.warnings.map((w) => "  WARN " + w),
        ...report.errors.map((e) => "  FAIL " + e)
      ];
      return { text: lines.join("\n") };
    }
    return { text: [head, "\u5B9E\u9645\u6267\u884C\u65F6\u5C06\u8FD0\u884C\uFF1A\u8BFB\u53D6\u6700\u65B0 daily_briefing \u4E0E daily_data\uFF08\u53EA\u8BFB\uFF09\u3002"].join("\n") };
  }
  if (action === "topics") {
    if (payload.editorial === "midweek" || payload.editorial === "weekly") {
      return { text: [head, "\u5B9E\u9645\u6267\u884C\u65F6\u5C06\u8FD0\u884C\uFF1Aeditorial." + payload.editorial + " \u9009\u9898\u5361\u751F\u6210\uFF08\u5199 SQLite\uFF09", "\u53C2\u6570\u6821\u9A8C\uFF1Aeditorial=" + payload.editorial + " \u5408\u6CD5" + (payload.date !== void 0 && typeof payload.date === "string" ? "\uFF0Cdate=" + payload.date : "")].join("\n") };
    }
    if (payload.editorial !== void 0) return { text: [head, "\u53C2\u6570\u6821\u9A8C\u5931\u8D25\uFF1Aeditorial \u53EA\u5141\u8BB8 midweek|weekly\u3002"].join("\n") };
    return { text: [head, "\u5B9E\u9645\u6267\u884C\u65F6\u5C06\u8FD0\u884C\uFF1A\u8BFB\u53D6\u4E3B\u9898\u6C60\u4E0E\u5DF2\u91C7\u7EB3\u4E8B\u4EF6\uFF08\u53EA\u8BFB\uFF09\u3002"].join("\n") };
  }
  if (action === "draft") {
    if (payload.pending === true) return { text: [head, "\u5B9E\u9645\u6267\u884C\u65F6\u5C06\u8FD0\u884C\uFF1A\u5217\u51FA\u5F85\u751F\u6210\u8349\u7A3F\u5951\u7EA6\uFF08\u53EA\u8BFB SQLite\uFF09\u3002"].join("\n") };
    if (typeof payload.request === "string") {
      const okId = DRAFT_PACKAGE_ID.test(payload.request);
      return { text: [head, "\u5B9E\u9645\u6267\u884C\u65F6\u5C06\u8FD0\u884C\uFF1A\u521B\u5EFA\u8349\u7A3F\u4EFB\u52A1\u8BF7\u6C42\uFF08\u5199 SQLite\uFF09\u3002", "\u53C2\u6570\u6821\u9A8C\uFF1Arequest=" + payload.request + (okId ? "\uFF08\u5408\u6CD5 dp-id\uFF09" : "\uFF08\u4E0D\u5408\u6CD5\uFF1A\u5E94\u4E3A dp-<16\u4F4Dhex>\uFF09")].join("\n") };
    }
    if (typeof payload.revise === "string") {
      const okId = DRAFT_PACKAGE_ID.test(payload.revise);
      return { text: [head, "\u5B9E\u9645\u6267\u884C\u65F6\u5C06\u8FD0\u884C\uFF1A\u521B\u5EFA\u4E0D\u53EF\u8986\u76D6\u4FEE\u8BA2\u7248\uFF08\u5199 SQLite\uFF09\u3002", "\u53C2\u6570\u6821\u9A8C\uFF1Arevise=" + payload.revise + (okId ? "\uFF08\u5408\u6CD5 dp-id\uFF09" : "\uFF08\u4E0D\u5408\u6CD5\uFF1A\u5E94\u4E3A dp-<16\u4F4Dhex>\uFF09")].join("\n") };
    }
    if (payload.submitPackage !== void 0) {
      const submission = payload.submitPackage;
      const shapeOk = submission !== null && typeof submission === "object" && !Array.isArray(submission);
      const lines = [head, "\u5B9E\u9645\u6267\u884C\u65F6\u5C06\u8FD0\u884C\uFF1A\u5B8C\u6574\u4E8B\u5B9E\u4E0E\u5E73\u53F0\u6821\u9A8C\uFF0C\u901A\u8FC7\u540E\u5199\u8349\u7A3F\u5305\u4E0E\u4EA7\u7269\uFF08\u5199 SQLite + VAULT\uFF09\u3002"];
      lines.push(shapeOk ? "\u53C2\u6570\u6821\u9A8C\uFF1AsubmitPackage \u4E3A\u5BF9\u8C61\uFF08\u5B8C\u6574\u4E94\u5B88\u536B/\u56DB\u5E73\u53F0\u6821\u9A8C\u4EC5\u5728\u5B9E\u9645\u63D0\u4EA4\u65F6\u6267\u884C\uFF09\u3002" : "\u53C2\u6570\u6821\u9A8C\u5931\u8D25\uFF1AsubmitPackage \u5FC5\u987B\u662F\u5BF9\u8C61\u3002");
      return { text: lines.join("\n") };
    }
    if (payload.packages === true) return { text: [head, "\u5B9E\u9645\u6267\u884C\u65F6\u5C06\u8FD0\u884C\uFF1A\u5217\u51FA\u5DE5\u5382\u8349\u7A3F\u5305\uFF08\u53EA\u8BFB SQLite\uFF09\u3002"].join("\n") };
    return { text: [head, "\u5B9E\u9645\u6267\u884C\u65F6\u5C06\u8FD0\u884C\uFF1A\u8BFB\u53D6\u8349\u7A3F\u4E2D\u5FC3\u6587\u4EF6\u5217\u8868\uFF08\u53EA\u8BFB\uFF09\u3002"].join("\n") };
  }
  const readOnly = {
    distill: "\u5408\u5E76 runtime+vault \u84B8\u998F\u961F\u5217\u5E76\u5C55\u793A\u5BA1\u6838\u72B6\u6001\uFF08\u53EA\u8BFB\uFF09",
    sources: "\u8BFB\u53D6 info_sources.json \u4E0E intel \u5065\u5EB7\u5FEB\u7167\uFF08\u53EA\u8BFB\uFF09",
    publish: "\u6C47\u603B perf/*.json \u53D1\u5E03\u8868\u73B0\uFF08\u53EA\u8BFB\uFF09",
    advise: "\u8BFB\u53D6\u7CFB\u7EDF\u5EFA\u8BAE\uFF08\u53EA\u8BFB\uFF0C\u5B88\u536B\u2464\uFF09"
  };
  return { text: [head, "\u5B9E\u9645\u6267\u884C\u65F6\u5C06\u8FD0\u884C\uFF1A" + (readOnly[action] ?? "\u53EA\u8BFB\u5206\u652F")].join("\n") };
}
async function runSparkosCommand(args) {
  if (args.action === void 0) return { text: usage() };
  if (!SUBCOMMANDS.includes(args.action)) {
    return { text: "\u672A\u77E5\u5B50\u547D\u4EE4\uFF1A" + args.action + "\n" + usage() };
  }
  const dryRun = args.dryRun === true;
  const payload = args.payload ?? {};
  if (dryRun) return dispatchDryRun(args.action, payload);
  const vault = initVault();
  if (args.action === "brief" && payload.daily !== void 0) {
    const daily = payload.daily;
    const report = validateDaily(daily, {
      recheck: payload.recheck === true,
      commit: payload.commit === true
    });
    const lines = [
      "\u65E5\u671F=" + daily.date + " \u5FC5\u8BFB=" + report.stats.must_reads + " \u8349\u7A3F=" + report.stats.drafts + " \u5EFA\u8BAE=" + report.stats.suggestions + " \u84B8\u998F\u5019\u9009=" + report.stats.distill_candidates,
      ...report.warnings.map((w) => "WARN " + w),
      ...report.errors.map((e) => "FAIL " + e)
    ];
    if (!report.ok) lines.push("\u7ED3\u679C: \u6821\u9A8C\u672A\u901A\u8FC7(" + report.errors.length + " \u9519\u8BEF), \u672A\u5165\u5E93");
    else if (report.committed !== void 0) lines.push("\u7ED3\u679C: \u6821\u9A8C\u901A\u8FC7, \u65B0\u5165\u5E93 " + report.committed + " \u6761\u4E8B\u4EF6(\u5DF2\u5B58\u5728 " + report.skipped + " \u6761\u8DF3\u8FC7)");
    else lines.push("\u7ED3\u679C: \u6821\u9A8C\u901A\u8FC7(\u672A\u5165\u5E93, payload.commit=true \u624D\u5165\u5E93)");
    return { text: lines.join("\n") };
  }
  if (args.action === "brief") return { text: cmdBrief(payload).join("\n") };
  if (args.action === "topics" && (payload.editorial === "midweek" || payload.editorial === "weekly")) {
    const { runEditorialPlanning: runEditorialPlanning2 } = await Promise.resolve().then(() => (init_service2(), service_exports));
    try {
      const result = runEditorialPlanning2(payload.editorial, typeof payload.date === "string" ? payload.date : void 0);
      const p = result.plan;
      const lines = [
        `editorial ${p.mode}: ${p.periodStart}..${p.periodEnd} \xB7 ${p.cards.length} \u5F20\u9009\u9898\u5361 \xB7 ${p.status}\uFF08job=${result.jobId}${result.reused ? " \xB7 \u5E42\u7B49\u590D\u7528" : ""}\uFF09`,
        "  " + p.summary.note
      ];
      for (const card of p.cards) {
        lines.push(`  #${card.rank} [${card.verificationGrade}/${card.trendPattern}] \u4EF7\u503C=${card.expectedValue.toFixed(1)} ${card.title}`);
        lines.push("    \u5224\u65AD\uFF1A" + card.coreThesis);
        lines.push("    \u65F6\u673A\uFF1A" + card.whyNow);
        if (card.counterArguments.length > 0) lines.push("    \u53CD\u65B9\uFF1A" + card.counterArguments.join("\uFF1B"));
        if (card.risks.length > 0) lines.push("    \u98CE\u9669\uFF1A" + card.risks.join("\uFF1B"));
      }
      lines.push("  \u4E0B\u4E00\u6B65\uFF1A\u5728\u5DE5\u4F5C\u53F0\u4EBA\u5DE5\u6279\u51C6/\u9A73\u56DE\uFF1B\u672A\u6279\u51C6\u4E0D\u5F97\u8FDB\u5165\u8349\u7A3F\u751F\u6210\u3002");
      return { text: lines.join("\n") };
    } catch (error) {
      return { text: "editorial FAIL: " + (error instanceof Error ? error.message : String(error)) };
    }
  }
  if (args.action === "topics") return { text: cmdTopics(payload).join("\n") };
  if (args.action === "draft" && payload.pending === true) {
    const { listPendingDraftRequests: listPendingDraftRequests2 } = await Promise.resolve().then(() => (init_service2(), service_exports));
    const requests = listPendingDraftRequests2(typeof payload.limit === "number" ? payload.limit : 5);
    if (requests.length === 0) return { text: "\u6682\u65E0\u5F85\u751F\u6210\u8349\u7A3F\u4EFB\u52A1\u3002\u6279\u51C6 M3 \u9009\u9898\u5361\u540E\u4F1A\u81EA\u52A8\u5165\u961F\u3002" };
    return { text: ["===== \u5F85\u751F\u6210\u8349\u7A3F\u5951\u7EA6\uFF08" + requests.length + "\uFF09 =====", ...requests.map((request) => JSON.stringify(request, null, 2))].join("\n") };
  }
  if (args.action === "draft" && typeof payload.request === "string") {
    try {
      const { requestDraftPackage: requestDraftPackage2 } = await Promise.resolve().then(() => (init_service2(), service_exports));
      const result = requestDraftPackage2(payload.request);
      return { text: `\u8349\u7A3F\u4EFB\u52A1 ${result.created ? "\u5DF2\u521B\u5EFA" : "\u5DF2\u5B58\u5728"}\uFF1A
` + JSON.stringify(result.package.request, null, 2) };
    } catch (error) {
      return { text: "draft request FAIL: " + (error instanceof Error ? error.message : String(error)) };
    }
  }
  if (args.action === "draft" && typeof payload.revise === "string") {
    try {
      const { requestDraftRevision: requestDraftRevision2 } = await Promise.resolve().then(() => (init_service2(), service_exports));
      const result = requestDraftRevision2(payload.revise);
      return { text: `\u8349\u7A3F\u4FEE\u8BA2\u7248 ${result.created ? "\u5DF2\u521B\u5EFA" : "\u5DF2\u5B58\u5728"}\uFF1A
` + JSON.stringify(result.package.request, null, 2) };
    } catch (error) {
      return { text: "draft revise FAIL: " + (error instanceof Error ? error.message : String(error)) };
    }
  }
  if (args.action === "draft" && payload.submitPackage !== void 0) {
    try {
      const { runDraftSubmission: runDraftSubmission2 } = await Promise.resolve().then(() => (init_service2(), service_exports));
      const result = runDraftSubmission2(payload.submitPackage);
      if (!result.validation.ok) return { text: ["draft submit VALIDATION FAIL:", ...result.validation.errors.map((error) => "  - " + error), ...result.validation.warnings.map((warning) => "  WARN " + warning)].join("\n") };
      return { text: [
        `draft submit OK: ${result.package.id} \xB7 ${result.package.artifacts.length} \u4E2A\u4EA7\u7269 \xB7 ${result.package.status}`,
        `  \u5FAE\u4FE1 ${result.validation.stats.wechatChars} \u5B57 / Telegram ${result.validation.stats.telegramChars} \u5B57 / X ${result.validation.stats.xPosts} \u6761 / \u5C0F\u7EA2\u4E66 ${result.validation.stats.xiaohongshuChars} \u5B57 / \u914D\u56FE\u4EFB\u52A1 ${result.validation.stats.assets} \u4E2A`,
        ...result.package.artifacts.map((artifact) => "  - " + artifact.relativePath),
        "  \u4E0B\u4E00\u6B65\uFF1A\u5DE5\u4F5C\u53F0\u4EBA\u5DE5\u5BA1\u6838\uFF1B\u6279\u51C6\u524D\u4E0D\u5F97\u53D1\u5E03\u3002"
      ].join("\n") };
    } catch (error) {
      return { text: "draft submit FAIL: " + (error instanceof Error ? error.message : String(error)) };
    }
  }
  if (args.action === "draft" && payload.packages === true) {
    const { buildFactorySnapshot: buildFactorySnapshot2 } = await Promise.resolve().then(() => (init_service2(), service_exports));
    const packages = buildFactorySnapshot2().drafts;
    return { text: packages.length === 0 ? "\u6682\u65E0\u5DE5\u5382\u8349\u7A3F\u5305\u3002" : ["===== \u5DE5\u5382\u8349\u7A3F\u5305 =====", ...packages.map((item) => `- ${item.id} v${item.revision} [${item.status}] ${item.title} \xB7 \u4EA7\u7269 ${item.artifacts.length}`)].join("\n") };
  }
  if (args.action === "draft") return { text: cmdDraft(payload).join("\n") };
  if (args.action === "distill") return { text: cmdDistill(payload).join("\n") };
  if (args.action === "sources") return { text: cmdSources(payload).join("\n") };
  if (args.action === "publish") return { text: cmdPublish(payload).join("\n") };
  if (args.action === "advise") return { text: cmdAdvise(payload).join("\n") };
  if (args.action === "intel") {
    const { defaultIntelConfig: defaultIntelConfig2 } = await Promise.resolve().then(() => (init_ingest(), ingest_exports));
    const cfg = defaultIntelConfig2();
    const { runIntelTick: runIntelTick2 } = await Promise.resolve().then(() => (init_tick(), tick_exports));
    const r = runIntelTick2();
    const lines = [
      "intel tick ok=" + r.ingest.ok + " overall=" + r.overall,
      ...r.ingest.sources.map((s) => "  " + s.source + ": ok=" + s.ok + (s.error ? " error=" + s.error : "") + " scanned=" + s.scanned + " added=" + s.added + " skipped=" + s.skipped)
    ];
    if (payload.fusion === true) {
      const { fuseDaily: fuseDaily2 } = await Promise.resolve().then(() => (init_fusion(), fusion_exports));
      const f = fuseDaily2(cfg);
      lines.push("fusion: " + f.items.length + " \u6761\uFF08" + f.files.join(", ") + "\uFF09", ...f.notes.map((n) => "  " + n));
    }
    if (payload.analyze === true) {
      const { buildClusterSkeletons: buildClusterSkeletons2, writeAnalyzeRequest: writeAnalyzeRequest2 } = await Promise.resolve().then(() => (init_cluster(), cluster_exports));
      const { fuseDaily: fuseDaily2 } = await Promise.resolve().then(() => (init_fusion(), fusion_exports));
      const f2 = fuseDaily2(cfg);
      const skeletons = buildClusterSkeletons2(f2.items, f2.dupGroups);
      const r2 = writeAnalyzeRequest2(cfg, skeletons);
      lines.push("analyze: \u751F\u6210 " + skeletons.length + " \u4E2A\u60C5\u62A5\u7C07\u9AA8\u67B6\uFF08" + r2.pending + " \u5F85\u5206\u6790\uFF0C\u5176\u4E2D T0 \u5019\u9009 " + r2.t0 + " \u2192 analyze-" + f2.date + ".json\uFF09");
      if (r2.pending > 0) lines.push("  \u5F85\u8865\u5B57\u6BB5\uFF1Atopic/topicKey/coreFacts/evidence/judgment/novelty/knowledgeCards/credibility/risks/platforms/angleSuggestions");
    }
    if (payload.clusters === true) {
      const { latestClusters: latestClusters2 } = await Promise.resolve().then(() => (init_cluster(), cluster_exports));
      const lc = latestClusters2(cfg);
      if (!lc) {
        lines.push("clusters: \u6682\u65E0\u60C5\u62A5\u7C07\uFF08\u5148 payload.analyze=true \u751F\u6210\u9AA8\u67B6\uFF09");
      } else {
        lines.push("clusters: " + lc.date + " \u5171 " + lc.clusters.length + " \u7C07");
        for (const c of lc.clusters) {
          lines.push("  - " + c.clusterId + " [" + c.heat + "] " + (c.topic || "(\u5F85\u5206\u6790)") + " \xB7 \u6765\u6E90 " + c.sourceCount + " \xB7 \u4E8B\u4EF6 " + c.eventKeys.length + (c.angleSuggestions.length ? " \xB7 \u89D2\u5EA6 " + c.angleSuggestions.join(" / ") : ""));
        }
      }
    }
    if (payload.submitCluster !== void 0) {
      const { validateCluster: validateCluster2, saveClusters: saveClusters2 } = await Promise.resolve().then(() => (init_cluster(), cluster_exports));
      const c = payload.submitCluster;
      const errs = validateCluster2(c);
      if (errs.length > 0) {
        lines.push("submit-cluster FAIL: " + errs.join("\uFF1B"));
      } else {
        const r2 = saveClusters2(cfg, [c], /* @__PURE__ */ new Date());
        lines.push("submit-cluster OK: " + c.clusterId + " \u2192 " + r2.file.split("/").pop() + "\uFF08\u5171 " + r2.total + " \u7C07\uFF09");
        try {
          const { runLatestRanking: runLatestRanking2 } = await Promise.resolve().then(() => (init_service2(), service_exports));
          const ranked = runLatestRanking2();
          lines.push("  \u81EA\u52A8\u5237\u65B0\u6392\u540D\uFF1ATop " + ranked.ranking.top5.length + " \xB7 \u8FDE\u7EED\u9738\u699C " + ranked.ranking.persistent.length + " \xB7 \u53EF\u521B\u4F5C " + ranked.ranking.creationCandidates.length);
        } catch (error) {
          lines.push("  \u6392\u540D\u5237\u65B0\u5F85\u540E\u7EED\u91CD\u8BD5\uFF1A" + (error instanceof Error ? error.message : String(error)));
        }
      }
    }
    if (payload.rank === true) {
      const { runLatestRanking: runLatestRanking2 } = await Promise.resolve().then(() => (init_service2(), service_exports));
      try {
        const result = runLatestRanking2();
        lines.push("rank: " + result.ranking.date + " Top " + result.ranking.top5.length + "\uFF08job=" + result.jobId + (result.reused ? " \xB7 \u5E42\u7B49\u590D\u7528" : "") + "\uFF09");
        for (const item of result.ranking.top5) {
          lines.push("  #" + item.rank + " [" + item.verificationGrade + "] \u70ED\u5EA6=" + item.heatScore.toFixed(1) + " \u8FDE\u699C=" + item.consecutiveTopDays + "\u5929 " + item.topic);
        }
        if (result.ranking.persistent.length > 0) lines.push("  \u8FDE\u7EED\u9738\u699C\uFF1A" + result.ranking.persistent.map((item) => item.topic).join(" / "));
        lines.push("  \u53EF\u8FDB\u5165\u521B\u4F5C\uFF08\u4EC5A/B\u8BC1\u636E\uFF09\uFF1A" + result.ranking.creationCandidates.length + " \u4E2A");
      } catch (error) {
        lines.push("rank FAIL: " + (error instanceof Error ? error.message : String(error)));
      }
    }
    if (payload.jobs === true) {
      const { buildFactorySnapshot: buildFactorySnapshot2 } = await Promise.resolve().then(() => (init_service2(), service_exports));
      const snapshot = buildFactorySnapshot2();
      lines.push("jobs: schema=" + snapshot.database.schemaVersion + " \u6700\u8FD1 " + snapshot.jobs.length + " \u9879");
      for (const job of snapshot.jobs) lines.push("  - " + job.kind + " [" + job.status + "] attempts=" + job.attempts + "/" + job.maxAttempts + " id=" + job.id);
    }
    if (payload.cardRequests === true) {
      const { buildCardRequests: buildCardRequests2, writeCardRequests: writeCardRequests2 } = await Promise.resolve().then(() => (init_cards(), cards_exports));
      const { latestClusters: latestClusters2 } = await Promise.resolve().then(() => (init_cluster(), cluster_exports));
      const { latestFusion: latestFusion2 } = await Promise.resolve().then(() => (init_report(), report_exports));
      const lc = latestClusters2(cfg);
      if (!lc) {
        lines.push("card-requests: \u6682\u65E0\u60C5\u62A5\u7C07\uFF08\u5148 payload.analyze=true \u751F\u6210\u9AA8\u67B6\uFF09");
      } else {
        const titles = new Map((latestFusion2()?.items ?? []).map((i) => [i.eventKey, i.title]));
        const requests = buildCardRequests2(lc.clusters, { titles });
        const w = writeCardRequests2(cfg, requests);
        lines.push("card-requests: " + requests.length + " \u6761\u5F85\u8865\uFF08" + w.files.map((f) => f.split("/").pop()).join(", ") + "\uFF09");
        for (const r2 of requests) {
          lines.push("  - " + r2.suggestedUri + " [" + (r2.sourceHeat === null ? r2.heat : r2.sourceHeat) + "] " + r2.title);
        }
        if (requests.length > 0) lines.push("  \u63D0\u793A\uFF1A\u661F\u706B\u5E93\u53EA\u8BFB\uFF0C\u9700\u4EBA\u5DE5\u786E\u8BA4\u540E\u81EA\u884C\u5EFA\u5361\uFF08\u5EFA\u8BAE\u6587\u4EF6 " + requests[0].suggestedFile + "\uFF09\u3002");
      }
    }
    if (payload.dispatch === true) {
      const { generateDispatch: generateDispatch2 } = await Promise.resolve().then(() => (init_dispatch(), dispatch_exports));
      const d = generateDispatch2(cfg);
      lines.push("dispatch: preferences.json \u5DF2\u751F\u6210\uFF08" + d.items.length + " \u6761\u5EFA\u8BAE\uFF0C\u53D1\u5E03\u6743\u4ECD\u5F52\u539F Owner\uFF09");
    }
    return { text: lines.join("\n") };
  }
  return { text: args.action + " \u5DF2\u53D7\u7406\u3002vault=" + vault.vaultRoot + " \u8FC1\u79FB=" + vault.migrated.length + " \u5DF2\u5B58\u5728=" + vault.alreadyPresent.length };
}
function registerRunTool(ctx) {
  ctx.tools.register(defineTool({
    name: "sparkos_run",
    description: "SparkOS \u81EA\u5A92\u4F53\u5DE5\u4F5C\u53F0\uFF1Abrief/topics/draft/distill/sources/publish/advise/intel \u5B50\u547D\u4EE4\u6267\u884C\u6BCF\u65E5\u5185\u5BB9\u5DE5\u4F5C\u6D41\u3002\u5199\u64CD\u4F5C\u5148\u8FC7\u4E94\u5B88\u536B\uFF0848h\u7A97\u53E3/event_id\u53BB\u91CD/\u5F15\u7528\u5361\u5B58\u5728/\u4E3B\u7EBF\u5B58\u5728/\u5EFA\u8BAE\u53EA\u8BFB\uFF09\u3002\u4E0D\u5E26\u53C2\u6570\u8FD4\u56DE\u7528\u6CD5\u3002dryRun=true \u65F6\u5168\u90E8\u5B50\u547D\u4EE4\u96F6\u5199\u5165\uFF08\u4EC5\u6821\u9A8C\u4E0E\u9884\u89C8\uFF09\u3002",
    parameters: {
      action: { type: "string", description: "\u5B50\u547D\u4EE4\uFF1A" + SUBCOMMANDS.join(" | ") },
      payload: { type: "object", additionalProperties: true, description: "\u5B50\u547D\u4EE4\u53C2\u6570" },
      dryRun: { type: "boolean", description: "\u53EA\u6821\u9A8C\u4E0D\u843D\u76D8\uFF08\u5168\u90E8 8 \u4E2A\u5B50\u547D\u4EE4\u96F6\u5199\u5165\uFF09" }
    },
    output: {
      schema: { type: "object", additionalProperties: false, properties: { text: { type: "string", required: true } } },
      render: (_args, value) => [{ type: "text", text: value.text }]
    },
    // 并发声明收口：写动作（会写 VAULT / SQLite）不得声明并发安全。
    isConcurrencySafe: (args) => args.dryRun === true || !isWriteInvocation(args.action, args.payload ?? {}),
    async execute(args) {
      return runSparkosCommand(args);
    }
  }));
}

// src/tools/visual.ts
init_database();
init_service();
init_review();
import { defineTool as defineTool2 } from "@deepseek-ai/dsh-tools";
var output = {
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      text: { type: "string", required: true },
      value: { type: "object", additionalProperties: true, required: true }
    }
  },
  render: (_args, result) => [{ type: "text", text: result.text }]
};
function ok(text, value) {
  return { text, value: { ok: true, ...value } };
}
function failed(error) {
  const code = error instanceof VisualPipelineError ? error.code : "internal-error";
  const message = error instanceof Error ? error.message : String(error);
  return { text: `SparkOS visual ${code}: ${message}`, value: { ok: false, error: { code, message } } };
}
function withDb(operation) {
  const db = openFactoryDatabase();
  try {
    return operation(db);
  } finally {
    db.close();
  }
}
function registerVisualTools(ctx) {
  ctx.tools.register(defineTool2({
    name: "sparkos_visual_queue",
    description: "\u4E3A\u5DF2\u6279\u51C6\u4E14\u5B8C\u6574\u6027\u6821\u9A8C\u901A\u8FC7\u7684 SparkOS \u8349\u7A3F\u5305\u521B\u5EFA\u89C6\u89C9\u6279\u6B21\u3002\u6BCF\u4E2A assets.json \u9879\u72EC\u7ACB\u5EFA\u4EFB\u52A1\uFF1B\u91CD\u590D\u8C03\u7528\u5E42\u7B49\u3002",
    parameters: {
      packageId: { type: "string", required: true, description: "\u5DF2\u6279\u51C6\u8349\u7A3F\u5305 ID\uFF08dp-...\uFF09" }
    },
    output,
    isConcurrencySafe: () => false,
    async execute(args) {
      try {
        const result = withDb((db) => queueVisualBatch(db, args.packageId));
        return ok(`\u89C6\u89C9\u6279\u6B21${result.created ? "\u5DF2\u521B\u5EFA" : "\u5DF2\u5E42\u7B49\u590D\u7528"}\uFF1A${result.batch.id}\uFF0C${result.tasks.length} \u4E2A\u72EC\u7ACB\u8D44\u4EA7\u4EFB\u52A1\u3002`, result);
      } catch (error) {
        return failed(error);
      }
    }
  }));
  ctx.tools.register(defineTool2({
    name: "sparkos_visual_claim",
    description: "\u9886\u53D6\u4E00\u4E2A SparkOS \u89C6\u89C9\u8D44\u4EA7\u4EFB\u52A1\u3002\u9886\u53D6\u540E\u6309 authoritative prompt \u8C03\u7528 image_generate\uFF0C\u5FC5\u987B\u4ECE images[0] \u53D6\u5F97\u5B8C\u6574\u9644\u4EF6\u5F15\u7528\uFF08attachmentId/mediaType/bytes/width/height/name\uFF09\uFF0C\u518D\u8C03\u7528 sparkos_visual_submit\uFF1B\u4E0D\u5F97\u63D0\u4EA4 path\u3001URL \u6216 base64\u3002",
    parameters: {
      packageId: { type: "string", description: "\u53EF\u9009\uFF1A\u53EA\u9886\u53D6\u6307\u5B9A\u8349\u7A3F\u5305\u7684\u4EFB\u52A1" },
      leaseSeconds: { type: "integer", description: "\u79DF\u7EA6\u79D2\u6570\uFF0C\u9ED8\u8BA4 300\uFF1B\u5141\u8BB8 60\u2013900" }
    },
    output,
    isConcurrencySafe: () => false,
    async execute(args) {
      try {
        const claim = withDb((db) => claimVisualTask(db, args));
        if (claim === null) return ok("\u5F53\u524D\u6CA1\u6709\u53EF\u9886\u53D6\u7684\u89C6\u89C9\u4EFB\u52A1\u3002", { claimed: false });
        return ok(
          `\u5DF2\u9886\u53D6 ${claim.task.assetId}\uFF08${claim.task.targetWidth}x${claim.task.targetHeight}\uFF0Cimage_generate aspect=${claim.imageStudioAspect}\uFF09\u3002authoritativePrompt \u5DF2\u542B\u539F prompt\u3001\u56FA\u5B9A\u89C4\u683C\u4E0E\u4E8B\u5B9E\u8FB9\u754C\u7EA6\u675F${claim.previousNote ? "\uFF0C\u5E76\u9644\u9A73\u56DE\u610F\u89C1\u4E0E\u8865\u5145\u8981\u6C42" : ""}\uFF1B\u8BF7\u6309 authoritativePrompt \u8C03\u7528 image_generate\uFF0C\u518D\u5C06 images[0] \u7684\u5B8C\u6574\u9644\u4EF6\u5F15\u7528\u539F\u6837\u56DE\u4EA4 sparkos_visual_submit\u3002`,
          { claimed: true, ...claim }
        );
      } catch (error) {
        return failed(error);
      }
    }
  }));
  ctx.tools.register(defineTool2({
    name: "sparkos_visual_heartbeat",
    description: "\u4E3A\u5F53\u524D SparkOS \u89C6\u89C9\u751F\u6210 attempt \u5EF6\u957F\u79DF\u7EA6\uFF1B\u53EA\u6709\u5339\u914D\u7684\u4E00\u6B21\u6027 leaseToken \u6709\u6548\u3002",
    parameters: {
      taskId: { type: "string", required: true },
      attemptId: { type: "string", required: true },
      leaseToken: { type: "string", required: true },
      leaseSeconds: { type: "integer", description: "\u5EF6\u671F\u79D2\u6570\uFF0C\u9ED8\u8BA4 300\uFF1B\u5141\u8BB8 60\u2013900" }
    },
    output,
    isConcurrencySafe: () => false,
    async execute(args) {
      try {
        const result = withDb((db) => heartbeatVisualTask(db, args.taskId, args.attemptId, args.leaseToken, /* @__PURE__ */ new Date(), args.leaseSeconds));
        return ok(`\u89C6\u89C9\u4EFB\u52A1\u79DF\u7EA6\u5DF2\u5EF6\u957F\u81F3 ${result.leaseExpiresAt}\u3002`, result);
      } catch (error) {
        return failed(error);
      }
    }
  }));
  ctx.tools.register(defineTool2({
    name: "sparkos_visual_fail",
    description: "\u62A5\u544A\u5F53\u524D\u89C6\u89C9 attempt \u5931\u8D25\u3002\u53EF\u91CD\u8BD5\u4E14\u672A\u8FBE\u5230 maxAttempts \u65F6\u56DE\u5230 retry\uFF0C\u5426\u5219\u8FDB\u5165 failed\uFF1B\u5386\u53F2 attempt/event \u4FDD\u7559\u3002",
    parameters: {
      taskId: { type: "string", required: true },
      attemptId: { type: "string", required: true },
      leaseToken: { type: "string", required: true },
      code: { type: "string", required: true },
      message: { type: "string", required: true },
      retryable: { type: "boolean", required: true }
    },
    output,
    isConcurrencySafe: () => false,
    async execute(args) {
      try {
        const result = withDb((db) => failVisualTask(db, args));
        return ok(`\u89C6\u89C9 attempt \u5DF2\u8BB0\u5F55\u5931\u8D25\uFF0C\u4EFB\u52A1\u72B6\u6001=${result.state}\u3002`, result);
      } catch (error) {
        return failed(error);
      }
    }
  }));
  ctx.tools.register(defineTool2({
    name: "sparkos_visual_submit",
    description: "\u56DE\u4EA4 image_generate \u7684\u53EF\u9760\u9644\u4EF6\u3002\u5148 claim\uFF0C\u518D\u8C03\u7528 image_generate\uFF0C\u6700\u540E\u628A images[0] \u7684\u5B8C\u6574 attachment ref \u539F\u6837\u63D0\u4EA4\uFF1BSparkOS \u4F1A\u901A\u8FC7\u6B63\u5F0F attachments \u670D\u52A1\u91CD\u8BFB\u3001\u6821\u9A8C\u5E76\u4E0D\u53EF\u53D8\u4FDD\u5B58\u3002\u7981\u6B62 path\u3001URL\u3001base64\u3002\u6210\u529F\u53EA\u63A8\u8FDB\u5230 waiting_visual_approval\u3002",
    parameters: {
      taskId: { type: "string", required: true },
      attemptId: { type: "string", required: true },
      leaseToken: { type: "string", required: true },
      attachment: {
        type: "object",
        required: true,
        additionalProperties: false,
        properties: {
          attachmentId: { type: "string", required: true },
          mediaType: { type: "string", required: true },
          bytes: { type: "integer", required: true },
          width: { type: "integer", required: true },
          height: { type: "integer", required: true },
          name: { type: "string" }
        }
      },
      provider: { type: "string" },
      model: { type: "string" },
      sourceTool: { type: "string", required: true, description: "\u901A\u5E38\u4E3A image_generate" },
      sourceCallId: { type: "string" },
      promptEffective: { type: "string" },
      negativePrompt: { type: "string" },
      seedRequested: { type: "integer" },
      seedEffective: { type: "boolean" },
      revisedPrompt: { type: "string" },
      contentFilter: { type: "string" },
      generatedAt: { type: "string" }
    },
    output,
    isConcurrencySafe: () => false,
    async execute(args, execution) {
      const db = openFactoryDatabase();
      try {
        const attachments = ctx.get("attachments");
        const result = await submitVisualAttachment(db, attachments, args, { signal: execution.signal });
        return ok(`\u89C6\u89C9\u9644\u4EF6\u5DF2\u9A8C\u8BC1\u5E76\u4E0D\u53EF\u53D8\u4FDD\u5B58\uFF1A${result.relativePath}\uFF1B\u72B6\u6001=waiting_visual_approval\uFF0CM5A \u4E0D\u4F1A\u81EA\u52A8\u6279\u51C6\u6216\u53D1\u5E03\u3002`, result);
      } catch (error) {
        return failed(error);
      } finally {
        db.close();
      }
    }
  }));
  ctx.tools.register(defineTool2({
    name: "sparkos_visual_retry",
    description: "\u4EC5\u5C06\u5DF2\u88AB\u4EBA\u5DE5\u9A73\u56DE\u4E14\u5E26\u5BA1\u6838\u610F\u89C1\u7684\u89C6\u89C9\u4EFB\u52A1\u8F6C\u5165 retry\uFF08\u4E0E HTTP \u53D7\u63A7\u91CD\u8BD5\u540C\u4E00\u540E\u7AEF\u72B6\u6001\u673A\uFF1A\u8D44\u683C\u95E8\u3001visual_retry_requests \u5BA1\u8BA1\u3001\u5E42\u7B49\u952E\u3001\u5E76\u53D1\u51B2\u7A81\u4FDD\u62A4\uFF09\u3002\u4E0D\u80FD\u6279\u51C6\u56FE\u7247\uFF1B\u65E7\u56FE\u7247\u3001attempt \u548C approval \u5168\u90E8\u4FDD\u7559\uFF1Bstub \u6D4B\u8BD5\u56FE\u9700\u4EBA\u5DE5\u8D70 replace_stub_with_production \u6D41\u7A0B\u3002",
    parameters: {
      taskId: { type: "string", required: true, description: "\u5DF2\u88AB\u4EBA\u5DE5\u9A73\u56DE\u7684\u89C6\u89C9\u4EFB\u52A1 ID\uFF08vt-...\uFF09" }
    },
    output,
    isConcurrencySafe: () => false,
    async execute(args) {
      try {
        const result = withDb((db) => retryVisualTask(db, args.taskId));
        return ok(`\u89C6\u89C9\u4EFB\u52A1\u5DF2\u6309\u4EBA\u5DE5\u610F\u89C1\u8F6C\u5165 retry\uFF1B\u524D\u6B21\u610F\u89C1\uFF1A${result.previousNote}`, result);
      } catch (error) {
        return failed(error);
      }
    }
  }));
  ctx.tools.register(defineTool2({
    name: "sparkos_visual_status",
    description: "\u53EA\u8BFB\u67E5\u8BE2 SparkOS \u89C6\u89C9\u6279\u6B21\u3001\u4EFB\u52A1\u3001attempt\u3001\u5BA1\u6838\u3001\u4EA4\u4ED8\u4E0E\u5404\u5E73\u53F0\u53D1\u5E03\u51C6\u5907\u5EA6\uFF1B\u4E0D\u4F1A\u6267\u884C\u53D1\u5E03\u3002",
    parameters: {
      packageId: { type: "string", description: "\u53EF\u9009\uFF1A\u7B5B\u9009\u8349\u7A3F\u5305" }
    },
    output,
    isConcurrencySafe: () => true,
    async execute(args) {
      try {
        const snapshot = withDb((db) => visualStatus(db, args.packageId));
        return ok(`\u89C6\u89C9\u6279\u6B21 ${snapshot.batches.length} \u4E2A\uFF1B\u8FD9\u91CC\u53EA\u8BFB\u62A5\u544A\u51C6\u5907\u5EA6\uFF0C\u4E0D\u6267\u884C\u6279\u51C6\u6216\u53D1\u5E03\u3002`, snapshot);
      } catch (error) {
        return failed(error);
      }
    }
  }));
}

// src/server/routes.ts
import { readFileSync as readFileSync18 } from "node:fs";
import nodePath2 from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";

// src/server/data.ts
import { readFileSync as readFileSync15, readdirSync as readdirSync14 } from "node:fs";

// src/storage/atomic.ts
import { mkdirSync as mkdirSync12, renameSync as renameSync3, rmSync as rmSync5, writeFileSync as writeFileSync11, openSync as openSync2, closeSync as closeSync2, fsyncSync as fsyncSync2 } from "node:fs";
import path15 from "node:path";
import { randomUUID as randomUUID6 } from "node:crypto";
function atomicWriteFile(target, content, options = {}) {
  const parent = path15.dirname(target);
  mkdirSync12(parent, { recursive: true });
  const staging = path15.join(parent, "." + path15.basename(target) + "-" + randomUUID6() + ".tmp");
  try {
    writeFileSync11(staging, content, { mode: options.mode ?? 420 });
    const fd = openSync2(staging, "r+");
    try {
      fsyncSync2(fd);
    } finally {
      closeSync2(fd);
    }
    renameSync3(staging, target);
  } catch (error) {
    rmSync5(staging, { force: true });
    throw error;
  }
}
function atomicWriteJson(target, value, options = {}) {
  atomicWriteFile(target, JSON.stringify(value, null, 2) + "\n", options);
}

// src/server/data.ts
init_vault();
init_report();
init_dispatch();
init_cluster();
init_ingest();
import path17 from "node:path";
init_service2();

// src/server/mediaos.ts
init_vault();
import { readFileSync as readFileSync14, statSync as statSync4 } from "node:fs";
import path16 from "node:path";
function mediaOsPaths(root = MEDIA_OS_ROOT) {
  return {
    root,
    schedule: path16.join(root, "01-content", "30\u5929\u6392\u671F.md"),
    metrics: path16.join(root, "04-data", "metrics.csv"),
    topicPool: path16.join(root, "01-content", "\u9009\u9898\u6C60.md")
  };
}
function safeRead(file) {
  try {
    return readFileSync14(file, "utf8");
  } catch {
    return null;
  }
}
function safeMtime(file) {
  try {
    return statSync4(file).mtime.toISOString();
  } catch {
    return null;
  }
}
function parseRange(text) {
  const m = /(\d{4})-(\d{2})-(\d{2})\s*[→~-]\s*(?:(\d{4})-)?(\d{2})-(\d{2})/.exec(text);
  if (!m) return null;
  const startYear = Number(m[1]);
  const start = new Date(Date.UTC(startYear, Number(m[2]) - 1, Number(m[3])));
  let endYear = m[4] ? Number(m[4]) : startYear;
  let end = new Date(Date.UTC(endYear, Number(m[5]) - 1, Number(m[6])));
  if (!m[4] && end.getTime() < start.getTime()) {
    endYear += 1;
    end = new Date(Date.UTC(endYear, Number(m[5]) - 1, Number(m[6])));
  }
  return { start, end };
}
function parseSchedule(text, today) {
  const range = /\d{4}-\d{2}-\d{2}\s*[→~-]\s*(?:\d{4}-)?\d{2}-\d{2}/.exec(text)?.[0] ?? null;
  const parsed = range ? parseRange(range) : null;
  const [y, m, d] = today.split("-").map(Number);
  const inRange = parsed ? new Date(Date.UTC(y, m - 1, d)).getTime() >= parsed.start.getTime() && new Date(Date.UTC(y, m - 1, d)).getTime() <= parsed.end.getTime() : false;
  const items = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    if (cells.length < 2) continue;
    const head = cells[0];
    const date = /^(?:周)?[一二三四五六日]\s*(\d{1,2})\/(\d{1,2})/.exec(head);
    if (!date) continue;
    if (Number(date[1]) !== m || Number(date[2]) !== d) continue;
    const action = cells.slice(1).filter((c) => c !== "").join(" \xB7 ");
    if (action === "") continue;
    items.push({ label: head, action });
  }
  return { items, range, inRange };
}
function parseMetrics(text) {
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  if (lines.length <= 1) return { rows: 0, lastDate: null };
  const body = lines.slice(1);
  let lastDate = null;
  for (const line of body) {
    const first = line.split(",")[0]?.trim();
    if (first && /^\d{4}-\d{2}-\d{2}$/.test(first)) lastDate = first;
  }
  return { rows: body.length, lastDate };
}
function parseTopicPool(text) {
  let n = 0;
  for (const line of text.split("\n")) {
    if (/^\|\s*\d{2}-\d{2}\s*\|/.test(line)) n += 1;
  }
  return n;
}
function buildMediaOsSnapshot(today, root = MEDIA_OS_ROOT) {
  const p = mediaOsPaths(root);
  const scheduleText = safeRead(p.schedule);
  const metricsText = safeRead(p.metrics);
  const poolText = safeRead(p.topicPool);
  const sched = scheduleText ? parseSchedule(scheduleText, today) : null;
  const metrics = metricsText ? parseMetrics(metricsText) : null;
  return {
    root: p.root,
    available: scheduleText !== null || metricsText !== null || poolText !== null,
    today,
    schedule: {
      present: scheduleText !== null,
      items: sched?.items ?? [],
      range: sched?.range ?? null,
      inRange: sched?.inRange ?? false,
      updatedAt: safeMtime(p.schedule)
    },
    metrics: {
      present: metricsText !== null,
      rows: metrics?.rows ?? 0,
      lastDate: metrics?.lastDate ?? null,
      updatedAt: safeMtime(p.metrics)
    },
    topicPool: {
      present: poolText !== null,
      entries: poolText ? parseTopicPool(poolText) : 0,
      updatedAt: safeMtime(p.topicPool)
    }
  };
}

// src/server/data.ts
init_cards();
function readJsonIf(file, fallback) {
  try {
    return JSON.parse(readFileSync15(file, "utf8"));
  } catch {
    return fallback;
  }
}
function listFiles(dir) {
  try {
    return readdirSync14(dir).filter((f) => !f.startsWith("."));
  } catch {
    return [];
  }
}
function loadWritebackQueue() {
  return readJsonIf(path17.join(VAULT_ROOT, "state", "writeback_queue.json"), []);
}
function appendWriteback(entry) {
  const file = path17.join(VAULT_ROOT, "state", "writeback_queue.json");
  const all = loadWritebackQueue().filter((e) => e.file !== entry.file);
  all.push(entry);
  atomicWriteJson(file, all);
}
function suggestTarget(content) {
  const kind = /^kind:\s*(.+)$/m.exec(content)?.[1]?.trim().toLowerCase() ?? "";
  const sub = kind === "model" ? "models" : kind === "cruise" ? "cruises" : "observations";
  return "spark-notes/" + sub + "/\uFF08\u4EBA\u5DE5\u6838\u5BF9\u540E\u7C98\u8D34\u5199\u5165\uFF0C\u63D2\u4EF6\u4E0D\u81EA\u52A8\u5199\u661F\u706B\u5E93\uFF09";
}
function redLineCheck(content) {
  return RED_LINE_PATTERNS.filter((r) => r.pattern.test(content)).map((r) => "\u7EA2\u7EBF" + r.id + "\uFF1A" + r.label);
}
function daysSince(dateStr) {
  if (!dateStr) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return null;
  const now = /* @__PURE__ */ new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((today.getTime() - d.getTime()) / 864e5);
}
function localDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + day;
}
function buildDailyCycle() {
  const today = localDateStr(/* @__PURE__ */ new Date());
  const d = latestDailyData();
  if (d?.date === today) return { status: "done", dailyDate: today };
  const cycle = readJsonIf(path17.join(VAULT_ROOT, "system", "daily_cycle.json"), null) ?? {};
  if (cycle.status === "due" && typeof cycle.fusionDate === "string" && cycle.fusionDate.length === 8) {
    const fDate = cycle.fusionDate.slice(0, 4) + "-" + cycle.fusionDate.slice(4, 6) + "-" + cycle.fusionDate.slice(6, 8);
    if (fDate === today) return { status: "due", fusionDate: fDate, dailyDate: d?.date ?? void 0, note: cycle.note };
  }
  return { status: "idle", dailyDate: d?.date ?? void 0 };
}
function buildWorkbenchData() {
  const lineNames = readJsonIf(
    path17.join(VAULT_ROOT, "config", "line_names.json"),
    {}
  );
  const narrativeDoc = readJsonIf(
    path17.join(VAULT_ROOT, "config", "narrative_lines.json"),
    {}
  );
  const narrative = Array.isArray(narrativeDoc) ? narrativeDoc : narrativeDoc.lines ?? [];
  const lines = narrative.map((l, i) => ({
    id: String(l.id ?? l.line_id ?? "line-" + String(i + 1).padStart(3, "0")),
    name: String(l.name ?? l.title ?? lineNames[String(l.id ?? "")] ?? "\u4E3B\u7EBF" + (i + 1))
  }));
  const timeline = readJsonIf(
    path17.join(VAULT_ROOT, "config", "timeline_cards.json"),
    readJsonIf(TIMELINE_DATA, { cards: [] })
  );
  const decisions = readJsonIf(
    path17.join(VAULT_ROOT, "state", "decisions.json"),
    []
  );
  const reviewed = readJsonIf(
    path17.join(VAULT_ROOT, "state", "distill_reviewed.json"),
    { approved: [], rejected: [] }
  );
  const dailyData = latestDailyData();
  const briefing = latestBriefing();
  const distillAll = listDistillQueue().map((e) => ({
    ...e,
    reviewed: reviewed.approved.includes(e.file) ? "approved" : reviewed.rejected.includes(e.file) ? "rejected" : void 0
  }));
  const runtimeDrafts = [...listRuntimeDrafts(), ...listVaultDrafts()].filter((d, i, arr) => arr.findIndex((x) => x.file === d.file) === i).sort((a, b) => b.mtime - a.mtime);
  const fusion = latestFusion();
  const lc = latestClusters(defaultIntelConfig());
  const clustersSnapshot = lc ? { date: lc.date, items: lc.clusters } : { date: null, items: [] };
  const cardRequestTitles = new Map((fusion?.items ?? []).map((i) => [i.eventKey, i.title]));
  return {
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    vaultRoot: VAULT_ROOT,
    lines,
    timeline: { d0: timeline.d0, days: timeline.days, cards: timeline.cards ?? [] },
    events: runtimeEventsCount(),
    drafts: listFiles(path17.join(VAULT_ROOT, "drafts")),
    distillQueue: distillAll.filter((e) => !e.reviewed).map(({ file, dir, summary, targets }) => ({ file, dir, summary, targets })),
    distillReviewed: reviewed,
    writebackQueue: loadWritebackQueue(),
    decisions,
    intel: buildIntelReport(),
    daily: {
      date: dailyData?.date ?? null,
      briefingDate: briefing?.date ?? null,
      briefing: briefing?.text ?? null,
      data: dailyData,
      ageDays: daysSince(dailyData?.date)
    },
    runtimeDrafts: runtimeDrafts.map(({ file, path: path19, platform, preview, bytes }) => ({ file, path: path19, platform, preview, bytes })),
    perf: listPerf(),
    infoSources: infoSources(),
    fusion,
    dispatch: latestDispatch(),
    clusters: clustersSnapshot,
    cardRequests: buildCardRequests(clustersSnapshot.items, { titles: cardRequestTitles }),
    factory: buildFactorySnapshot(),
    dailyCycle: buildDailyCycle(),
    // 编辑侧只读：排期/数据主表/选题池。today 取自每日产物日期，缺失时退回宿主当天。
    mediaOs: buildMediaOsSnapshot(dailyData?.date ?? (/* @__PURE__ */ new Date()).toISOString().slice(0, 10))
  };
}
function reviewDistill(file, action) {
  const entry = findDistillEntry(file);
  if (action === "adopt" && !entry) {
    throw new Error("\u84B8\u998F\u6761\u76EE\u4E0D\u5B58\u5728\u6216\u4E0D\u53EF\u8BFB\uFF1A" + file + "\uFF0C\u62D2\u7EDD\u65E0\u5185\u5BB9\u91C7\u7EB3");
  }
  const content = entry?.content ?? "";
  const violations = action === "adopt" ? redLineCheck(content) : [];
  if (violations.length > 0) {
    throw new Error("\u7EA2\u7EBF\u68C0\u67E5\u672A\u8FC7\uFF1A" + violations.join("\uFF1B"));
  }
  const stateDir = path17.join(VAULT_ROOT, "state");
  const reviewedFile = path17.join(stateDir, "distill_reviewed.json");
  const reviewed = readJsonIf(reviewedFile, { approved: [], rejected: [] });
  const list = action === "adopt" ? reviewed.approved : reviewed.rejected;
  if (!list.includes(file)) list.push(file);
  atomicWriteJson(reviewedFile, reviewed);
  if (action === "adopt" && entry) {
    appendWriteback({
      file,
      at: (/* @__PURE__ */ new Date()).toISOString(),
      dir: entry.dir,
      target: suggestTarget(content),
      content
    });
  }
  return { entry: recordDecision("distill", file, action), violations };
}
function recordDecision(kind, id, action, note) {
  const stateDir = path17.join(VAULT_ROOT, "state");
  const file = path17.join(stateDir, "decisions.json");
  const all = readJsonIf(file, []);
  const entry = { at: (/* @__PURE__ */ new Date()).toISOString(), kind, id, action, note };
  all.push(entry);
  atomicWriteJson(file, all);
  return entry;
}
var RED_LINE_PATTERNS = [
  { id: "A", label: "\u4E0D\u5F97\u8981\u6C42\u5199\u60C5\u62A5\u7BA1\u9053 state/ \u6216\u52A8 token/\u94A5\u5319\u4E32/launchd", pattern: /(管道).{0,24}(state\/|token|钥匙串|launchd)|(state\/|token|钥匙串|launchd).{0,24}(管道)/ },
  { id: "B", label: "ownership \u5FC5\u987B\u4FDD\u6301 pending\uFF08\u4E0D\u5141\u8BB8\u4E00\u5200\u5207\u63A5\u7BA1\uFF09", pattern: /ownership.{0,20}(takeover|接管生效|owner\s*[:=]\s*dsch?)/i },
  { id: "D", label: "\u4E0D\u5F97\u81EA\u52A8\u5B9A\u593A\u53D1\u5E03\uFF08\u6700\u7EC8\u88C1\u51B3\u5F52\u4EBA\u5DE5\uFF09", pattern: /自动发布|自动定夺|无需人工|跳过审核/ }
];

// src/server/routes.ts
init_report();
init_tick();
init_database();
init_service();
init_review();
init_security();

// src/server/access.ts
function denyAdmission() {
  return { rejection: 401 };
}
function refuseAdmission(res, status) {
  res.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "private, no-store"
  });
  res.end(status === 401 ? "unauthorized" : "forbidden");
}

// src/server/mode.ts
init_vault();
import { readFileSync as readFileSync16 } from "node:fs";
import nodePath from "node:path";
function workbenchMode() {
  const env = process.env.SPARKOS_WORKBENCH_MODE;
  if (env === "full" || env === "brief") return env;
  try {
    const raw = JSON.parse(readFileSync16(nodePath.join(VAULT_ROOT, "config", "workbench_mode.json"), "utf8"));
    if (raw && (raw.mode === "full" || raw.mode === "brief")) return raw.mode;
  } catch {
  }
  return "brief";
}
function factoryEnabled() {
  return workbenchMode() === "full";
}

// src/visual/delivery.ts
init_vault();
init_errors();
init_review();
import { createHash as createHash7, randomUUID as randomUUID7 } from "node:crypto";
import {
  existsSync as existsSync14,
  lstatSync as lstatSync3,
  mkdirSync as mkdirSync14,
  readFileSync as readFileSync17,
  realpathSync as realpathSync3,
  renameSync as renameSync4,
  rmSync as rmSync6,
  writeFileSync as writeFileSync12
} from "node:fs";
import path18 from "node:path";

// src/visual/zip.ts
var FORBIDDEN = /(^|\/)(?:\.DS_Store|\._[^/]+|[^/]+\.(?:tmp|temp|swp)|~[^/]*)$/i;
function safeZipPath(value) {
  const normalized = value.replaceAll("\\", "/");
  if (normalized === "" || normalized.startsWith("/") || /^[a-z]:\//i.test(normalized) || normalized.split("/").some((part) => part === "" || part === "." || part === "..") || FORBIDDEN.test(normalized)) {
    throw new Error("\u4E0D\u5B89\u5168\u7684 ZIP \u6761\u76EE\uFF1A" + value);
  }
  return normalized;
}
var CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) !== 0 ? 3988292384 ^ value >>> 1 : value >>> 1;
  return value >>> 0;
});
function crc32(data) {
  let crc = 4294967295;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 255] ^ crc >>> 8;
  return (crc ^ 4294967295) >>> 0;
}
function localHeader(name2, data, crc) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(67324752, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(2048, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(33, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(data.byteLength, 18);
  header.writeUInt32LE(data.byteLength, 22);
  header.writeUInt16LE(name2.byteLength, 26);
  return header;
}
function centralHeader(name2, data, crc, offset) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(33639248, 0);
  header.writeUInt16LE(788, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(2048, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt16LE(33, 14);
  header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(data.byteLength, 20);
  header.writeUInt32LE(data.byteLength, 24);
  header.writeUInt16LE(name2.byteLength, 28);
  header.writeUInt32LE(33188 << 16 >>> 0, 38);
  header.writeUInt32LE(offset, 42);
  return header;
}
function deterministicZip(input) {
  const entries = input.map((entry) => ({ path: safeZipPath(entry.path), data: Buffer.from(entry.data) })).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  if (new Set(entries.map((entry) => entry.path)).size !== entries.length) throw new Error("ZIP \u6761\u76EE\u91CD\u590D");
  const locals = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name2 = Buffer.from(entry.path, "utf8");
    const crc = crc32(entry.data);
    const header = localHeader(name2, entry.data, crc);
    locals.push(header, name2, entry.data);
    central.push(centralHeader(name2, entry.data, crc, offset), name2);
    offset += header.byteLength + name2.byteLength + entry.data.byteLength;
  }
  const centralSize = central.reduce((sum, item) => sum + item.byteLength, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(101010256, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...central, end]);
}

// src/visual/delivery.ts
var PACKAGE_ID3 = /^dp-[a-f0-9]{16}$/;
var DELIVERY_ID = /^vd-[a-f0-9]{20}$/;
var ASSET_ID3 = /^[a-z0-9][a-z0-9._-]{2,48}$/i;
var MIME_EXTENSION = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
function sha2563(data) {
  return createHash7("sha256").update(data).digest("hex");
}
function json(value) {
  return Buffer.from(JSON.stringify(value, null, 2) + "\n");
}
function escapeHtml2(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
function safeMarkdown(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\\", "\\\\").replaceAll("[", "\\[").replaceAll("]", "\\]").replaceAll("(", "\\(").replaceAll(")", "\\)");
}
function ensureSafeDirectory(root, relative) {
  const canonicalRoot = realpathSync3(root);
  let current = root;
  for (const part of relative.split("/")) {
    if (part === "" || part === "." || part === "..") throw new VisualPipelineError("unsafe-path", "\u4EA4\u4ED8\u76EE\u5F55\u4E0D\u5408\u6CD5", 422);
    current = path18.join(current, part);
    if (!existsSync14(current)) mkdirSync14(current, { mode: 448 });
    const info = lstatSync3(current);
    if (!info.isDirectory() || info.isSymbolicLink() || !realpathSync3(current).startsWith(canonicalRoot + path18.sep)) {
      throw new VisualPipelineError("unsafe-path", "\u4EA4\u4ED8\u76EE\u5F55\u5305\u542B symlink \u6216\u8D8A\u754C\u8DEF\u5F84", 422);
    }
  }
  return current;
}
function safeVaultFile(relative, expectedSha, expectedBytes) {
  const integrity = (reason) => new VisualPipelineError("artifact-integrity-failed", reason, 422);
  if (path18.isAbsolute(relative) || relative.includes("\0")) throw integrity("\u89C6\u89C9\u6587\u4EF6\u8DEF\u5F84\u4E0D\u5408\u6CD5");
  const root = path18.resolve(VAULT_ROOT);
  const absolute = path18.resolve(root, relative);
  if (!absolute.startsWith(root + path18.sep)) throw integrity("\u89C6\u89C9\u6587\u4EF6\u8DEF\u5F84\u8D8A\u754C");
  let info;
  let real;
  let rootReal;
  let data;
  try {
    info = lstatSync3(absolute);
    real = realpathSync3(absolute);
    rootReal = realpathSync3(root);
    data = readFileSync17(absolute);
  } catch {
    throw integrity("\u89C6\u89C9\u6587\u4EF6\u7F3A\u5931\u6216\u4E0D\u53EF\u8BFB\uFF1A" + relative);
  }
  if (!info.isFile() || info.isSymbolicLink() || !real.startsWith(rootReal + path18.sep)) {
    throw integrity("\u89C6\u89C9\u6587\u4EF6\u5FC5\u987B\u662F VAULT \u5185\u666E\u901A\u6587\u4EF6");
  }
  if (data.byteLength !== expectedBytes || sha2563(data) !== expectedSha) throw integrity("\u89C6\u89C9\u6587\u4EF6\u54C8\u5E0C\u6216\u5927\u5C0F\u4E0D\u5339\u914D");
  return data;
}
function readSource(db, packageId) {
  if (!PACKAGE_ID3.test(packageId)) throw new VisualPipelineError("bad-request", "packageId \u4E0D\u5408\u6CD5", 400);
  const draft = db.prepare("SELECT id, contract_version, status, updated_at, decided_at FROM draft_packages WHERE id=?").get(packageId);
  if (!draft) throw new VisualPipelineError("not-found", "\u8349\u7A3F\u5305\u4E0D\u5B58\u5728", 404);
  if (draft.status !== "approved") throw new VisualPipelineError("package-not-approved", "\u53EA\u6709 approved \u8349\u7A3F\u53EF\u4EE5\u751F\u6210\u89C6\u89C9\u4EA4\u4ED8\u5305", 409);
  const packageArtifact = db.prepare(`
    SELECT relative_path, sha256, bytes FROM draft_artifacts
    WHERE package_id=? AND relative_path LIKE '%/package.json'
  `).get(packageId);
  if (!packageArtifact || path18.basename(packageArtifact.relative_path) !== "package.json") throw new VisualPipelineError("artifact-integrity-failed", "\u539F\u8349\u7A3F package.json \u4E0D\u5B58\u5728", 422);
  const sourceData = safeVaultFile(packageArtifact.relative_path, packageArtifact.sha256, Number(packageArtifact.bytes));
  let submission;
  try {
    submission = JSON.parse(sourceData.toString("utf8"));
  } catch (error) {
    throw new VisualPipelineError("artifact-integrity-failed", "\u539F\u8349\u7A3F package.json \u4E0D\u662F\u5408\u6CD5 JSON", 422, { cause: error });
  }
  if (submission.packageId !== packageId || !Array.isArray(submission.assets)) throw new VisualPipelineError("artifact-integrity-failed", "\u539F\u8349\u7A3F package.json \u6807\u8BC6\u4E0D\u4E00\u81F4", 422);
  const batch = db.prepare("SELECT id FROM visual_batches WHERE package_id=?").get(packageId);
  if (!batch) throw new VisualPipelineError("not-found", "\u89C6\u89C9\u6279\u6B21\u4E0D\u5B58\u5728", 404);
  const tasks = db.prepare(`
    SELECT t.id AS task_id, t.batch_id, t.asset_id, t.kind, t.placement, t.prompt, t.alt_text,
           t.current_attempt, a.id AS attempt_id, a.attempt_no, a.provider, a.model, a.source_media_type,
           a.source_bytes, a.source_width, a.source_height, a.imported_relative_path, a.imported_sha256, a.imported_at
    FROM visual_asset_tasks t
    LEFT JOIN visual_asset_attempts a ON a.task_id=t.id AND a.attempt_no=t.current_attempt
    WHERE t.batch_id=? ORDER BY t.asset_id
  `).all(batch.id);
  if (tasks.length !== submission.assets.length) throw new VisualPipelineError("artifact-integrity-failed", "\u89C6\u89C9\u4EFB\u52A1\u4E0E\u539F\u8349\u7A3F assets \u6570\u91CF\u4E0D\u4E00\u81F4", 422);
  return { draft, batchId: batch.id, submission, sourceSha256: packageArtifact.sha256, tasks };
}
function preparedAssets(db, source) {
  const plans = new Map(source.submission.assets.map((asset) => [asset.id, asset]));
  if (plans.size !== source.submission.assets.length) throw new VisualPipelineError("artifact-integrity-failed", "\u539F\u8349\u7A3F assetId \u91CD\u590D", 422);
  return source.tasks.map((task) => {
    if (!ASSET_ID3.test(task.asset_id)) throw new VisualPipelineError("artifact-integrity-failed", "assetId \u4E0D\u5408\u6CD5", 422);
    const plan = plans.get(task.asset_id);
    if (!plan || plan.kind !== task.kind || plan.placement !== task.placement || plan.prompt !== task.prompt || plan.altText !== task.alt_text) {
      throw new VisualPipelineError("artifact-integrity-failed", "\u89C6\u89C9\u4EFB\u52A1\u4E0E\u539F\u8349\u7A3F\u7ED3\u6784\u4E0D\u4E00\u81F4\uFF1A" + task.asset_id, 422);
    }
    if (!task.attempt_id || Number(task.attempt_no) !== Number(task.current_attempt)) throw new VisualPipelineError("visual-not-approved", "\u89C6\u89C9\u4EFB\u52A1\u7F3A\u5C11\u5F53\u524D attempt", 409);
    const approval = attemptApproval(db, task.attempt_id);
    if (approval.decision !== "approved") throw new VisualPipelineError("visual-not-approved", "\u5168\u90E8\u89C6\u89C9\u4EFB\u52A1\u5FC5\u987B approved\uFF1A" + task.asset_id, 409);
    const extension = task.source_media_type === null ? void 0 : MIME_EXTENSION[task.source_media_type];
    if (!extension || task.source_bytes === null || task.imported_relative_path === null || task.imported_sha256 === null) {
      throw new VisualPipelineError("artifact-integrity-failed", "approved attempt \u7F3A\u5C11\u53EF\u9760\u56FE\u7247\u4FE1\u606F\uFF1A" + task.asset_id, 422);
    }
    return {
      plan,
      task,
      extension,
      data: safeVaultFile(task.imported_relative_path, task.imported_sha256, Number(task.source_bytes)),
      approvalNote: approval.note,
      decidedAt: approval.decidedAt
    };
  });
}
function renderWechat(submission, assets, testOnly) {
  const render = (block) => {
    if (block.type === "heading") return `<h${block.level}>${escapeHtml2(block.text)}</h${block.level}>`;
    if (block.type === "paragraph") return `<p>${escapeHtml2(block.text).replaceAll("\n", "<br>")}</p>`;
    if (block.type === "quote") return `<blockquote>${escapeHtml2(block.text)}${block.sourceUrl ? `<small>${escapeHtml2(block.sourceUrl)}</small>` : ""}</blockquote>`;
    if (block.type === "list") return `<ul>${block.items.map((item) => `<li>${escapeHtml2(item)}</li>`).join("")}</ul>`;
    if (!ASSET_ID3.test(block.assetId) || /[:/\\]/.test(block.assetId)) throw new VisualPipelineError("asset-injection", "\u56FE\u7247\u5757 assetId \u4E0D\u5408\u6CD5", 422);
    const asset = assets.get(block.assetId);
    if (!asset) throw new VisualPipelineError("unknown-asset", "\u5FAE\u4FE1\u6B63\u6587\u5F15\u7528\u672A\u77E5\u6216\u672A\u6279\u51C6 assetId\uFF1A" + block.assetId, 422);
    const src = `assets/${asset.plan.id}.${asset.extension}`;
    return `<figure><img src="${src}" alt="${escapeHtml2(asset.plan.altText)}"><figcaption>${escapeHtml2(block.caption)}</figcaption></figure>`;
  };
  const body = submission.variants.wechat.blocks.map(render).join("");
  const banner = testOnly ? '<div class="test-only">TEST ONLY \xB7 \u6D4B\u8BD5\u56FE\u7247\uFF0C\u4E0D\u53EF\u53D1\u5E03</div>' : "";
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml2(submission.variants.wechat.title)}</title><style>body{margin:0;background:#f5f2ec;color:#2f2a24;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}.article{max-width:720px;margin:auto;background:#fff;padding:32px}img{display:block;max-width:100%;height:auto}.test-only{position:sticky;top:0;padding:12px;background:#8b1e1e;color:#fff;font-weight:800;text-align:center}figcaption{color:#766b5d;text-align:center}.boundary{margin-top:32px;padding:14px;background:#f5f2ec}</style></head><body>${banner}<article class="article"><h1>${escapeHtml2(submission.variants.wechat.title)}</h1><p>${escapeHtml2(submission.variants.wechat.dek)}</p>${body}<div class="boundary"><b>\u4E8B\u5B9E\u8FB9\u754C\uFF1A</b>${escapeHtml2(submission.factBoundary)}</div></article></body></html>`;
  const lines = [`# ${submission.variants.wechat.title}`, "", `> ${submission.variants.wechat.dek}`, ""];
  for (const block of submission.variants.wechat.blocks) {
    if (block.type === "heading") lines.push(`${"#".repeat(block.level)} ${block.text}`, "");
    else if (block.type === "paragraph") lines.push(block.text, "");
    else if (block.type === "quote") lines.push(`> ${block.text}${block.sourceUrl ? `\uFF08${block.sourceUrl}\uFF09` : ""}`, "");
    else if (block.type === "list") lines.push(...block.items.map((item) => `- ${item}`), "");
    else {
      const asset = assets.get(block.assetId);
      lines.push(`![${safeMarkdown(block.caption)}](assets/${asset.plan.id}.${asset.extension})`, "");
    }
  }
  lines.push("---", `\u4E8B\u5B9E\u8FB9\u754C\uFF1A${submission.factBoundary}`);
  return { html: Buffer.from(html), markdown: Buffer.from(lines.join("\n") + "\n") };
}
function legacyXhsOrder(asset, index) {
  const match = asset.plan.placement.match(/第\s*(\d+)\s*张/);
  if (match) return Number(match[1]);
  if (/cover|封面|首图/i.test(asset.plan.id + " " + asset.plan.placement)) return 1;
  if (asset.plan.kind === "carousel") return Math.max(2, index + 1);
  return index + 1;
}
function xhsAssets(source, assets) {
  const legacy = Number(source.draft.contract_version) < 2;
  const selected = assets.filter((asset) => legacy ? asset.plan.kind === "carousel" || /小红书|轮播|首图/i.test(asset.plan.placement) : asset.plan.platforms?.includes("xiaohongshu") || asset.plan.role?.startsWith("xhs-"));
  const entries = selected.map((asset, index) => ({ ...asset, order: legacy ? legacyXhsOrder(asset, index) : Number(asset.plan.order) })).sort((left, right) => left.order - right.order || left.plan.id.localeCompare(right.plan.id));
  const orders = new Set(entries.map((entry) => entry.order));
  const max = Math.max(2, ...orders);
  const missing = Array.from({ length: max }, (_, index) => index + 1).filter((order) => !orders.has(order));
  return { entries, legacy, missing };
}
function latestDeterministicTime(source, assets) {
  const values = [source.draft.updated_at, source.draft.decided_at, ...assets.flatMap((asset) => [asset.task.imported_at, asset.decidedAt])].filter((value) => typeof value === "string" && !Number.isNaN(Date.parse(value)));
  return values.sort().at(-1) ?? "1980-01-01T00:00:00.000Z";
}
function rowFromDb(row) {
  return {
    id: row.id,
    packageId: row.package_id,
    batchId: row.batch_id,
    version: Number(row.version),
    mode: row.mode,
    platform: row.platform,
    format: row.format,
    relativePath: row.relative_path,
    sha256: row.sha256,
    bytes: Number(row.bytes),
    manifest: JSON.parse(row.manifest_json),
    createdAt: row.created_at
  };
}
function createVisualDelivery(db, input, now = /* @__PURE__ */ new Date()) {
  if (input.mode !== "preview" && input.mode !== "production") throw new VisualPipelineError("bad-request", "mode \u5FC5\u987B\u662F preview \u6216 production", 400);
  const source = readSource(db, input.packageId);
  const aggregate = visualReviewAggregate(db, source.batchId);
  if (!aggregate.visualApproved) throw new VisualPipelineError("visual-not-approved", "required \u89C6\u89C9\u4EFB\u52A1\u5C1A\u672A\u5168\u90E8\u6279\u51C6", 409);
  const assets = preparedAssets(db, source);
  const stub = assets.some((asset) => asset.task.provider === "stub");
  const productionProviders = assets.every((asset) => typeof asset.task.provider === "string" && asset.task.provider !== "" && asset.task.provider !== "stub");
  const xhs = xhsAssets(source, assets);
  if (input.mode === "production" && (!productionProviders || xhs.legacy || xhs.missing.length > 0)) {
    const reason = !productionProviders ? "production delivery \u62D2\u7EDD stub \u6216\u672A\u77E5 provider" : xhs.legacy ? "legacy contract v1 \u4E0D\u80FD\u8BC1\u660E\u5C0F\u7EA2\u4E66\u69FD\u4F4D\u5B8C\u6574" : "\u5C0F\u7EA2\u4E66 required \u69FD\u4F4D\u7F3A\u5931";
    throw new VisualPipelineError("production-gate", reason, 409);
  }
  const fingerprint = sha2563(JSON.stringify({
    packageId: source.draft.id,
    mode: input.mode,
    contractVersion: source.draft.contract_version,
    sourceSha256: source.sourceSha256,
    assets: assets.map((asset) => ({ id: asset.plan.id, attemptId: asset.task.attempt_id, sha256: asset.task.imported_sha256, provider: asset.task.provider, model: asset.task.model, decidedAt: asset.decidedAt }))
  }));
  const existing = db.prepare(`
    SELECT * FROM visual_delivery_artifacts WHERE package_id=? AND mode=? AND platform='shared' AND format='manifest' ORDER BY version DESC
  `).all(input.packageId, input.mode).find((row) => {
    try {
      return JSON.parse(row.manifest_json).fingerprint === fingerprint;
    } catch {
      return false;
    }
  });
  if (existing) {
    const rows = db.prepare("SELECT * FROM visual_delivery_artifacts WHERE package_id=? AND version=? ORDER BY relative_path").all(input.packageId, existing.version);
    for (const row of rows) safeVaultFile(row.relative_path, row.sha256, Number(row.bytes));
    const artifacts2 = rows.map(rowFromDb);
    return { delivery: rowFromDb(existing), artifacts: artifacts2, created: false };
  }
  const versionRow = db.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM visual_delivery_artifacts WHERE package_id=?").get(input.packageId);
  const version = Number(versionRow.version) + 1;
  const deliveryId = `vd-${sha2563(`${input.packageId}:${version}:${fingerprint}`).slice(0, 20)}`;
  const testOnly = input.mode === "preview" || stub;
  const generatedAt = latestDeterministicTime(source, assets);
  const files = /* @__PURE__ */ new Map();
  const byId = new Map(assets.map((asset) => [asset.plan.id, asset]));
  const wechat = renderWechat(source.submission, byId, testOnly);
  files.set("wechat-visual.html", wechat.html);
  files.set("wechat-visual.md", wechat.markdown);
  for (const asset of assets) files.set(`assets/${asset.plan.id}.${asset.extension}`, asset.data);
  const provenance = {
    packageId: input.packageId,
    batchId: source.batchId,
    sourcePackageSha256: source.sourceSha256,
    generatedAt,
    assets: assets.map((asset) => ({
      assetId: asset.plan.id,
      attemptId: asset.task.attempt_id,
      attemptNo: Number(asset.task.attempt_no),
      provider: asset.task.provider,
      model: asset.task.model,
      prompt: asset.task.prompt,
      sha256: asset.task.imported_sha256,
      bytes: Number(asset.task.source_bytes),
      width: Number(asset.task.source_width),
      height: Number(asset.task.source_height),
      mime: asset.task.source_media_type,
      generatedAt: asset.task.imported_at,
      reviewNote: asset.approvalNote
    }))
  };
  files.set("provenance.json", json(provenance));
  const xhsAssetManifest = [];
  for (const asset of xhs.entries) {
    const filename = `${String(asset.order).padStart(2, "0")}-${asset.plan.id}.${asset.extension}`;
    files.set(`xiaohongshu/${filename}`, asset.data);
    xhsAssetManifest.push({ assetId: asset.plan.id, order: asset.order, role: asset.plan.role ?? null, placement: asset.plan.placement, file: filename, sha256: asset.task.imported_sha256 });
  }
  files.set("xiaohongshu/caption.md", Buffer.from(`# ${source.submission.variants.xiaohongshu.title}

${source.submission.variants.xiaohongshu.body}

${source.submission.variants.xiaohongshu.hashtags.map((tag) => tag.startsWith("#") ? tag : "#" + tag).join(" ")}
`));
  files.set("xiaohongshu/assets.json", json(xhsAssetManifest));
  files.set("xiaohongshu/provenance.json", json(provenance));
  const xhsManifest = { packageId: input.packageId, legacyContract: xhs.legacy, missingSlots: xhs.missing, completeForProduction: !xhs.legacy && xhs.missing.length === 0, assets: xhsAssetManifest };
  files.set("xiaohongshu/manifest.json", json(xhsManifest));
  const initialFiles = [...files].map(([file, data]) => ({ path: file, sha256: sha2563(data), bytes: data.byteLength })).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const manifest = {
    deliveryId,
    packageId: input.packageId,
    batchId: source.batchId,
    version,
    mode: input.mode,
    fingerprint,
    generatedAt,
    testOnly,
    readyForPublication: input.mode === "production" && !testOnly,
    legacyContract: xhs.legacy,
    missingSlots: xhs.missing,
    files: initialFiles
  };
  files.set("manifest.json", json(manifest));
  const zipName = `visual-delivery-v${String(version).padStart(3, "0")}.zip`;
  files.set(zipName, deterministicZip([...files].map(([file, data]) => ({ path: file, data }))));
  const relativeDir = path18.posix.join("deliveries", "factory", now.toISOString().slice(0, 10), input.packageId, `visual-v${String(version).padStart(3, "0")}`);
  const absoluteDir = path18.join(VAULT_ROOT, ...relativeDir.split("/"));
  if (existsSync14(absoluteDir)) throw new VisualPipelineError("delivery-conflict", "\u6D3E\u751F\u4EA4\u4ED8\u76EE\u5F55\u5DF2\u5B58\u5728\uFF0C\u62D2\u7EDD\u8986\u76D6", 409);
  ensureSafeDirectory(VAULT_ROOT, path18.posix.dirname(relativeDir));
  const staging = path18.join(path18.dirname(absoluteDir), `.${path18.basename(absoluteDir)}-${randomUUID7()}.tmp`);
  mkdirSync14(staging);
  try {
    for (const [file, data] of files) {
      const target = path18.join(staging, ...file.split("/"));
      mkdirSync14(path18.dirname(target), { recursive: true });
      writeFileSync12(target, data, { mode: 384 });
    }
    renameSync4(staging, absoluteDir);
  } catch (error) {
    rmSync6(staging, { recursive: true, force: true });
    throw error;
  }
  const specs = [...files].map(([file, data]) => {
    const platform = file.startsWith("xiaohongshu/") ? "xiaohongshu" : file.startsWith("wechat-") || file.startsWith("assets/") ? "wechat" : "shared";
    const format = file === "manifest.json" ? "manifest" : file === zipName ? "zip" : file === "provenance.json" ? "provenance" : file.replaceAll("/", ":");
    return { file, data, platform, format };
  });
  const manifestJson = JSON.stringify(manifest);
  const at = now.toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const spec of specs) {
      const id = spec.file === "manifest.json" ? deliveryId : `vf-${sha2563(`${deliveryId}:${spec.file}`).slice(0, 20)}`;
      db.prepare(`
        INSERT INTO visual_delivery_artifacts(
          id, package_id, batch_id, version, mode, platform, format, relative_path, sha256, bytes, manifest_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        input.packageId,
        source.batchId,
        version,
        input.mode,
        spec.platform,
        spec.format,
        path18.posix.join(relativeDir, spec.file),
        sha2563(spec.data),
        spec.data.byteLength,
        manifestJson,
        at
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    rmSync6(absoluteDir, { recursive: true, force: true });
    throw error;
  }
  const artifacts = db.prepare("SELECT * FROM visual_delivery_artifacts WHERE package_id=? AND version=? ORDER BY relative_path").all(input.packageId, version).map(rowFromDb);
  const delivery = artifacts.find((artifact) => artifact.id === deliveryId);
  publicationReadiness(db, source.batchId);
  return { delivery, artifacts, created: true };
}
function listVisualDeliveries(db, packageId) {
  if (!PACKAGE_ID3.test(packageId)) throw new VisualPipelineError("bad-request", "packageId \u4E0D\u5408\u6CD5", 400);
  return db.prepare(`
    SELECT * FROM visual_delivery_artifacts WHERE package_id=? AND platform='shared' AND format='manifest' ORDER BY version DESC
  `).all(packageId).map(rowFromDb);
}
function deliveryRoot(db, deliveryId) {
  if (!DELIVERY_ID.test(deliveryId)) throw new VisualPipelineError("bad-request", "deliveryId \u4E0D\u5408\u6CD5", 400);
  const row = db.prepare(`SELECT * FROM visual_delivery_artifacts WHERE id=? AND platform='shared' AND format='manifest'`).get(deliveryId);
  if (!row) throw new VisualPipelineError("not-found", "\u89C6\u89C9\u4EA4\u4ED8\u5305\u4E0D\u5B58\u5728", 404);
  return row;
}
function readVisualDeliveryFile(db, deliveryId, file) {
  const root = deliveryRoot(db, deliveryId);
  if (file === "" || path18.isAbsolute(file) || file.includes("\\") || file.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new VisualPipelineError("bad-request", "file \u4E0D\u5408\u6CD5", 400);
  }
  const manifest = JSON.parse(root.manifest_json);
  const allowed = /* @__PURE__ */ new Set([...manifest.files.map((item) => item.path), "manifest.json", `visual-delivery-v${String(root.version).padStart(3, "0")}.zip`]);
  if (!allowed.has(file)) throw new VisualPipelineError("not-found", "\u4EA4\u4ED8\u5305\u6587\u4EF6\u672A\u58F0\u660E", 404);
  const base = path18.posix.dirname(root.relative_path);
  const relative = path18.posix.join(base, file);
  const row = db.prepare("SELECT sha256, bytes FROM visual_delivery_artifacts WHERE package_id=? AND version=? AND relative_path=?").get(root.package_id, root.version, relative);
  if (!row) throw new VisualPipelineError("not-found", "\u4EA4\u4ED8\u5305\u6587\u4EF6\u4E0D\u5B58\u5728", 404);
  return { content: safeVaultFile(relative, row.sha256, Number(row.bytes)), relativePath: relative };
}
function readVisualDeliveryZip(db, deliveryId) {
  const root = deliveryRoot(db, deliveryId);
  const filename = `visual-delivery-v${String(root.version).padStart(3, "0")}.zip`;
  return { content: readVisualDeliveryFile(db, deliveryId, filename).content, filename };
}

// src/server/routes.ts
function loadTemplate(name2) {
  return readFileSync18(fileURLToPath2(new URL("./" + name2, import.meta.url)), "utf8");
}
function factoryDisabled(res) {
  if (factoryEnabled()) return false;
  respondJson(res, 410, {
    ok: false,
    error: {
      code: "factory-disabled",
      message: '\u5DE5\u5382\u7BA1\u7EBF\u9ED8\u8BA4\u5173\u95ED\uFF08\u5F53\u524D\u662F\u7B80\u62A5\u53F0\uFF09\uFF0C\u8FD9\u4E2A\u63A5\u53E3\u8FD4\u56DE 410\u3002\u53D1\u5E03\u8BF7\u5728\u5404\u5E73\u53F0\u540E\u53F0\u4EBA\u5DE5\u5B8C\u6210\u3002\u82E5\u8981\u4E34\u65F6\u6253\u5F00\u5DE5\u5382\uFF0C\u8BBE\u7F6E SPARKOS_WORKBENCH_MODE=full\uFF0C\u6216\u5728 VAULT config/workbench_mode.json \u5199\u5165 {"mode":"full"} \u540E\u91CD\u542F\u5BBF\u4E3B\u3002'
    }
  });
  return true;
}
function respondJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(payload);
}
function respondVisualError(res, error) {
  const status = error instanceof VisualPipelineError ? error.httpStatus : 500;
  const code = error instanceof VisualPipelineError ? error.code : "internal-error";
  const message = error instanceof Error ? error.message : String(error);
  respondJson(res, status, { ok: false, error: { code, message } });
}
function renderWorkbenchPage(res, template) {
  const nonce = newCspNonce();
  const csrfToken = issueCsrfToken();
  const data = escapeJsonForScript(buildWorkbenchData());
  const scriptOpen = '<script nonce="' + nonce + '">';
  const html = template.replaceAll("<script>", scriptOpen).replace(scriptOpen, scriptOpen + "window._embeddedDailyData = " + data + ';window._sparkosCsrf = "' + csrfToken + '";</script>\n' + scriptOpen);
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "content-security-policy": cspWithNonce(nonce),
    "x-content-type-options": "nosniff",
    "cache-control": "private, no-store"
  });
  res.end(html);
}
var MAX_BODY_BYTES = 256 * 1024;
async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    chunks.push(chunk);
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const err = new Error("request body too large");
      err.code = "BODY_TOO_LARGE";
      throw err;
    }
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}
async function handleSparkosHttp(req, res, admit = denyAdmission) {
  const admission = admit(req);
  if ("rejection" in admission) {
    refuseAdmission(res, admission.rejection);
    return;
  }
  const url = new URL(req.url ?? "/", "http://dsh-sparkos.local");
  const path19 = url.pathname.replace(/\/+$/, "") || "/sparkos";
  try {
    const rejection = checkMutationRequest(req);
    if (rejection !== null) {
      respondJson(res, rejection.status, { ok: false, error: { code: rejection.code, message: rejection.message } });
      return;
    }
    if (req.method === "GET" && path19 === "/sparkos/csrf") {
      respondJson(res, 200, { ok: true, value: { token: issueCsrfToken() } });
      return;
    }
    if (req.method === "GET" && (path19 === "/sparkos" || path19 === "/sparkos/app" || path19 === "/sparkos/app-v2")) {
      renderWorkbenchPage(res, loadTemplate(factoryEnabled() ? "factory.template.html" : "page.template.html"));
      return;
    }
    if (req.method === "GET" && path19 === "/sparkos/data") {
      respondJson(res, 200, { ok: true, value: buildWorkbenchData() });
      return;
    }
    if (req.method === "GET" && path19 === "/sparkos/intel") {
      respondJson(res, 200, { ok: true, value: buildIntelReport() });
      return;
    }
    if (req.method === "POST" && path19 === "/sparkos/intel/tick") {
      const r = runIntelTick();
      respondJson(res, 200, { ok: r.ingest.ok && r.overall !== "red", value: r.ingest });
      return;
    }
    if (req.method === "POST" && path19 === "/sparkos/visual/queue") {
      if (factoryDisabled(res)) return;
      let body;
      try {
        body = await readJsonBody(req);
      } catch (error) {
        if (error instanceof Error && error.code === "BODY_TOO_LARGE") {
          respondJson(res, 413, { ok: false, error: { code: "payload-too-large", message: "\u8BF7\u6C42\u4F53\u8D85\u8FC7 256KB \u4E0A\u9650" } });
          return;
        }
        respondJson(res, 400, { ok: false, error: { code: "bad-request", message: "body \u5FC5\u987B\u662F\u5408\u6CD5 JSON" } });
        return;
      }
      if (typeof body.packageId !== "string" || Object.keys(body).some((key) => key !== "packageId")) {
        respondJson(res, 400, { ok: false, error: { code: "bad-request", message: "\u4EC5\u5141\u8BB8 packageId" } });
        return;
      }
      const db = openFactoryDatabase();
      try {
        const value = queueVisualBatch(db, body.packageId);
        respondJson(res, value.created ? 201 : 200, { ok: true, value });
      } catch (error) {
        respondVisualError(res, error);
      } finally {
        db.close();
      }
      return;
    }
    if (req.method === "GET" && path19 === "/sparkos/visual/status") {
      if (factoryDisabled(res)) return;
      const packageId = url.searchParams.get("packageId") ?? void 0;
      const db = openFactoryDatabase();
      try {
        respondJson(res, 200, { ok: true, value: visualStatus(db, packageId) });
      } catch (error) {
        respondVisualError(res, error);
      } finally {
        db.close();
      }
      return;
    }
    if (req.method === "GET" && path19 === "/sparkos/visual/asset") {
      if (factoryDisabled(res)) return;
      const attemptId = url.searchParams.get("attemptId") ?? "";
      if ([...url.searchParams.keys()].some((key) => key !== "attemptId") || url.searchParams.getAll("attemptId").length !== 1) {
        respondJson(res, 400, { ok: false, error: { code: "bad-request", message: "\u4EC5\u5141\u8BB8\u4E00\u4E2A attemptId \u53C2\u6570" } });
        return;
      }
      const db = openFactoryDatabase();
      try {
        const asset = readVisualAsset(db, attemptId);
        if (asset === null) {
          respondJson(res, 404, { ok: false, error: { code: "not-found", message: "\u89C6\u89C9\u8D44\u4EA7\u4E0D\u5B58\u5728\u3001\u672A\u5230\u9884\u89C8\u72B6\u6001\u6216\u5B8C\u6574\u6027\u6821\u9A8C\u5931\u8D25" } });
          return;
        }
        res.writeHead(200, {
          "content-type": asset.mediaType,
          "content-length": String(asset.bytes),
          "x-content-type-options": "nosniff",
          "cross-origin-resource-policy": "same-origin",
          "cache-control": "private, no-store"
        });
        res.end(asset.content);
      } finally {
        db.close();
      }
      return;
    }
    if (req.method === "POST" && path19 === "/sparkos/visual/decision") {
      if (factoryDisabled(res)) return;
      let body;
      try {
        body = await readJsonBody(req);
      } catch {
        respondJson(res, 400, { ok: false, error: { code: "bad-request", message: "body \u5FC5\u987B\u662F\u5408\u6CD5 JSON" } });
        return;
      }
      if (typeof body.attemptId !== "string" || body.decision !== "approved" && body.decision !== "rejected" || body.note !== void 0 && typeof body.note !== "string" || Object.keys(body).some((key) => !["attemptId", "decision", "note"].includes(key))) {
        respondJson(res, 400, { ok: false, error: { code: "bad-request", message: "\u4EC5\u5141\u8BB8 attemptId\u3001decision \u548C\u53EF\u9009 note" } });
        return;
      }
      const db = openFactoryDatabase();
      try {
        respondJson(res, 200, { ok: true, value: decideVisualAttempt(db, { attemptId: body.attemptId, decision: body.decision, note: body.note }) });
      } catch (error) {
        respondVisualError(res, error);
      } finally {
        db.close();
      }
      return;
    }
    if (req.method === "POST" && path19 === "/sparkos/visual/retry") {
      if (factoryDisabled(res)) return;
      let body;
      try {
        body = await readJsonBody(req);
      } catch {
        respondJson(res, 400, { ok: false, error: { code: "bad-request", message: "body \u5FC5\u987B\u662F\u5408\u6CD5 JSON" } });
        return;
      }
      const keys = Object.keys(body);
      if (keys.length === 1 && typeof body.taskId === "string") {
        const db2 = openFactoryDatabase();
        try {
          respondJson(res, 200, { ok: true, value: retryVisualTask(db2, body.taskId) });
        } catch (error) {
          respondVisualError(res, error);
        } finally {
          db2.close();
        }
        return;
      }
      const allowed = ["packageId", "taskId", "currentAttemptId", "assetId", "idempotencyKey", "supplementaryInstruction", "purpose", "humanConfirmation"];
      if (keys.some((key) => !allowed.includes(key)) || typeof body.packageId !== "string" || typeof body.taskId !== "string" || typeof body.currentAttemptId !== "string" || typeof body.assetId !== "string" || typeof body.idempotencyKey !== "string" || body.supplementaryInstruction !== void 0 && typeof body.supplementaryInstruction !== "string" || body.purpose !== void 0 && body.purpose !== "reject_rerun" && body.purpose !== "replace_stub_with_production" || body.humanConfirmation !== void 0 && typeof body.humanConfirmation !== "string") {
        respondJson(res, 400, { ok: false, error: { code: "bad-request", message: "\u4EC5\u5141\u8BB8 packageId\u3001taskId\u3001currentAttemptId\u3001assetId\u3001idempotencyKey\u3001\u53EF\u9009 supplementaryInstruction/purpose/humanConfirmation" } });
        return;
      }
      const db = openFactoryDatabase();
      try {
        respondJson(res, 200, { ok: true, value: requestVisualRetry(db, body) });
      } catch (error) {
        respondVisualError(res, error);
      } finally {
        db.close();
      }
      return;
    }
    if (req.method === "POST" && path19 === "/sparkos/visual/delivery") {
      if (factoryDisabled(res)) return;
      let body;
      try {
        body = await readJsonBody(req);
      } catch {
        respondJson(res, 400, { ok: false, error: { code: "bad-request", message: "body \u5FC5\u987B\u662F\u5408\u6CD5 JSON" } });
        return;
      }
      if (typeof body.packageId !== "string" || body.mode !== "preview" && body.mode !== "production" || Object.keys(body).some((key) => key !== "packageId" && key !== "mode")) {
        respondJson(res, 400, { ok: false, error: { code: "bad-request", message: "\u4EC5\u5141\u8BB8 packageId \u548C mode" } });
        return;
      }
      const db = openFactoryDatabase();
      try {
        const value = createVisualDelivery(db, { packageId: body.packageId, mode: body.mode });
        respondJson(res, value.created ? 201 : 200, { ok: true, value });
      } catch (error) {
        respondVisualError(res, error);
      } finally {
        db.close();
      }
      return;
    }
    if (req.method === "POST" && path19 === "/sparkos/publish") {
      if (factoryDisabled(res)) return;
      let body;
      try {
        body = await readJsonBody(req);
      } catch {
        respondJson(res, 400, { ok: false, error: { code: "bad-request", message: "body \u5FC5\u987B\u662F\u5408\u6CD5 JSON" } });
        return;
      }
      if (typeof body.packageId !== "string" || Object.keys(body).some((key) => key !== "packageId")) {
        respondJson(res, 400, { ok: false, error: { code: "bad-request", message: "\u4EC5\u5141\u8BB8 packageId" } });
        return;
      }
      const db = openFactoryDatabase();
      try {
        respondJson(res, 200, { ok: true, value: createPublishTask(db, body.packageId) });
      } catch (error) {
        respondVisualError(res, error);
      } finally {
        db.close();
      }
      return;
    }
    if (req.method === "GET" && path19 === "/sparkos/visual/deliveries") {
      if (factoryDisabled(res)) return;
      const packageId = url.searchParams.get("packageId") ?? "";
      if (url.searchParams.getAll("packageId").length !== 1 || [...url.searchParams.keys()].some((key) => key !== "packageId")) {
        respondJson(res, 400, { ok: false, error: { code: "bad-request", message: "\u4EC5\u5141\u8BB8\u4E00\u4E2A packageId \u53C2\u6570" } });
        return;
      }
      const db = openFactoryDatabase();
      try {
        respondJson(res, 200, { ok: true, value: listVisualDeliveries(db, packageId) });
      } catch (error) {
        respondVisualError(res, error);
      } finally {
        db.close();
      }
      return;
    }
    if (req.method === "GET" && path19 === "/sparkos/visual/delivery") {
      if (factoryDisabled(res)) return;
      const deliveryId = url.searchParams.get("deliveryId") ?? "";
      const file = url.searchParams.get("file") ?? "";
      if (url.searchParams.getAll("deliveryId").length !== 1 || url.searchParams.getAll("file").length !== 1 || [...url.searchParams.keys()].some((key) => key !== "deliveryId" && key !== "file")) {
        respondJson(res, 400, { ok: false, error: { code: "bad-request", message: "\u4EC5\u5141\u8BB8 deliveryId \u548C file" } });
        return;
      }
      const db = openFactoryDatabase();
      try {
        const item = readVisualDeliveryFile(db, deliveryId, file);
        const extension = nodePath2.extname(file).toLowerCase();
        const contentType = extension === ".html" ? "text/html; charset=utf-8" : extension === ".json" ? "application/json; charset=utf-8" : extension === ".md" ? "text/plain; charset=utf-8" : extension === ".png" ? "image/png" : extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : extension === ".webp" ? "image/webp" : "application/octet-stream";
        const headers = { "content-type": contentType, "content-length": String(item.content.byteLength), "x-content-type-options": "nosniff", "cache-control": "private, no-store" };
        if (extension === ".html") headers["content-security-policy"] = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'";
        res.writeHead(200, headers);
        res.end(item.content);
      } catch (error) {
        respondVisualError(res, error);
      } finally {
        db.close();
      }
      return;
    }
    if (req.method === "GET" && path19 === "/sparkos/visual/download") {
      if (factoryDisabled(res)) return;
      const deliveryId = url.searchParams.get("deliveryId") ?? "";
      if (url.searchParams.getAll("deliveryId").length !== 1 || [...url.searchParams.keys()].some((key) => key !== "deliveryId")) {
        respondJson(res, 400, { ok: false, error: { code: "bad-request", message: "\u4EC5\u5141\u8BB8\u4E00\u4E2A deliveryId \u53C2\u6570" } });
        return;
      }
      const db = openFactoryDatabase();
      try {
        const item = readVisualDeliveryZip(db, deliveryId);
        res.writeHead(200, {
          "content-type": "application/zip",
          "content-length": String(item.content.byteLength),
          "content-disposition": `attachment; filename="${item.filename}"`,
          "x-content-type-options": "nosniff",
          "cache-control": "private, no-store"
        });
        res.end(item.content);
      } catch (error) {
        respondVisualError(res, error);
      } finally {
        db.close();
      }
      return;
    }
    if (req.method === "POST" && path19 === "/sparkos/editorial/decision") {
      if (factoryDisabled(res)) return;
      let body;
      try {
        body = await readJsonBody(req);
      } catch (error) {
        if (error instanceof Error && error.code === "BODY_TOO_LARGE") {
          respondJson(res, 413, { ok: false, error: { code: "payload-too-large", message: "\u8BF7\u6C42\u4F53\u8D85\u8FC7 256KB \u4E0A\u9650" } });
          return;
        }
        respondJson(res, 400, { ok: false, error: { code: "bad-request", message: "body \u5FC5\u987B\u662F\u5408\u6CD5 JSON" } });
        return;
      }
      const cardId = typeof body.cardId === "string" ? body.cardId : "";
      const decision = body.decision;
      if (!/^ec-[a-f0-9]{16}$/.test(cardId) || decision !== "approved" && decision !== "rejected") {
        respondJson(res, 400, { ok: false, error: { code: "bad-request", message: "cardId \u6216 decision \u4E0D\u5408\u6CD5" } });
        return;
      }
      try {
        const { reviewEditorialCard: reviewEditorialCard2 } = await Promise.resolve().then(() => (init_service2(), service_exports));
        const card = reviewEditorialCard2(cardId, decision, typeof body.note === "string" ? body.note : void 0);
        respondJson(res, 200, { ok: true, value: card });
      } catch (error) {
        respondJson(res, 404, { ok: false, error: { code: "not-found", message: error instanceof Error ? error.message : String(error) } });
      }
      return;
    }
    if (req.method === "GET" && path19 === "/sparkos/creation/artifact") {
      if (factoryDisabled(res)) return;
      const packageId = url.searchParams.get("packageId") ?? "";
      const file = url.searchParams.get("file") ?? "";
      const { openFactoryDatabase: openFactoryDatabase2 } = await Promise.resolve().then(() => (init_database(), database_exports));
      const { readDraftArtifact: readDraftArtifact2 } = await Promise.resolve().then(() => (init_drafts(), drafts_exports));
      const db = openFactoryDatabase2();
      try {
        let artifact;
        try {
          artifact = readDraftArtifact2(db, packageId, file);
        } catch (integrityError) {
          respondJson(res, 422, { ok: false, error: { code: "artifact-integrity-failed", message: integrityError instanceof Error ? integrityError.message : String(integrityError) } });
          return;
        }
        if (!artifact) {
          respondJson(res, 404, { ok: false, error: { code: "not-found", message: "draft artifact" } });
          return;
        }
        const contentType = artifact.format === "html" ? "text/html; charset=utf-8" : artifact.format === "json" ? "application/json; charset=utf-8" : "text/plain; charset=utf-8";
        const headers = { "content-type": contentType, "x-content-type-options": "nosniff" };
        if (artifact.format === "html") headers["content-security-policy"] = "default-src 'none'; style-src 'unsafe-inline'; img-src data:";
        res.writeHead(200, headers);
        res.end(artifact.content);
      } finally {
        db.close();
      }
      return;
    }
    if (req.method === "POST" && path19 === "/sparkos/creation/decision") {
      if (factoryDisabled(res)) return;
      let body;
      try {
        body = await readJsonBody(req);
      } catch (error) {
        if (error instanceof Error && error.code === "BODY_TOO_LARGE") {
          respondJson(res, 413, { ok: false, error: { code: "payload-too-large", message: "\u8BF7\u6C42\u4F53\u8D85\u8FC7 256KB \u4E0A\u9650" } });
          return;
        }
        respondJson(res, 400, { ok: false, error: { code: "bad-request", message: "body \u5FC5\u987B\u662F\u5408\u6CD5 JSON" } });
        return;
      }
      const packageId = typeof body.packageId === "string" ? body.packageId : "";
      const decision = body.decision;
      const note = typeof body.note === "string" ? body.note.trim() : "";
      if (!/^dp-[a-f0-9]{16}$/.test(packageId) || decision !== "approved" && decision !== "rejected") {
        respondJson(res, 400, { ok: false, error: { code: "bad-request", message: "packageId \u6216 decision \u4E0D\u5408\u6CD5" } });
        return;
      }
      if (decision === "rejected" && note === "") {
        respondJson(res, 400, { ok: false, error: { code: "bad-request", message: "\u9A73\u56DE\u8349\u7A3F\u5FC5\u987B\u586B\u5199\u5BA1\u6838\u610F\u89C1" } });
        return;
      }
      try {
        const { reviewDraftPackage: reviewDraftPackage2 } = await Promise.resolve().then(() => (init_service2(), service_exports));
        const draftPackage = reviewDraftPackage2(packageId, decision, note || void 0);
        respondJson(res, 200, { ok: true, value: draftPackage });
      } catch (error) {
        respondJson(res, 422, { ok: false, error: { code: "invalid-state", message: error instanceof Error ? error.message : String(error) } });
      }
      return;
    }
    if (req.method === "POST" && path19 === "/sparkos/creation/revise") {
      if (factoryDisabled(res)) return;
      let body;
      try {
        body = await readJsonBody(req);
      } catch {
        respondJson(res, 400, { ok: false, error: { code: "bad-request", message: "body \u5FC5\u987B\u662F\u5408\u6CD5 JSON" } });
        return;
      }
      const packageId = typeof body.packageId === "string" ? body.packageId : "";
      if (!/^dp-[a-f0-9]{16}$/.test(packageId)) {
        respondJson(res, 400, { ok: false, error: { code: "bad-request", message: "packageId \u4E0D\u5408\u6CD5" } });
        return;
      }
      try {
        const { requestDraftRevision: requestDraftRevision2 } = await Promise.resolve().then(() => (init_service2(), service_exports));
        const result = requestDraftRevision2(packageId);
        respondJson(res, 200, { ok: true, value: result.package, created: result.created });
      } catch (error) {
        respondJson(res, 422, { ok: false, error: { code: "invalid-state", message: error instanceof Error ? error.message : String(error) } });
      }
      return;
    }
    if (req.method === "GET" && path19 === "/sparkos/writeback") {
      respondJson(res, 200, { ok: true, value: loadWritebackQueue() });
      return;
    }
    if (req.method === "POST" && path19 === "/sparkos/writeback/clear") {
      const { writeFileSync: writeFileSync14, mkdirSync: mkdirSync16 } = await import("node:fs");
      const { VAULT_ROOT: VAULT_ROOT2 } = await Promise.resolve().then(() => (init_vault(), vault_exports));
      const { join: join2 } = await import("node:path");
      mkdirSync16(join2(VAULT_ROOT2, "state"), { recursive: true });
      writeFileSync14(join2(VAULT_ROOT2, "state", "writeback_queue.json"), "[]\n");
      respondJson(res, 200, { ok: true });
      return;
    }
    if (req.method === "POST" && path19 === "/sparkos/writeback/remove") {
      let body;
      try {
        body = await readJsonBody(req);
      } catch (error) {
        if (error instanceof Error && error.code === "BODY_TOO_LARGE") {
          respondJson(res, 413, { ok: false, error: { code: "payload-too-large", message: "\u8BF7\u6C42\u4F53\u8D85\u8FC7 256KB \u4E0A\u9650" } });
          return;
        }
        respondJson(res, 400, { ok: false, error: { code: "bad-request", message: "body \u5FC5\u987B\u662F\u5408\u6CD5 JSON" } });
        return;
      }
      const file = typeof body.file === "string" ? body.file : "";
      if (file === "") {
        respondJson(res, 400, { ok: false, error: { code: "bad-request", message: "file \u5FC5\u586B" } });
        return;
      }
      const { writeFileSync: writeFileSync14, mkdirSync: mkdirSync16 } = await import("node:fs");
      const { VAULT_ROOT: VAULT_ROOT2 } = await Promise.resolve().then(() => (init_vault(), vault_exports));
      const { join: join2 } = await import("node:path");
      const queueFile = join2(VAULT_ROOT2, "state", "writeback_queue.json");
      const queue = loadWritebackQueue().filter((e) => e.file !== file);
      mkdirSync16(join2(VAULT_ROOT2, "state"), { recursive: true });
      writeFileSync14(queueFile, JSON.stringify(queue, null, 2) + "\n");
      respondJson(res, 200, { ok: true, value: queue });
      return;
    }
    if (req.method === "GET" && path19 === "/sparkos/draft") {
      const file = typeof url.searchParams.get("file") === "string" ? String(url.searchParams.get("file")) : "";
      if (file === "" || file.includes("/") || file.includes("\\") || file.includes("..")) {
        respondJson(res, 400, { ok: false, error: { code: "bad-request", message: "file \u4E0D\u5408\u6CD5" } });
        return;
      }
      const candidates = [...listRuntimeDrafts(), ...listVaultDrafts()].filter((d) => d.file === file);
      if (candidates.length === 0) {
        respondJson(res, 404, { ok: false, error: { code: "not-found", message: "draft: " + file } });
        return;
      }
      const content = readDraft(candidates[0].path);
      respondJson(res, 200, { ok: true, value: { file, path: candidates[0].path, content: content ?? "" } });
      return;
    }
    if (req.method === "POST" && path19 === "/sparkos/mutate") {
      let body;
      try {
        body = await readJsonBody(req);
      } catch (error) {
        if (error instanceof Error && error.code === "BODY_TOO_LARGE") {
          respondJson(res, 413, { ok: false, error: { code: "payload-too-large", message: "\u8BF7\u6C42\u4F53\u8D85\u8FC7 256KB \u4E0A\u9650" } });
          return;
        }
        respondJson(res, 400, { ok: false, error: { code: "bad-request", message: "body \u5FC5\u987B\u662F\u5408\u6CD5 JSON" } });
        return;
      }
      const { kind, id, action } = body;
      if (typeof kind !== "string" || kind === "" || !/^[\w.-]{1,64}$/.test(kind)) {
        respondJson(res, 400, { ok: false, error: { code: "bad-request", message: "kind \u4E0D\u5408\u6CD5" } });
        return;
      }
      if (typeof id !== "string" || id === "" || id.length > 128) {
        respondJson(res, 400, { ok: false, error: { code: "bad-request", message: "id \u4E0D\u5408\u6CD5" } });
        return;
      }
      if (action !== "adopt" && action !== "ignore") {
        respondJson(res, 400, { ok: false, error: { code: "bad-request", message: "action \u53EA\u5141\u8BB8 adopt/ignore" } });
        return;
      }
      if (kind === "distill") {
        try {
          const r = reviewDistill(id, action);
          respondJson(res, 200, { ok: true, entry: r.entry });
        } catch (error) {
          respondJson(res, 422, { ok: false, error: { code: "red-line", message: error instanceof Error ? error.message : String(error) } });
        }
        return;
      }
      const entry = recordDecision(kind, id, action, typeof body.note === "string" ? body.note : void 0);
      respondJson(res, 200, { ok: true, entry });
      return;
    }
    respondJson(res, 404, { ok: false, error: { code: "not-found", message: path19 } });
  } catch (error) {
    const code = error instanceof Error && error.code;
    if (code === "BODY_TOO_LARGE") {
      respondJson(res, 413, { ok: false, error: { code: "payload-too-large", message: "\u8BF7\u6C42\u4F53\u8D85\u8FC7 256KB \u4E0A\u9650" } });
      return;
    }
    respondJson(res, 500, {
      ok: false,
      error: { code: "internal", message: error instanceof Error ? error.message : String(error) }
    });
  }
}
function registerWorkbench(ctx) {
  ctx.inject(["webServer", "connection"], (httpCtx) => {
    httpCtx.effect(() => httpCtx.webServer.register({
      kind: "prefix",
      path: "/sparkos",
      handler: async (req, res) => {
        await handleSparkosHttp(req, res, (request) => httpCtx.connection.admit(request));
      }
    }));
  });
}

// src/schedule.ts
init_vault();
init_ingest();
init_tick();
init_fusion();
init_service2();
init_cluster();
import { appendFileSync as appendFileSync2, mkdirSync as mkdirSync15, writeFileSync as writeFileSync13 } from "node:fs";
import { join } from "node:path";
function logSchedule(line) {
  try {
    mkdirSync15(join(VAULT_ROOT, "system"), { recursive: true });
    appendFileSync2(join(VAULT_ROOT, "system", "schedule.log"), "[" + (/* @__PURE__ */ new Date()).toISOString() + "] " + line + "\n");
  } catch {
  }
}
function dailyFusionAndQueue() {
  const cfg = defaultIntelConfig();
  const f = fuseDaily(cfg);
  logSchedule("daily fusion ok items=" + f.items.length + " files=" + f.files.join(","));
  const skeletons = buildClusterSkeletons(f.items, f.dupGroups);
  const ar = writeAnalyzeRequest(cfg, skeletons);
  logSchedule("analyze queue ok pending=" + ar.pending + " t0=" + ar.t0 + " file=" + ar.file);
  writeDailyCycle(f.date, true);
  return { items: f.items.length, pending: ar.pending, t0: ar.t0, date: f.date };
}
function editorialScheduleDue(now = /* @__PURE__ */ new Date()) {
  if (now.getHours() !== 20) return null;
  return now.getDay() === 3 ? "midweek" : now.getDay() === 6 ? "weekly" : null;
}
function intelTick() {
  const r = runIntelTick();
  const ok2 = r.ingest.ok && r.overall !== "red";
  mkdirSync15(join(VAULT_ROOT, "system"), { recursive: true });
  appendFileSync2(
    join(VAULT_ROOT, "system", "schedule.log"),
    `[${r.ingest.at}] intel tick ok=${ok2} added=${r.ingest.sources.reduce((n, s) => n + s.added, 0)} health=${r.overall}
`
  );
}
function writeDailyCycle(fusionDate, ok2) {
  try {
    const dir = join(VAULT_ROOT, "system");
    mkdirSync15(dir, { recursive: true });
    writeFileSync13(join(dir, "daily_cycle.json"), JSON.stringify({
      fusionAt: (/* @__PURE__ */ new Date()).toISOString(),
      fusionDate,
      status: ok2 ? "due" : "failed",
      note: ok2 ? "\u4ECA\u65E5 09:30 \u878D\u5408\u5DF2\u5B8C\u6210\uFF1B\u53EF\u5148\u8DD1\u60C5\u62A5\u7C07\u5206\u6790\uFF08sparkos-intel-cluster-analysis skill\uFF0Csparkos_run intel analyze/submitCluster\uFF09\uFF0C\u518D\u89E6\u53D1 sparkos-daily \u8DD1\u4ECA\u65E5\u5185\u5BB9\u5FAA\u73AF\uFF08sparkos_run brief / topics\uFF09" : "\u878D\u5408\u5931\u8D25\uFF0C\u5185\u5BB9\u5FAA\u73AF\u63D0\u9192\u6682\u7F13"
    }, null, 2) + "\n");
  } catch {
  }
}
function registerSchedule(ctx) {
  initVault();
  if (process.env.SPARKOS_SCHEDULE === "1") {
    const DAY_MS = 24 * 60 * 60 * 1e3;
    const timer = setInterval(() => {
      const dir = join(VAULT_ROOT, "system");
      mkdirSync15(dir, { recursive: true });
      appendFileSync2(join(dir, "schedule.log"), `[${(/* @__PURE__ */ new Date()).toISOString()}] daily brief due
`);
    }, DAY_MS);
    timer.unref?.();
    ctx.effect(() => () => clearInterval(timer));
    ctx.logger("sparkos").info("schedule enabled (daily brief due reminder)");
  }
  if (process.env.SPARKOS_INTEL_SCHEDULE === "1") {
    const HOUR_MS = 60 * 60 * 1e3;
    intelTick();
    const timer = setInterval(intelTick, HOUR_MS);
    timer.unref?.();
    ctx.effect(() => () => clearInterval(timer));
    ctx.logger("sparkos").info("intel schedule enabled (hourly ingest + health + run report)");
    if (process.env.SPARKOS_FUSION_SCHEDULE !== "0") {
      const HOUR = 9, MINUTE = 30;
      const now = /* @__PURE__ */ new Date();
      const next = new Date(now);
      next.setHours(HOUR, MINUTE, 0, 0);
      if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
      const delay = next.getTime() - now.getTime();
      const fusionTimer = setTimeout(() => {
        try {
          dailyFusionAndQueue();
        } catch (error) {
          logSchedule("daily fusion FAIL " + (error instanceof Error ? error.message : String(error)));
        }
        const loop = setInterval(() => {
          try {
            dailyFusionAndQueue();
          } catch (error) {
            logSchedule("daily fusion FAIL " + (error instanceof Error ? error.message : String(error)));
          }
        }, 24 * 60 * 60 * 1e3);
        loop.unref?.();
        ctx.effect(() => () => clearInterval(loop));
      }, delay);
      fusionTimer.unref?.();
      ctx.effect(() => () => clearTimeout(fusionTimer));
      ctx.logger("sparkos").info(`daily fusion schedule enabled (next ${next.toISOString()})`);
    }
  }
  if (process.env.SPARKOS_EDITORIAL_SCHEDULE === "1") {
    let lastRunKey = "";
    const tick = () => {
      const now = /* @__PURE__ */ new Date();
      const mode = editorialScheduleDue(now);
      if (!mode) return;
      const date = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
      const key = mode + ":" + date;
      if (key === lastRunKey) return;
      lastRunKey = key;
      mkdirSync15(join(VAULT_ROOT, "system"), { recursive: true });
      try {
        const result = runEditorialPlanning(mode, date);
        appendFileSync2(
          join(VAULT_ROOT, "system", "schedule.log"),
          `[${now.toISOString()}] editorial ${mode} ok cards=${result.plan.cards.length} job=${result.jobId}${result.reused ? " reused" : ""} waiting-approval
`
        );
      } catch (error) {
        appendFileSync2(
          join(VAULT_ROOT, "system", "schedule.log"),
          `[${now.toISOString()}] editorial ${mode} FAIL ${error instanceof Error ? error.message : String(error)}
`
        );
      }
    };
    tick();
    const timer = setInterval(tick, 30 * 60 * 1e3);
    timer.unref?.();
    ctx.effect(() => () => clearInterval(timer));
    ctx.logger("sparkos").info("editorial schedule enabled (Wednesday/Saturday 20:00 local, human approval required)");
  }
}

// src/index.ts
var name = "sparkos";
var inject = ["tools"];
function apply(ctx) {
  registerRunTool(ctx);
  registerVisualTools(ctx);
  registerWorkbench(ctx);
  registerSchedule(ctx);
}
export {
  apply,
  inject,
  name
};
