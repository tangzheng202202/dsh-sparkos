/**
 * dsh-sparkos — DeepSeek Harness 自媒体工作台插件（host 半）。
 *
 * 数据与代码分离：VAULT = ~/DeepSeek harness/sparkos/；
 * 星火知识库只读，写回仅经 distill_queue 人工审核。
 * @module dsh-sparkos/src/index
 */

import type { Context } from '@deepseek-ai/cordis'
import { registerRunTool } from './tools/run.ts'

export const name = 'sparkos'
export const inject = ['tools']

export function apply(ctx: Context): void {
  registerRunTool(ctx)
}
