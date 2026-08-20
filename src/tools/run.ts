/**
 * `sparkos_run` — 工作台唯一入口工具：8 个子命令全部实装（读取运行时每日产物）。
 * brief（payload.daily 时走五守卫入库）/ topics / draft / distill / sources / publish /
 * advise（只读 G5）/ intel（情报指挥所）。
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
    '  topics   选题推荐（当日 must_reads 按新鲜度排序；payload.top=N 取 Top N）',
    '  draft    草稿列表（payload.get=<文件名> 读全文）',
    '  distill  蒸馏审核队列（runtime+vault 合并 + 审核状态）',
    '  sources  信息源（info_sources.json + intel 健康快照）',
    '  publish  发布表现（perf/*.json 汇总，缺失降级）',
    '  advise   系统建议（只读，守卫⑤）',
    '  intel    情报指挥所（ingest/health；payload.fusion=true 融合；payload.dispatch=true 生成选题建议）',
    '参数：action(string, 可选) 子命令；payload(object, 可选)；dryRun(bool) 只校验不落盘',
    'VAULT：' + VAULT_ROOT,
  ].join('\n')
}

interface RunArgs {
  action?: string
  payload?: Record<string, unknown>
  dryRun?: boolean
}

export function registerRunTool(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'sparkos_run',
    description: 'SparkOS 自媒体工作台：brief/topics/draft/distill/sources/publish/advise/intel 子命令执行每日内容工作流。写操作先过五守卫（48h窗口/event_id去重/引用卡存在/主线存在/建议只读）。不带参数返回用法。',
    parameters: {
      action: { type: 'string', description: '子命令：' + SUBCOMMANDS.join(' | ') },
      payload: { type: 'object', additionalProperties: true, description: '子命令参数' },
      dryRun: { type: 'boolean', description: '只校验不落盘' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.text as string }],
    },
    isConcurrencySafe: () => true,
    async execute(args: RunArgs) {
      if (args.action === undefined) return { text: usage() }
      if (!SUBCOMMANDS.includes(args.action as Subcommand)) {
        return { text: '未知子命令：' + args.action + '\n' + usage() }
      }
      const dryRun = args.dryRun === true
      const vault = initVault()
      const payload = args.payload ?? {}

      // brief：提供整份 daily_data 时走五守卫（dryRun=只校验；payload.commit=true 才入库）
      if (args.action === 'brief' && payload.daily !== undefined) {
        const daily = payload.daily as Parameters<typeof validateDaily>[0]
        const report = validateDaily(daily, {
          recheck: payload.recheck === true,
          commit: !dryRun && payload.commit === true,
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
      if (args.action === 'topics') return { text: cmdTopics(payload).join('\n') }
      if (args.action === 'draft') return { text: cmdDraft(payload).join('\n') }
      if (args.action === 'distill') return { text: cmdDistill(payload).join('\n') }
      if (args.action === 'sources') return { text: cmdSources(payload).join('\n') }
      if (args.action === 'publish') return { text: cmdPublish(payload).join('\n') }
      if (args.action === 'advise') return { text: cmdAdvise(payload).join('\n') }

      if (args.action === 'intel') {
        const { runIntelTick } = await import('../intel/tick.ts')
        const r = runIntelTick()
        const lines = [
          'intel tick ok=' + r.ingest.ok + ' overall=' + r.overall,
          ...r.ingest.sources.map((s) =>
            '  ' + s.source + ': ok=' + s.ok + (s.error ? ' error=' + s.error : '') + ' scanned=' + s.scanned + ' added=' + s.added + ' skipped=' + s.skipped),
        ]
        if (payload.fusion === true) {
          const { fuseDaily } = await import('../intel/fusion.ts')
          const { defaultIntelConfig } = await import('../intel/ingest.ts')
          const f = fuseDaily(defaultIntelConfig())
          lines.push('fusion: ' + f.items.length + ' 条（' + f.files.join(', ') + '）', ...f.notes.map((n) => '  ' + n))
        }
        if (payload.dispatch === true) {
          const { generateDispatch } = await import('../intel/dispatch.ts')
          const { defaultIntelConfig } = await import('../intel/ingest.ts')
          const d = generateDispatch(defaultIntelConfig())
          lines.push('dispatch: preferences.json 已生成（' + d.items.length + ' 条建议，发布权仍归原 Owner）')
        }
        return { text: lines.join('\n') }
      }

      if (dryRun) {
        return { text: '[dryRun] ' + args.action + ' 参数校验通过，未落盘。payload keys: ' + Object.keys(payload).join(',') + (Object.keys(payload).length === 0 ? '(空)' : '') }
      }
      return { text: args.action + ' 已受理。vault=' + vault.vaultRoot + ' 迁移=' + vault.migrated.length + ' 已存在=' + vault.alreadyPresent.length }
    },
  }))
}

