/**
 * 渲染工作台 HTML 到 /tmp/sparkos-wb.html（无宿主也可跑 DOM 检查）。
 * 用法：node --experimental-strip-types scripts/render-page.mjs [out.html]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildWorkbenchData } from '../src/server/data.ts'

const out = process.argv[2] ?? '/tmp/sparkos-wb.html'
const data = JSON.stringify(buildWorkbenchData()).replace(/</g, '\\u003c')
const template = readFileSync(fileURLToPath(new URL('../src/server/page.template.html', import.meta.url)), 'utf8')
const html = template.replace('<script>', '<script>window._embeddedDailyData = ' + data + ';</script>\n<script>')
writeFileSync(out, html)
console.log('rendered ' + out + ' (' + html.length + ' bytes)')
