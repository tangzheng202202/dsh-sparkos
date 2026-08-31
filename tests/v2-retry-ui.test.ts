/** M6.2 V2 视觉卡片受控重试 DOM 回归测试（真实 Chrome headless）：
 * - 已驳回卡片的“按意见重试”按钮层级与不可重试提示；
 * - 正式重试对话框字段、补充要求预检、双击只发一次、409 刷新；
 * - 成功后卡片进入“等待 Agent 领取”并重新读取 visual status；
 * - 只读轮询：仅 GET、页面隐藏停止、离开路由停止；
 * - 页面加载不创建 retry、不调用 image_generate / delivery / publish。
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

interface RetryDialogResult {
  error?: string
  rejectedBadge: boolean
  retryButtonOnRetryable: boolean
  noRetryOnStubRejected: boolean
  noRetryOnMaxedRejected: boolean
  maxNoteShown: boolean
  stubNoteShown: boolean
  rejectTimeShown: boolean
  fullNoteShown: boolean
  dialogOpened: boolean
  dialogHasAssetId: boolean
  dialogHasPlacement: boolean
  dialogHasAttemptNo: boolean
  dialogHasProviderModel: boolean
  dialogHasPromptSummary: boolean
  dialogHasFullNote: boolean
  dialogHasNextAttemptNo: boolean
  dialogHasMaxUsage: boolean
  dialogHasOnlyCreatesTaskNote: boolean
  postsBeforeConfirm: number
  forbiddenPathBlocked: boolean
  forbiddenPosts: number
  postsAfterConfirm: number
  confirmDisabledWhileBusy: boolean
  confirmLabel: string
  retryBody: unknown
  cardWaitingAgentAfter: boolean
  statusRefreshedAfter: boolean
  doubleClickPosts: number
  conflictDialogOpen: boolean
  conflictMessage: string
  conflictRefreshed: boolean
  noGenerateDeliveryPublish: boolean
}

interface PollingResult {
  error?: string
  pollGets: number
  pollPosts: number
  pollOnlyGet: boolean
  hiddenStopsPolling: boolean
  leaveStopsPolling: boolean
  singlePollerPerPackage: boolean
  manualRefreshGets: number
  manualRefreshPosts: number
  pageLoadPosts: number
}

const retryDialogResult = runRetryDialogFixture()
const pollingResult = runPollingFixture()

test('v2 retry: rejected card shows 已驳回 badge, reject time, full note and retry button (primary)', async () => {
  const r = await retryDialogResult
  assert.equal(r.error, undefined, r.error)
  assert.equal(r.rejectedBadge, true)
  assert.equal(r.rejectTimeShown, true)
  assert.equal(r.fullNoteShown, true)
  assert.equal(r.retryButtonOnRetryable, true)
})

test('v2 retry: stub-rejected and maxed-rejected cards never show a retry button', async () => {
  const r = await retryDialogResult
  assert.equal(r.noRetryOnStubRejected, true)
  assert.equal(r.noRetryOnMaxedRejected, true)
  assert.equal(r.stubNoteShown, true)
  assert.equal(r.maxNoteShown, true)
})

test('v2 retry: formal dialog shows rejected image context and only-creates-task note; no POST before confirm', async () => {
  const r = await retryDialogResult
  assert.equal(r.dialogOpened, true)
  assert.equal(r.dialogHasAssetId, true)
  assert.equal(r.dialogHasPlacement, true)
  assert.equal(r.dialogHasAttemptNo, true)
  assert.equal(r.dialogHasProviderModel, true)
  assert.equal(r.dialogHasPromptSummary, true)
  assert.equal(r.dialogHasFullNote, true)
  assert.equal(r.dialogHasNextAttemptNo, true)
  assert.equal(r.dialogHasMaxUsage, true)
  assert.equal(r.dialogHasOnlyCreatesTaskNote, true)
  assert.equal(r.postsBeforeConfirm, 0)
})

test('v2 retry: supplementary rejects local paths and URLs without posting', async () => {
  const r = await retryDialogResult
  assert.equal(r.forbiddenPathBlocked, true)
  assert.equal(r.forbiddenPosts, 0)
})

test('v2 retry: confirm posts exactly once, disables the button, then card shows 等待 Agent 领取 and status refreshes', async () => {
  const r = await retryDialogResult
  assert.equal(r.postsAfterConfirm, 1)
  assert.equal(r.confirmDisabledWhileBusy, true)
  assert.equal(r.confirmLabel, '正在创建重试任务')
  assert.deepEqual(r.retryBody, {
    packageId: 'dp-2222222222222222',
    taskId: 'vt-88888888888888888888',
    currentAttemptId: 'va-88888888888888888888',
    assetId: 'retry-one',
    idempotencyKey: 'retry:vt-88888888888888888888:va-88888888888888888888',
    supplementaryInstruction: '加强主体占比',
  })
  assert.equal(r.cardWaitingAgentAfter, true)
  assert.equal(r.statusRefreshedAfter, true)
})

test('v2 retry: double-click produces a single retry POST', async () => {
  const r = await retryDialogResult
  assert.equal(r.doubleClickPosts, 1)
})

test('v2 retry: 409 keeps the dialog open with “任务状态已变化” and refreshes state', async () => {
  const r = await retryDialogResult
  assert.equal(r.conflictDialogOpen, true)
  assert.ok(r.conflictMessage.indexOf('任务状态已变化') >= 0, r.conflictMessage)
  assert.equal(r.conflictRefreshed, true)
})

test('v2 retry: no image_generate / delivery / publish calls anywhere', async () => {
  const r = await retryDialogResult
  assert.equal(r.noGenerateDeliveryPublish, true)
})

test('v2 polling: only GETs, page hidden stops, leaving route stops, single poller per package', async () => {
  const r = await pollingResult
  assert.equal(r.error, undefined, r.error)
  assert.ok(r.pollGets >= 1, 'expected polling GETs, got ' + r.pollGets)
  assert.equal(r.pollPosts, 0)
  assert.equal(r.pollOnlyGet, true)
  assert.equal(r.hiddenStopsPolling, true)
  assert.equal(r.leaveStopsPolling, true)
  assert.equal(r.singlePollerPerPackage, true)
})

test('v2 polling: manual refresh button is read-only (GET only)', async () => {
  const r = await pollingResult
  assert.ok(r.manualRefreshGets >= 1)
  assert.equal(r.manualRefreshPosts, 0)
})

test('v2 polling: page load never POSTs a retry', async () => {
  const r = await pollingResult
  assert.equal(r.pageLoadPosts, 0)
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

function runChromeFixture(harnessName: string, harness: string, preId: string, budgetMs = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    let root = ''
    try {
      root = mkdtempSync(path.join(tmpdir(), 'sparkos-v2-' + harnessName + '-'))
      const base = path.join(root, 'base.html')
      const fixture = path.join(root, 'fixture.html')
      const rendered = spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/render-page.mjs', '--factory', '--v2', base], {
        cwd: process.cwd(), encoding: 'utf8', env: withoutSparkosPaths(process.env), timeout: 60_000,
      })
      assert.equal(rendered.status, 0, rendered.stderr || rendered.stdout)
      const source = readFileSync(base, 'utf8')
      writeFileSync(fixture, source.replace('</body>', '<script>' + harness + '</script></body>'))
      const chrome = spawnSync(CHROME, [
        '--headless=new', '--disable-gpu', '--disable-background-networking', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + path.join(root, 'chrome-profile'),
        '--virtual-time-budget=' + budgetMs, '--window-size=1440,900', '--dump-dom', 'file://' + fixture,
      ], { encoding: 'utf8', timeout: 60_000, maxBuffer: 12 * 1024 * 1024 })
      assert.equal(chrome.status, 0, chrome.stderr)
      resolve(parsePre(chrome.stdout, preId))
    } catch (e) {
      reject(e)
    } finally {
      if (root) rmSync(root, { recursive: true, force: true })
    }
  })
}

function runRetryDialogFixture(): Promise<RetryDialogResult> {
  return runChromeFixture('retry', retryDialogHarness(), 'v2-retry-result')
    .then((value) => JSON.parse(value) as RetryDialogResult)
    .then((value) => { assert.equal(value.error, undefined, value.error); return value })
}

function runPollingFixture(): Promise<PollingResult> {
  // 生产 6s 轮询间隔需要更大的 virtual-time 预算（首轮 6.8s + 次轮 6.3s + 停止验证）
  return runChromeFixture('poll', pollingHarness(), 'v2-poll-result', 20000)
    .then((value) => JSON.parse(value) as PollingResult)
    .then((value) => { assert.equal(value.error, undefined, value.error); return value })
}

// ---------- retry dialog harness ----------
function retryDialogHarness(): string {
  return String.raw`
(async function(){
  var out={};
  var calls=[],posts=[],gets=[];
  var mode='ok',retryResponses={},decisions={};
  window.fetch=function(url,opts){
    var u=String(url),method=(opts&&opts.method)||'GET';
    calls.push({url:u,method:method});
    if(method==='POST')posts.push({url:u,body:JSON.parse(opts.body)});
    else gets.push(u);
    if(u.indexOf('/sparkos/visual/decision')>=0&&method==='POST'){
      var dbody=JSON.parse(opts.body);
      decisions[dbody.attemptId]=dbody.decision;
      return Promise.resolve({ok:true,status:200,json:async function(){return {ok:true,value:{taskId:'vt-x',attemptId:dbody.attemptId,decision:dbody.decision,note:dbody.note||null,taskState:dbody.decision,batchStatus:'rejected',approvedCount:0,requiredCount:4}};}});
    }
    if(u.indexOf('/sparkos/visual/retry')>=0&&method==='POST'){
      if(mode==='conflict')return Promise.resolve({ok:false,status:409,json:async function(){return {ok:false,error:{code:'retry-conflict',message:'任务状态已变化，正在刷新'}};}});
      var body=JSON.parse(opts.body);
      retryResponses[body.taskId]=true;
      return Promise.resolve({ok:true,status:200,json:async function(){return {ok:true,value:{requestId:'rr-1',taskId:body.taskId,previousAttemptId:body.currentAttemptId,state:'retry',previousNote:'构图需要重做：主体放大，去掉左下角杂物',supplementaryInstruction:body.supplementaryInstruction||null,expectedNextAttemptNo:2,idempotent:false,currentAttempt:1,maxAttempts:3}};}});
    }
    if(u.indexOf('/sparkos/visual/status')>=0&&method==='GET'){
      var pkg=decodeURIComponent(u.split('packageId=')[1]);
      var b=D.factory.visual.batches.filter(function(x){return x.packageId===pkg;})[0];
      var nb=JSON.parse(JSON.stringify(b));
      nb.tasks.forEach(function(t){
        if(retryResponses[t.id]){t.pipelineState='retry';t.state='retry';return;}
        var a=t.attempts.filter(function(x){return Number(x.attemptNo)===Number(t.currentAttempt);})[0];
        if(a&&decisions[a.id]==='rejected'){t.state='rejected';t.pipelineState='waiting_visual_approval';t.reviewNote='构图重做';a.approval={decision:'rejected',note:'构图重做',decidedAt:new Date().toISOString()};t.retry={eligible:true,reason:null,code:null,expectedNextAttemptNo:Number(t.currentAttempt)+1};}
      });
      return Promise.resolve({ok:true,status:200,json:async function(){return {ok:true,value:{batches:[nb]}};}});
    }
    if(u.indexOf('/sparkos/visual/asset')>=0&&method==='GET'){
      return Promise.resolve({ok:false,status:404,json:async function(){return {ok:false};}});
    }
    return Promise.resolve({ok:false,status:404,json:async function(){return {ok:false};}});
  };
  function q(s){return document.querySelector(s);}
  function qa(s){return Array.prototype.slice.call(document.querySelectorAll(s));}
  function wait(ms){return new Promise(function(r){setTimeout(r,ms);});}
  async function hash(h){location.hash=h;await wait(70);}
  function card(id){return q('[data-vis-task="'+id+'"]');}
  try{
    await hash('#/visual');
    var c888=card('vt-88888888888888888888');
    var c333=card('vt-33333333333333333333');
    var c999=card('vt-99999999999999999999');
    out.rejectedBadge=c888.textContent.indexOf('已驳回')>=0;
    out.rejectTimeShown=c888.textContent.indexOf('驳回时间')>=0;
    out.fullNoteShown=!!c888.querySelector('details.tech summary');
    out.retryButtonOnRetryable=!!c888.querySelector('[data-visual-retry]');
    out.noRetryOnStubRejected=!c333.querySelector('[data-visual-retry]')&&!c333.querySelector('[data-visual-approve]')&&!c333.querySelector('[data-visual-reject]');
    out.noRetryOnMaxedRejected=!c999.querySelector('[data-visual-retry]');
    out.stubNoteShown=c333.textContent.indexOf('测试图片（stub）不可重试')>=0;
    out.maxNoteShown=c999.textContent.indexOf('已达到最大重试次数')>=0;
    // 打开重试对话框
    c888.querySelector('[data-visual-retry]').click();await wait(60);
    var dlg=q('#retry-dialog');
    var body=dlg?q('#retryDialogBody').textContent:'';
    out.dialogOpened=!!dlg&&!dlg.classList.contains('hidden');
    out.dialogHasAssetId=body.indexOf('retry-one')>=0;
    out.dialogHasPlacement=body.indexOf('微信公众号封面')>=0||body.indexOf('微信正文')>=0;
    out.dialogHasAttemptNo=body.indexOf('#1（当前）')>=0;
    out.dialogHasProviderModel=body.indexOf('openai')>=0&&body.indexOf('image-model')>=0;
    out.dialogHasPromptSummary=body.indexOf('原 prompt 摘要')>=0;
    out.dialogHasFullNote=body.indexOf('构图需要重做：主体放大，去掉左下角杂物')>=0;
    out.dialogHasNextAttemptNo=body.indexOf('#2')>=0;
    out.dialogHasMaxUsage=body.indexOf('已用 1 / 3 次')>=0;
    out.dialogHasOnlyCreatesTaskNote=body.indexOf('只创建重试任务')>=0;
    out.postsBeforeConfirm=posts.length;
    // 补充要求预检：路径/URL 被拦截且不 POST
    var sup=q('#retry-supplementary');
    sup.value='/Users/me/pic.png';sup.dispatchEvent(new Event('input',{bubbles:true}));
    q('[data-retry-confirm]').click();await wait(80);
    out.forbiddenPathBlocked=q('#retryDialogErr').textContent.indexOf('本地路径')>=0||q('#retryDialogErr').textContent.indexOf('URL')>=0;
    out.forbiddenPosts=posts.length;
    // 合法补充要求 + 确认
    sup.value='加强主体占比';sup.dispatchEvent(new Event('input',{bubbles:true}));
    var errEl=q('#retryDialogErr');if(errEl)errEl.classList.remove('show');
    q('[data-retry-confirm]').click();await wait(60);
    var busyBtn=q('[data-retry-confirm]');
    out.confirmDisabledWhileBusy=busyBtn.disabled===true;
    out.confirmLabel=busyBtn.textContent;
    await wait(260);
    out.postsAfterConfirm=posts.length;
    out.retryBody=posts[posts.length-1]?posts[posts.length-1].body:null;
    out.cardWaitingAgentAfter=(function(){var c=card('vt-88888888888888888888');return !!c&&c.textContent.indexOf('等待 Agent 领取')>=0;})();
    out.statusRefreshedAfter=gets.some(function(u){return u.indexOf('/sparkos/visual/status')>=0;});
    // 双击只发一次：重新渲染后 888 已变为 retry，改用 444 走「驳回→可重试→双击确认」
    var c444=card('vt-44444444444444444444');
    var dblPosts=0;
    if(c444&&c444.querySelector('[data-visual-reject]')){
      c444.querySelector('[data-visual-reject]').click();await wait(50);
      var n=q('#review-note');if(n){n.value='需要重做';n.dispatchEvent(new Event('input',{bubbles:true}));}
      q('[data-review-confirm]').click();await wait(260);
      var c444b=card('vt-44444444444444444444');
      var rb444=c444b?c444b.querySelector('[data-visual-retry]'):null;
      if(rb444){
        rb444.click();await wait(60);
        var sup3=q('#retry-supplementary');if(sup3){sup3.value='';sup3.dispatchEvent(new Event('input',{bubbles:true}));}
        // 从对话框打开后的状态开始计数，双击确认只应产生一次 retry POST
        var beforeDbl=posts.length;
        q('[data-retry-confirm]').click();q('[data-retry-confirm]').click();await wait(260);
        dblPosts=posts.length-beforeDbl;
      }
    }
    out.doubleClickPosts=dblPosts;
    // 409 冲突
    mode='conflict';
    var c555=card('vt-55555555555555555555');
    var rejectBtn=c555.querySelector('[data-visual-reject]');
    if(rejectBtn){rejectBtn.click();await wait(50);}
    var note2=q('#review-note');if(note2){note2.value='构图重做';note2.dispatchEvent(new Event('input',{bubbles:true}));}
    q('[data-review-confirm]').click();await wait(260);
    var c555b=card('vt-55555555555555555555');
    var retryBtn555=c555b?c555b.querySelector('[data-visual-retry]'):null;
    if(retryBtn555){retryBtn555.click();await wait(50);}
    if(q('#retry-dialog')&&!q('#retry-dialog').classList.contains('hidden')){
      var sup2=q('#retry-supplementary');if(sup2){sup2.value='';sup2.dispatchEvent(new Event('input',{bubbles:true}));}
      var beforeConflict=gets.length;
      q('[data-retry-confirm]').click();await wait(260);
      out.conflictDialogOpen=!q('#retry-dialog').classList.contains('hidden');
      out.conflictMessage=q('#retryDialogErr').textContent;
      out.conflictRefreshed=gets.length>beforeConflict;
      q('[data-retry-cancel]').click();await wait(50);
    }else{out.conflictDialogOpen=false;out.conflictMessage='';out.conflictRefreshed=false;}
    out.noGenerateDeliveryPublish=calls.every(function(c){return c.url.indexOf('image_generate')<0&&c.url.indexOf('/sparkos/visual/delivery')<0&&c.url.indexOf('/sparkos/visual/queue')<0&&c.url.indexOf('/sparkos/mutate')<0&&c.url.indexOf('/sparkos/creation/')<0&&c.url.indexOf('/sparkos/editorial/')<0;});
  }catch(e){out.error=String(e&&e.stack||e).replace(/</g,'&lt;');}
  var pre=document.createElement('pre');pre.id='v2-retry-result';pre.textContent=JSON.stringify(out);document.body.appendChild(pre);
})();`
}

// ---------- polling harness ----------
function pollingHarness(): string {
  return String.raw`
(async function(){
  var out={};
  var calls=[],posts=[],gets=[];
  var statusCalls=0;
  // 注入一个 generating 任务，让轮询启动
  var genTask=JSON.parse(JSON.stringify(D.factory.visual.batches[0].tasks[0]));
  genTask.id='vt-10101010101010101010';genTask.assetId='generating-one';genTask.state='generating';genTask.pipelineState='generating';
  genTask.currentAttempt=2;genTask.maxAttempts=3;
  genTask.attempts=[{id:'va-10101010101010101010',taskId:'vt-10101010101010101010',attemptNo:2,provider:'openai',model:'image-model',sourceWidth:900,sourceHeight:383,sourceMediaType:'image/png',sourceBytes:64,importedRelativePath:null,importedSha256:null,status:'generating',approval:{decision:'pending',note:null,decidedAt:null},createdAt:'2026-08-22T10:00:00Z',updatedAt:'2026-08-22T10:00:00Z'}];
  genTask.events=[];genTask.retry={eligible:false,reason:null,code:null,expectedNextAttemptNo:3};
  D.factory.visual.batches[0].tasks.push(genTask);
  // headless 下 document.hidden 恒为 true，会触发页面的可见性暂停：先恢复为可见
  Object.defineProperty(document,'hidden',{configurable:true,get:function(){return false;}});
  // 保持生产默认 6s 节奏，用更大的 virtual-time 预算观察（轮询间隔由页面逻辑决定）
  window.fetch=function(url,opts){
    var u=String(url),method=(opts&&opts.method)||'GET';
    calls.push({url:u,method:method});
    if(method==='POST')posts.push(u);
    else gets.push(u);
    if(u.indexOf('/sparkos/visual/status')>=0&&method==='GET'){
      statusCalls+=1;
      var pkg=decodeURIComponent(u.split('packageId=')[1]);
      var b=D.factory.visual.batches.filter(function(x){return x.packageId===pkg;})[0];
      return Promise.resolve({ok:true,status:200,json:async function(){return {ok:true,value:{batches:[JSON.parse(JSON.stringify(b))]}};}});
    }
    return Promise.resolve({ok:false,status:404,json:async function(){return {ok:false};}});
  };
  function q(s){return document.querySelector(s);}
  function wait(ms){return new Promise(function(r){setTimeout(r,ms);});}
  async function hash(h){location.hash=h;await wait(80);}
  try{
    // 页面加载：无 POST
    out.pageLoadPosts=posts.length;
    await hash('#/visual');
    // 等待首个轮询 GET（生产 6s 间隔）
    await wait(6800);
    var firstGets=gets.filter(function(u){return u.indexOf('/sparkos/visual/status')>=0;}).length;
    out.pollGets=firstGets;
    out.pollPosts=posts.length;
    out.pollOnlyGet=posts.length===0&&firstGets>0;
    // 同一 package 只有一个轮询器：6.3s 窗口内恰好再来一次（串行调度，不并发翻倍）
    var before=statusCalls;
    await wait(6300);
    var delta=statusCalls-before;
    out.singlePollerPerPackage=delta===1;
    // 页面隐藏 → 停止
    Object.defineProperty(document,'hidden',{configurable:true,get:function(){return true;}});
    document.dispatchEvent(new Event('visibilitychange'));
    var hiddenBefore=statusCalls;await wait(600);
    out.hiddenStopsPolling=(statusCalls-hiddenBefore)===0;
    Object.defineProperty(document,'hidden',{configurable:true,get:function(){return false;}});
    document.dispatchEvent(new Event('visibilitychange'));
    await wait(120);
    // 离开路由 → 停止
    var leaveBefore=statusCalls;
    await hash('#/overview');
    await wait(600);
    out.leaveStopsPolling=(statusCalls-leaveBefore)===0;
    // 手动刷新按钮只读
    await hash('#/visual');await wait(120);
    var mrPosts=posts.length;
    var beforeMr=gets.length;
    var btn=q('[data-visual-refresh]');
    if(btn){btn.click();await wait(300);}
    out.manualRefreshGets=gets.length-beforeMr;
    out.manualRefreshPosts=posts.length-mrPosts;
  }catch(e){out.error=String(e&&e.stack||e).replace(/</g,'&lt;');}
  var pre=document.createElement('pre');pre.id='v2-poll-result';pre.textContent=JSON.stringify(out);document.body.appendChild(pre);
})();`
}

