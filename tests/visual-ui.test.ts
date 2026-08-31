import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

/**
 * 统一工作台视觉交互回归（M8：原 V1 内联编辑器模型并入 V2 受控对话框模型）。
 * 覆盖：审核对话框（打开/驳回必填/取消零请求/精确一次请求/XSS 转义/错误反馈可重试/批准处理中）
 * 与 lightbox（受控 URL/包内导航/XSS 转义/键盘与焦点恢复）。
 */
const CHROME = process.env.SPARKOS_TEST_CHROME
  ?? (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : '/usr/bin/google-chrome')

interface InteractionResult {
  error?: string
  dialogOpened: boolean
  textareaOpened: boolean
  blankBlocked: boolean
  cancelNoFetch: boolean
  rejectRequestCount: number
  rejectBody: unknown
  rejectedRendered: boolean
  rejectedNoteRendered: boolean
  rejectedNoteSafe: boolean
  apiErrorRendered: boolean
  apiErrorRetryEnabled: boolean
  apiRetrySucceeded: boolean
  approveBody: unknown
  approveProcessing: boolean
  approveSucceeded: boolean
}

/* 决策后维护批次状态副本，供 /sparkos/visual/status 刷新返回（模拟后端状态机） */
const STATE_STORE = `
  var batches = JSON.parse(JSON.stringify(window._embeddedDailyData.factory.visual.batches));
  function applyDecision(body){
    batches.forEach(function(b){(b.tasks||[]).forEach(function(t){(t.attempts||[]).forEach(function(a){
      if(a.id===body.attemptId){t.state=body.decision;a.approval={decision:body.decision,note:body.note||null,decidedAt:'2026-08-22T12:00:00Z'};}
    });});});
  }
  async function statusJson(){return {ok:true,value:{batches:batches}};}
  function statusBody(){return {ok:true,status:200,json:statusJson};}
`
const interactionResult = runVisualInteractionFixture()

test('visual reject click opens the review dialog with a note textarea', async () => {
  const result = await interactionResult
  assert.equal(result.dialogOpened, true)
  assert.equal(result.textareaOpened, true)
})

test('blank visual rejection note cannot be submitted', async () => {
  assert.equal((await interactionResult).blankBlocked, true)
})

test('cancelling visual review dialog does not call fetch', async () => {
  assert.equal((await interactionResult).cancelNoFetch, true)
})

test('visual rejection sends exactly one correctly shaped request', async () => {
  const result = await interactionResult
  assert.equal(result.rejectRequestCount, 1)
  assert.deepEqual(result.rejectBody, {
    attemptId: 'va-' + '1'.repeat(20),
    decision: 'rejected',
    note: '<img src=x onerror=uiAttack()> 重做构图',
  })
})

test('successful visual rejection renders rejected state and escaped note', async () => {
  const result = await interactionResult
  assert.equal(result.rejectedRendered, true)
  assert.equal(result.rejectedNoteRendered, true)
  assert.equal(result.rejectedNoteSafe, true)
})

test('visual decision API failure is visible and the dialog can retry', async () => {
  const result = await interactionResult
  assert.equal(result.apiErrorRendered, true)
  assert.equal(result.apiErrorRetryEnabled, true)
  assert.equal(result.apiRetrySucceeded, true)
})

test('visual approve shows processing and sends the correct request', async () => {
  const result = await interactionResult
  assert.equal(result.approveProcessing, true)
  assert.deepEqual(result.approveBody, { attemptId: 'va-' + '2'.repeat(20), decision: 'approved', note: '' })
  assert.equal(result.approveSucceeded, true)
})

interface LightboxResult {
  error?: string
  opened: boolean
  dialogRole: boolean
  ariaModal: boolean
  bodyLockedWhileOpen: boolean
  bodyUnlockedAfterClose: boolean
  thumbsAreButtons: boolean
  thumbAriaLabel: boolean
  infoHasAssetId: boolean
  infoHasAttemptNo: boolean
  infoHasProvider: boolean
  infoHasDims: boolean
  infoHasMime: boolean
  infoHasBytes: boolean
  infoHasSha: boolean
  infoHasAlt: boolean
  infoHasPlacement: boolean
  infoHasPrompt: boolean
  infoHasCounter: boolean
  infoHasOriginalLink: boolean
  originalLinkValid: boolean
  imageErrorShown: boolean
  errorLinkValid: boolean
  errorCurrentHrefValid: boolean
  errorMsgHasAttemptId: boolean
  urlsIdentical: boolean
  sameTabLinkPresent: boolean
  invalidIdRejected: boolean
  noApprovalCallsDuringLightbox: boolean
  arrowRight: boolean
  nextButton: boolean
  arrowLeft: boolean
  prevButton: boolean
  wrapKeptInPackage: boolean
  escapeCloses: boolean
  focusRestored: boolean
  backdropCloses: boolean
  crossPackageOpened: boolean
  crossPackageIsolated: boolean
  xssThumbEscaped: boolean
  xssEscaped: boolean
  noApprovalCallsBeforeControls: boolean
  approveStillWorks: boolean
  rejectStillWorks: boolean
}

const lightboxResult = runVisualLightboxFixture()

test('visual thumbnail click opens an in-page lightbox dialog', async () => {
  const result = await lightboxResult
  assert.equal(result.opened, true)
  assert.equal(result.dialogRole, true)
  assert.equal(result.ariaModal, true)
  assert.equal(result.thumbsAreButtons, true)
  assert.equal(result.thumbAriaLabel, true)
})

test('lightbox shows full asset info and only a system attempt asset link', async () => {
  const result = await lightboxResult
  assert.equal(result.infoHasAssetId, true)
  assert.equal(result.infoHasAttemptNo, true)
  assert.equal(result.infoHasProvider, true)
  assert.equal(result.infoHasDims, true)
  assert.equal(result.infoHasMime, true)
  assert.equal(result.infoHasBytes, true)
  assert.equal(result.infoHasSha, true)
  assert.equal(result.infoHasAlt, true)
  assert.equal(result.infoHasPlacement, true)
  assert.equal(result.infoHasPrompt, true)
  assert.equal(result.infoHasCounter, true)
  assert.equal(result.infoHasOriginalLink, true)
  assert.equal(result.originalLinkValid, true)
})

test('lightbox image load failure shows understandable error and valid links', async () => {
  const result = await lightboxResult
  assert.equal(result.imageErrorShown, true)
  assert.equal(result.errorLinkValid, true)
  assert.equal(result.errorCurrentHrefValid, true)
  assert.equal(result.errorMsgHasAttemptId, true)
})

test('lightbox thumbnail and original links share one controlled URL', async () => {
  assert.equal((await lightboxResult).urlsIdentical, true)
})

test('lightbox provides a same-tab original link variant', async () => {
  assert.equal((await lightboxResult).sameTabLinkPresent, true)
})

test('lightbox single validator rejects invalid attempt ids', async () => {
  assert.equal((await lightboxResult).invalidIdRejected, true)
})

test('lightbox Escape closes and restores focus to the thumbnail', async () => {
  const result = await lightboxResult
  assert.equal(result.escapeCloses, true)
  assert.equal(result.focusRestored, true)
  assert.equal(result.bodyUnlockedAfterClose, true)
})

test('lightbox backdrop click closes', async () => {
  assert.equal((await lightboxResult).backdropCloses, true)
})

test('lightbox prev/next buttons and arrow keys switch images', async () => {
  const result = await lightboxResult
  assert.equal(result.arrowRight, true)
  assert.equal(result.nextButton, true)
  assert.equal(result.arrowLeft, true)
  assert.equal(result.prevButton, true)
})

test('lightbox navigation stays within the current package', async () => {
  const result = await lightboxResult
  assert.equal(result.wrapKeptInPackage, true)
  assert.equal(result.crossPackageOpened, true)
  assert.equal(result.crossPackageIsolated, true)
})

test('lightbox locks background scroll while open', async () => {
  assert.equal((await lightboxResult).bodyLockedWhileOpen, true)
})

test('lightbox content escapes XSS markup', async () => {
  const result = await lightboxResult
  assert.equal(result.xssThumbEscaped, true)
  assert.equal(result.xssEscaped, true)
})

test('lightbox operations never call approval APIs', async () => {
  const result = await lightboxResult
  assert.equal(result.noApprovalCallsDuringLightbox, true)
  assert.equal(result.noApprovalCallsBeforeControls, true)
})

test('approve and reject dialogs still work after lightbox use', async () => {
  const result = await lightboxResult
  assert.equal(result.approveStillWorks, true)
  assert.equal(result.rejectStillWorks, true)
})

async function runVisualInteractionFixture(): Promise<InteractionResult> {
  const root = mkdtempSync(path.join(tmpdir(), 'sparkos-visual-ui-'))
  try {
    const base = path.join(root, 'base.html')
    const fixture = path.join(root, 'fixture.html')
    const rendered = spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/render-page.mjs', '--factory', base], {
      cwd: process.cwd(), encoding: 'utf8', env: withoutSparkosPaths(process.env), timeout: 60_000,
    })
    assert.equal(rendered.status, 0, rendered.stderr || rendered.stdout)
    const source = readFileSync(base, 'utf8')
    writeFileSync(fixture, source.replace('</body>', '<script>' + interactionHarness() + '</script></body>'))
    const chrome = spawnSync(CHROME, [
      '--headless=new', '--disable-gpu', '--disable-background-networking', '--no-first-run', '--no-default-browser-check',
      '--user-data-dir=' + path.join(root, 'chrome-profile'),
      '--virtual-time-budget=4000', '--dump-dom', 'file://' + fixture,
    ], { encoding: 'utf8', timeout: 60_000, maxBuffer: 10 * 1024 * 1024 })
    assert.equal(chrome.status, 0, chrome.stderr)
    const match = chrome.stdout.match(/<pre id="visual-interaction-result">([^<]+)<\/pre>/)
    assert.ok(match, 'Chrome fixture did not emit visual interaction results')
    const value = JSON.parse(decodeHtml(match[1])) as InteractionResult
    assert.equal(value.error, undefined, value.error)
    return value
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

async function runVisualLightboxFixture(): Promise<LightboxResult> {
  const root = mkdtempSync(path.join(tmpdir(), 'sparkos-visual-lightbox-'))
  try {
    const base = path.join(root, 'base.html')
    const fixture = path.join(root, 'fixture.html')
    const rendered = spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/render-page.mjs', '--factory', base], {
      cwd: process.cwd(), encoding: 'utf8', env: withoutSparkosPaths(process.env), timeout: 60_000,
    })
    assert.equal(rendered.status, 0, rendered.stderr || rendered.stdout)
    const source = readFileSync(base, 'utf8')
    writeFileSync(fixture, source.replace('</body>', '<script>' + lightboxHarness() + '</script></body>'))
    const chrome = spawnSync(CHROME, [
      '--headless=new', '--disable-gpu', '--disable-background-networking', '--no-first-run', '--no-default-browser-check',
      '--user-data-dir=' + path.join(root, 'chrome-profile'),
      '--virtual-time-budget=4000', '--dump-dom', 'file://' + fixture,
    ], { encoding: 'utf8', timeout: 60_000, maxBuffer: 10 * 1024 * 1024 })
    assert.equal(chrome.status, 0, chrome.stderr)
    const match = chrome.stdout.match(/<pre id="visual-lightbox-result">([^<]+)<\/pre>/)
    assert.ok(match, 'Chrome fixture did not emit lightbox results')
    const value = JSON.parse(decodeHtml(match[1])) as LightboxResult
    assert.equal(value.error, undefined, value.error)
    return value
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function withoutSparkosPaths(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const next = { ...env }
  for (const key of Object.keys(next)) if (key.startsWith('SPARKOS_')) delete next[key]
  return next
}

function decodeHtml(value: string): string {
  return value.replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&')
}


function interactionHarness(): string {
  return String.raw`
(async function(){
  var out={};var requests=[];var mode="success",pendingResolve=null;
  var attemptTasks={
    "va-11111111111111111111":"vt-11111111111111111111",
    "va-22222222222222222222":"vt-22222222222222222222",
    "va-44444444444444444444":"vt-44444444444444444444"
  };
  ${STATE_STORE}
  async function decisionJson(body){return {ok:true,value:{taskId:attemptTasks[body.attemptId],attemptId:body.attemptId,decision:body.decision,note:body.note||null,decidedAt:"2026-08-22T12:00:00Z",taskState:body.decision}};}
  function decisionResponse(body){return {ok:true,status:200,json:function(){return decisionJson(body);}};}
  window.fetch=function(url,options){
    out.fetchLog=out.fetchLog||[];out.fetchLog.push(String(url));
    if(url.indexOf("/sparkos/visual/status")===0){return Promise.resolve(statusBody());}
    if(url!=="/sparkos/visual/decision"){return Promise.reject(new Error("unexpected request: "+url));}
    var body=JSON.parse(options.body);requests.push({url:url,method:options.method,body:body});
async function errorJson(){return {ok:false,error:{code:"bad-request",message:"模拟审核失败"}};}
    if(mode==="error"){return Promise.resolve({ok:false,status:400,json:errorJson});}
    if(mode==="pending"){return new Promise(function(resolve){pendingResolve=function(){applyDecision(body);resolve(decisionResponse(body));};});}
    applyDecision(body);
    return Promise.resolve(decisionResponse(body));
  };
  function wait(ms){return new Promise(function(resolve){setTimeout(resolve,ms);});}
  function gotoVisual(){location.hash="#/visual";return wait(150);}
  function card(taskId){return document.querySelector('[data-vis-task="'+taskId+'"]');}
  function dlg(){return document.getElementById("review-dialog");}
  function dlgVisible(){return dlg()&&!dlg().classList.contains("hidden");}
  function click(root,selector){var scope=root||document;var node=scope.querySelector(selector);if(!node)throw new Error("missing "+selector);node.click();return node;}
  function fillNote(value){var input=document.getElementById("review-note");if(!input)throw new Error("missing textarea");input.value=value;input.dispatchEvent(new Event("input",{bubbles:true}));}
  function confirmBtn(){return dlg().querySelector("[data-review-confirm]");}
  function settle(){return new Promise(function(resolve){setTimeout(resolve,0);});}
  try{
    await gotoVisual();
    var rejectTask="vt-11111111111111111111",rejectAttempt="va-11111111111111111111";
    var rejectCard=card(rejectTask);
    if(!rejectCard)throw new Error("visual card not rendered");
    click(rejectCard,'[data-visual-reject="'+rejectAttempt+'"]');
    await settle();
    out.dialogOpened=dlgVisible();
    out.textareaOpened=!!document.getElementById("review-note");
    confirmBtn().click();await settle();
    out.blankBlocked=requests.length===0&&dlg().querySelector("#reviewDialogErr").textContent.indexOf("驳回意见必填")>=0;
    click(dlg(),"[data-review-cancel]");await settle();
    out.cancelNoFetch=requests.length===0&&!dlgVisible();

    click(card(rejectTask),'[data-visual-reject="'+rejectAttempt+'"]');await settle();
    fillNote("  <img src=x onerror=uiAttack()> 重做构图  ");
    confirmBtn().click();await settle();await settle();await wait(100);
    var rejectedRequests=requests.filter(function(item){return item.body.attemptId===rejectAttempt;});
    out.rejectRequestCount=rejectedRequests.length;out.rejectBody=rejectedRequests[0]&&rejectedRequests[0].body;
    var rc=card(rejectTask);
    out.rejectedRendered=!!rc&&rc.textContent.indexOf("已驳回")>=0;
    out.rejectedNoteRendered=!!rc&&rc.textContent.indexOf("重做构图")>=0;
    out.rejectedNoteSafe=!rc.querySelector('img[src="x"]');

    var failureTask="vt-44444444444444444444",failureAttempt="va-44444444444444444444";mode="error";
    click(card(failureTask),'[data-visual-reject="'+failureAttempt+'"]');await settle();
    fillNote("修复边缘");
    confirmBtn().click();await settle();await settle();
    out.apiErrorRendered=dlgVisible()&&dlg().querySelector("#reviewDialogErr").textContent.indexOf("模拟审核失败")>=0;
    var retryButton=confirmBtn();out.apiErrorRetryEnabled=!!retryButton&&!retryButton.disabled;
    var failureBefore=requests.filter(function(item){return item.body.attemptId===failureAttempt;}).length;
    mode="success";retryButton.click();await settle();await settle();await wait(100);
    out.apiRetrySucceeded=requests.filter(function(item){return item.body.attemptId===failureAttempt;}).length===failureBefore+1&&!dlgVisible();

    var approveTask="vt-22222222222222222222",approveAttempt="va-22222222222222222222";mode="pending";
    click(card(approveTask),'[data-visual-approve="'+approveAttempt+'"]');await settle();
    fillNote("");
    confirmBtn().click();await settle();
    out.approveProcessing=confirmBtn().textContent.indexOf("提交中")>=0;
    out.approveBody=requests.filter(function(item){return item.body.attemptId===approveAttempt;})[0].body;
    pendingResolve();await settle();await settle();await wait(100);
    out.approveSucceeded=!dlgVisible()&&!!card(approveTask)&&card(approveTask).textContent.indexOf("已批准")>=0;
  }catch(error){out.error=String(error&&error.stack||error);}
  var result=document.createElement("pre");result.id="visual-interaction-result";result.textContent=JSON.stringify(out);document.body.appendChild(result);
})();`
}

function lightboxHarness(): string {
  return String.raw`
(async function(){
  var out={};var requests=[];
  var attemptTasks={
    "va-11111111111111111111":"vt-11111111111111111111",
    "va-22222222222222222222":"vt-22222222222222222222",
    "va-44444444444444444444":"vt-44444444444444444444"
  };
  ${STATE_STORE}
  async function decisionJson(body){return {ok:true,value:{taskId:attemptTasks[body.attemptId],attemptId:body.attemptId,decision:body.decision,note:body.note||null,decidedAt:"2026-08-22T12:00:00Z",taskState:body.decision}};}
  function decisionResponse(body){return {ok:true,status:200,json:function(){return decisionJson(body);}};}
  window.fetch=function(url,options){
    out.fetchLog=out.fetchLog||[];out.fetchLog.push(String(url));
    if(url.indexOf("/sparkos/visual/status")===0){return Promise.resolve(statusBody());}
    if(url!=="/sparkos/visual/decision"){return Promise.reject(new Error("unexpected request: "+url));}
    var body=JSON.parse(options.body);requests.push({url:url,method:options.method,body:body});
    applyDecision(body);
    return Promise.resolve(decisionResponse(body));
  };
  function wait(ms){return new Promise(function(resolve){setTimeout(resolve,ms);});}
  function thumb(attemptId){return document.querySelector('[data-visual-thumb="'+attemptId+'"]');}
  function lb(){return document.getElementById("visual-lightbox");}
  function visible(){return lb()&&!lb().classList.contains("hidden");}
  function infoText(){return lb().querySelector("[data-lightbox-info]").textContent;}
  function key(k){document.dispatchEvent(new KeyboardEvent("keydown",{key:k,bubbles:true,cancelable:true}));}
  function settle(){return new Promise(function(resolve){setTimeout(resolve,0);});}
  function waitImageError(img){
    return new Promise(function(resolve){
      if(img.complete&&img.naturalWidth===0){resolve(true);return;}
      if(img.complete&&img.naturalWidth>0){resolve(false);return;}
      var settled=false;var timer;
      function done(value){if(settled)return;settled=true;img.removeEventListener("error",onError);clearTimeout(timer);resolve(value);}
      function onError(){done(true);}
      timer=setTimeout(function(){done(img.complete&&img.naturalWidth===0);},800);
      img.addEventListener("error",onError);
    });
  }
  function linkHref(){var a=lb().querySelector('[data-lightbox-info] a[href^="/sparkos/visual/asset"]');return a?a.getAttribute("href"):null;}
  var ATTEMPT_RE=/^\/sparkos\/visual\/asset\?attemptId=va-[a-f0-9]{20}$/;
  try{
    location.hash="#/visual";await wait(150);
    var cover="va-11111111111111111111";
    var t=thumb(cover);
    if(!t)throw new Error("thumbnail not rendered");
    out.thumbsAreButtons=t.tagName==="BUTTON"&&t.getAttribute("type")==="button";
    out.thumbAriaLabel=(t.getAttribute("aria-label")||"").indexOf("查看大图")===0;
    t.focus();t.click();await settle();
    var img=lb().querySelector("[data-lightbox-img]");
    await waitImageError(img);await settle();
    out.opened=visible();
    out.dialogRole=lb().getAttribute("role")==="dialog";
    out.ariaModal=lb().getAttribute("aria-modal")==="true";
    out.bodyLockedWhileOpen=document.body.classList.contains("modal-open")&&getComputedStyle(document.body).overflow==="hidden";
    var info=infoText();
    out.infoHasAssetId=info.indexOf("cover-main")>=0;
    out.infoHasAttemptNo=info.indexOf("attempt 编号")>=0&&info.indexOf("1")>=0;
    out.infoHasProvider=info.indexOf("stub")>=0&&info.indexOf("stub-v1")>=0;
    out.infoHasDims=info.indexOf("900×383")>=0;
    out.infoHasMime=info.indexOf("image/png")>=0;
    out.infoHasBytes=info.indexOf("bytes")>=0&&info.indexOf("64")>=0;
    out.infoHasSha=info.indexOf("aaaaaaaaaaaa")>=0;
    out.infoHasAlt=info.indexOf("安全替代文本")>=0;
    out.infoHasPlacement=info.indexOf("微信公众号封面")>=0;
    out.infoHasPrompt=info.indexOf("必须转义的提示词")>=0&&lb().querySelector("[data-lightbox-info] script")===null;
    out.infoHasCounter=/1 \/ \d+/.test(info);
    var href=linkHref();
    out.infoHasOriginalLink=!!href;
    out.originalLinkValid=!!href&&ATTEMPT_RE.test(href);
    out.imageErrorShown=lb().querySelector("[data-lightbox-error]").classList.contains("show");
    var errorHref=lb().querySelector("[data-lightbox-error-link]").getAttribute("href");
    out.errorLinkValid=!!errorHref&&ATTEMPT_RE.test(errorHref);
    out.errorCurrentHrefValid=(function(){var h=lb().querySelector("[data-lightbox-error-current]").getAttribute("href");return !!h&&ATTEMPT_RE.test(h);})();
    out.errorMsgHasAttemptId=lb().querySelector("[data-lightbox-error-msg]").textContent.indexOf("11111111111111111111")>=0;
    out.urlsIdentical=(function(){
      var tsrc=thumb(cover).querySelector("img").getAttribute("src");
      var imgSrc=lb().querySelector("[data-lightbox-img]").getAttribute("src");
      var infoHref=lb().querySelector('[data-lightbox-info] a[data-lightbox-open]').getAttribute("href");
      var errHref2=lb().querySelector("[data-lightbox-error-link]").getAttribute("href");
      return tsrc===imgSrc&&imgSrc===infoHref&&infoHref===errHref2&&ATTEMPT_RE.test(tsrc);
    })();
    out.sameTabLinkPresent=(function(){
      var a=lb().querySelector('[data-lightbox-info] a[data-lightbox-open-current]');
      return !!a&&ATTEMPT_RE.test(a.getAttribute("href"));
    })();
    out.invalidIdRejected=(function(){
      var bad=["va-6905f7dd8abdedf03","va-gggggggggggggggggggg","../../etc/passwd","javascript:alert(1)","VA-6905F7DD8ABDEDF03CDA","",null];
      var allNull=bad.every(function(id){return window.visualAssetUrl(id)===null;});
      var good=window.visualAssetUrl("va-6905f7dd8abdedf03cda");
      return allNull&&good==="/sparkos/visual/asset?attemptId=va-6905f7dd8abdedf03cda";
    })();
    out.noApprovalCallsDuringLightbox=requests.length===0;

    key("ArrowRight");await settle();
    out.arrowRight=infoText().indexOf("inline-one")>=0;
    lb().querySelector("[data-lightbox-next]").click();await settle();
    out.nextButton=infoText().indexOf("failure-one")>=0||infoText().indexOf("carousel-one")>=0||infoText().indexOf("xss-one")>=0;
    key("ArrowLeft");await settle();
    out.arrowLeft=infoText().indexOf("inline-one")>=0;
    lb().querySelector("[data-lightbox-prev]").click();await settle();
    out.prevButton=infoText().indexOf("cover-main")>=0;
    for(var i=0;i<12;i++){lb().querySelector("[data-lightbox-next]").click();await settle();}
    out.wrapKeptInPackage=infoText().indexOf("other-package")<0;

    key("Escape");await settle();
    out.escapeCloses=!visible();
    out.bodyUnlockedAfterClose=!document.body.classList.contains("modal-open");
    out.focusRestored=document.activeElement===thumb(cover);

    t.click();await settle();
    lb().querySelector("[data-lightbox-backdrop]").click();
    out.backdropCloses=!visible();
    await settle();

    var other=thumb("va-66666666666666666666");
    if(other){other.click();await settle();}
    out.crossPackageOpened=!!other&&infoText().indexOf("other-package")>=0;
    if(other){lb().querySelector("[data-lightbox-next]").click();await settle();}
    out.crossPackageIsolated=!other||(infoText().indexOf("other-package")>=0&&infoText().indexOf("cover-main")<0);
    key("Escape");await settle();

    var xssThumb=thumb("va-55555555555555555555");
    out.xssThumbEscaped=!!xssThumb&&(xssThumb.getAttribute("aria-label")||"").indexOf("查看大图")===0&&(xssThumb.getAttribute("aria-label")||"").indexOf("lightboxAttack")>=0;
    if(xssThumb){xssThumb.click();await settle();}
    var xssInfo=infoText();
    var infoBox=lb().querySelector("[data-lightbox-info]");
    out.xssEscaped=!!xssThumb&&xssInfo.indexOf("lightboxAttack")>=0&&xssInfo.indexOf("pwned()")>=0
      &&infoBox.querySelector("script")===null&&infoBox.querySelector("svg")===null;
    key("Escape");await settle();

    out.noApprovalCallsBeforeControls=requests.length===0;
    var approveTask="vt-22222222222222222222",approveAttempt="va-22222222222222222222";
    var approveCard=document.querySelector('[data-vis-task="'+approveTask+'"]');
    approveCard.querySelector('[data-visual-approve="'+approveAttempt+'"]').click();await settle();
    var note=document.getElementById("review-note");note.value="";note.dispatchEvent(new Event("input",{bubbles:true}));
    document.getElementById("review-dialog").querySelector("[data-review-confirm]").click();
    await settle();await settle();await wait(100);
    var approveCard2=document.querySelector('[data-vis-task="'+approveTask+'"]');
    out.approveStillWorks=requests.filter(function(item){return item.body.attemptId===approveAttempt;}).length===1&&approveCard2.textContent.indexOf("已批准")>=0;

    var rejectTask2="vt-44444444444444444444",rejectAttempt2="va-44444444444444444444";
    var rejectCard=document.querySelector('[data-vis-task="'+rejectTask2+'"]');
    rejectCard.querySelector('[data-visual-reject="'+rejectAttempt2+'"]').click();await settle();
    var note2=document.getElementById("review-note");note2.value=" 修复边缘 ";note2.dispatchEvent(new Event("input",{bubbles:true}));
    document.getElementById("review-dialog").querySelector("[data-review-confirm]").click();await settle();await settle();await wait(100);
    var rejectCard2=document.querySelector('[data-vis-task="'+rejectTask2+'"]');
    var rejectReq=requests.filter(function(item){return item.body.attemptId===rejectAttempt2;});
    out.rejectStillWorks=rejectReq.length===1&&rejectReq[0].body.decision==="rejected"&&rejectReq[0].body.note==="修复边缘"&&rejectCard2.textContent.indexOf("已驳回")>=0;
  }catch(error){out.error=String(error&&error.stack||error).replace(/</g,"&lt;");}
  var result=document.createElement("pre");result.id="visual-lightbox-result";result.textContent=JSON.stringify(out);document.body.appendChild(result);
})();`
}
