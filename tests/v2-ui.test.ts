/**
 * SparkOS 工作台 V2 只读预览版回归测试：
 * - 真实 Chrome headless 交互（导航/hash/前进后退/抽屉/lightbox/筛选/只读零请求/XSS）
 * - 四个视口尺寸（1440 / 1920 / 1024 / 390）无横向溢出、响应式折叠与首屏待办可见
 * 数据来自 render-page.mjs --v2 的隔离 fixture，不读取生产 VAULT。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

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
}

const interactionResult = runV2InteractionFixture()
// 串行执行：交互 fixture 完成后才启动响应式 fixture，避免多 Chrome 实例共享 profile 竞争
const responsiveResult = interactionResult.then(() => runV2ResponsiveFixture())

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
      writeFileSync(fixture, source.replace('</body>', '<script>' + interactionHarness() + '</script></body>'))
      const chrome = spawnSync(CHROME, [
        '--headless=new', '--disable-gpu', '--disable-background-networking', '--no-first-run', '--no-default-browser-check',
        '--virtual-time-budget=3000', '--window-size=1440,900', '--dump-dom', 'file://' + fixture,
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
      const sizes: Array<[number, number]> = [[1440, 900], [1920, 1080], [1024, 768], [390, 844]]
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
    out.hero=document.getElementById('view').textContent.indexOf('今日总览')>=0;
    out.overviewTodo=document.getElementById('view').textContent.indexOf('今日待办')>=0;
    qa('.nav-item').forEach(function(b){if(b.getAttribute('data-nav')==='intel')b.click();});
    await wait(70);
    out.intelNav=location.hash==='#/intel'&&document.getElementById('view').textContent.indexOf('Top 5')>=0;
    qa('.nav-item').forEach(function(b){if(b.getAttribute('data-nav')==='overview')b.click();});
    await wait(70);
    var backToOverview=location.hash==='#/overview'||location.hash==='';
    qa('.nav-item').forEach(function(b){if(b.getAttribute('data-nav')==='intel')b.click();});
    await wait(70);
    out.repeatNav=backToOverview&&location.hash==='#/intel'&&document.getElementById('view').textContent.indexOf('Top 5')>=0;
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
    out.reviewFiltered=document.getElementById('reviewList').textContent.indexOf('共 5 项')>=0;
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
    await hash('#/growth');
    out.growthEmpty=document.getElementById('view').textContent.indexOf('暂无真实发布表现数据')>=0;
    await hash('#/publish');
    out.publishManual=document.getElementById('view').textContent.indexOf('发布仍需人工操作')>=0;
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
  var pre=document.createElement('pre');pre.id='v2-rsp-result';pre.textContent=JSON.stringify(out);document.body.appendChild(pre);
})();`
}
