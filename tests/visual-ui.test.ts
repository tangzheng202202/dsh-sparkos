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
