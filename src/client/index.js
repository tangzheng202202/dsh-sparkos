// dsh-sparkos web client half — 设置页插件卡片，入口跳转到 /sparkos 工作台。
// 数据来自宿主路由 GET /sparkos/intel（只读健康 + 最近 run + archive 计数）。
// 注意：本文件是 factory 函数体，由 scripts/build.mjs 包裹进
// window.__ModuleLoader__.load({ id: 'dsh-sparkos', factory }) 后生成 lib/client.js。
// 不要在此文件写顶层 import / export，也不要写 return module.exports（build 已加）。
const React = require('react')
const { createElement: h, useCallback, useEffect, useState } = React

const NS = 'dsh-sparkos'
const PREFIX = '/sparkos'

  const zh = {
    nav: '自媒体工作台 · SparkOS',
    desc: '星火库增量信源 + 叙事主线 + 选题/草稿/蒸馏审核工作流（9 tab 工作台）。点击打开完整工作台。',
    open: '打开工作台',
    loading: '读取中...',
    error: '读取失败',
    health: '情报健康',
    lastRun: '最近一轮',
    archive: '归档',
    snapshot: '快照',
    fusion: '蒸馏融合',
    sources: '信源状态',
    runStage: '阶段',
    stale: '滞后',
    hours: 'h',
    never: '无数据',
    refresh: '刷新',
    hint: '写回仅经 distill_queue 人工审核，浏览器不做写操作。',
  }
  const en = {
    nav: 'Media Workbench · SparkOS',
    desc: 'SparkVault incremental sources + narrative主线 + topic/draft/distill review workflow (9-tab workbench).',
    open: 'Open Workbench',
    loading: 'Loading...',
    error: 'Load failed',
    health: 'Intel health',
    lastRun: 'Last run',
    archive: 'Archive',
    snapshot: 'Snapshots',
    fusion: 'Distill fusion',
    sources: 'Source status',
    runStage: 'Stage',
    stale: 'Stale',
    hours: 'h',
    never: 'no data',
    refresh: 'Refresh',
    hint: 'Writes go through distill_queue human review; browser does no writes.',
  }

const css = [
  '.dsh-sparkos-card{list-style:none;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-3)}',
  '.dsh-sparkos-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 16px}',
  '.dsh-sparkos-title{font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary)}',
  '.dsh-sparkos-desc{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary);margin-top:2px}',
  '.dsh-sparkos-meta{display:flex;gap:8px;padding:0 16px 12px;flex-wrap:wrap}',
  '.dsh-sparkos-chip{font-size:12px;line-height:20px;padding:0 8px;border-radius:999px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary)}',
  '.dsh-sparkos-chip b{font-weight:600;color:var(--dsw-alias-label-primary)}',
  '.dsh-sparkos-src{display:flex;align-items:center;gap:6px;font-size:12px;line-height:22px}',
  '.dsh-sparkos-dot{width:8px;height:8px;border-radius:50%;flex:none}',
  '.dsh-sparkos-dot-green{background:#34c759}',
  '.dsh-sparkos-dot-yellow{background:#ffcc00}',
  '.dsh-sparkos-dot-red{background:#ff453a}',
  '.dsh-sparkos-dot-gray{background:var(--dsw-alias-label-tertiary)}',
  '.dsh-sparkos-sec{margin:0 16px;padding:8px 0;border-top:1px dashed var(--dsw-alias-border-l2);display:flex;gap:14px;flex-wrap:wrap;align-items:center}',
  '.dsh-sparkos-sec-title{font-size:11px;color:var(--dsw-alias-label-tertiary);width:100%}',
  '.dsh-sparkos-btn{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;height:28px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer}',
  '.dsh-sparkos-hint{margin:0 16px 14px;font-size:11px;line-height:1.6;color:var(--dsw-alias-label-tertiary)}',
  '.dsh-sparkos-error{margin:0 16px 14px;font-size:12px;color:var(--dsw-alias-label-error)}',
].join('\n')

function SparkosPanel(props) {
  const { t } = props
  const [state, setState] = useState(null)
  const [error, setError] = useState('')
  const load = useCallback(() => {
    fetch(PREFIX + '/intel')
      .then((r) => r.json())
      .then((body) => {
        if (body && body.ok) { setState(body.value); setError('') }
        else { setError((body && body.error && body.error.message) || t('error')) }
      })
      .catch(() => setError(t('error')))
  }, [t])
  useEffect(() => { load() }, [load])

  const healthOverall = (state && state.health && state.health.overall) || '-'
  const lastRun = state && state.lastRun || null
  const lastRunAt = lastRun ? String(lastRun.at || '').replace('T', ' ').slice(0, 16) : '-'
  const archiveCounts = (state && state.archiveCounts) || null
  const archiveTotal = archiveCounts
    ? Object.values(archiveCounts).reduce((a, b) => a + (Number(b) || 0), 0)
    : '-'
  const snapshotCount = (state && state.snapshotCount != null) ? state.snapshotCount : '-'
  const fusion = state && state.fusionAvailable != null ? (state.fusionAvailable ? 'OK' : 'OFF') : '-'
  const sources = (state && state.health && Array.isArray(state.health.sources)) ? state.health.sources : []
  const dotColor = { green: 'green', yellow: 'yellow', amber: 'yellow', red: 'red', pending: 'gray' }

  const fmtStale = (s) => s == null ? t('never') : (s.stalenessHours || 0) + t('hours') + '/' + (s.maxStalenessHours || '?') + t('hours')

  return h('div', { className: 'dsh-sparkos-card' },
    h('div', { className: 'dsh-sparkos-head' },
      h('div', null,
        h('div', { className: 'dsh-sparkos-title' }, t('nav')),
        h('div', { className: 'dsh-sparkos-desc' }, t('desc')),
      ),
      h('div', { style: { display: 'flex', gap: '6px' } },
        h('button', { className: 'dsh-sparkos-btn', onClick: load }, t('refresh')),
        h('button', { className: 'dsh-sparkos-btn', onClick: () => window.open(PREFIX, '_blank') }, t('open')),
      ),
    ),
    error ? h('p', { className: 'dsh-sparkos-error' }, error) : null,
    h('div', { className: 'dsh-sparkos-meta' },
      h('span', { className: 'dsh-sparkos-chip' }, t('health') + ': ', h('b', null, healthOverall)),
      h('span', { className: 'dsh-sparkos-chip' }, t('lastRun') + ': ', h('b', null, lastRunAt)),
      h('span', { className: 'dsh-sparkos-chip' }, t('archive') + ': ', h('b', null, String(archiveTotal))),
      h('span', { className: 'dsh-sparkos-chip' }, t('snapshot') + ': ', h('b', null, String(snapshotCount))),
      h('span', { className: 'dsh-sparkos-chip' }, t('fusion') + ': ', h('b', null, fusion)),
    ),
    sources.length > 0 ? h('div', { className: 'dsh-sparkos-sec' },
      h('div', { className: 'dsh-sparkos-sec-title' }, t('sources')
        + (lastRun ? ' · ' + t('lastRun') + ' ' + t('runStage') + '=' + (lastRun.stage || '-') + (lastRun.ok === false ? ' ✗' : ' ✓') : '')),
      sources.map((s) => h('span', { key: s.id, className: 'dsh-sparkos-src', title: (s.note || '') },
        h('span', { className: 'dsh-sparkos-dot dsh-sparkos-dot-' + (dotColor[s.status] || 'gray') }),
        h('span', null, s.id + ' · ' + t('stale') + ' ' + fmtStale(s)),
      )),
    ) : null,
    h('p', { className: 'dsh-sparkos-hint' }, t('hint')),
  )
}

const inject = ['slots', 'locale']

function apply(ctx) {
  ctx.effect(() => ctx.locale.register('settings.dshSparkos', { zh, en }), 'dsh-sparkos: locale')
  const t = ctx.locale.bind('settings.dshSparkos')
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    id: NS,
    order: 45,
    locale: 'settings.dshSparkos',
    inject: () => ({ t }),
  }, SparkosPanel))
  const style = document.createElement('style')
  style.textContent = css
  document.head.appendChild(style)
  ctx.effect(() => () => style.remove(), 'dsh-sparkos: css')
}

exports.apply = apply
exports.inject = inject
