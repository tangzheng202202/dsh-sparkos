/** M6.4 V2 交付包生成受控确认 DOM 回归测试（真实 Chrome headless）：
 * - 发布准备页：交付就绪包显示 生成预览/生产交付包（可点击），testOnly/未批准包按钮禁用；
 * - 正式确认对话框（模式/目标平台/已有交付包/不自动发布声明）、确认前零 POST、双击单发；
 * - 409 保持对话框并刷新；生成后下载链接出现、计数同步；
 * - 页面加载零 POST、无越权请求（队列/选题/发布/生图）。
 * 数据来自 render-page.mjs --v2 的隔离 fixture，不读取生产 VAULT。 */

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

interface DeliveryResult {
  error?: string
  readyPackagePreviewEnabled: boolean
  readyPackageProductionEnabled: boolean
  testOnlyPackageProductionDisabled: boolean
  unapprovedPackagePreviewDisabled: boolean
  dialogOpened: boolean
  dialogFields: boolean
  postsBeforeConfirm: number
  productionDoubleClickPosts: number
  productionBody: unknown
  downloadLinkShown: boolean
  previewPosts: number
  previewBody: unknown
  conflictDialogOpen: boolean
  conflictMessage: string
  conflictRefreshed: boolean
  pageLoadPosts: number
  noForbiddenCalls: boolean
}

const deliveryResult = runDeliveryFixture()

test('v2 delivery: ready package enables preview+production; testOnly/unapproved disable them', async () => {
  const r = await deliveryResult
  assert.equal(r.error, undefined, r.error)
  assert.equal(r.readyPackagePreviewEnabled, true)
  assert.equal(r.readyPackageProductionEnabled, true)
  assert.equal(r.testOnlyPackageProductionDisabled, true)
  assert.equal(r.unapprovedPackagePreviewDisabled, true)
})

test('v2 delivery: formal dialog shows mode/platform/immutability and never POSTs before confirm', async () => {
  const r = await deliveryResult
  assert.equal(r.dialogOpened, true)
  assert.equal(r.dialogFields, true)
  assert.equal(r.postsBeforeConfirm, 0)
})

test('v2 delivery: production double-click sends a single POST and the download link appears', async () => {
  const r = await deliveryResult
  assert.equal(r.productionDoubleClickPosts, 1)
  assert.deepEqual(r.productionBody, { packageId: 'dp-5555555555555555', mode: 'production' })
  assert.equal(r.downloadLinkShown, true)
})

test('v2 delivery: preview mode posts once with mode=preview', async () => {
  const r = await deliveryResult
  assert.equal(r.previewPosts, 1)
  assert.deepEqual(r.previewBody, { packageId: 'dp-5555555555555555', mode: 'preview' })
})

test('v2 delivery: 409 keeps the dialog open with state-changed message and refreshes', async () => {
  const r = await deliveryResult
  assert.equal(r.conflictDialogOpen, true)
  assert.ok(r.conflictMessage.indexOf('状态已变化') >= 0, r.conflictMessage)
  assert.equal(r.conflictRefreshed, true)
})

test('v2 delivery: page load never POSTs and no forbidden calls happen', async () => {
  const r = await deliveryResult
  assert.equal(r.pageLoadPosts, 0)
  assert.equal(r.noForbiddenCalls, true)
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

function runDeliveryFixture(): Promise<DeliveryResult> {
  return new Promise((resolve, reject) => {
    let root = ''
    try {
      root = mkdtempSync(path.join(tmpdir(), 'sparkos-v2-delivery-'))
      const base = path.join(root, 'base.html')
      const fixture = path.join(root, 'fixture.html')
      const rendered = spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/render-page.mjs', '--v2', base], {
        cwd: process.cwd(), encoding: 'utf8', env: withoutSparkosPaths(process.env), timeout: 60_000,
      })
      assert.equal(rendered.status, 0, rendered.stderr || rendered.stdout)
      const source = readFileSync(base, 'utf8')
      writeFileSync(fixture, source.replace('</body>', '<script>' + deliveryHarness() + '</script></body>'))
      const chrome = spawnSync(CHROME, [
        '--headless=new', '--disable-gpu', '--disable-background-networking', '--no-first-run', '--no-default-browser-check',
        '--virtual-time-budget=5000', '--window-size=1440,900', '--dump-dom', 'file://' + fixture,
      ], { encoding: 'utf8', timeout: 60_000, maxBuffer: 12 * 1024 * 1024 })
      assert.equal(chrome.status, 0, chrome.stderr)
      const value = JSON.parse(parsePre(chrome.stdout, 'v2-delivery-result')) as DeliveryResult
      assert.equal(value.error, undefined, value.error)
      resolve(value)
    } catch (e) {
      reject(e)
    } finally {
      if (root) rmSync(root, { recursive: true, force: true })
    }
  })
}

function deliveryHarness(): string {
  return String.raw`
(async function(){
  var out={};
  var calls=[],posts=[],gets=[];
  var mode='ok';
  var db=JSON.parse(JSON.stringify(D));
  window.fetch=function(url,opts){
    var u=String(url),method=(opts&&opts.method)||'GET';
    calls.push({url:u,method:method});
    if(method==='POST')posts.push({url:u,body:JSON.parse(opts.body)});
    else gets.push(u);
    if(u.indexOf('/sparkos/visual/delivery')>=0&&method==='POST'){
      if(mode==='conflict')return Promise.resolve({ok:false,status:409,json:async function(){return {ok:false,error:{code:'conflict',message:'状态已变化，正在刷新'}};}});
      var dbody=JSON.parse(opts.body);
      (db.factory.visual.batches||[]).forEach(function(b){if(b.packageId===dbody.packageId){b.deliveryLink='/sparkos/visual/download?deliveryId=vd-1';}});
      return Promise.resolve({ok:true,status:201,json:async function(){return {ok:true,value:{delivery:{id:'vd-1'},created:true}};}});
    }
    if(u.indexOf('/sparkos/data')>=0&&method==='GET'){
      return Promise.resolve({ok:true,status:200,json:async function(){return {ok:true,value:JSON.parse(JSON.stringify(db))};}});
    }
    return Promise.resolve({ok:false,status:404,json:async function(){return {ok:false};}});
  };
  function q(s){return document.querySelector(s);}
  function qa(s){return Array.prototype.slice.call(document.querySelectorAll(s));}
  function wait(ms){return new Promise(function(r){setTimeout(r,ms);});}
  async function hash(h){location.hash=h;await wait(80);}
  function pkgActions(pkg){var hd=null;qa('[data-delivery-action]').forEach(function(b){if(b.getAttribute('data-package')===pkg)hd=hd||{};});return hd;}
  function actionBtn(pkg,mode){var found=null;qa('[data-delivery-action]').forEach(function(b){if(b.getAttribute('data-package')===pkg&&b.getAttribute('data-delivery-action')===mode)found=b;});return found;}
  try{
    out.pageLoadPosts=posts.length;
    await hash('#/publish');
    var p555=actionBtn('dp-5555555555555555','preview');
    var p555prod=actionBtn('dp-5555555555555555','production');
    out.readyPackagePreviewEnabled=!!p555&&!p555.disabled;
    out.readyPackageProductionEnabled=!!p555prod&&!p555prod.disabled;
    var p222prod=actionBtn('dp-2222222222222222','production');
    out.testOnlyPackageProductionDisabled=!!p222prod&&p222prod.disabled;
    var p222prev=actionBtn('dp-2222222222222222','preview');
    out.unapprovedPackagePreviewDisabled=!!p222prev&&p222prev.disabled;
    // 打开生产交付对话框
    var beforeDlg=posts.length;
    p555prod.click();await wait(50);
    var dlg=q('#delivery-dialog');
    out.dialogOpened=!!dlg&&!dlg.classList.contains('hidden');
    var db2=q('#deliveryDialogBody').textContent;
    out.dialogFields=q('#deliveryDialogTitle').textContent==='生成生产交付包'&&db2.indexOf('dp-5555555555555555')>=0&&db2.indexOf('生产（production）')>=0&&db2.indexOf('不会自动发布')>=0;
    out.postsBeforeConfirm=posts.length-beforeDlg;
    // 生产交付：双击只发一次
    q('[data-delivery-confirm]').click();q('[data-delivery-confirm]').click();await wait(260);
    out.productionDoubleClickPosts=posts.length-beforeDlg;
    out.productionBody=posts[posts.length-1]?posts[posts.length-1].body:null;
    out.downloadLinkShown=!!q('[data-delivery-download]')&&q('[data-delivery-download]').getAttribute('href').indexOf('/sparkos/visual/download?deliveryId=')>=0;
    // 预览交付（重新查询按钮，避免使用重渲染前的过期节点）
    var beforePrev=posts.length;
    actionBtn('dp-5555555555555555','preview').click();await wait(50);
    q('[data-delivery-confirm]').click();await wait(260);
    out.previewPosts=posts.length-beforePrev;
    out.previewBody=posts[posts.length-1]?posts[posts.length-1].body:null;
    // 409 冲突
    mode='conflict';
    var beforeConflict=gets.length;
    actionBtn('dp-5555555555555555','production').click();await wait(50);
    q('[data-delivery-confirm]').click();await wait(260);
    out.conflictDialogOpen=!q('#delivery-dialog').classList.contains('hidden');
    out.conflictMessage=q('#deliveryDialogErr').textContent;
    out.conflictRefreshed=gets.length>beforeConflict;
    q('[data-delivery-cancel]').click();await wait(50);
    out.noForbiddenCalls=calls.every(function(c){return c.url.indexOf('/sparkos/visual/decision')<0&&c.url.indexOf('/sparkos/visual/retry')<0&&c.url.indexOf('/sparkos/visual/queue')<0&&c.url.indexOf('/sparkos/mutate')<0&&c.url.indexOf('/sparkos/editorial/decision')<0&&c.url.indexOf('/sparkos/creation/')<0&&c.url.indexOf('image_generate')<0;});
  }catch(e){out.error=String(e&&e.stack||e).replace(/</g,'&lt;');}
  var pre=document.createElement('pre');pre.id='v2-delivery-result';pre.textContent=JSON.stringify(out);document.body.appendChild(pre);
})();`
}
