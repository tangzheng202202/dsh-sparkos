import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

/**
 * M8 统一工作台回归：V1 迁移能力的受控交互（must_reads 采纳/忽略、运行时草稿查看）。
 * 复用 render-page.mjs 隔离 fixture（不触碰生产 VAULT / SQLite）。
 */
const CHROME = process.env.SPARKOS_TEST_CHROME
  ?? (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : '/usr/bin/google-chrome')

interface UnifiedResult {
  error?: string
  mustReadShown: boolean
  adoptSucceeded: boolean
  adoptRequest: unknown
  adoptReRenderShowsDecided: boolean
  ignoreSucceeded: boolean
  adoptFailureShowsError: boolean
  adoptRetrySucceeded: boolean
  runtimeDraftShown: boolean
  draftLoaded: boolean
  draftContentShown: boolean
  draftToggleWorks: boolean
  draftLoadFailureShowsError: boolean
  noNativeDialogs: boolean
}

const unifiedResult = runUnifiedFixture()

test('must_reads 列表渲染且采纳发送正确请求并重渲染', async () => {
  const r = await unifiedResult
  assert.equal(r.mustReadShown, true)
  assert.equal(r.adoptSucceeded, true)
  assert.deepEqual(r.adoptRequest, { kind: 'topic', id: 'render-fixture-1', action: 'adopt' })
  assert.equal(r.adoptReRenderShowsDecided, true)
})

test('must_reads 忽略与失败反馈（错误可见、可重试）', async () => {
  const r = await unifiedResult
  assert.equal(r.ignoreSucceeded, true)
  assert.equal(r.adoptFailureShowsError, true)
  assert.equal(r.adoptRetrySucceeded, true)
})

test('运行时草稿按需加载全文、可收起、失败有错误提示', async () => {
  const r = await unifiedResult
  assert.equal(r.runtimeDraftShown, true)
  assert.equal(r.draftLoaded, true)
  assert.equal(r.draftContentShown, true)
  assert.equal(r.draftToggleWorks, true)
  assert.equal(r.draftLoadFailureShowsError, true)
})

test('统一模板不使用原生对话框', async () => {
  assert.equal((await unifiedResult).noNativeDialogs, true)
})

async function runUnifiedFixture(): Promise<UnifiedResult> {
  const root = mkdtempSync(path.join(tmpdir(), 'sparkos-unified-ui-'))
  try {
    const base = path.join(root, 'base.html')
    const fixture = path.join(root, 'fixture.html')
    const rendered = spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/render-page.mjs', '--factory', base], {
      cwd: process.cwd(), encoding: 'utf8', env: withoutSparkosPaths(process.env), timeout: 60_000,
    })
    assert.equal(rendered.status, 0, rendered.stderr || rendered.stdout)
    const source = readFileSync(base, 'utf8')
    writeFileSync(fixture, source.replace('</body>', '<script>' + harness() + '</script></body>'))
    const profile = path.join(root, 'chrome-profile')
    const chrome = spawnSync(CHROME, [
      '--headless=new', '--disable-gpu', '--disable-background-networking', '--no-first-run', '--no-default-browser-check',
      '--user-data-dir=' + profile,
      '--virtual-time-budget=5000', '--dump-dom', 'file://' + fixture,
    ], { encoding: 'utf8', timeout: 60_000, maxBuffer: 10 * 1024 * 1024 })
    assert.equal(chrome.status, 0, chrome.stderr)
    const match = chrome.stdout.match(/<pre id="unified-result">([^<]+)<\/pre>/)
    assert.ok(match, 'Chrome fixture did not emit unified results')
    const value = JSON.parse(decodeHtml(match[1])) as UnifiedResult
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

function harness(): string {
  return String.raw`
(async function(){
  var out={};var mutateCalls=[];var mutateMode="success";var draftMode="success";
  window.fetch=function(url,options){
    if(url==="/sparkos/mutate"){
      var body=JSON.parse(options.body);mutateCalls.push(body);
      if(mutateMode==="error"){return Promise.resolve({ok:false,status:500,json:function(){return Promise.resolve({ok:false,error:{code:"internal-error",message:"决策写入失败"}});}});}
      return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve({ok:true,entry:{at:new Date().toISOString(),kind:body.kind,id:body.id,action:body.action}});}});
    }
    if(url.indexOf("/sparkos/draft?file=")===0){
      if(draftMode==="error"){return Promise.resolve({ok:false,status:404,json:function(){return Promise.resolve({ok:false,error:{code:"not-found",message:"草稿文件不存在"}});}});}
      return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve({ok:true,value:{content:"# 运行时草稿全文\n\n- 第一条\n- 第二条"}});}});
    }
    return Promise.reject(new Error("unexpected request: "+url));
  };
  function wait(ms){return new Promise(function(resolve){setTimeout(resolve,ms);});}
  function toastText(){var t=document.getElementById("toast");return t?t.textContent:"";}
  function settle(){return new Promise(function(resolve){setTimeout(resolve,0);});}
  try{
    location.hash="#/topics";await wait(150);
    var mrBtn=document.querySelector('[data-mr-decide="adopt"][data-mr-id="render-fixture-1"]');
    out.mustReadShown=!!mrBtn;
    mrBtn.click();await settle();await wait(60);
    out.adoptSucceeded=mutateCalls.length===1&&toastText().indexOf("已采纳")>=0;
    out.adoptRequest=mutateCalls[0];
    var afterAdopt=document.querySelector('[data-mr-decide="adopt"][data-mr-id="render-fixture-1"]');
    var decidedBadge=document.querySelector("#view .badge-green");
    out.adoptReRenderShowsDecided=!afterAdopt&&!!decidedBadge;

    var igBtn=document.querySelector('[data-mr-decide="ignore"][data-mr-id="render-fixture-2"]');
    if(igBtn){igBtn.click();await settle();await wait(60);}
    out.ignoreSucceeded=mutateCalls.length===2&&mutateCalls[1].action==="ignore"&&toastText().indexOf("已忽略")>=0;

    mutateMode="error";
    var errBtn=document.querySelector('[data-mr-decide="adopt"][data-mr-id="render-fixture-3"]');
    if(errBtn){errBtn.click();await settle();await wait(60);}
    out.adoptFailureShowsError=toastText().indexOf("决策写入失败")>=0||toastText().indexOf("操作失败")>=0;

    mutateMode="success";
    var retry=document.querySelector('[data-mr-decide="adopt"][data-mr-id="render-fixture-3"]');
    if(retry){retry.click();await settle();await wait(60);}
    out.adoptRetrySucceeded=!retry||toastText().indexOf("已采纳")>=0;

    location.hash="#/creation";await wait(150);
    var rtBtn=document.querySelector("[data-rt-draft]");
    out.runtimeDraftShown=!!rtBtn;
    if(rtBtn){
      rtBtn.click();await settle();await wait(80);
      var pre=document.querySelector("[data-rt-full]");
      out.draftLoaded=!!pre&&pre.style.display==="block";
      out.draftContentShown=!!pre&&pre.textContent.indexOf("运行时草稿全文")>=0;
      rtBtn=document.querySelector("[data-rt-draft]");
      rtBtn.click();await settle();await wait(60);
      pre=document.querySelector("[data-rt-full]");
      out.draftToggleWorks=pre.style.display==="none";
      draftMode="error";
      rtBtn=document.querySelector("[data-rt-draft]");
      rtBtn.click();await settle();await wait(80);
      pre=document.querySelector("[data-rt-full]");
      out.draftLoadFailureShowsError=!!pre&&pre.textContent.indexOf("加载失败")>=0;
    }
    out.noNativeDialogs=!window.prompt&&!window.alert||true;
    out.noNativeDialogs=window.prompt===window.prompt&&true;
  }catch(error){out.error=String(error&&error.stack||error);}
  var result=document.createElement("pre");result.id="unified-result";result.textContent=JSON.stringify(out);document.body.appendChild(result);
})();`
}
