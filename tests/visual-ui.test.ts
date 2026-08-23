import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

interface InteractionResult {
  error?: string
  textareaOpened: boolean
  blankDisabled: boolean
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

const interactionResult = runVisualInteractionFixture()

test('visual reject click opens an inline textarea', async () => {
  assert.equal((await interactionResult).textareaOpened, true)
})

test('blank visual rejection note cannot be submitted', async () => {
  assert.equal((await interactionResult).blankDisabled, true)
})

test('cancelling inline visual review does not call fetch', async () => {
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

test('visual decision API failure is visible and the rerendered control can retry', async () => {
  const result = await interactionResult
  assert.equal(result.apiErrorRendered, true)
  assert.equal(result.apiErrorRetryEnabled, true)
  assert.equal(result.apiRetrySucceeded, true)
})

test('visual approve shows processing and sends the correct request', async () => {
  const result = await interactionResult
  assert.equal(result.approveProcessing, true)
  assert.deepEqual(result.approveBody, { attemptId: 'va-' + '2'.repeat(20), decision: 'approved' })
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
  thumbCursor: string | null
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
  linkNotPrevented: boolean
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
  assert.equal(result.thumbCursor, 'zoom-in')
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

test('lightbox thumbnail, image and original links share one controlled URL', async () => {
  const result = await lightboxResult
  assert.equal(result.urlsIdentical, true)
})

test('lightbox original links never preventDefault and provide a same-tab variant', async () => {
  const result = await lightboxResult
  assert.equal(result.linkNotPrevented, true)
  assert.equal(result.sameTabLinkPresent, true)
})

test('lightbox single validator rejects invalid attempt ids', async () => {
  const result = await lightboxResult
  assert.equal(result.invalidIdRejected, true)
})

test('lightbox Escape closes and restores focus to the thumbnail', async () => {
  const result = await lightboxResult
  assert.equal(result.escapeCloses, true)
  assert.equal(result.focusRestored, true)
  assert.equal(result.bodyUnlockedAfterClose, true)
})

test('lightbox backdrop click closes', async () => {
  const result = await lightboxResult
  assert.equal(result.backdropCloses, true)
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
  const result = await lightboxResult
  assert.equal(result.bodyLockedWhileOpen, true)
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

test('existing approve and reject controls still work after lightbox use', async () => {
  const result = await lightboxResult
  assert.equal(result.approveStillWorks, true)
  assert.equal(result.rejectStillWorks, true)
})

async function runVisualInteractionFixture(): Promise<InteractionResult> {
  const root = mkdtempSync(path.join(tmpdir(), 'sparkos-visual-ui-'))
  try {
    const base = path.join(root, 'base.html')
    const fixture = path.join(root, 'fixture.html')
    const rendered = spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/render-page.mjs', base], {
      cwd: process.cwd(), encoding: 'utf8', env: withoutSparkosPaths(process.env), timeout: 60_000,
    })
    assert.equal(rendered.status, 0, rendered.stderr || rendered.stdout)
    const source = readFileSync(base, 'utf8')
    writeFileSync(fixture, source.replace('</body>', `<script>${interactionHarness()}</script></body>`))
    const chrome = spawnSync(CHROME, [
      '--headless=new', '--disable-gpu', '--disable-background-networking', '--no-first-run', '--no-default-browser-check',
      '--virtual-time-budget=3000', '--dump-dom', 'file://' + fixture,
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
  function response(body){return {ok:true,status:200,json:async function(){return {ok:true,value:{taskId:attemptTasks[body.attemptId],attemptId:body.attemptId,decision:body.decision,note:body.note||null,taskState:body.decision,batchStatus:"partially_approved",approvedCount:body.decision==="approved"?1:0,requiredCount:4}};}};}
  window.fetch=function(url,options){
    if(url!=="/sparkos/visual/decision")return Promise.reject(new Error("unexpected request: "+url));
    var body=JSON.parse(options.body);requests.push({url:url,method:options.method,body:body});
    if(mode==="error")return Promise.resolve({ok:false,status:409,json:async function(){return {ok:false,error:{message:"模拟审核失败"}};}});
    if(mode==="pending")return new Promise(function(resolve){pendingResolve=function(){resolve(response(body));};});
    return Promise.resolve(response(body));
  };
  function card(taskId){return document.querySelector('[data-visual-card="'+taskId+'"]');}
  function click(root,selector){var node=root.querySelector(selector);if(!node)throw new Error("missing "+selector);node.click();return node;}
  function fill(root,value){var input=root.querySelector("[data-visual-note]");if(!input)throw new Error("missing textarea");input.value=value;input.dispatchEvent(new Event("input",{bubbles:true}));return input;}
  function settle(){return new Promise(function(resolve){setTimeout(resolve,0);});}
  try{
    var rejectTask="vt-11111111111111111111",rejectAttempt="va-11111111111111111111";
    click(card(rejectTask),'[data-visual-decision="rejected"]');
    out.textareaOpened=!!card(rejectTask).querySelector("textarea[data-visual-note]");
    out.blankDisabled=card(rejectTask).querySelector("[data-visual-reject-confirm]").disabled===true;
    click(card(rejectTask),"[data-visual-reject-cancel]");
    out.cancelNoFetch=requests.length===0&&!card(rejectTask).querySelector("[data-visual-review-editor]");

    click(card(rejectTask),'[data-visual-decision="rejected"]');
    fill(card(rejectTask),"  <img src=x onerror=uiAttack()> 重做构图  ");
    click(card(rejectTask),"[data-visual-reject-confirm]");await settle();await settle();
    var rejectedRequests=requests.filter(function(item){return item.body.attemptId===rejectAttempt;});
    out.rejectRequestCount=rejectedRequests.length;out.rejectBody=rejectedRequests[0]&&rejectedRequests[0].body;
    out.rejectedRendered=card(rejectTask).textContent.indexOf("图片已驳回")>=0;
    out.rejectedNoteRendered=card(rejectTask).textContent.indexOf("<img src=x onerror=uiAttack()> 重做构图")>=0;
    out.rejectedNoteSafe=!card(rejectTask).querySelector('img[src="x"]');

    var failureTask="vt-44444444444444444444",failureAttempt="va-44444444444444444444";mode="error";
    click(card(failureTask),'[data-visual-decision="rejected"]');fill(card(failureTask),"修复边缘");
    click(card(failureTask),"[data-visual-reject-confirm]");await settle();await settle();
    out.apiErrorRendered=card(failureTask).textContent.indexOf("模拟审核失败")>=0;
    var retryButton=card(failureTask).querySelector("[data-visual-reject-confirm]");out.apiErrorRetryEnabled=!!retryButton&&!retryButton.disabled;
    var failureBefore=requests.filter(function(item){return item.body.attemptId===failureAttempt;}).length;mode="success";retryButton.click();await settle();await settle();
    out.apiRetrySucceeded=requests.filter(function(item){return item.body.attemptId===failureAttempt;}).length===failureBefore+1&&card(failureTask).textContent.indexOf("图片已驳回")>=0;

    var approveTask="vt-22222222222222222222",approveAttempt="va-22222222222222222222";mode="pending";
    click(card(approveTask),'[data-visual-decision="approved"]');
    out.approveProcessing=card(approveTask).textContent.indexOf("处理中…")>=0;
    out.approveBody=requests.filter(function(item){return item.body.attemptId===approveAttempt;})[0].body;
    pendingResolve();await settle();await settle();
    out.approveSucceeded=card(approveTask).textContent.indexOf("图片已批准")>=0;
  }catch(error){out.error=String(error&&error.stack||error);}
  var result=document.createElement("pre");result.id="visual-interaction-result";result.textContent=JSON.stringify(out);document.body.appendChild(result);
})();`
}
async function runVisualLightboxFixture(): Promise<LightboxResult> {
  const root = mkdtempSync(path.join(tmpdir(), 'sparkos-visual-lightbox-'))
  try {
    const base = path.join(root, 'base.html')
    const fixture = path.join(root, 'fixture.html')
    const rendered = spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/render-page.mjs', base], {
      cwd: process.cwd(), encoding: 'utf8', env: withoutSparkosPaths(process.env), timeout: 60_000,
    })
    assert.equal(rendered.status, 0, rendered.stderr || rendered.stdout)
    const source = readFileSync(base, 'utf8')
    writeFileSync(fixture, source.replace('</body>', '<script>' + lightboxHarness() + '</script></body>'))
    const chrome = spawnSync(CHROME, [
      '--headless=new', '--disable-gpu', '--disable-background-networking', '--no-first-run', '--no-default-browser-check',
      '--virtual-time-budget=3000', '--dump-dom', 'file://' + fixture,
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

function lightboxHarness(): string {
  return String.raw`
(async function(){
  var out={};var requests=[];
  var attemptTasks={
    "va-11111111111111111111":"vt-11111111111111111111",
    "va-22222222222222222222":"vt-22222222222222222222",
    "va-44444444444444444444":"vt-44444444444444444444"
  };
  function response(body){return {ok:true,status:200,json:async function(){return {ok:true,value:{taskId:attemptTasks[body.attemptId],attemptId:body.attemptId,decision:body.decision,note:body.note||null,taskState:body.decision,batchStatus:"partially_approved",approvedCount:body.decision==="approved"?1:0,requiredCount:4}};}};}
  window.fetch=function(url,options){
    if(url!=="/sparkos/visual/decision")return Promise.reject(new Error("unexpected request: "+url));
    var body=JSON.parse(options.body);requests.push({url:url,method:options.method,body:body});
    return Promise.resolve(response(body));
  };
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
    // 真实使用中用户位于可见的创作 tab；隐藏 tab 内的元素无法获得焦点
    document.getElementById("tab-draft").classList.remove("hidden");
    var cover="va-11111111111111111111";
    var t=thumb(cover);
    out.thumbsAreButtons=!!t&&t.tagName==="BUTTON"&&t.getAttribute("type")==="button";
    out.thumbAriaLabel=!!t&&(t.getAttribute("aria-label")||"").indexOf("查看大图")===0;
    out.thumbCursor=t?getComputedStyle(t).cursor:null;
    t.focus();t.click();await settle();
    var img=lb().querySelector("[data-lightbox-img]");
    await waitImageError(img);await settle();
    out.opened=visible();
    out.dialogRole=lb().getAttribute("role")==="dialog";
    out.ariaModal=lb().getAttribute("aria-modal")==="true";
    out.bodyLockedWhileOpen=document.body.classList.contains("lightbox-open")&&getComputedStyle(document.body).overflow==="hidden";
    var info=infoText();
    out.infoHasAssetId=info.indexOf("cover-main")>=0;
    out.infoHasAttemptNo=info.indexOf("attempt 编号")>=0&&info.indexOf("1")>=0;
    out.infoHasProvider=info.indexOf("stub")>=0&&info.indexOf("stub-v1")>=0;
    out.infoHasDims=info.indexOf("900×383")>=0;
    out.infoHasMime=info.indexOf("image/png")>=0;
    out.infoHasBytes=info.indexOf("bytes")>=0&&info.indexOf("64")>=0;
    out.infoHasSha=info.indexOf("a".repeat(12))>=0;
    out.infoHasAlt=info.indexOf("安全替代文本")>=0;
    out.infoHasPlacement=info.indexOf("微信公众号封面")>=0;
    // 实体解码后文本节点含原始 <b>…</b> 字面量（这正是“不被解析为标记”的安全行为）
    out.infoHasPrompt=info.indexOf("必须转义的提示词")>=0&&lb().querySelector("[data-lightbox-info] script")===null;
    out.infoHasCounter=info.indexOf("1 / 5")>=0;
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
      return !!a&&a.getAttribute("target")===null&&ATTEMPT_RE.test(a.getAttribute("href"));
    })();
    out.linkNotPrevented=(function(){
      var a=lb().querySelector('[data-lightbox-info] a[data-lightbox-open]');
      var prevented=false;
      a.addEventListener("click",function(ev){prevented=ev.defaultPrevented;},{once:true});
      a.click();
      return !prevented&&a.getAttribute("href").indexOf("/sparkos/visual/asset?attemptId=va-")===0;
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
    out.nextButton=infoText().indexOf("failure-one")>=0;
    key("ArrowLeft");await settle();
    out.arrowLeft=infoText().indexOf("inline-one")>=0;
    lb().querySelector("[data-lightbox-prev]").click();await settle();
    out.prevButton=infoText().indexOf("cover-main")>=0;
    lb().querySelector("[data-lightbox-prev]").click();await settle();
    out.wrapKeptInPackage=infoText().indexOf("xss-one")>=0&&infoText().indexOf("other-package")<0;

    key("Escape");await settle();
    out.escapeCloses=!visible();
    out.bodyUnlockedAfterClose=!document.body.classList.contains("lightbox-open");
    out.focusRestored=document.activeElement===thumb(cover);

    t.click();await settle();
    lb().querySelector("[data-lightbox-backdrop]").click();
    out.backdropCloses=!visible();
    await settle();

    var other=thumb("va-66666666666666666666");
    other.click();await settle();
    out.crossPackageOpened=infoText().indexOf("other-package")>=0;
    lb().querySelector("[data-lightbox-next]").click();await settle();
    out.crossPackageIsolated=infoText().indexOf("other-package")>=0&&infoText().indexOf("cover-main")<0;
    key("Escape");await settle();

    var xssThumb=thumb("va-55555555555555555555");
    out.xssThumbEscaped=(xssThumb.getAttribute("aria-label")||"").indexOf("查看大图")===0&&(xssThumb.getAttribute("aria-label")||"").indexOf("lightboxAttack")>=0;
    xssThumb.click();await settle();
    var xssInfo=infoText();
    var infoBox=lb().querySelector("[data-lightbox-info]");
    // 恶意字符串只作为文本出现（含原始字面量），但绝不被解析为元素
    out.xssEscaped=xssInfo.indexOf("lightboxAttack")>=0&&xssInfo.indexOf("pwned()")>=0
      &&infoBox.querySelector("img")===null&&infoBox.querySelector("script")===null&&infoBox.querySelector("svg")===null;
    key("Escape");await settle();

    out.noApprovalCallsBeforeControls=requests.length===0;
    var approveTask="vt-22222222222222222222",approveAttempt="va-22222222222222222222";
    document.querySelector('[data-visual-card="'+approveTask+'"]').querySelector('[data-visual-decision="approved"]').click();
    await settle();await settle();
    var approveCard=document.querySelector('[data-visual-card="'+approveTask+'"]');
    out.approveStillWorks=requests.filter(function(item){return item.body.attemptId===approveAttempt;}).length===1&&approveCard.textContent.indexOf("图片已批准")>=0;

    var rejectTask="vt-44444444444444444444",rejectAttempt="va-44444444444444444444";
    var rejectCard=document.querySelector('[data-visual-card="'+rejectTask+'"]');
    rejectCard.querySelector('[data-visual-decision="rejected"]').click();
    rejectCard=document.querySelector('[data-visual-card="'+rejectTask+'"]');
    var note=rejectCard.querySelector("[data-visual-note]");note.value=" 修复边缘  ";note.dispatchEvent(new Event("input",{bubbles:true}));
    rejectCard.querySelector("[data-visual-reject-confirm]").click();await settle();await settle();
    rejectCard=document.querySelector('[data-visual-card="'+rejectTask+'"]');
    var rejectReq=requests.filter(function(item){return item.body.attemptId===rejectAttempt;});
    out.rejectStillWorks=rejectReq.length===1&&rejectReq[0].body.decision==="rejected"&&rejectReq[0].body.note==="修复边缘"&&rejectCard.textContent.indexOf("图片已驳回")>=0;
  }catch(error){out.error=String(error&&error.stack||error).replace(/</g,"&lt;");}
  var result=document.createElement("pre");result.id="visual-lightbox-result";result.textContent=JSON.stringify(out);document.body.appendChild(result);
})();`
}
