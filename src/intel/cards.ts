/**
 * 补卡清单：把「有热度但没有知识卡」的情报簇转成**可执行的补卡请求**。
 *
 * 为什么需要：`knowledgeCards` 决定 ranking 的 `knowledgeDepth`（占 overallScore 0.20），
 * 而规则骨架的 `knowledgeCards` 恒为空、要靠 agent 分析补。于是系统知道「什么在热」，
 * 却没有任何出口告诉人「该补哪张卡」——热点就这样空转成 0 分候选。
 * 本模块补上这个出口，把热点翻译成「写这一张卡」。
 *
 * 红线：**只生成建议，不写星火库**。星火知识库对插件永久只读（写回仅经蒸馏审核 + 人工复制）。
 * @module dsh-sparkos/src/intel/cards
 */

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { KNOWLEDGE_ROOT } from '../vault.ts'
import type { IntelConfig } from './ingest.ts'
import type { IntelCluster } from './cluster.ts'

export interface CardRequest {
  clusterId: string
  /** 建议的引用卡 URI（形如 obs://056）。人工确认并建卡后才可被草稿引用。 */
  suggestedUri: string
  /** 建议文件名；`<slug>` 占位需人工/agent 翻译生成（沿用 spark-notes 的英文 slug 惯例）。 */
  suggestedFile: string
  title: string
  /** 为什么建议补这张卡（含热度与缺卡对排序的影响）。 */
  reason: string
  heat: IntelCluster['heat']
  sourceHeat: number | null
  sourceCount: number
  evidenceUrls: string[]
  eventKeys: string[]
}

/** 触发补卡的热度门槛：sourceHeat ≥ 此值，或缺 sourceHeat 但 heat=high。 */
export const CARD_REQUEST_MIN_HEAT = 70

/** 单次最多输出多少条，避免把清单变成新的噪声源。 */
export const CARD_REQUEST_LIMIT = 10

function pad3(n: number): string {
  return String(n).padStart(3, '0')
}

/**
 * 扫 spark-notes 的编号前缀，返回下一个可用编号（**只读**）。
 * 目录缺失（干净环境）时从 001 开始，不抛错。
 */
export function nextCardNumbers(knowledgeRoot: string = KNOWLEDGE_ROOT): { obs: number; model: number } {
  if (!knowledgeRoot) return { obs: 1, model: 1 }
  const scan = (dir: string, pattern: RegExp): number => {
    let max = 0
    const base = path.join(knowledgeRoot, 'spark-notes', dir)
    if (!existsSync(base)) return 1
    for (const f of readdirSync(base)) {
      const m = pattern.exec(f)
      if (m) max = Math.max(max, Number.parseInt(m[1], 10))
    }
    return max + 1
  }
  return {
    obs: scan('observations', /^(\d{1,4})-/),
    model: scan('models', /^(\d{1,4})-/),
  }
}

export interface CardRequestOptions {
  knowledgeRoot?: string
  /** 生成日期（决定建议文件名的日期后缀）。 */
  date?: Date
  minHeat?: number
  limit?: number
  /**
   * eventKey → 事件标题（来自当日 fusion）。
   *
   * 必需性说明：规则骨架的 `topic` 为空，若不用融合条目标题兜底，
   * 清单会变成一排「(待分析)」——等于没有信息。
   */
  titles?: Map<string, string>
}

function stampOf(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * 生成补卡请求：挑出「够热但一张卡都没有」的簇，按热度降序，给出建议编号与理由。
 *
 * 建议卡种统一为 observation（观察卡）——一条新闻事件天然支撑的是「我观察到的事实」；
 * model（模型卡）是人为提炼的框架，是否值得沉淀由人判断，模块不越权代拟。
 */
export function buildCardRequests(clusters: IntelCluster[], opts: CardRequestOptions = {}): CardRequest[] {
  const minHeat = opts.minHeat ?? CARD_REQUEST_MIN_HEAT
  const limit = opts.limit ?? CARD_REQUEST_LIMIT
  const date = opts.date ?? new Date()
  const { obs } = nextCardNumbers(opts.knowledgeRoot ?? KNOWLEDGE_ROOT)
  const stamp = stampOf(date)

  const targets = clusters
    .filter((c) => c.knowledgeCards.length === 0)
    .filter((c) => (typeof c.sourceHeat === 'number' ? c.sourceHeat >= minHeat : c.heat === 'high'))
    .sort((a, b) => (b.sourceHeat ?? 0) - (a.sourceHeat ?? 0) || b.sourceCount - a.sourceCount)
    .slice(0, limit)

  return targets.map((c, i) => {
    const heatText = typeof c.sourceHeat === 'number' ? c.sourceHeat + ' 分' : c.heat + ' 档'
    // 标题优先级：簇主题（模型分析过）→ 融合条目标题（骨架状态）→ 显式提示待分析
    const fromFusion = c.eventKeys.map((k) => opts.titles?.get(k)).find((t) => t !== undefined && t !== '')
    const title = c.topic.trim() !== ''
      ? c.topic
      : (fromFusion ?? '(待分析：需先跑 sparkos-intel-cluster-analysis)')
    return {
      clusterId: c.clusterId,
      suggestedUri: 'obs://' + pad3(obs + i),
      suggestedFile: pad3(obs + i) + '-<slug>-' + stamp + '.md',
      title,
      reason: '热度 ' + heatText + ' / ' + c.sourceCount + ' 个来源，但 0 张知识卡 → knowledgeDepth=0，'
        + '该主题进不了创作候选。补 1 张卡即可让它具备论证层。',
      heat: c.heat,
      sourceHeat: c.sourceHeat ?? null,
      sourceCount: c.sourceCount,
      evidenceUrls: c.evidenceUrls,
      eventKeys: c.eventKeys,
    }
  })
}

/** 写出补卡清单到 VAULT/ops-intel/card-requests-YYYYMMDD.{json,md}（不碰星火库）。 */
export function writeCardRequests(
  cfg: IntelConfig,
  requests: CardRequest[],
  date = new Date(),
): { files: string[]; pending: number } {
  const outDir = path.dirname(cfg.outDir)
  mkdirSync(outDir, { recursive: true })
  const stamp = stampOf(date).replace(/-/g, '')
  const jsonFile = path.join(outDir, 'card-requests-' + stamp + '.json')
  const mdFile = path.join(outDir, 'card-requests-' + stamp + '.md')
  writeFileSync(jsonFile, JSON.stringify({
    date: stamp,
    generatedAt: new Date().toISOString(),
    note: '补卡建议，人工确认后自行在星火库建卡；插件不写知识库。',
    requests,
  }, null, 2) + '\n')

  const md = requests.length === 0
    ? '# 补卡清单 ' + stamp + '\n\n> 今日没有「够热但缺卡」的主题。\n'
    : [
        '# 补卡清单 ' + stamp,
        '',
        '> 热度够但 0 张知识卡的主题。补 1 张卡即可让该主题进入创作候选（knowledgeDepth 由此而来）。',
        '> 星火知识库对插件只读：以下均为**建议**，需人工确认后自行建卡。',
        '',
        '| 建议编号 | 建议文件 | 热度 | 来源 | 主题 |',
        '| --- | --- | --- | --- | --- |',
        ...requests.map((r) => '| ' + r.suggestedUri + ' | ' + r.suggestedFile + ' | '
          + (r.sourceHeat === null ? r.heat : String(r.sourceHeat)) + ' | ' + r.sourceCount + ' | '
          + r.title.replace(/\|/g, '\\|') + ' |'),
        '',
        ...requests.flatMap((r) => [
          '## ' + r.suggestedUri + ' · ' + r.title,
          '',
          '建议文件：`' + r.suggestedFile + '`',
          '',
          '理由：' + r.reason,
          '',
          ...(r.evidenceUrls.length > 0 ? ['证据：', ...r.evidenceUrls.map((u) => '- ' + u), ''] : []),
        ]),
      ].join('\n')
  writeFileSync(mdFile, md)
  return { files: [jsonFile, mdFile], pending: requests.length }
}
