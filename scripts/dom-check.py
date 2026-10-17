#!/usr/bin/env python3
"""Chrome headless DOM checks.

Usage: python3 scripts/dom-check.py brief|full <html>

brief checks the default desk. full checks the factory template
rendered with scripts/render-page.mjs --factory.
"""
import os
import re
import subprocess
import sys

CANDIDATES = [
    os.environ.get("SPARKOS_TEST_CHROME"),
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
]
CHROME = next((p for p in CANDIDATES if p and os.path.exists(p)), None)

if len(sys.argv) < 3 or sys.argv[1] not in ("brief", "full"):
    print("usage: python3 scripts/dom-check.py brief|full <html>")
    sys.exit(2)
mode = sys.argv[1]
src = sys.argv[2]
if CHROME is None:
    print("SKIP: Chrome not found")
    sys.exit(0)
if not os.path.exists(src):
    print("MISS html file " + src)
    sys.exit(1)

dom = subprocess.run(
    [CHROME, "--headless", "--disable-gpu", "--dump-dom", "file://" + src],
    capture_output=True, text=True, timeout=60,
).stdout
ok = True

def check(name, cond):
    global ok
    ok = ok and bool(cond)
    print(("OK  " if cond else "MISS ") + name)

if mode == "brief":
    for kw in ["SparkOS 简报台", "每日简报", "当日必读", "运行时草稿", "蒸馏队列", "待写回"]:
        check("keyword " + kw, kw in dom)
    check("must_reads adopt posts to /sparkos/mutate", 'data-mr="adopt"' in dom and "/sparkos/mutate" in dom)
    check("missing brief is a warning", "还没有简报" in dom)
    check("unconfigured intel is not a red pill", "情报源未配置" in dom)
    check("factory writes say 410", "410" in dom)
    check("no native prompt", "window.prompt(" not in dom and "window.alert(" not in dom and "window.confirm(" not in dom)
    check("browser requests send cookies", "credentials = 'include'" in dom)
else:
    for kw in ["SparkOS 统一工作台", "每日简报", "叙事主线", "时间线知识卡", "当日必读",
               "运行时草稿", "来源注册表", "融合产物", "下发建议", "归档计数",
               "情报簇", "每日 Top 5", "系统建议", "信源健康", "待写回"]:
        check("keyword " + kw, kw in dom)
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
    check("rendered buttons have explicit type", re.search(r"<button(?![^>]*type=)", dom) is None)
    check("visual test-only gate", "测试图片（stub）" in dom and "readyForPublication" in dom)
    check("visual review note escaped in template source", ("esc(t.reviewNote)" in dom) or ("esc(p.reviewNote)" in dom))
    check("visual prompt escaped via esc", "esc(t.prompt)" in dom or "esc(a.prompt)" in dom or "altText" in dom)
    check("visual lightbox dialog markup", 'id="visual-lightbox"' in dom and 'role="dialog"' in dom and 'aria-modal="true"' in dom)
    check("visual thumbnails are buttons", "data-visual-thumb" in dom)
    check("lightbox close/backdrop/nav controls", 'data-lightbox-close' in dom and 'data-lightbox-backdrop' in dom and 'data-lightbox-prev' in dom and 'data-lightbox-next' in dom)
    check("lightbox escape and arrow keys", 'Escape' in dom and 'ArrowLeft' in dom)
    check("lightbox avoids native dialogs", 'window.open(' not in dom and 'alert(' not in dom)
    check("lightbox body scroll lock", 'modal-open' in dom)
    check("lightbox original link uses system attemptId", '/sparkos/visual/asset?attemptId=' in dom)
    check("lightbox error overlay hidden by default", '.visual-lightbox-error{position:absolute;inset:0;display:none' in dom and '.visual-lightbox-error.show{display:flex}' in dom)
    check("lightbox hidden class wins inside dialog", '#visual-lightbox .hidden{display:none}' in dom)
    check("lightbox same-tab original link", '在当前标签查看原图' in dom and 'data-lightbox-open-current' in dom and 'data-lightbox-error-current' in dom)
    check("lightbox single attempt validator", 'ATTEMPT_ID_RE' in dom and 'va-[a-f0-9]{20}' in dom and 'visualAssetUrl(attemptId)' in dom)
    check("full title and brand", "SparkOS 统一工作台" in dom and "AI 编辑部" in dom)
    check("sidebar centers", all(x in dom for x in ["overview", "intel", "topics", "creation", "review", "visual", "publish", "growth", "system"]) and "data-nav=" in dom)
    check("controlled write endpoints", "/sparkos/visual/decision" in dom and "/sparkos/visual/retry" in dom and "/sparkos/creation/decision" in dom and "/sparkos/creation/revise" in dom and "/sparkos/editorial/decision" in dom and "/sparkos/mutate" in dom and "/sparkos/writeback/remove" in dom and "/sparkos/visual/delivery" in dom and "/sparkos/publish" in dom and "/sparkos/visual/queue" not in dom and "data-editorial" not in dom)
    check("no PUT/PATCH/DELETE and no native dialogs", '"PUT"' not in dom and "'PUT'" not in dom and '"PATCH"' not in dom and '"DELETE"' not in dom and 'window.open(' not in dom and 'alert(' not in dom)
    check("does not auto publish", "不会自动发布" in dom)
    check("status color tokens", all(x in dom for x in ["--green", "--amber", "--red", "--blue", "--gray"]))
    check("responsive breakpoints", "max-width:1023px" in dom and "max-width:767px" in dom)
    check("manual publish marker", "发布仍需人工操作" in dom)
    check("inline svg icons", dom.count("<svg") >= 3 and all(x in dom for x in ["intel:[", "visual:[", "growth:[", "system:["]))
    check("reduced motion + focus visible", "prefers-reduced-motion" in dom and ":focus-visible" in dom)
    check("escape handled", "==='Escape'" in dom or "'Escape'" in dom)
    check("browser requests send cookies", "credentials='include'" in dom)

print("RESULT:", "PASS" if ok else "FAIL")
sys.exit(0 if ok else 1)
