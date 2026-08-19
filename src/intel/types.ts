/**
 * intel 信源模块 · 接口预留（P2，仅类型与注册位，无任何实现）。
 *
 * 红线（来自 intel-command-blueprint §1，原样保留）：
 * - 任何 intel Provider 实现落地前，必须先过蓝图确认关卡（用户过目）；
 * - ops-intel/ 目录与 ownership.yml 桩不在此插件内实现；
 * - 本文件只定义数据契约与注册位，默认 registry 为空，不产生任何网络行为。
 *
 * @module dsh-sparkos/src/intel/types
 */

/** 信源种类。首版仅 sparkos（星火库增量）与 rss；intel 为扩展预留位。 */
export type ChannelKind = 'sparkos' | 'rss' | 'intel'

/** 信源通道契约：sources 子命令与工作台「信息源」tab 的数据来源。 */
export interface Channel {
  id: string
  kind: ChannelKind
  title: string
  /** 只读标志：星火库对插件只读，写回仅经 distill_queue 人工审核。 */
  readOnly: boolean
}

/**
 * intel Provider 扩展位：未来接入情报指挥所信源时实现此接口，
 * 并在 registerIntelProvider 注册。落地前必须走蓝图 §1 确认关卡。
 */
export interface IntelProvider {
  id: string
  /** 声明支持的通道；实现不得有副作用（网络/写盘），由调度方驱动。 */
  channels(): Channel[]
  /** 拉取增量，返回原始条目；实现必须幂等、可中断。 */
  fetchIncremental(sinceISO: string): Promise<IntelItem[]>
}

/** intel 原始条目（未蒸馏，进入工作流前仍需过守卫与人工审核）。 */
export interface IntelItem {
  eventKey: string
  sourceUrl: string
  title: string
  observedAt: string
  raw: Record<string, unknown>
}

/** 注册表：默认空。四条红线下，任何注册都需用户显式确认后才写入。 */
export const intelProviders: IntelProvider[] = []

export function registerIntelProvider(provider: IntelProvider): void {
  if (intelProviders.some((p) => p.id === provider.id)) return
  intelProviders.push(provider)
}
