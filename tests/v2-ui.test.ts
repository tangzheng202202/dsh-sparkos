/**
 * SparkOS 工作台 V2 回归测试（受控写操作版，非只读）：
 * - 真实 Chrome headless 交互（导航/hash/前进后退/抽屉/lightbox/筛选/初始零主动请求/XSS）
 * - 页面包含六类受控 POST（视觉 decision/retry、草稿 decision/revise、delivery、publish 台账），
 *   仅在人工确认对话框提交时发送（受控写交互另有 v2-retry/v2-creation/v2-delivery/v2-publish 套件覆盖）
 * - 四个视口尺寸（1440 / 1920 / 1024 / 390）无横向溢出、响应式折叠与首屏待办可见
 * 数据来自 render-page.mjs --v2 的隔离 fixture，不读取生产 VAULT。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const CHROME = process.env.SPARKOS_TEST_CHROME
  ?? (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : '/usr/bin/google-chrome')

interface InteractionResult {
  error?: string
  navItems: number
  overviewTodo: boolean
  hero: boolean
  intelNav: boolean
  repeatNav: boolean
  intelDrawer: boolean
  drawerHasFacts: boolean
  drawerEscClosed: boolean
  topicsPreviewMode: boolean
  noEditorialButtons: boolean
  reviewPreview: boolean
  noDecisionButtons: boolean
  reviewFiltered: boolean
  thumbs: number
  lbOpen: boolean
  lbUrlOk: boolean
  lbErrorShown: boolean
  lbSameTab: boolean
  lbEscClosed: boolean
  xssNoImg: boolean
  xssNoSvg: boolean
  xssEscapedText: boolean
  growthEmpty: boolean
  publishManual: boolean
  zeroFetches: boolean
  titleW: number
  titleH: number
  reviewIconW: number
  reviewIconH: number
  pagesNoHScroll: boolean
  creationUrlPkg: string
  creationSel: string | null
  creationPreviewSame: boolean
  creationSwitched: boolean
  creationNormalized: boolean
  globalBlockerOnce: boolean
  tgXClean: boolean
  wechatOwnBlocker: boolean
  xhsOwnBlocker: boolean
  attemptTableOk: boolean
  consoleErrors: number
  routesRendered: boolean
  flowNavHashOnly: boolean
  navRouteMatch: boolean
  statusHasText: boolean
  attemptCurrentMarked: boolean
  attemptHistoryDimmed: boolean
  focusRestoredAfterDrawer: boolean
  techDetailsCollapsed: boolean
  noSamplePerf: boolean
  overviewEventLedger: boolean
  todoNoRawCodes: boolean
  todoChineseLabels: boolean
  jobRecords: boolean
  jobChinese: boolean
  flowCreationNotBlocked: boolean
  metricCardsHashOnly: boolean
}

interface ResponsiveResult {
  error?: string
  width: number
  scrollWidth: number
  hOverflow: boolean
  sidebarHidden: boolean
  menuVisible: boolean
  todoVisible: boolean
  navItems: number
  viewWidth: number
  pagesNoHScroll: boolean
  ovMetricsEqual: boolean
  ovTop5Ratio: number
  ovFlowRatio: number
  ovTodoFull: boolean
  ovRow4EqualW: boolean
  ovRow4EqualH: boolean
  ovRow4Stacked: boolean
  ovRow4TwoCol: boolean
}

interface ReviewResult {
  error?: string
  browseZeroPosts: boolean
  browseZeroGets: boolean
  waitingHasActions: boolean
  approvedNoActions: boolean
  rejectedNoActions: boolean
  approveDialogFields: boolean
  approvePostsBeforeConfirm: number
  approvePosts: number
  approveBody: unknown
  approveCardUpdated: boolean
  approveCountDecreased: boolean
  rejectBlankBlocked: boolean
  rejectBlankPosts: number
  rejectPosts: number
  rejectBody: unknown
  rejectCardUpdated: boolean
  doubleClickPosts: number
  conflictDialogOpen: boolean
  conflictMessage: string
  conflictRefresh: boolean
  lightboxHasApprove: boolean
  lightboxSameDialog: boolean
  lightboxStillOpenAfterCancel: boolean
  reviewPendingCountAfter: number
  noForbiddenCalls: boolean
  reviewListTail?: string
  stateView?: string
  hashNow?: string
  manualApply?: string
  manualErr?: string
}

const interactionResult = runV2InteractionFixture()
// 串行执行：交互 fixture 完成后才启动响应式 fixture，避免多 Chrome 实例共享 profile 竞争
const responsiveResult = interactionResult.then(() => runV2ResponsiveFixture())
const reviewResult = interactionResult.then(() => runV2ResponsiveFixture()).then(() => runV2ReviewFixture())

// ---------- 交互回归 ----------
test('v2 app boots with 9 centers and overview answers what to do', async () => {
  const r = await interactionResult
  assert.equal(r.navItems, 9)
  assert.equal(r.hero, true)
  assert.equal(r.overviewTodo, true)
})

test('v2 navigation is hash-driven and re-renders on every hash change', async () => {
  // 前进/后退依赖同一 hashchange 路由机制（真实浏览器回退见 QA 截图验证）
  const r = await interactionResult
  assert.equal(r.intelNav, true)
  assert.equal(r.repeatNav, true)
})

test('v2 intel drawer opens with facts and closes on Escape', async () => {
  const r = await interactionResult
  assert.equal(r.intelDrawer, true)
  assert.equal(r.drawerHasFacts, true)
  assert.equal(r.drawerEscClosed, true)
})

test('v2 review and topics are read-only preview with no decision controls', async () => {
  const r = await interactionResult
  assert.equal(r.topicsPreviewMode, true)
  assert.equal(r.noEditorialButtons, true)
  assert.equal(r.reviewPreview, true)
  assert.equal(r.noDecisionButtons, true)
  assert.equal(r.reviewFiltered, true)
})

test('v2 visual lightbox uses controlled attempt urls and closes on Escape', async () => {
  const r = await interactionResult
  assert.ok(r.thumbs >= 5)
  assert.equal(r.lbOpen, true)
  assert.equal(r.lbUrlOk, true)
  assert.equal(r.lbErrorShown, true)
  assert.equal(r.lbSameTab, true)
  assert.equal(r.lbEscClosed, true)
})

test('v2 never fetches and never injects XSS markup', async () => {
  const r = await interactionResult
  assert.equal(r.zeroFetches, true)
  assert.equal(r.xssNoImg, true)
  assert.equal(r.xssNoSvg, true)
  assert.equal(r.xssEscapedText, true)
})

test('v2 growth shows honest empty state and publish requires manual action', async () => {
  const r = await interactionResult
  assert.equal(r.growthEmpty, true)
  assert.equal(r.publishManual, true)
})

// ---------- 布局与数据呈现稳定性回归（P0/P1 修复） ----------
test('v2 page title stays horizontal (width>120, height<48, no vertical stacking)', async () => {
  const r = await interactionResult
  assert.ok(r.titleW > 120, 'title width ' + r.titleW + ' should exceed 120px')
  assert.ok(r.titleH < 48, 'title height ' + r.titleH + ' should stay under 48px')
})

test('v2 review warning icon stays small (max 64px)', async () => {
  const r = await interactionResult
  assert.ok(r.reviewIconW > 0 && r.reviewIconW <= 64, 'review icon width ' + r.reviewIconW)
  assert.ok(r.reviewIconH > 0 && r.reviewIconH <= 64, 'review icon height ' + r.reviewIconH)
})

test('v2 main content uses wide desktop width at 1920px (not ~900px)', async () => {
  const r = await responsiveResult
  const wide = r.find((i) => i.width === 1920)
  assert.ok(wide, '1920 result missing')
  assert.ok(wide.viewWidth >= 1200, 'main content width ' + wide.viewWidth + ' at 1920 should be >= 1200px')
})

test('v2 all pages have no unexpected horizontal scrollbars', async () => {
  const r = await interactionResult
  assert.equal(r.pagesNoHScroll, true)
  const rs = await responsiveResult
  for (const i of rs) assert.equal(i.pagesNoHScroll, true, 'page overflow at ' + i.width)
})

test('v2 creation URL, selection, preview and facts stay on the same package', async () => {
  const r = await interactionResult
  assert.ok(r.creationUrlPkg.indexOf('dp-1111111111111111') >= 0, 'url pkg: ' + r.creationUrlPkg)
  assert.equal(r.creationSel, 'dp-1111111111111111')
  assert.equal(r.creationPreviewSame, true)
  assert.equal(r.creationSwitched, true)
  assert.equal(r.creationNormalized, true)
})

test('v2 telegram/x never show wechat or xiaohongshu blockers', async () => {
  const r = await interactionResult
  assert.equal(r.tgXClean, true)
})

test('v2 global blocker is shown once, not repeated under every platform', async () => {
  const r = await interactionResult
  assert.equal(r.globalBlockerOnce, true)
  assert.equal(r.wechatOwnBlocker, true)
  assert.equal(r.xhsOwnBlocker, true)
})

test('v2 visual attempt table does not wrap normal fields character by character', async () => {
  const r = await interactionResult
  assert.equal(r.attemptTableOk, true)
})

test('v2 all routes produce zero console errors', async () => {
  const r = await interactionResult
  assert.equal(r.consoleErrors, 0)
})

test('v2 never sends POST requests', async () => {
  const r = await interactionResult
  assert.equal(r.zeroFetches, true)
})

// ---------- 第二轮精修回归 ----------
test('v2 all nine routes render their expected content', async () => {
  const r = await interactionResult
  assert.equal(r.routesRendered, true)
})

test('v2 flow navigation only performs hash jumps (no fetch)', async () => {
  const r = await interactionResult
  assert.equal(r.flowNavHashOnly, true)
})

test('v2 active nav item matches the current route', async () => {
  const r = await interactionResult
  assert.equal(r.navRouteMatch, true)
})

test('v2 status labels always carry text, not color alone', async () => {
  const r = await interactionResult
  assert.equal(r.statusHasText, true)
})

test('v2 visual drawer distinguishes current and history attempts', async () => {
  const r = await interactionResult
  assert.equal(r.attemptCurrentMarked, true)
  assert.equal(r.attemptHistoryDimmed, true)
})

test('v2 drawer closes on Escape and restores focus', async () => {
  const r = await interactionResult
  assert.equal(r.focusRestoredAfterDrawer, true)
})

test('v2 technical details are collapsed by default', async () => {
  const r = await interactionResult
  assert.equal(r.techDetailsCollapsed, true)
})

test('v2 growth never shows example/sample performance data', async () => {
  const r = await interactionResult
  assert.equal(r.noSamplePerf, true)
})

// ---------- 验收收尾：总览统计口径 / 中文映射 / 路由跳转 / 流程语义 ----------
test('v2 overview event metric is the cumulative ledger, labelled 事件账本', async () => {
  const r = await interactionResult
  assert.equal(r.overviewEventLedger, true)
})

test('v2 overview todo shows Chinese blocker labels, never raw codes', async () => {
  const r = await interactionResult
  assert.equal(r.todoNoRawCodes, true)
  assert.equal(r.todoChineseLabels, true)
})

test('v2 overview 任务记录 uses Chinese statuses and is a job ledger, not pending count', async () => {
  const r = await interactionResult
  assert.equal(r.jobRecords, true)
  assert.equal(r.jobChinese, true)
})

test('v2 flow creation stage is not blocked by rejected history', async () => {
  const r = await interactionResult
  assert.equal(r.flowCreationNotBlocked, true)
})

test('v2 metric cards navigate via hash only and never fetch', async () => {
  const r = await interactionResult
  assert.equal(r.metricCardsHashOnly, true)
})

// ---------- 总览布局验收 ----------
test('v2 overview: five metric cards are equal width on desktop', async () => {
  const r = await responsiveResult
  for (const w of [1440, 1920]) {
    const i = r.find((x) => x.width === w)
    assert.ok(i, 'missing ' + w)
    assert.equal(i.ovMetricsEqual, true, 'metric widths at ' + w)
  }
})

test('v2 overview: second row is 7/12 Top5 + 5/12 flow', async () => {
  const r = await responsiveResult
  for (const w of [1440, 1920]) {
    const i = r.find((x) => x.width === w)
    assert.ok(i, 'missing ' + w)
    assert.equal(i.ovTop5Ratio, 7, 'top5 ratio at ' + w)
    assert.equal(i.ovFlowRatio, 5, 'flow ratio at ' + w)
  }
})

test('v2 overview: todo card spans the full row', async () => {
  const r = await responsiveResult
  for (const w of [1440, 1920]) {
    const i = r.find((x) => x.width === w)
    assert.ok(i, 'missing ' + w)
    assert.equal(i.ovTodoFull, true, 'todo full width at ' + w)
  }
})

test('v2 overview: row-4 cards are equal width and height on desktop', async () => {
  const r = await responsiveResult
  for (const w of [1440, 1920]) {
    const i = r.find((x) => x.width === w)
    assert.ok(i, 'missing ' + w)
    assert.equal(i.ovRow4EqualW, true, 'row4 width at ' + w)
    assert.equal(i.ovRow4EqualH, true, 'row4 height at ' + w)
  }
})

test('v2 overview: row-4 is two-column at 1024 and single-column at narrow', async () => {
  const r = await responsiveResult
  const w1024 = r.find((x) => x.width === 1024)
  const narrowest = r.reduce((a, b) => (a.width < b.width ? a : b))
  assert.ok(w1024, 'missing 1024 size')
  assert.equal(w1024.ovRow4TwoCol, true, '1024 should be two-column')
  assert.equal(narrowest.ovRow4Stacked, true, 'narrowest (' + narrowest.width + ') should be single-column')
})

// ---------- 视觉审核（受控开放） ----------
test('v2 visual review: browsing and navigation emit zero requests', async () => {
  const r = await reviewResult
  assert.equal(r.browseZeroPosts, true)
  assert.equal(r.browseZeroGets, true)
})

test('v2 visual review: actions only on waiting current attempts', async () => {
  const r = await reviewResult
  assert.equal(r.waitingHasActions, true)
  assert.equal(r.approvedNoActions, true)
  assert.equal(r.rejectedNoActions, true)
})

test('v2 visual review: approve dialog fields, optional note, single POST, card updates', async () => {
  const r = await reviewResult
  assert.equal(r.approveDialogFields, true)
  assert.equal(r.approvePostsBeforeConfirm, 0, 'dialog open must not send POST')
  assert.equal(r.approvePosts, 1)
  assert.deepEqual(r.approveBody, { attemptId: 'va-11111111111111111111', decision: 'approved', note: '' })
  assert.equal(r.approveCardUpdated, true)
  assert.equal(r.approveCountDecreased, true)
})

test('v2 visual review: reject requires a non-blank note', async () => {
  const r = await reviewResult
  assert.equal(r.rejectBlankBlocked, true)
  assert.equal(r.rejectBlankPosts, 1, 'blank reject must not add a POST')
  assert.equal(r.rejectPosts, 2)
  assert.deepEqual(r.rejectBody, { attemptId: 'va-22222222222222222222', decision: 'rejected', note: '重做构图' })
  assert.equal(r.rejectCardUpdated, true)
})

test('v2 visual review: double-click produces a single request', async () => {
  const r = await reviewResult
  assert.equal(r.doubleClickPosts, 1)
})

test('v2 visual review: 409 keeps dialog open and refreshes state', async () => {
  const r = await reviewResult
  assert.equal(r.conflictDialogOpen, true)
  assert.ok(r.conflictMessage.indexOf('该图片状态已变化') >= 0, r.conflictMessage)
  assert.equal(r.conflictRefresh, true)
})

test('v2 visual review: card and lightbox share the same review entry', async () => {
  const r = await reviewResult
  assert.equal(r.lightboxHasApprove, true)
  assert.equal(r.lightboxSameDialog, true)
  assert.equal(r.lightboxStillOpenAfterCancel, true)
})

test('v2 visual review: review inbox pending count updates after approvals', async () => {
  const r = await reviewResult
  // 2 张等待审核（444、666）+ 1 张被驳回可重试（888，非 stub）= 3
  assert.equal(r.reviewPendingCountAfter, 3)
})

test('v2 visual review: no retry/delivery/generate/publish calls', async () => {
  const r = await reviewResult
  assert.equal(r.noForbiddenCalls, true)
})

// ---------- 响应式回归 ----------
test('v2 responsive: no horizontal overflow at 1440/1920/1024/390', async () => {
  const r = await responsiveResult
  for (const item of r) {
    assert.equal(item.error, undefined, 'width ' + item.width + ': ' + item.error)
    assert.equal(item.hOverflow, false, 'horizontal overflow at ' + item.width + 'px (scrollWidth=' + item.scrollWidth + ')')
  }
})

test('v2 responsive: sidebar collapses and menu toggle appears below 1024px', async () => {
  const r = await responsiveResult
  const wide = r.filter((i) => i.width >= 1024)
  const narrow = r.filter((i) => i.width < 1024)
  for (const i of wide) {
    assert.equal(i.sidebarHidden, false, 'sidebar should be visible at ' + i.width)
    assert.equal(i.menuVisible, false, 'menu toggle hidden at ' + i.width)
  }
  for (const i of narrow) {
    assert.equal(i.sidebarHidden, true, 'sidebar collapsed at ' + i.width)
    assert.equal(i.menuVisible, true, 'menu toggle visible at ' + i.width)
  }
})

test('v2 responsive: today todo visible on first screen and nav intact', async () => {
  const r = await responsiveResult
  for (const i of r) {
    assert.equal(i.todoVisible, true, 'todo not visible at ' + i.width)
    assert.equal(i.navItems, 9, 'nav items at ' + i.width)
  }
})

// ---------- helpers ----------
function withoutSparkosPaths(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const next = { ...env }
  for (const key of Object.keys(next)) if (key.startsWith('SPARKOS_')) delete next[key]
  return next
}

function decodeHtml(value: string): string {
  return value.replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&')
}

function parsePre(stdout: string, id: string): string {
  const marker = '<pre id="' + id + '">'
  const start = stdout.indexOf(marker)
  assert.ok(start >= 0, 'Chrome fixture did not emit ' + id)
  const body = stdout.slice(start + marker.length)
  const end = body.indexOf('</pre>')
  assert.ok(end >= 0, 'Chrome fixture result not terminated')
  return decodeHtml(body.slice(0, end))
}

function runV2InteractionFixture(): Promise<InteractionResult> {
  return new Promise((resolve, reject) => {
    let root = ''
    try {
      root = mkdtempSync(path.join(tmpdir(), 'sparkos-v2-int-'))
      const base = path.join(root, 'base.html')
      const fixture = path.join(root, 'fixture.html')
      const rendered = spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/render-page.mjs', '--v2', base], {
        cwd: process.cwd(), encoding: 'utf8', env: withoutSparkosPaths(process.env), timeout: 60_000,
      })
      assert.equal(rendered.status, 0, rendered.stderr || rendered.stdout)
      const source = readFileSync(base, 'utf8')
      const preScript = '<script>window.__v2errs=[];window.onerror=function(m){window.__v2errs.push(String(m));};var _ce=console.error.bind(console);console.error=function(){window.__v2errs.push(Array.prototype.slice.call(arguments).join(" "));_ce.apply(console,arguments);};</script>'
      writeFileSync(fixture, source.replace('<head>', '<head>' + preScript).replace('</body>', '<script>' + interactionHarness() + '</script></body>'))
      const chrome = spawnSync(CHROME, [
        '--headless=new', '--disable-gpu', '--disable-background-networking', '--no-first-run', '--no-default-browser-check',
        '--virtual-time-budget=4000', '--window-size=1440,900', '--dump-dom', 'file://' + fixture,
      ], { encoding: 'utf8', timeout: 60_000, maxBuffer: 12 * 1024 * 1024 })
      assert.equal(chrome.status, 0, chrome.stderr)
      const value = JSON.parse(parsePre(chrome.stdout, 'v2-interaction-result')) as InteractionResult
      assert.equal(value.error, undefined, value.error)
      resolve(value)
    } catch (e) {
      reject(e)
    } finally {
      if (root) rmSync(root, { recursive: true, force: true })
    }
  })
}

function runV2ResponsiveFixture(): Promise<ResponsiveResult[]> {
  return new Promise((resolve, reject) => {
    let root = ''
    try {
      root = mkdtempSync(path.join(tmpdir(), 'sparkos-v2-rsp-'))
      const base = path.join(root, 'base.html')
      const fixture = path.join(root, 'fixture.html')
      const rendered = spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/render-page.mjs', '--v2', base], {
        cwd: process.cwd(), encoding: 'utf8', env: withoutSparkosPaths(process.env), timeout: 60_000,
      })
      assert.equal(rendered.status, 0, rendered.stderr || rendered.stdout)
      const source = readFileSync(base, 'utf8')
      writeFileSync(fixture, source.replace('</body>', '<script>' + responsiveHarness() + '</script></body>'))
      const sizes: Array<[number, number]> = [[1440, 900], [1920, 1080], [1280, 800], [1024, 768], [768, 1024], [390, 844]]
      const results: ResponsiveResult[] = []
      for (const [w, h] of sizes) {
        const chrome = spawnSync(CHROME, [
          '--headless=new', '--disable-gpu', '--disable-background-networking', '--no-first-run', '--no-default-browser-check',
          '--virtual-time-budget=2000', '--window-size=' + w + ',' + h, '--dump-dom', 'file://' + fixture,
        ], { encoding: 'utf8', timeout: 60_000, maxBuffer: 12 * 1024 * 1024 })
        assert.equal(chrome.status, 0, chrome.stderr)
        results.push(JSON.parse(parsePre(chrome.stdout, 'v2-rsp-result')) as ResponsiveResult)
      }
      resolve(results)
    } catch (e) {
      reject(e)
    } finally {
      if (root) rmSync(root, { recursive: true, force: true })
    }
  })
}

function interactionHarness(): string {
  return `
(async function(){
  var out={};var fetches=[];
  window.fetch=function(){fetches.push(1);return Promise.reject(new Error('V2 不应发起任何请求'));};
  function q(s){return document.querySelector(s);}
  function qa(s){return Array.prototype.slice.call(document.querySelectorAll(s));}
  function wait(ms){return new Promise(function(r){setTimeout(r,ms);});}
  function waitImageError(img){
    return new Promise(function(resolve){
      if(img.complete&&img.naturalWidth===0){resolve(true);return;}
      if(img.complete&&img.naturalWidth>0){resolve(false);return;}
      var settled=false;var timer;
      function done(value){if(settled)return;settled=true;img.removeEventListener('error',onError);clearTimeout(timer);resolve(value);}
      function onError(){done(true);}
      timer=setTimeout(function(){done(img.complete&&img.naturalWidth===0);},800);
      img.addEventListener('error',onError);
    });
  }
  async function hash(h){location.hash=h;await wait(70);}
  var ASSET_PREFIX='/sparkos/visual/asset?attemptId=va-';
  function urlOk(u){return typeof u==='string'&&u.indexOf(ASSET_PREFIX)===0&&u.length===ASSET_PREFIX.length+20;}
  try{
    out.navItems=qa('.nav-item').length;
    out.hero=document.getElementById('view').textContent.indexOf('内容生产流程')>=0;
    out.overviewTodo=document.getElementById('view').textContent.indexOf('今日待办')>=0;
    var ovText=document.getElementById('view').textContent;
    out.overviewEventLedger=ovText.indexOf('事件账本')>=0&&ovText.indexOf('今日情报')<0;
    out.todoNoRawCodes=ovText.indexOf('required-visual-assets-not-approved')<0&&ovText.indexOf('wechat-production-delivery-missing')<0&&ovText.indexOf('legacy-contract-v1')<0;
    out.todoChineseLabels=ovText.indexOf('视觉资产未全部批准')>=0||ovText.indexOf('微信公众号生产交付包缺失')>=0;
    out.jobRecords=ovText.indexOf('任务记录')>=0&&ovText.indexOf('workflow job')>=0;
    out.jobChinese=ovText.indexOf('成功')>=0&&ovText.indexOf('已取消')>=0;
    out.flowCreationNotBlocked=(function(){var s=q('.flow-step[data-flow="creation"]');return !!s&&s.getAttribute('data-flow-status')!=='blocked';})();
    var mc=qa('.metric-card');
    out.metricCardsHashOnly=(function(){var ok=mc.length===5;var tg=['intel','topics','creation','visual','publish'];for(var i=0;i<mc.length;i++){if(tg.indexOf(mc[i].getAttribute('data-goto'))<0)ok=false;}return ok;})();
    if(mc.length===5){mc[4].click();await wait(80);}
    out.metricCardsHashOnly=out.metricCardsHashOnly&&location.hash==='#/publish'&&fetches.length===0;
    await hash('#/overview');
    qa('.nav-item').forEach(function(b){if(b.getAttribute('data-nav')==='intel')b.click();});
    await wait(70);
    out.intelNav=location.hash==='#/intel'&&document.getElementById('view').textContent.indexOf('Top 5')>=0;
    qa('.nav-item').forEach(function(b){if(b.getAttribute('data-nav')==='overview')b.click();});
    await wait(70);
    var backToOverview=location.hash==='#/overview'||location.hash==='';
    qa('.nav-item').forEach(function(b){if(b.getAttribute('data-nav')==='intel')b.click();});
    await wait(70);
    out.repeatNav=backToOverview&&location.hash==='#/intel'&&document.getElementById('view').textContent.indexOf('Top 5')>=0;
    var tt=document.getElementById('topbarTitle');
    var tr=tt.getBoundingClientRect();
    out.titleW=Math.round(tr.width);out.titleH=Math.round(tr.height);
    var row=q('[data-intel-drawer]');if(row)row.click();
    out.intelDrawer=!q('#drawer').classList.contains('hidden');
    out.drawerHasFacts=q('#drawerBody').textContent.indexOf('已确认')>=0||q('#drawerBody').textContent.indexOf('事实')>=0;
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await wait(50);
    out.drawerEscClosed=q('#drawer').classList.contains('hidden');
    await hash('#/topics');
    out.topicsPreviewMode=document.getElementById('view').textContent.indexOf('V2 预览模式（不可审批）')>=0;
    out.noEditorialButtons=qa('[data-editorial]').length===0;
    await hash('#/review');
    out.reviewPreview=document.getElementById('view').textContent.indexOf('V2 预览模式')>=0;
    out.noDecisionButtons=qa('[data-visual-decision]').length===0&&qa('[data-draft-decision]').length===0&&qa('[data-visual-queue]').length===0&&qa('[data-visual-retry]').length===0;
    var sel=q('[data-rf="type"]');if(sel){sel.value='visual';sel.dispatchEvent(new Event('change',{bubbles:true}));}
    // 视觉待审 5 项 + 被驳回可重试 1 项（888）= 6
    out.reviewFiltered=document.getElementById('reviewList').textContent.indexOf('共 6 项')>=0;
    var rn=q('.notice.warn');
    out.reviewIconW=0;out.reviewIconH=0;
    if(rn){var ri=rn.querySelector('svg');if(ri){var rr=ri.getBoundingClientRect();out.reviewIconW=Math.round(rr.width);out.reviewIconH=Math.round(rr.height);}}
    await hash('#/visual');
    out.thumbs=qa('[data-visual-thumb]').length;
    var t=q('[data-visual-thumb]');if(t)t.click();
    var lb=q('#visual-lightbox');
    out.lbOpen=!lb.classList.contains('hidden');
    var lbImg=lb.querySelector('[data-lightbox-img]');
    await waitImageError(lbImg);await wait(40);
    var src=lbImg.getAttribute('src');
    out.lbUrlOk=urlOk(src);
    out.lbErrorShown=lb.querySelector('[data-lightbox-error]').classList.contains('show');
    out.lbSameTab=lb.querySelector('[data-lightbox-open-current]').getAttribute('href')===src;
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await wait(50);
    out.lbEscClosed=lb.classList.contains('hidden');
    out.xssNoImg=qa('img[src="x"]').length===0;
    out.xssNoSvg=qa('svg[onload]').length===0;
    out.xssEscapedText=document.getElementById('view').textContent.indexOf('svgAttack')>=0;
    out.attemptTableOk=(function(){
      var ok=true;
      Array.prototype.forEach.call(document.querySelectorAll('.attempt-list td'),function(c){
        var cs=getComputedStyle(c);
        if((cs.overflowWrap==='anywhere'||cs.wordBreak==='break-all')&&c.className.indexOf('mono')<0)ok=false;
      });
      return ok;
    })();
    var ahBtn=q('[data-attempt-history]');
    if(ahBtn){ahBtn.focus();ahBtn.click();await wait(60);
      var adb=document.getElementById('drawerBody');
      out.attemptCurrentMarked=adb.textContent.indexOf('当前 attempt')>=0;
      out.attemptHistoryDimmed=adb.textContent.indexOf('历史')>=0||dbRowDimmed();
      document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await wait(50);
      out.focusRestoredAfterDrawer=document.activeElement===ahBtn;
    }else{out.attemptCurrentMarked=false;out.attemptHistoryDimmed=false;out.focusRestoredAfterDrawer=false;}
    function dbRowDimmed(){var trs=document.querySelectorAll('#drawerBody .attempt-list tbody tr');for(var i=0;i<trs.length;i++){if(getComputedStyle(trs[i]).opacity<='0.7')return true;}return false;}
    await hash('#/creation?pkg=dp-1111111111111111');
    out.creationUrlPkg=location.hash;
    var selC=q('.cg-list .todo-row.sel');
    out.creationSel=selC?selC.getAttribute('data-pkg'):null;
    out.creationPreviewSame=q('.cg-preview').textContent.indexOf('dp-1111111111111111')>=0&&q('.cg-fact').textContent.indexOf('v1')>=0;
    var row222=q('.cg-list [data-pkg="dp-2222222222222222"]');if(row222)row222.click();
    await wait(80);
    out.creationSwitched=(function(){var s=q('.cg-list .todo-row.sel');return !!s&&s.getAttribute('data-pkg')==='dp-2222222222222222'&&location.hash.indexOf('dp-2222222222222222')>=0&&q('.cg-preview').textContent.indexOf('dp-2222222222222222')>=0;})();
    await hash('#/creation?pkg=bogus');
    out.creationNormalized=(function(){var s=q('.cg-list .todo-row.sel');return !!s&&s.getAttribute('data-pkg')==='dp-1111111111111111'&&location.hash.indexOf('dp-1111111111111111')>=0;})();
    await hash('#/growth');
    out.growthEmpty=document.getElementById('view').textContent.indexOf('尚未接入真实平台表现数据')>=0;
    out.noSamplePerf=document.getElementById('view').textContent.indexOf('example')<0&&document.getElementById('view').textContent.indexOf('sample')<0;
    await hash('#/publish');
    out.publishManual=document.getElementById('view').textContent.indexOf('发布仍需人工操作')>=0;
    var pvText=document.getElementById('view').textContent;
    out.globalBlockerOnce=(pvText.split('视觉资产未全部批准').length-1)===1;
    var mrows=qa('.readiness-matrix tbody tr');
    function rowOf(name){for(var i=0;i<mrows.length;i++){if(mrows[i].querySelector('td').textContent.trim()===name)return mrows[i];}return null;}
    var tgRow=rowOf('Telegram');var xRow=rowOf('X');var wRow=rowOf('微信公众号');var hRow=rowOf('小红书');
    out.tgXClean=(!tgRow||(tgRow.textContent.indexOf('微信')<0&&tgRow.textContent.indexOf('小红书')<0))&&(!xRow||(xRow.textContent.indexOf('微信')<0&&xRow.textContent.indexOf('小红书')<0));
    out.wechatOwnBlocker=!!wRow&&wRow.textContent.indexOf('微信公众号生产交付包缺失')>=0;
    out.xhsOwnBlocker=!!hRow&&hRow.textContent.indexOf('小红书生产交付包缺失')>=0;
    // 所有页面无横向溢出（九个路由）＋ 九路由均可渲染 ＋ 导航与路由一致
    out.pagesNoHScroll=true;
    out.routesRendered=true;
    out.navRouteMatch=true;
    var pages=['overview','intel','topics','creation','review','visual','publish','growth','system'];
    var markers={overview:'内容生产流程',intel:'每日 Top 5',topics:'编辑策划',creation:'草稿包',review:'编辑待办箱',visual:'视觉批次',publish:'发布准备',growth:'发布表现',system:'系统状态'};
    for(var pi=0;pi<pages.length;pi++){
      await hash('#/'+pages[pi]);
      if(document.documentElement.scrollWidth>window.innerWidth+1)out.pagesNoHScroll=false;
      if(document.getElementById('view').textContent.indexOf(markers[pages[pi]])<0)out.routesRendered=false;
      var act=q('.nav-item.active');
      if(!act||act.getAttribute('data-nav')!==pages[pi])out.navRouteMatch=false;
    }
    // 流程导航只做 hash 跳转
    await hash('#/overview');
    var fsBtn=q('.flow-step[data-flow="visual"]');
    if(fsBtn){fsBtn.click();await wait(80);}
    out.flowNavHashOnly=location.hash==='#/visual'&&fetches.length===0;
    // 状态徽标必须带文字
    out.statusHasText=(function(){
      var bads=qa('.badge,.totals-chip');
      var ok=true;
      bads.forEach(function(b){if(!b.textContent.trim())ok=false;});
      return ok;
    })();
    // 技术详情默认折叠
    out.techDetailsCollapsed=(function(){
      var ds=qa('details.tech');
      var ok=true;
      ds.forEach(function(d){if(d.open)ok=false;});
      return ok;
    })();
    out.consoleErrors=window.__v2errs?window.__v2errs.length:-1;
    out.zeroFetches=fetches.length===0;
  }catch(e){out.error=String(e&&e.stack||e).replace(/</g,'&lt;');}
  var pre=document.createElement('pre');pre.id='v2-interaction-result';pre.textContent=JSON.stringify(out);document.body.appendChild(pre);
})();`
}

function responsiveHarness(): string {
  return `
(async function(){
  var out={};
  var w=window.innerWidth;
  out.width=w;
  var de=document.documentElement;
  out.scrollWidth=de.scrollWidth;
  out.hOverflow=de.scrollWidth>w+1;
  var sidebar=document.getElementById('sidebar');
  out.sidebarHidden=window.getComputedStyle(sidebar).transform!=='none';
  var toggle=document.getElementById('menuToggle');
  out.menuVisible=window.getComputedStyle(toggle).display!=='none';
  var todoCard=null;
  Array.prototype.forEach.call(document.querySelectorAll('.card'),function(c){if(c.textContent.indexOf('今日待办')>=0)todoCard=c;});
  if(todoCard){var r=todoCard.getBoundingClientRect();out.todoVisible=r.top<window.innerHeight;}
  else out.todoVisible=false;
  out.navItems=document.querySelectorAll('.nav-item').length;
  var viewEl=document.querySelector('.view');
  out.viewWidth=viewEl?Math.round(viewEl.getBoundingClientRect().width):0;
  out.pagesNoHScroll=true;
  var pages=['overview','intel','topics','creation','review','visual','publish','growth','system'];
  for(var pi=0;pi<pages.length;pi++){
    location.hash='#/'+pages[pi];
    await new Promise(function(rs){setTimeout(rs,70);});
    if(document.documentElement.scrollWidth>window.innerWidth+1)out.pagesNoHScroll=false;
    if(pages[pi]==='overview'){
      var mc=document.querySelectorAll('.ov-metrics .metric-card');
      out.ovMetricsEqual= mc.length===5&&Math.round(mc[0].getBoundingClientRect().width)===Math.round(mc[4].getBoundingClientRect().width);
      var cont=document.querySelector('.ov-dashboard').getBoundingClientRect();
      var top5=document.querySelector('.ov-top5').getBoundingClientRect();
      var flow=document.querySelector('.ov-flow').getBoundingClientRect();
      var todo=document.querySelector('.ov-todo').getBoundingClientRect();
      out.ovTop5Ratio=Math.round(top5.width/cont.width*12);
      out.ovFlowRatio=Math.round(flow.width/cont.width*12);
      out.ovTodoFull=Math.abs(todo.width-cont.width)<4;
      var src=document.querySelector('.ov-sources').getBoundingClientRect();
      var jobs=document.querySelector('.ov-jobs').getBoundingClientRect();
      var alr=document.querySelector('.ov-alerts').getBoundingClientRect();
      out.ovRow4EqualW=Math.abs(src.width-jobs.width)<4&&Math.abs(jobs.width-alr.width)<4;
      out.ovRow4EqualH=Math.abs(src.height-jobs.height)<4&&Math.abs(jobs.height-alr.height)<4;
      out.ovRow4Stacked=alr.top>src.top+4&&jobs.top>src.top+4;
      out.ovRow4TwoCol=Math.abs(src.top-jobs.top)<4&&Math.abs(alr.top-src.top)>4;
    }
  }
  var pre=document.createElement('pre');pre.id='v2-rsp-result';pre.textContent=JSON.stringify(out);document.body.appendChild(pre);
})();`
}
function runV2ReviewFixture(): Promise<ReviewResult> {
  return new Promise((resolve, reject) => {
    let root = ''
    try {
      root = mkdtempSync(path.join(tmpdir(), 'sparkos-v2-rev-'))
      const base = path.join(root, 'base.html')
      const fixture = path.join(root, 'fixture.html')
      const rendered = spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/render-page.mjs', '--v2', base], {
        cwd: process.cwd(), encoding: 'utf8', env: withoutSparkosPaths(process.env), timeout: 60_000,
      })
      assert.equal(rendered.status, 0, rendered.stderr || rendered.stdout)
      const source = readFileSync(base, 'utf8')
      writeFileSync(fixture, source.replace('</body>', '<script>' + reviewHarness() + '</script></body>'))
      const chrome = spawnSync(CHROME, [
        '--headless=new', '--disable-gpu', '--disable-background-networking', '--no-first-run', '--no-default-browser-check',
        '--virtual-time-budget=4000', '--window-size=1440,900', '--dump-dom', 'file://' + fixture,
      ], { encoding: 'utf8', timeout: 60_000, maxBuffer: 12 * 1024 * 1024 })
      assert.equal(chrome.status, 0, chrome.stderr)
      const value = JSON.parse(parsePre(chrome.stdout, 'v2-review-result')) as ReviewResult
      assert.equal(value.error, undefined, value.error)
      resolve(value)
    } catch (e) {
      reject(e)
    } finally {
      if (root) rmSync(root, { recursive: true, force: true })
    }
  })
}

function reviewHarness(): string {
  return `
(async function(){
  var out={};
  var calls=[],posts=[],gets=[],decisions={},mode='ok';
  window.fetch=function(url,opts){
    calls.push({url:String(url),method:(opts&&opts.method)||'GET'});
    var u=String(url);
    if(u.indexOf('/sparkos/visual/decision')>=0){
      var body=JSON.parse(opts.body);
      if(mode==='conflict')return Promise.resolve({ok:false,status:409,json:async function(){return {ok:false,error:{code:'decision-conflict',message:'该 attempt 已有不同审核决定，拒绝覆盖'}};}});
      decisions[body.attemptId]=body.decision;
      posts.push(body);
      return Promise.resolve({ok:true,status:200,json:async function(){return {ok:true,value:{taskId:'t',attemptId:body.attemptId,decision:body.decision,note:body.note||null,taskState:body.decision,batchStatus:'partially_approved',approvedCount:1,requiredCount:4}};}});
    }
    if(u.indexOf('/sparkos/visual/status')>=0){
      gets.push(u);
      var pkg=decodeURIComponent(u.split('packageId=')[1]);
      var b=D.factory.visual.batches.filter(function(x){return x.packageId===pkg;})[0];
      var nb=JSON.parse(JSON.stringify(b));
      nb.tasks.forEach(function(t){
        var a=t.attempts.filter(function(x){return Number(x.attemptNo)===Number(t.currentAttempt);})[0];
        if(a&&decisions[a.id]){t.state=decisions[a.id];t.reviewNote='test';a.approval={decision:decisions[a.id],note:'test',decidedAt:new Date().toISOString()};}
      });
      return Promise.resolve({ok:true,status:200,json:async function(){return {ok:true,value:{batches:[nb]}};}});
    }
    return Promise.resolve({ok:false,status:404,json:async function(){return {ok:false};}});
  };
  function q(s){return document.querySelector(s);}
  function qa(s){return Array.prototype.slice.call(document.querySelectorAll(s));}
  function wait(ms){return new Promise(function(r){setTimeout(r,ms);});}
  async function hash(h){location.hash=h;await wait(70);}
  try{
    await hash('#/visual');
    out.browseZeroPosts=posts.length===0;out.browseZeroGets=gets.length===0;
    var wCard=q('[data-vis-task="vt-11111111111111111111"]');
    out.waitingHasActions=!!wCard&&!!wCard.querySelector('[data-visual-approve]')&&!!wCard.querySelector('[data-visual-reject]')&&!!wCard.querySelector('[data-visual-open]');
    out.approvedNoActions=(function(){var c=q('[data-vis-task="vt-77777777777777777777"]');return !!c&&!c.querySelector('[data-visual-approve]')&&!c.querySelector('[data-visual-reject]');})();
    out.rejectedNoActions=(function(){var c=q('[data-vis-task="vt-33333333333333333333"]');return !!c&&!c.querySelector('[data-visual-approve]')&&!c.querySelector('[data-visual-reject]')&&!c.querySelector('[data-visual-retry]');})();
    // approve flow (note optional, empty)
    q('[data-visual-approve="va-11111111111111111111"]').click();await wait(60);
    out.approveDialogFields=(function(){var d=q('#review-dialog');var b=q('#reviewDialogBody').textContent;return !d.classList.contains('hidden')&&q('#reviewDialogTitle').textContent==='批准图片'&&b.indexOf('cover-main')>=0&&b.indexOf('批准后将计入')>=0&&b.indexOf('审核意见（可选）')>=0;})();
    out.approvePostsBeforeConfirm=posts.length;
    q('[data-review-confirm]').click();await wait(220);
    out.approvePosts=posts.length;
    out.approveBody=posts[posts.length-1]||null;
    out.approveCardUpdated=(function(){var c=q('[data-vis-task="vt-11111111111111111111"]');return c.textContent.indexOf('已批准')>=0;})();
    out.approveCountDecreased=qa('[data-visual-approve]').length===4;
    // reject: blank blocked
    q('[data-visual-reject="va-22222222222222222222"]').click();await wait(60);
    q('[data-review-confirm]').click();await wait(60);
    out.rejectBlankBlocked=q('#reviewDialogErr').textContent.indexOf('驳回意见必填')>=0;
    out.rejectBlankPosts=posts.length;
    var n=q('#review-note');n.value=' 重做构图  ';n.dispatchEvent(new Event('input',{bubbles:true}));
    q('[data-review-confirm]').click();await wait(220);
    out.rejectPosts=posts.length;
    out.rejectBody=posts[posts.length-1]||null;
    out.rejectCardUpdated=(function(){var c=q('[data-vis-task="vt-22222222222222222222"]');return c.textContent.indexOf('已驳回')>=0;})();
    // double click single request
    q('[data-visual-approve="va-55555555555555555555"]').click();await wait(50);
    var before=posts.length;
    q('[data-review-confirm]').click();q('[data-review-confirm]').click();await wait(220);
    out.doubleClickPosts=posts.length-before;
    // conflict 409
    mode='conflict';
    q('[data-visual-approve="va-44444444444444444444"]').click();await wait(50);
    q('[data-review-confirm]').click();await wait(220);
    out.conflictDialogOpen=!q('#review-dialog').classList.contains('hidden');
    out.conflictMessage=q('#reviewDialogErr').textContent;
    out.conflictRefresh=gets.length>0;
    q('[data-review-cancel]').click();await wait(50);
    // lightbox shares same dialog
    mode='ok';
    var lt=q('[data-visual-thumb="va-66666666666666666666"]');if(lt)lt.click();await wait(60);
    var lb=q('#visual-lightbox');
    out.lightboxHasApprove=!!lb.querySelector('[data-visual-approve]');
    lb.querySelector('[data-visual-approve]').click();await wait(50);
    out.lightboxSameDialog=!q('#review-dialog').classList.contains('hidden')&&q('#reviewDialogTitle').textContent==='批准图片';
    q('[data-review-cancel]').click();await wait(50);
    out.lightboxStillOpenAfterCancel=!lb.classList.contains('hidden');
    // review inbox pending count after approvals of 111,222,555（显式 renderRouter 保证同步渲染）
    await hash('#/review?type=visual');
    renderRouter();
    await wait(60);
    var rl=q('#reviewList');
    var rt=rl?rl.textContent:'';
    var rm=rt.match(/共 (\\d+) 项/);
    out.reviewPendingCountAfter=rm?Number(rm[1]):-1;
    out.noForbiddenCalls=calls.every(function(c){return c.url.indexOf('/sparkos/visual/retry')<0&&c.url.indexOf('/sparkos/visual/delivery')<0&&c.url.indexOf('image_generate')<0&&c.url.indexOf('/sparkos/visual/queue')<0&&c.url.indexOf('/sparkos/mutate')<0&&c.url.indexOf('/sparkos/creation/')<0&&c.url.indexOf('/sparkos/editorial/')<0;});
  }catch(e){out.error=String(e&&e.stack||e).replace(/</g,'&lt;');}
  var pre=document.createElement('pre');pre.id='v2-review-result';pre.textContent=JSON.stringify(out);document.body.appendChild(pre);
})();`
}

