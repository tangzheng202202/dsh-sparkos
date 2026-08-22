/**
 * 情报簇（Intel Cluster）：融合产物之上的结构化分析单元。
 *
 * 规则层预填骨架（分组/来源数/证据 URL/热度初判），模型层（agent 经
 * sparkos_run intel submit-cluster）补充主题/核心事实/新颖度/知识卡关系/
 * 可信度/风险/平台/选题角度。插件本身不调用 LLM（红线：判断归 agent）。
 * 数据落 ops-intel/clusters/clusters-YYYYMMDD.json（合并当天，clusterId 幂等覆盖）。
 * @module dsh-sparkos/src/intel/cluster
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { IntelConfig } from './ingest.ts'
import type { FusionItem } from './fusion.ts'

export type Level = 'low' | 'medium' | 'high'

export type EvidenceGrade = 'A' | 'B' | 'C' | 'D'

export interface ClusterEvidence {
  url: string
  claim?: string
  sourceType?: 'primary' | 'official' | 'research' | 'media' | 'social' | 'unknown'
  /** Syndicated copies must share a group so they only count as one source. */
  independenceGroup?: string
  verified?: boolean
  contradicts?: boolean
}

export interface IntelJudgment {
  confirmedFacts: string[]
  inferences: string[]
  editorialView: string
  counterArguments: string[]
  uncertainties: string[]
}

export interface IntelCluster {
  clusterId: string
  /** Stable cross-day topic identity. Agents may keep this key when a topic is renamed. */
  topicKey?: string
  date: string
  /** 主题（模型填，骨架为空）。 */
  topic: string
  coreFacts: string[]
  heat: Level
  novelty: Level
  sourceCount: number
  evidenceUrls: string[]
  evidence?: ClusterEvidence[]
  knowledgeCards: string[]
  credibility: Level
  risks: string[]
  platforms: string[]
  angleSuggestions: string[]
  judgment?: IntelJudgment
  /** Optional agent overrides (0-100); deterministic fallbacks are used when absent. */
  sourceAuthorityScore?: number
  audienceFitScore?: number
  /** 回链 fusion eventKey。 */
  eventKeys: string[]
  /** 分析模型/来源标记（agent 提交时可带）。 */
  model?: string
}

function localDateStamp(d: Date): string {
  const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, '0'); const day = String(d.getDate()).padStart(2, '0')
  return y + m + day
}

function levelOf(up: boolean, base: Level): Level {
  if (!up) return base
  return base === 'low' ? 'medium' : base === 'medium' ? 'high' : 'high'
}

/** 从 fusion 当日条目 + 疑似重复组生成待分析骨架（规则预填，模型待补）。 */
export function buildClusterSkeletons(items: FusionItem[], dupGroups: string[][], date = new Date()): IntelCluster[] {
  const stamp = localDateStamp(date)
  const byKey = new Map(items.map((i) => [i.eventKey, i]))
  const grouped = new Set<string>()
  const clusters: IntelCluster[] = []
  let seq = 1
  const mk = (keys: string[]): IntelCluster => {
    const members = keys.map((k) => byKey.get(k)).filter((x): x is FusionItem => x !== undefined)
    const sources = new Set(members.map((m) => m.source))
    const urls = [...new Set(members.map((m) => m.evidenceUrl).filter((u) => u !== ''))]
    let heat: Level = members.length >= 3 ? 'high' : members.length === 2 ? 'medium' : 'low'
    if (sources.size >= 2) heat = levelOf(true, heat) // 跨源验证升一级
    return {
      clusterId: 'c-' + stamp + '-' + String(seq++).padStart(3, '0'),
      date: stamp,
      topic: '',
      coreFacts: [],
      heat,
      novelty: 'medium',
      sourceCount: sources.size,
      evidenceUrls: urls,
      knowledgeCards: [],
      credibility: 'medium',
      risks: [],
      platforms: [],
      angleSuggestions: [],
      eventKeys: keys,
    }
  }
  for (const g of dupGroups) {
    g.forEach((k) => grouped.add(k))
    clusters.push(mk(g))
  }
  for (const i of items) {
    if (!grouped.has(i.eventKey)) clusters.push(mk([i.eventKey]))
  }
  return clusters.sort((a, b) => { const o = { high: 2, medium: 1, low: 0 }; return (o[b.heat] - o[a.heat]) || b.eventKeys.length - a.eventKeys.length })
}

/** 提交校验：返回错误列表（空=通过）。 */
export function validateCluster(c: Partial<IntelCluster>): string[] {
  const errs: string[] = []
  if (typeof c.clusterId !== 'string' || !/^c-\d{8}-\d{3}$/.test(c.clusterId)) errs.push('clusterId 必须形如 c-YYYYMMDD-001')
  if (typeof c.topic !== 'string' || c.topic.trim() === '' || c.topic.length > 120) errs.push('topic 必填且 ≤120 字')
  if (!Array.isArray(c.eventKeys) || c.eventKeys.length === 0) errs.push('eventKeys 必填且非空')
  for (const k of ['heat', 'novelty', 'credibility'] as const) {
    const v = c[k]
    if (v !== 'low' && v !== 'medium' && v !== 'high') errs.push(k + ' 必须是 low/medium/high')
  }
  for (const k of ['coreFacts', 'evidenceUrls', 'knowledgeCards', 'risks', 'platforms', 'angleSuggestions'] as const) {
    if (c[k] !== undefined && !Array.isArray(c[k])) errs.push(k + ' 必须是数组')
  }
  if (c.topicKey !== undefined && !/^t-[a-z0-9][a-z0-9._-]{2,80}$/i.test(c.topicKey)) errs.push('topicKey 必须形如 t-<稳定主题键>')
  if (c.evidence !== undefined && !Array.isArray(c.evidence)) errs.push('evidence 必须是数组')
  for (const k of ['sourceAuthorityScore', 'audienceFitScore'] as const) {
    if (c[k] !== undefined && (typeof c[k] !== 'number' || c[k]! < 0 || c[k]! > 100)) errs.push(k + ' 必须是 0-100')
  }
  if (c.judgment !== undefined) {
    if (typeof c.judgment !== 'object' || c.judgment === null) errs.push('judgment 必须是对象')
    else {
      for (const k of ['confirmedFacts', 'inferences', 'counterArguments', 'uncertainties'] as const) {
        if (!Array.isArray(c.judgment[k])) errs.push('judgment.' + k + ' 必须是数组')
      }
      if (typeof c.judgment.editorialView !== 'string') errs.push('judgment.editorialView 必须是字符串')
    }
  }
  return errs
}

function clustersDir(cfg: IntelConfig): string {
  return path.join(path.dirname(cfg.outDir), 'clusters')
}

/** 读取某天情报簇（无则空数组）。 */
export function loadClusters(cfg: IntelConfig, date: Date): IntelCluster[] {
  const dir = clustersDir(cfg)
  const f = path.join(dir, 'clusters-' + localDateStamp(date) + '.json')
  if (!existsSync(f)) return []
  try {
    const raw = JSON.parse(readFileSync(f, 'utf8')) as IntelCluster[]
    return Array.isArray(raw) ? raw : []
  } catch { return [] }
}

/** 读取最新一份情报簇（按文件名倒序）。 */
export function latestClusters(cfg: IntelConfig): { date: string; clusters: IntelCluster[] } | null {
  const dir = clustersDir(cfg)
  try {
    const files = readdirSync(dir).filter((f) => /^clusters-\d{8}\.json$/.test(f)).sort().reverse()
    if (files.length === 0) return null
    const raw = JSON.parse(readFileSync(path.join(dir, files[0]), 'utf8')) as IntelCluster[]
    return { date: files[0].slice(9, 17), clusters: Array.isArray(raw) ? raw : [] }
  } catch { return null }
}

/** 合并写回某天情报簇（同 clusterId 覆盖，其余保留）。 */
export function saveClusters(cfg: IntelConfig, incoming: IntelCluster[], date: Date): { file: string; total: number } {
  const dir = clustersDir(cfg)
  mkdirSync(dir, { recursive: true })
  const stamp = localDateStamp(date)
  const existing = loadClusters(cfg, date)
  const merged = new Map(existing.map((c) => [c.clusterId, c]))
  for (const c of incoming) {
    if (c.clusterId && c.clusterId.startsWith('c-')) merged.set(c.clusterId, c)
  }
  const out = [...merged.values()]
  const f = path.join(dir, 'clusters-' + stamp + '.json')
  writeFileSync(f, JSON.stringify(out, null, 2) + '\n')
  return { file: f, total: out.length }
}

/** 生成待分析骨架文件 analyze-YYYYMMDD.json（供模型分析参考；不覆盖已提交簇）。 */
export function writeAnalyzeRequest(cfg: IntelConfig, skeletons: IntelCluster[], date = new Date()): { file: string; pending: number } {
  const dir = clustersDir(cfg)
  mkdirSync(dir, { recursive: true })
  const stamp = localDateStamp(date)
  const existing = new Map(loadClusters(cfg, date).map((c) => [c.clusterId, c]))
  const pending = skeletons.filter((s) => !existing.has(s.clusterId))
  const f = path.join(dir, 'analyze-' + stamp + '.json')
  writeFileSync(f, JSON.stringify({
    date: stamp,
    generatedAt: new Date().toISOString(),
    instructions: {
      topicKey: '跨日同一话题必须复用稳定 topicKey（t-...），即使标题变化',
      evidence: '逐条填写 claim/url/sourceType/independenceGroup/verified/contradicts；转载同稿共用 independenceGroup',
      judgment: '严格分开 confirmedFacts、inferences、editorialView、counterArguments、uncertainties',
      creationGate: '只有证据等级 A（官方/第一方）或 B（至少两个独立可靠来源）可进入创作',
    },
    pending,
  }, null, 2) + '\n')
  return { file: f, pending: pending.length }
}
