/** M6.3 V2 草稿包受控审批与修订 DOM 回归测试（真实 Chrome headless）：
 * - 创作中心：待审草稿显示 批准/驳回，已驳回显示 按意见修订；
 * - 正式决策对话框（驳回意见必填、双击只发一次、409 刷新）；
 * - 修订对话框（驳回意见全文、下一版本、不可覆盖声明、幂等提示）；
 * - 页面加载不创建任何 POST；无越权请求（交付/队列/选题/发布）。
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

interface CreationResult {
  error?: string
  rejectedHasRevise: boolean
  waitingHasDecisions: boolean
  approvedNoActions: boolean
  approveDialogOpened: boolean
  approveDialogFields: boolean
  postsBeforeConfirm: number
  blankRejectBlocked: boolean
  blankRejectPosts: number
  rejectPosts: number
  rejectBody: unknown
  rejectedCardUpdated: boolean
  reviseDialogOpened: boolean
  reviseDialogHasNote: boolean
  reviseDialogHasNextVersion: boolean
  reviseDialogHasImmutability: boolean
  revisePosts: number
  reviseBody: unknown
  revisionCreated: boolean
  approveDoubleClickPosts: number
  approveBody: unknown
  approveCardUpdated: boolean
  conflictDialogOpen: boolean
  conflictMessage: string
  conflictRefreshed: boolean
  overviewPendingDraftsAfter: boolean
  pageLoadPosts: number
  noForbiddenCalls: boolean
}

const creationResult = runCreationFixture()

test('v2 creation: rejected draft shows 按意见修订; waiting draft shows 批准/驳回; approved shows none', async () => {
  const r = await creationResult
  assert.equal(r.error, undefined, r.error)
  assert.equal(r.rejectedHasRevise, true)
  assert.equal(r.waitingHasDecisions, true)
  assert.equal(r.approvedNoActions, true)
})

test('v2 creation: approve dialog is formal, shows package context, and never POSTs before confirm', async () => {
  const r = await creationResult
  assert.equal(r.approveDialogOpened, true)
  assert.equal(r.approveDialogFields, true)
  assert.equal(r.postsBeforeConfirm, 0)
})

test('v2 creation: rejecting requires a non-blank note', async () => {
  const r = await creationResult
  assert.equal(r.blankRejectBlocked, true)
  assert.equal(r.blankRejectPosts, 0)
})

test('v2 creation: reject posts exactly once with note and updates the card', async () => {
  const r = await creationResult
  assert.equal(r.rejectPosts, 1)
  assert.deepEqual(r.rejectBody, { packageId: 'dp-3333333333333333', decision: 'rejected', note: '需要重写开头' })
  assert.equal(r.rejectedCardUpdated, true)
})

test('v2 creation: revise dialog shows full reject note, next version and immutability; posts once', async () => {
  const r = await creationResult
  assert.equal(r.reviseDialogOpened, true)
  assert.equal(r.reviseDialogHasNote, true)
  assert.equal(r.reviseDialogHasNextVersion, true)
  assert.equal(r.reviseDialogHasImmutability, true)
  assert.equal(r.revisePosts, 1)
  assert.deepEqual(r.reviseBody, { packageId: 'dp-3333333333333333' })
  assert.equal(r.revisionCreated, true)
})

test('v2 creation: approving a revision double-click sends a single POST', async () => {
  const r = await creationResult
  assert.equal(r.approveDoubleClickPosts, 1)
  assert.deepEqual(r.approveBody, { packageId: 'dp-4444444444444444', decision: 'approved', note: '' })
  assert.equal(r.approveCardUpdated, true)
})

test('v2 creation: 409 keeps the dialog open with state-changed message and refreshes', async () => {
  const r = await creationResult
  assert.equal(r.conflictDialogOpen, true)
  assert.ok(r.conflictMessage.indexOf('状态已变化') >= 0, r.conflictMessage)
  assert.equal(r.conflictRefreshed, true)
})

test('v2 creation: page load never POSTs; overview pending drafts sync after decisions', async () => {
  const r = await creationResult
  assert.equal(r.pageLoadPosts, 0)
  assert.equal(r.overviewPendingDraftsAfter, true)
})

test('v2 creation: no forbidden calls (delivery/queue/editorial/publish/generate)', async () => {
  const r = await creationResult
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

function runCreationFixture(): Promise<CreationResult> {
  return new Promise((resolve, reject) => {
    let root = ''
    try {
      root = mkdtempSync(path.join(tmpdir(), 'sparkos-v2-creation-'))
      const base = path.join(root, 'base.html')
      const fixture = path.join(root, 'fixture.html')
      const rendered = spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/render-page.mjs', '--v2', base], {
        cwd: process.cwd(), encoding: 'utf8', env: withoutSparkosPaths(process.env), timeout: 60_000,
      })
      assert.equal(rendered.status, 0, rendered.stderr || rendered.stdout)
      const source = readFileSync(base, 'utf8')
      writeFileSync(fixture, source.replace('</body>', '<script>' + creationHarness() + '</script></body>'))
      const chrome = spawnSync(CHROME, [
        '--headless=new', '--disable-gpu', '--disable-background-networking', '--no-first-run', '--no-default-browser-check',
        '--virtual-time-budget=5000', '--window-size=1440,900', '--dump-dom', 'file://' + fixture,
      ], { encoding: 'utf8', timeout: 60_000, maxBuffer: 12 * 1024 * 1024 })
      assert.equal(chrome.status, 0, chrome.stderr)
      const value = JSON.parse(parsePre(chrome.stdout, 'v2-creation-result')) as CreationResult
      assert.equal(value.error, undefined, value.error)
      resolve(value)
    } catch (e) {
      reject(e)
    } finally {
      if (root) rmSync(root, { recursive: true, force: true })
    }
  })
}

function creationHarness(): string {
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
    if(u.indexOf('/sparkos/creation/decision')>=0&&method==='POST'){
      if(mode==='conflict')return Promise.resolve({ok:false,status:409,json:async function(){return {ok:false,error:{code:'invalid-state',message:'草稿包不在待审状态：approved'}};}});
      var dbody=JSON.parse(opts.body);
      (db.factory.drafts||[]).forEach(function(p){if(p.id===dbody.packageId){p.status=dbody.decision;p.decidedAt=new Date().toISOString();p.reviewNote=dbody.note||null;}});
      return Promise.resolve({ok:true,status:200,json:async function(){return {ok:true,value:{id:dbody.packageId,status:dbody.decision}};}});
    }
    if(u.indexOf('/sparkos/creation/revise')>=0&&method==='POST'){
      var rbody=JSON.parse(opts.body);
      var parent=(db.factory.drafts||[]).filter(function(p){return p.id===rbody.packageId;})[0];
      var rev=parent?Number(parent.revision)+1:2;
      db.factory.drafts.unshift({id:'dp-4444444444444444',cardId:parent?parent.cardId:'ec-1111111111111111',revision:rev,parentPackageId:rbody.packageId,status:'waiting_approval',title:(parent?parent.title:'')+'（修订版）',reviewNote:null,parentReviewNote:parent?parent.reviewNote:null,validation:{errors:[]},assetCount:2,artifacts:parent?parent.artifacts:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),decidedAt:null});
      return Promise.resolve({ok:true,status:200,json:async function(){return {ok:true,value:{id:'dp-4444444444444444',status:'waiting_approval',created:true}};}});
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
  function selectPkg(id){var row=q('.cg-list [data-pkg="'+id+'"]');if(row)row.click();return !!row;}
  try{
    out.pageLoadPosts=posts.length;
    await hash('#/creation');
    var c111=q('.cg-fact');
    out.rejectedHasRevise=!!c111&&!!c111.querySelector('[data-draft-revise]')&&!c111.querySelector('[data-draft-decision]');
    selectPkg('dp-3333333333333333');await wait(90);
    var c333=q('.cg-fact');
    out.waitingHasDecisions=!!c333&&!!c333.querySelector('[data-draft-decision="approved"]')&&!!c333.querySelector('[data-draft-decision="rejected"]');
    selectPkg('dp-2222222222222222');await wait(90);
    var c222=q('.cg-fact');
    out.approvedNoActions=!!c222&&!c222.querySelector('[data-draft-decision]')&&!c222.querySelector('[data-draft-revise]');
    selectPkg('dp-3333333333333333');await wait(90);
    var beforeApproveDlg=posts.length;
    q('[data-draft-decision="approved"]').click();await wait(50);
    var dlg=q('#draft-decision-dialog');
    out.approveDialogOpened=!!dlg&&!dlg.classList.contains('hidden');
    var ab=q('#draftDecisionBody').textContent;
    out.approveDialogFields=q('#draftDecisionTitle').textContent==='批准草稿'&&ab.indexOf('dp-3333333333333333')>=0&&ab.indexOf('不会自动创建视觉任务')>=0;
    out.postsBeforeConfirm=posts.length-beforeApproveDlg;
    q('[data-draft-decision-cancel]').click();await wait(50);
    mode='conflict';
    q('[data-draft-decision="approved"]').click();await wait(50);
    var beforeConflict=gets.length;
    q('[data-draft-decision-confirm]').click();await wait(220);
    out.conflictDialogOpen=!q('#draft-decision-dialog').classList.contains('hidden');
    out.conflictMessage=q('#draftDecisionErr').textContent;
    out.conflictRefreshed=gets.length>beforeConflict;
    q('[data-draft-decision-cancel]').click();await wait(50);
    mode='ok';
    var beforeReject=posts.length;
    q('[data-draft-decision="rejected"]').click();await wait(50);
    q('[data-draft-decision-confirm]').click();await wait(80);
    out.blankRejectBlocked=q('#draftDecisionErr').textContent.indexOf('驳回草稿必须填写审核意见')>=0;
    out.blankRejectPosts=posts.length-beforeReject;
    var noteEl=q('#draft-decision-note');noteEl.value=' 需要重写开头  ';noteEl.dispatchEvent(new Event('input',{bubbles:true}));
    var errEl=q('#draftDecisionErr');if(errEl)errEl.classList.remove('show');
    q('[data-draft-decision-confirm]').click();await wait(260);
    out.rejectPosts=posts.length-beforeReject;
    out.rejectBody=posts[posts.length-1]?posts[posts.length-1].body:null;
    out.rejectedCardUpdated=(function(){var c=q('.cg-fact');return !!c&&c.textContent.indexOf('rejected')>=0&&!!c.querySelector('[data-draft-revise]');})();
    var beforeRevise=posts.length;
    q('[data-draft-revise]').click();await wait(50);
    var rdlg=q('#draft-revise-dialog');
    out.reviseDialogOpened=!!rdlg&&!rdlg.classList.contains('hidden');
    var rb=q('#draftReviseBody').textContent;
    out.reviseDialogHasNote=rb.indexOf('需要重写开头')>=0;
    out.reviseDialogHasNextVersion=rb.indexOf('下一版本')>=0;
    out.reviseDialogHasImmutability=rb.indexOf('不可覆盖')>=0;
    q('[data-draft-revise-confirm]').click();await wait(260);
    out.revisePosts=posts.length-beforeRevise;
    out.reviseBody=posts[posts.length-1]?posts[posts.length-1].body:null;
    out.revisionCreated=(function(){var rows=qa('.cg-list [data-pkg]');var has444=rows.some(function(r){return r.getAttribute('data-pkg')==='dp-4444444444444444';});return has444&&document.getElementById('toast').textContent.indexOf('修订版')>=0;})();
    selectPkg('dp-4444444444444444');await wait(90);
    var beforeApprove=posts.length;
    q('[data-draft-decision="approved"]').click();await wait(50);
    q('[data-draft-decision-confirm]').click();q('[data-draft-decision-confirm]').click();await wait(260);
    out.approveDoubleClickPosts=posts.length-beforeApprove;
    out.approveBody=posts[posts.length-1]?posts[posts.length-1].body:null;
    out.approveCardUpdated=(function(){var c=q('.cg-fact');return !!c&&c.textContent.indexOf('approved')>=0;})();
    await hash('#/overview');
    var draftMetric=null;
    qa('.metric-card').forEach(function(c){if(c.textContent.indexOf('待审草稿')>=0)draftMetric=c;});
    out.overviewPendingDraftsAfter=!!draftMetric&&draftMetric.querySelector('.stat-value').textContent.trim()==='0';
    out.noForbiddenCalls=calls.every(function(c){return c.url.indexOf('/sparkos/visual/delivery')<0&&c.url.indexOf('/sparkos/visual/queue')<0&&c.url.indexOf('/sparkos/mutate')<0&&c.url.indexOf('/sparkos/editorial/decision')<0&&c.url.indexOf('image_generate')<0&&c.url.indexOf('/sparkos/visual/decision')<0&&c.url.indexOf('/sparkos/visual/retry')<0;});
  }catch(e){out.error=String(e&&e.stack||e).replace(/</g,'&lt;');}
  var pre=document.createElement('pre');pre.id='v2-creation-result';pre.textContent=JSON.stringify(out);document.body.appendChild(pre);
})();`
}
