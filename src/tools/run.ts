/**
 * `sparkos_run` — 工作台唯一入口工具：8 个子命令全部实装（读取运行时每日产物）。
 * brief（payload.daily 时走五守卫入库）/ topics / draft / distill / sources / publish /
 * advise（只读 G5）/ intel（情报指挥所）。
 * 语义收口：
 * - dryRun=true 对全部 8 个 action 零写入，分派发生在 initVault / SQLite 打开 / 任何写函数之前；
 * - 写动作不再声明并发安全（isConcurrencySafe 按参数判定）。
 * @module dsh-sparkos/src/tools/run
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { initVault, VAULT_ROOT } from '../vault.ts'
import { validateDaily } from '../guards.ts'
import {
  cmdAdvise,
  cmdBrief,
  cmdDistill,
  cmdDraft,
  cmdPublish,
  cmdSources,
  cmdTopics,
} from './workflow.ts'

export const SUBCOMMANDS = ['brief', 'topics', 'draft', 'distill', 'sources', 'publish', 'advise', 'intel'] as const
export type Subcommand = (typeof SUBCOMMANDS)[number]

export function usage(): string {
  return [
    'sparkos_run — SparkOS 自媒体工作台入口',
    '子命令：' + SUBCOMMANDS.join(' / '),
    '  brief    今日简报（读最新 daily_briefing + daily_data；payload.daily 时走五守卫，commit=true 入库）',
    '  topics   选题推荐；payload.editorial=midweek|weekly 生成周三/周六 5 张可审批选题卡',
    '  draft    草稿中心；pending 查看待生成契约，submitPackage 提交四平台完整草稿包，packages 查看状态',
    '  distill  蒸馏审核队列（runtime+vault 合并 + 审核状态）',
    '  sources  信息源（info_sources.json + intel 健康快照）',
    '  publish  发布表现（perf/*.json 汇总，缺失降级）',
    '  advise   系统建议（只读，守卫⑤）',
    '  intel    情报指挥所（ingest/health；fusion 融合；analyze/submitCluster 情报簇；rank 每日Top5/连续榜；jobs 任务状态；dispatch 生成建议）',
    '参数：action(string, 可选) 子命令；payload(object, 可选)；dryRun(bool) 只校验不落盘（8 个子命令全部零写入）',
    'VAULT：' + VAULT_ROOT,
  ].join('\n')
}

interface RunArgs {
  action?: string
  payload?: Record<string, unknown>
  dryRun?: boolean
}

/** 写动作判定：brief+daily / topics+editorial / draft 写分支 / intel 写旗标都会写 VAULT 或 SQLite。 */
export function isWriteInvocation(action: string | undefined, payload: Record<string, unknown>): boolean {
  if (action === 'brief') return payload.daily !== undefined
  if (action === 'topics') return payload.editorial === 'midweek' || payload.editorial === 'weekly'
  if (action === 'draft') return payload.pending !== true && payload.packages !== true
    && (typeof payload.request === 'string' || typeof payload.revise === 'string' || payload.submitPackage !== undefined || Object.keys(payload).length === 0)
  if (action === 'intel') return payload.fusion === true || payload.analyze === true || payload.submitCluster !== undefined
    || payload.rank === true || payload.dispatch === true || Object.keys(payload).length === 0
  return false
}

async function previewIntelDryRun(payload: Record<string, unknown>): Promise<{ text: string }> {
  const actions = ['runIntelTick（ingest / health / run 日志）']
  if (payload.fusion === true) actions.push('生成当日 fusion JSON/Markdown')
  if (payload.analyze === true) actions.push('生成情报簇 analyze 请求')
  if (payload.clusters === true) actions.push('读取最新情报簇')
  if (payload.submitCluster !== undefined) actions.push('保存情报簇并刷新排名')
  if (payload.rank === true) actions.push('刷新每日排名与创作候选')
  if (payload.jobs === true) actions.push('读取工厂任务快照')
  if (payload.dispatch === true) actions.push('生成 dispatch preferences.json')

  const lines = [
    '[dryRun] intel 零写入预览；未执行 runIntelTick，未打开 SQLite，未读写 VAULT。',
    '实际执行时将运行：',
    ...actions.map((action) => '  - ' + action),
  ]
  if (payload.submitCluster !== undefined) {
    const { validateCluster } = await import('../intel/cluster.ts')
    const errors = validateCluster(payload.submitCluster as never)
    if (errors.length > 0) lines.push('submit-cluster 校验失败：' + errors.join('；'))
    else lines.push('submit-cluster 校验通过；dryRun 未保存情报簇、未刷新排名。')
  }
  return { text: lines.join('\n') }
}

const DRAFT_PACKAGE_ID = /^dp-[a-f0-9]{16}$/

/**
 * 全局 dryRun 分派器：对全部 8 个 action 返回“将执行动作 + 参数校验结果”，
 * 绝不执行普通读取分支冒充 dryRun。零写入：不 initVault、不打开 SQLite、
 * 不建目录、不迁移种子、不改 mtime、不写日志或数据库（validateDaily 以
 * commit=false 运行，仅做内存校验与既有数据只读比对）。
 */
async function dispatchDryRun(action: Subcommand, payload: Record<string, unknown>): Promise<{ text: string }> {
  const head = '[dryRun] ' + action + ' 零写入预览（未初始化 VAULT、未打开 SQLite、未触发任何写入）。'
  if (action === 'intel') return previewIntelDryRun(payload)

  if (action === 'brief') {
    if (payload.daily !== undefined) {
      const daily = payload.daily as Parameters<typeof validateDaily>[0]
      const report = validateDaily(daily, { recheck: payload.recheck === true, commit: false })
      const lines = [
        head,
        '实际执行时将运行：五守卫校验' + (payload.commit === true ? ' 并在通过后入库（commit=true）' : '（commit 未设，仅校验不入库）'),
        '校验结果：ok=' + report.ok + ' 错误=' + report.errors.length + ' 警告=' + report.warnings.length,
        ...report.warnings.map((w) => '  WARN ' + w),
        ...report.errors.map((e) => '  FAIL ' + e),
      ]
      return { text: lines.join('\n') }
    }
    return { text: [head, '实际执行时将运行：读取最新 daily_briefing 与 daily_data（只读）。'].join('\n') }
  }

  if (action === 'topics') {
    if (payload.editorial === 'midweek' || payload.editorial === 'weekly') {
      return { text: [head, '实际执行时将运行：editorial.' + payload.editorial + ' 选题卡生成（写 SQLite）', '参数校验：editorial=' + payload.editorial + ' 合法' + (payload.date !== undefined && typeof payload.date === 'string' ? '，date=' + payload.date : '')].join('\n') }
    }
    if (payload.editorial !== undefined) return { text: [head, '参数校验失败：editorial 只允许 midweek|weekly。'].join('\n') }
    return { text: [head, '实际执行时将运行：读取主题池与已采纳事件（只读）。'].join('\n') }
  }

  if (action === 'draft') {
    if (payload.pending === true) return { text: [head, '实际执行时将运行：列出待生成草稿契约（只读 SQLite）。'].join('\n') }
    if (typeof payload.request === 'string') {
      const okId = DRAFT_PACKAGE_ID.test(payload.request)
      return { text: [head, '实际执行时将运行：创建草稿任务请求（写 SQLite）。', '参数校验：request=' + payload.request + (okId ? '（合法 dp-id）' : '（不合法：应为 dp-<16位hex>）')].join('\n') }
    }
    if (typeof payload.revise === 'string') {
      const okId = DRAFT_PACKAGE_ID.test(payload.revise)
      return { text: [head, '实际执行时将运行：创建不可覆盖修订版（写 SQLite）。', '参数校验：revise=' + payload.revise + (okId ? '（合法 dp-id）' : '（不合法：应为 dp-<16位hex>）')].join('\n') }
    }
    if (payload.submitPackage !== undefined) {
      const submission = payload.submitPackage as Record<string, unknown> | undefined
      const shapeOk = submission !== null && typeof submission === 'object' && !Array.isArray(submission)
      const lines = [head, '实际执行时将运行：完整事实与平台校验，通过后写草稿包与产物（写 SQLite + VAULT）。']
      lines.push(shapeOk
        ? '参数校验：submitPackage 为对象（完整五守卫/四平台校验仅在实际提交时执行）。'
        : '参数校验失败：submitPackage 必须是对象。')
      return { text: lines.join('\n') }
    }
    if (payload.packages === true) return { text: [head, '实际执行时将运行：列出工厂草稿包（只读 SQLite）。'].join('\n') }
    return { text: [head, '实际执行时将运行：读取草稿中心文件列表（只读）。'].join('\n') }
  }

  const readOnly: Record<string, string> = {
    distill: '合并 runtime+vault 蒸馏队列并展示审核状态（只读）',
    sources: '读取 info_sources.json 与 intel 健康快照（只读）',
    publish: '汇总 perf/*.json 发布表现（只读）',
    advise: '读取系统建议（只读，守卫⑤）',
  }
  return { text: [head, '实际执行时将运行：' + (readOnly[action] ?? '只读分支')].join('\n') }
}

/**
 * sparkos_run 主入口（导出供回归测试直调）。
 * dryRun 分派发生在 initVault / SQLite 打开 / schedule / 任何写函数之前。
 */
export async function runSparkosCommand(args: RunArgs): Promise<{ text: string }> {
  if (args.action === undefined) return { text: usage() }
  if (!SUBCOMMANDS.includes(args.action as Subcommand)) {
    return { text: '未知子命令：' + args.action + '\n' + usage() }
  }
  const dryRun = args.dryRun === true
  const payload = args.payload ?? {}
  if (dryRun) return dispatchDryRun(args.action as Subcommand, payload)
  const vault = initVault()

  // brief：提供整份 daily_data 时走五守卫（dryRun=只校验；payload.commit=true 才入库）
  if (args.action === 'brief' && payload.daily !== undefined) {
    const daily = payload.daily as Parameters<typeof validateDaily>[0]
    const report = validateDaily(daily, {
      recheck: payload.recheck === true,
      commit: payload.commit === true,
    })
    const lines = [
      '日期=' + daily.date + ' 必读=' + report.stats.must_reads + ' 草稿=' + report.stats.drafts + ' 建议=' + report.stats.suggestions + ' 蒸馏候选=' + report.stats.distill_candidates,
      ...report.warnings.map((w) => 'WARN ' + w),
      ...report.errors.map((e) => 'FAIL ' + e),
    ]
    if (!report.ok) lines.push('结果: 校验未通过(' + report.errors.length + ' 错误), 未入库')
    else if (report.committed !== undefined) lines.push('结果: 校验通过, 新入库 ' + report.committed + ' 条事件(已存在 ' + report.skipped + ' 条跳过)')
    else lines.push('结果: 校验通过(未入库, payload.commit=true 才入库)')
    return { text: lines.join('\n') }
  }

  if (args.action === 'brief') return { text: cmdBrief(payload).join('\n') }
  if (args.action === 'topics' && (payload.editorial === 'midweek' || payload.editorial === 'weekly')) {
    const { runEditorialPlanning } = await import('../factory/service.ts')
    try {
      const result = runEditorialPlanning(payload.editorial, typeof payload.date === 'string' ? payload.date : undefined)
      const p = result.plan
      const lines = [
        `editorial ${p.mode}: ${p.periodStart}..${p.periodEnd} · ${p.cards.length} 张选题卡 · ${p.status}（job=${result.jobId}${result.reused ? ' · 幂等复用' : ''}）`,
        '  ' + p.summary.note,
      ]
      for (const card of p.cards) {
        lines.push(`  #${card.rank} [${card.verificationGrade}/${card.trendPattern}] 价值=${card.expectedValue.toFixed(1)} ${card.title}`)
        lines.push('    判断：' + card.coreThesis)
        lines.push('    时机：' + card.whyNow)
        if (card.counterArguments.length > 0) lines.push('    反方：' + card.counterArguments.join('；'))
        if (card.risks.length > 0) lines.push('    风险：' + card.risks.join('；'))
      }
      lines.push('  下一步：在工作台人工批准/驳回；未批准不得进入草稿生成。')
      return { text: lines.join('\n') }
    } catch (error) {
      return { text: 'editorial FAIL: ' + (error instanceof Error ? error.message : String(error)) }
    }
  }
  if (args.action === 'topics') return { text: cmdTopics(payload).join('\n') }
  if (args.action === 'draft' && payload.pending === true) {
    const { listPendingDraftRequests } = await import('../factory/service.ts')
    const requests = listPendingDraftRequests(typeof payload.limit === 'number' ? payload.limit : 5)
    if (requests.length === 0) return { text: '暂无待生成草稿任务。批准 M3 选题卡后会自动入队。' }
    return { text: ['===== 待生成草稿契约（' + requests.length + '） =====', ...requests.map((request) => JSON.stringify(request, null, 2))].join('\n') }
  }
  if (args.action === 'draft' && typeof payload.request === 'string') {
    try {
      const { requestDraftPackage } = await import('../factory/service.ts')
      const result = requestDraftPackage(payload.request)
      return { text: `草稿任务 ${result.created ? '已创建' : '已存在'}：\n` + JSON.stringify(result.package.request, null, 2) }
    } catch (error) {
      return { text: 'draft request FAIL: ' + (error instanceof Error ? error.message : String(error)) }
    }
  }
  if (args.action === 'draft' && typeof payload.revise === 'string') {
    try {
      const { requestDraftRevision } = await import('../factory/service.ts')
      const result = requestDraftRevision(payload.revise)
      return { text: `草稿修订版 ${result.created ? '已创建' : '已存在'}：\n` + JSON.stringify(result.package.request, null, 2) }
    } catch (error) {
      return { text: 'draft revise FAIL: ' + (error instanceof Error ? error.message : String(error)) }
    }
  }
  if (args.action === 'draft' && payload.submitPackage !== undefined) {
    try {
      const { runDraftSubmission } = await import('../factory/service.ts')
      const result = runDraftSubmission(payload.submitPackage as never)
      if (!result.validation.ok) return { text: ['draft submit VALIDATION FAIL:', ...result.validation.errors.map((error) => '  - ' + error), ...result.validation.warnings.map((warning) => '  WARN ' + warning)].join('\n') }
      return { text: [
        `draft submit OK: ${result.package.id} · ${result.package.artifacts.length} 个产物 · ${result.package.status}`,
        `  微信 ${result.validation.stats.wechatChars} 字 / Telegram ${result.validation.stats.telegramChars} 字 / X ${result.validation.stats.xPosts} 条 / 小红书 ${result.validation.stats.xiaohongshuChars} 字 / 配图任务 ${result.validation.stats.assets} 个`,
        ...result.package.artifacts.map((artifact) => '  - ' + artifact.relativePath),
        '  下一步：工作台人工审核；批准前不得发布。',
      ].join('\n') }
    } catch (error) {
      return { text: 'draft submit FAIL: ' + (error instanceof Error ? error.message : String(error)) }
    }
  }
  if (args.action === 'draft' && payload.packages === true) {
    const { buildFactorySnapshot } = await import('../factory/service.ts')
    const packages = buildFactorySnapshot().drafts
    return { text: packages.length === 0 ? '暂无工厂草稿包。' : ['===== 工厂草稿包 =====', ...packages.map((item) => `- ${item.id} v${item.revision} [${item.status}] ${item.title} · 产物 ${item.artifacts.length}`)].join('\n') }
  }
  if (args.action === 'draft') return { text: cmdDraft(payload).join('\n') }
  if (args.action === 'distill') return { text: cmdDistill(payload).join('\n') }
  if (args.action === 'sources') return { text: cmdSources(payload).join('\n') }
  if (args.action === 'publish') return { text: cmdPublish(payload).join('\n') }
  if (args.action === 'advise') return { text: cmdAdvise(payload).join('\n') }

  if (args.action === 'intel') {
    const { defaultIntelConfig } = await import('../intel/ingest.ts')
    const cfg = defaultIntelConfig()
    const { runIntelTick } = await import('../intel/tick.ts')
    const r = runIntelTick()
    const lines = [
      'intel tick ok=' + r.ingest.ok + ' overall=' + r.overall,
      ...r.ingest.sources.map((s) =>
        '  ' + s.source + ': ok=' + s.ok + (s.error ? ' error=' + s.error : '') + ' scanned=' + s.scanned + ' added=' + s.added + ' skipped=' + s.skipped),
    ]
    if (payload.fusion === true) {
      const { fuseDaily } = await import('../intel/fusion.ts')
      const f = fuseDaily(cfg)
      lines.push('fusion: ' + f.items.length + ' 条（' + f.files.join(', ') + '）', ...f.notes.map((n) => '  ' + n))
    }
    if (payload.analyze === true) {
      const { buildClusterSkeletons, writeAnalyzeRequest } = await import('../intel/cluster.ts')
      const { fuseDaily: fuseDaily2 } = await import('../intel/fusion.ts')
      const f2 = fuseDaily2(cfg)
      const skeletons = buildClusterSkeletons(f2.items, f2.dupGroups)
      const r = writeAnalyzeRequest(cfg, skeletons)
      lines.push('analyze: 生成 ' + skeletons.length + ' 个情报簇骨架（' + r.pending + ' 待模型分析 → analyze-' + f2.date + '.json）')
      if (r.pending > 0) lines.push('  待补字段：topic/topicKey/coreFacts/evidence/judgment/novelty/knowledgeCards/credibility/risks/platforms/angleSuggestions')
    }
    if (payload.clusters === true) {
      const { latestClusters } = await import('../intel/cluster.ts')
      const lc = latestClusters(cfg)
      if (!lc) { lines.push('clusters: 暂无情报簇（先 payload.analyze=true 生成骨架）') }
      else {
        lines.push('clusters: ' + lc.date + ' 共 ' + lc.clusters.length + ' 簇')
        for (const c of lc.clusters) {
          lines.push('  - ' + c.clusterId + ' [' + c.heat + '] ' + (c.topic || '(待分析)') + ' · 来源 ' + c.sourceCount + ' · 事件 ' + c.eventKeys.length + (c.angleSuggestions.length ? ' · 角度 ' + c.angleSuggestions.join(' / ') : ''))
        }
      }
    }
    if (payload.submitCluster !== undefined) {
      const { validateCluster, saveClusters } = await import('../intel/cluster.ts')
      const c = payload.submitCluster as Record<string, unknown>
      const errs = validateCluster(c as never)
      if (errs.length > 0) { lines.push('submit-cluster FAIL: ' + errs.join('；')) }
      else {
        const r = saveClusters(cfg, [c as never], new Date())
        lines.push('submit-cluster OK: ' + c.clusterId + ' → ' + r.file.split('/').pop() + '（共 ' + r.total + ' 簇）')
        try {
          const { runLatestRanking } = await import('../factory/service.ts')
          const ranked = runLatestRanking()
          lines.push('  自动刷新排名：Top ' + ranked.ranking.top5.length + ' · 连续霸榜 ' + ranked.ranking.persistent.length + ' · 可创作 ' + ranked.ranking.creationCandidates.length)
        } catch (error) {
          lines.push('  排名刷新待后续重试：' + (error instanceof Error ? error.message : String(error)))
        }
      }
    }
    if (payload.rank === true) {
      const { runLatestRanking } = await import('../factory/service.ts')
      try {
        const result = runLatestRanking()
        lines.push('rank: ' + result.ranking.date + ' Top ' + result.ranking.top5.length + '（job=' + result.jobId + (result.reused ? ' · 幂等复用' : '') + '）')
        for (const item of result.ranking.top5) {
          lines.push('  #' + item.rank + ' [' + item.verificationGrade + '] 热度=' + item.heatScore.toFixed(1) + ' 连榜=' + item.consecutiveTopDays + '天 ' + item.topic)
        }
        if (result.ranking.persistent.length > 0) lines.push('  连续霸榜：' + result.ranking.persistent.map((item) => item.topic).join(' / '))
        lines.push('  可进入创作（仅A/B证据）：' + result.ranking.creationCandidates.length + ' 个')
      } catch (error) {
        lines.push('rank FAIL: ' + (error instanceof Error ? error.message : String(error)))
      }
    }
    if (payload.jobs === true) {
      const { buildFactorySnapshot } = await import('../factory/service.ts')
      const snapshot = buildFactorySnapshot()
      lines.push('jobs: schema=' + snapshot.database.schemaVersion + ' 最近 ' + snapshot.jobs.length + ' 项')
      for (const job of snapshot.jobs) lines.push('  - ' + job.kind + ' [' + job.status + '] attempts=' + job.attempts + '/' + job.maxAttempts + ' id=' + job.id)
    }
    if (payload.dispatch === true) {
      const { generateDispatch } = await import('../intel/dispatch.ts')
      const d = generateDispatch(cfg)
      lines.push('dispatch: preferences.json 已生成（' + d.items.length + ' 条建议，发布权仍归原 Owner）')
    }
    return { text: lines.join('\n') }
  }

  return { text: args.action + ' 已受理。vault=' + vault.vaultRoot + ' 迁移=' + vault.migrated.length + ' 已存在=' + vault.alreadyPresent.length }
}

export function registerRunTool(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'sparkos_run',
    description: 'SparkOS 自媒体工作台：brief/topics/draft/distill/sources/publish/advise/intel 子命令执行每日内容工作流。写操作先过五守卫（48h窗口/event_id去重/引用卡存在/主线存在/建议只读）。不带参数返回用法。dryRun=true 时全部子命令零写入（仅校验与预览）。',
    parameters: {
      action: { type: 'string', description: '子命令：' + SUBCOMMANDS.join(' | ') },
      payload: { type: 'object', additionalProperties: true, description: '子命令参数' },
      dryRun: { type: 'boolean', description: '只校验不落盘（全部 8 个子命令零写入）' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.text as string }],
    },
    // 并发声明收口：写动作（会写 VAULT / SQLite）不得声明并发安全。
    isConcurrencySafe: (args) => args.dryRun === true || !isWriteInvocation(args.action, args.payload ?? {}),
    async execute(args: RunArgs) {
      return runSparkosCommand(args)
    },
  }))
}
