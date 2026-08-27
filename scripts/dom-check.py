#!/usr/bin/env python3
"""Chrome headless DOM 渲染检查（工作台升级后断言集：真实每日产物渲染）。"""
import subprocess, sys, os

CHROME = os.environ.get("SPARKOS_TEST_CHROME") or (
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    if os.path.exists("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    else "/usr/bin/google-chrome"
)
src = sys.argv[1] if len(sys.argv) > 1 else "/tmp/sparkos-wb.html"
if not os.path.exists(CHROME):
    print("SKIP: Chrome not found at " + CHROME)
    sys.exit(0)
dom = subprocess.run([CHROME, "--headless", "--disable-gpu", "--dump-dom", "file://" + src],
                     capture_output=True, text=True, timeout=60).stdout
ok = True
def check(name, cond):
    global ok
    ok = ok and bool(cond)
    print(("OK  " if cond else "MISS ") + name)

# M8 统一工作台：/tmp/sparkos-wb.html 即统一模板（原 V1 与 V2 已合并为一份实现）
for kw in ["SparkOS 统一工作台", "每日简报", "叙事主线", "时间线知识卡", "当日必读",
           "运行时草稿", "来源注册表", "融合产物", "下发建议", "归档计数",
           "情报簇", "每日 Top 5", "系统建议", "信源健康", "待写回"]:
    check("keyword " + kw, kw in dom)

# 统一模板结构断言（V1 能力迁移 + V2 受控操作并存）
check("must_reads adopt/ignore buttons", 'data-mr-decide="adopt"' in dom and 'data-mr-decide="ignore"' in dom)
check("must_reads posts to /sparkos/mutate", "kind:'topic'" in dom and "/sparkos/mutate" in dom)
check("runtime draft viewer", 'data-rt-draft' in dom and '/sparkos/draft?file=' in dom and 'encodeURIComponent(entry.file)' in dom)
check("timeline search filter", 'data-tl-q' in dom and 'filterTimelineCards' in dom)
check("editorial decision endpoint", '/sparkos/editorial/decision' in dom and 'data-topic-decision' in dom)
check("distill adopt via mutate", 'data-distill-decide' in dom)
check("writeback remove endpoint", '/sparkos/writeback/remove' in dom)
check("brief markdown safe render", 'renderBriefMd' in dom)
check("real perf empty state", "尚未接入真实平台表现数据" in dom)
check("draft review note flows via data", "需要重写开头" in dom)
check("parent review note label", "父版本驳回意见" in dom or "（父版本 " in dom)
check("no native prompt anywhere", 'window.prompt(' not in dom and 'window.alert(' not in dom and 'window.confirm(' not in dom)
check("no stale v2 wording", "V2 预览模式" not in dom and "请前往原版工作台" not in dom)
check("visual task cards", "data-vis-task" in dom or "visualRetryInfo" in dom)
check("visual approve action", "批准图片" in dom)
check("visual reject action", "驳回图片" in dom)
check("visual retry action", "按意见重试" in dom)
check("visual inline review controls", "驳回意见（必填）" in dom and "确认驳回" in dom and "取消" in dom)

check("visual error feedback", 'showToast' in dom)
import re as _re
check("rendered buttons have explicit type", _re.search(r"<button(?![^>]*type=)", dom) is None)
check("visual test-only gate", "测试图片（stub）" in dom and "readyForPublication" in dom)
check("visual review note escaped in template source", ("esc(t.reviewNote)" in dom) or ("esc(p.reviewNote)" in dom))
check("visual prompt escaped via esc", "esc(t.prompt)" in dom or "esc(a.prompt)" in dom or "altText" in dom)
check("visual lightbox dialog markup", 'id="visual-lightbox"' in dom and 'role="dialog"' in dom and 'aria-modal="true"' in dom)
check("visual thumbnails are buttons", "data-visual-thumb" in dom)
check("lightbox close/backdrop/nav controls", 'data-lightbox-close' in dom or 'data-retry-close' in dom)


check("lightbox close/backdrop/nav controls", 'data-lightbox-close' in dom and 'data-lightbox-backdrop' in dom and 'data-lightbox-prev' in dom and 'data-lightbox-next' in dom)
check("lightbox escape and arrow keys", 'Escape' in dom and 'ArrowLeft' in dom)
check("lightbox avoids native dialogs", 'window.open(' not in dom and 'alert(' not in dom)
check("lightbox body scroll lock", 'modal-open' in dom)
check("lightbox original link uses system attemptId", '/sparkos/visual/asset?attemptId=' in dom)


check("lightbox error overlay hidden by default", '.visual-lightbox-error{position:absolute;inset:0;display:none' in dom and '.visual-lightbox-error.show{display:flex}' in dom)
check("lightbox hidden class wins inside dialog", '#visual-lightbox .hidden{display:none}' in dom)
check("lightbox same-tab original link", '在当前标签查看原图' in dom and 'data-lightbox-open-current' in dom and 'data-lightbox-error-current' in dom)
check("lightbox single attempt validator", 'ATTEMPT_ID_RE' in dom and 'va-[a-f0-9]{20}' in dom and 'visualAssetUrl(attemptId)' in dom)


# ---- V2 受控工作台（render-page.mjs 顺带渲染到 /tmp/sparkos-wb-v2.html）----
v2src = "/tmp/sparkos-wb-v2.html"
if os.path.exists(v2src):
    dom2 = open(v2src, encoding="utf8").read()
    def check2(name, cond):
        global ok
        ok = ok and bool(cond)
        print(("OK  " if cond else "MISS ") + "[v2] " + name)
    check2("v2 alias title and brand", "SparkOS 统一工作台" in dom2 and "AI 编辑部" in dom2)
    check2("v2 sidebar 9 centers", all(x in dom2 for x in ["overview", "intel", "topics", "creation", "review", "visual", "publish", "growth", "system"]) and "data-nav=" in dom2)
    check2("v2 controlled-review declaration", "统一工作台" in dom2 and "视觉审核" in dom2 and "草稿审批" in dom2)
    # M7 统一工作台：V2 受控写端点 = 视觉 decision/retry、草稿 decision/revise、选题 editorial/decision、
    # 蒸馏 mutate + 待写回 writeback/remove、交付 delivery 与发布 publish（均仅在人工确认后 POST；publish 仅建台账）
    check2("v2 only controlled write endpoints (visual/draft/editorial/distill/writeback/delivery/publish)", "/sparkos/visual/decision" in dom2 and "/sparkos/visual/retry" in dom2 and "/sparkos/creation/decision" in dom2 and "/sparkos/creation/revise" in dom2 and "/sparkos/editorial/decision" in dom2 and "/sparkos/mutate" in dom2 and "/sparkos/writeback/remove" in dom2 and "/sparkos/visual/delivery" in dom2 and "/sparkos/publish" in dom2 and "/sparkos/visual/queue" not in dom2 and "data-editorial" not in dom2)
    check2("v2 no PUT/PATCH/DELETE and no native dialogs", '"PUT"' not in dom2 and "'PUT'" not in dom2 and '"PATCH"' not in dom2 and '"DELETE"' not in dom2 and 'window.open(' not in dom2 and 'alert(' not in dom2)
    check2("v2 lightbox with controlled urls", 'id="visual-lightbox"' in dom2 and 'ATTEMPT_ID_RE' in dom2 and '/sparkos/visual/asset?attemptId=' in dom2 and 'encodeURIComponent(attemptId)' in dom2)
    check2("v2 status color tokens", all(x in dom2 for x in ["--green", "--amber", "--red", "--blue", "--gray"]))
    check2("v2 responsive breakpoints", "max-width:1023px" in dom2 and "max-width:767px" in dom2)
    check2("v2 unified markers", "统一工作台" in dom2 and "发布仍需人工操作" in dom2)
    check2("v2 inline svg icons", dom2.count("<svg") >= 3 and all(x in dom2 for x in ["intel:[", "visual:[", "growth:[", "system:["]))
    check2("v2 reduced motion + focus visible", "prefers-reduced-motion" in dom2 and ":focus-visible" in dom2)
    check2("v2 escape handled", "==='Escape'" in dom2 or "'Escape'" in dom2)
else:
    print("SKIP v2 checks (no /tmp/sparkos-wb-v2.html)")
print("RESULT:", "PASS" if ok else "FAIL")
sys.exit(0 if ok else 1)
