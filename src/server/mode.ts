/**
 * 工作台模式判定：SparkOS 降级（2026-08-30 决策）后默认为「简报台」（brief），
 * 重度受控工厂管线（选题/草稿包/视觉/交付/发布）仅在显式开启时可用。
 *
 * 优先级：环境变量 SPARKOS_WORKBENCH_MODE（full|brief）
 *   > VAULT config/workbench_mode.json（{ "mode": "full" }）
 *   > 默认 brief（工厂端点 410）
 * @module dsh-sparkos/src/server/mode
 */

import { readFileSync } from 'node:fs'
import nodePath from 'node:path'
import { VAULT_ROOT } from '../vault.ts'

export type WorkbenchMode = 'brief' | 'full'

export function workbenchMode(): WorkbenchMode {
  const env = process.env.SPARKOS_WORKBENCH_MODE
  if (env === 'full' || env === 'brief') return env
  try {
    const raw = JSON.parse(readFileSync(nodePath.join(VAULT_ROOT, 'config', 'workbench_mode.json'), 'utf8')) as { mode?: unknown }
    if (raw && (raw.mode === 'full' || raw.mode === 'brief')) return raw.mode
  } catch {
    // 无配置文件或解析失败 → 默认 brief
  }
  return 'brief'
}

export function factoryEnabled(): boolean {
  return workbenchMode() === 'full'
}
