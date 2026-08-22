/**
 * 渲染工作台 HTML 到 /tmp/sparkos-wb.html（无宿主也可跑 DOM 检查）。
 * 用法：node --experimental-strip-types scripts/render-page.mjs [out.html]
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Portable fallback: when no real VAULT is configured, render against seeds +
// one minimal daily fixture. Imports are intentionally dynamic so env paths are
// resolved after the temporary root is selected.
let fixtureRoot = null
if (!process.env.SPARKOS_VAULT_ROOT) {
  fixtureRoot = mkdtempSync(path.join(tmpdir(), 'sparkos-render-'))
  const vault = path.join(fixtureRoot, 'vault')
  const daily = path.join(fixtureRoot, 'daily')
  mkdirSync(daily, { recursive: true })
  process.env.SPARKOS_VAULT_ROOT = vault
  process.env.SPARKOS_CONTENTOS_ROOT = fixtureRoot
  process.env.SPARKOS_DAILY_BRIEF_DIR = daily
  process.env.SPARKOS_RUNTIME_EVENTS = path.join(vault, 'archive', 'events.jsonl')
  process.env.SPARKOS_TIMELINE_DATA = path.join(vault, 'config', 'timeline_cards.json')
  writeFileSync(path.join(daily, 'daily_data_2026-08-22.json'), JSON.stringify({
    date: '2026-08-22',
    must_reads: [{ event_id: 'render-fixture-1', title: '工作台渲染检查', fresh_hours: 1, primary_line: 'line-001' }],
  }))
  writeFileSync(path.join(daily, 'daily_briefing_2026-08-22.md'), '# 每日简报\n\n- 工作台渲染检查\n')
}

const { initVault } = await import('../src/vault.ts')
initVault()
if (fixtureRoot) {
  const vault = process.env.SPARKOS_VAULT_ROOT
  const lines = Array.from({ length: 10 }, (_, index) => ({ id: 'line-' + String(index + 1).padStart(3, '0') }))
  const names = Object.fromEntries(lines.map((line, index) => [line.id, '渲染主线' + (index + 1)]))
  const cards = Array.from({ length: 72 }, (_, index) => ({
    k: 'obs/' + String(index + 1).padStart(3, '0'),
    kind: 'observation',
    date: '2026-08-22',
    title: '渲染知识卡' + (index + 1),
    line: lines[index % lines.length].id,
  }))
  writeFileSync(path.join(vault, 'config', 'narrative_lines.json'), JSON.stringify({ lines }))
  writeFileSync(path.join(vault, 'config', 'line_names.json'), JSON.stringify(names))
  writeFileSync(path.join(vault, 'config', 'timeline_cards.json'), JSON.stringify({ cards }))
}
const { buildWorkbenchData } = await import('../src/server/data.ts')

const out = process.argv[2] ?? '/tmp/sparkos-wb.html'
const data = JSON.stringify(buildWorkbenchData()).replace(/</g, '\\u003c')
const template = readFileSync(fileURLToPath(new URL('../src/server/page.template.html', import.meta.url)), 'utf8')
const html = template.replace('<script>', '<script>window._embeddedDailyData = ' + data + ';</script>\n<script>')
writeFileSync(out, html)
console.log('rendered ' + out + ' (' + html.length + ' bytes)')
if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true })
