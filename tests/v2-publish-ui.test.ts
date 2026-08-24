/** M6.6 V2 受控发布任务创建 DOM 回归测试（真实 Chrome headless）：
 * - 发布准备页：就绪包显示『创建发布任务』按钮，未就绪包不显示；
 * - 正式确认对话框（平台就绪/已有任务/『仅创建台账，不自动发布』声明）、确认前零 POST、双击单发；
 * - 成功后发布任务状态展示、409 保持对话框并刷新；
 * - 页面加载零 POST、无越权请求。
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

interface PublishResult {
  error?: string
  readyPackageHasButton: boolean
  unreadyPackageNoButton: boolean
  dialogOpened: boolean
  dialogFields: boolean
  postsBeforeConfirm: number
  doubleClickPosts: number
  publishBody: unknown
  taskStatusShown: boolean
  conflictDialogOpen: boolean
  conflictMessage: string
  conflictRefreshed: boolean
  pageLoadPosts: number
  noForbiddenCalls: boolean
}

const publishResult = runPublishFixture()

test('v2 publish: ready package shows 创建发布任务; unready package does not', async () => {
  const r = await publishResult
  assert.equal(r.error, undefined, r.error)
  assert.equal(r.readyPackageHasButton, true)
  assert.equal(r.unreadyPackageNoButton, true)
})

test('v2 publish: formal dialog shows platform readiness and only-ledger warning; no POST before confirm', async () => {
  const r = await publishResult
  assert.equal(r.dialogOpened, true)
  assert.equal(r.dialogFields, true)
  assert.equal(r.postsBeforeConfirm, 0)
})

test('v2 publish: confirm double-click sends a single POST and task status appears', async () => {
  const r = await publishResult
  assert.equal(r.doubleClickPosts, 1)
  assert.deepEqual(r.publishBody, { packageId: 'dp-5555555555555555' })
  assert.equal(r.taskStatusShown, true)
})

test('v2 publish: 409 keeps the dialog open with state-changed message and refreshes', async () => {
  const r = await publishResult
  assert.equal(r.conflictDialogOpen, true)
  assert.ok(r.conflictMessage.indexOf('状态已变化') >= 0, r.conflictMessage)
  assert.equal(r.conflictRefreshed, true)
})

test('v2 publish: page load never POSTs and no forbidden calls happen', async () => {
  const r = await publishResult
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

function runPublishFixture(): Promise<PublishResult> {
  return new Promise((resolve, reject) => {
    let root = ''
    try {
      root = mkdtempSync(path.join(tmpdir(), 'sparkos-v2-publish-'))
      const base = path.join(root, 'base.html')
      const fixture = path.join(root, 'fixture.html')
      const rendered = spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/render-page.mjs', '--v2', base], {
        cwd: process.cwd(), encoding: 'utf8', env: withoutSparkosPaths(process.env), timeout: 60_000,
      })
      assert.equal(rendered.status, 0, rendered.stderr || rendered.stdout)
      const source = readFileSync(base, 'utf8')
      writeFileSync(fixture, source.replace('</body>', '<script>' + publishHarness() + '</script></body>'))
      const chrome = spawnSync(CHROME, [
        '--headless=new', '--disable-gpu', '--disable-background-networking', '--no-first-run', '--no-default-browser-check',
        '--virtual-time-budget=5000', '--window-size=1440,900', '--dump-dom', 'file://' + fixture,
      ], { encoding: 'utf8', timeout: 60_000, maxBuffer: 12 * 1024 * 1024 })
      assert.equal(chrome.status, 0, chrome.stderr)
      const value = JSON.parse(parsePre(chrome.stdout, 'v2-publish-result')) as PublishResult
      assert.equal(value.error, undefined, value.error)
      resolve(value)
    } catch (e) {
      reject(e)
    } finally {
      if (root) rmSync(root, { recursive: true, force: true })
    }
  })
}

function publishHarness(): string {
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
    if(u.indexOf('/sparkos/publish')>=0&&method==='POST'){
      if(mode==='conflict')return Promise.resolve({ok:false,status:409,json:async function(){return {ok:false,error:{code:'conflict',message:'状态已变化，正在刷新'}};}});
      var pbody=JSON.parse(opts.body);
      (db.factory.visual.batches||[]).forEach(function(b){if(b.packageId===pbody.packageId){b.publishTask={id:'wj-publish-1',status:'queued',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};}});
      return Promise.resolve({ok:true,status:200,json:async function(){return {ok:true,value:{jobId:'wj-publish-1',packageId:pbody.packageId,status:'queued',created:true,readyForPublication:true}};}});
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
  function pubBtn(pkg){var found=null;qa('[data-publish-action]').forEach(function(b){if(b.getAttribute('data-publish-action')===pkg)found=b;});return found;}
  try{
    out.pageLoadPosts=posts.length;
    await hash('#/publish');
    var b555=pubBtn('dp-5555555555555555');
    out.readyPackageHasButton=!!b555;
    var b222=pubBtn('dp-2222222222222222');
    out.unreadyPackageNoButton=!b222;
    var beforeDlg=posts.length;
    b555.click();await wait(50);
    var dlg=q('#publish-dialog');
    out.dialogOpened=!!dlg&&!dlg.classList.contains('hidden');
    var pb=q('#publishDialogBody').textContent;
    out.dialogFields=q('#publishDialogTitle').textContent==='创建发布任务'&&pb.indexOf('dp-5555555555555555')>=0&&pb.indexOf('微信公众号')>=0&&pb.indexOf('不会自动发布')>=0;
    out.postsBeforeConfirm=posts.length-beforeDlg;
    q('[data-publish-confirm]').click();q('[data-publish-confirm]').click();await wait(260);
    out.doubleClickPosts=posts.length-beforeDlg;
    out.publishBody=posts[posts.length-1]?posts[posts.length-1].body:null;
    out.taskStatusShown=(function(){var text=document.getElementById('view').textContent;return text.indexOf('发布任务')>=0&&text.indexOf('排队中')>=0;})();
    mode='conflict';
    var beforeConflict=gets.length;
    pubBtn('dp-5555555555555555').click();await wait(50);
    q('[data-publish-confirm]').click();await wait(260);
    out.conflictDialogOpen=!q('#publish-dialog').classList.contains('hidden');
    out.conflictMessage=q('#publishDialogErr').textContent;
    out.conflictRefreshed=gets.length>beforeConflict;
    q('[data-publish-cancel]').click();await wait(50);
    out.noForbiddenCalls=calls.every(function(c){return c.url.indexOf('/sparkos/visual/decision')<0&&c.url.indexOf('/sparkos/visual/retry')<0&&c.url.indexOf('/sparkos/visual/queue')<0&&c.url.indexOf('/sparkos/mutate')<0&&c.url.indexOf('/sparkos/editorial/decision')<0&&c.url.indexOf('/sparkos/creation/')<0&&c.url.indexOf('image_generate')<0&&c.url.indexOf('/sparkos/visual/delivery')<0;});
  }catch(e){out.error=String(e&&e.stack||e).replace(/</g,'&lt;');}
  var pre=document.createElement('pre');pre.id='v2-publish-result';pre.textContent=JSON.stringify(out);document.body.appendChild(pre);
})();`
}

