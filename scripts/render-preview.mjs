#!/usr/bin/env node
/**
 * 本地 DOM 预览：把 buildWorkbenchData + page.template.html 组装成单文件 HTML，
 * 供 Chrome headless --dump-dom 渲染检查（不依赖宿主 webServer）。
 * 用法：node scripts/render-preview.mjs /tmp/sparkos-wb.html
 */
import { writeFileSync } from 'node:fs'
import { buildWorkbenchData } from '../src/server/data.ts'
import { readFileSync } from 'node:fs'

const out = process.argv[2] ?? '/tmp/sparkos-wb.html'
const data = JSON.stringify(buildWorkbenchData()).replace(/</g, '\\u003c')
const tpl = readFileSync(new URL('../src/server/page.template.html', import.meta.url), 'utf8')
const html = tpl.replace('<script>', `<script>window._embeddedDailyData = ${data};</script>\n<script>`)
writeFileSync(out, html)
console.log(`written ${out}`)
