#!/usr/bin/env python3
"""
Chrome headless DOM 冒烟检查。

产物由 `node scripts/render-page.mjs`（无位置参数时）生成：
  /tmp/sparkos-wb-brief.html    ← src/server/page.template.html   （默认入口 /sparkos/app）
  /tmp/sparkos-wb-factory.html  ← src/server/factory.template.html（mode=full 才可达）

2026-09-10 修复：本脚本此前在 08-30 降级后仍断言工厂模板特性，而 render-page.mjs
默认渲染的是简报台模板 → `npm run test:dom` 长期恒 FAIL（假红），且工厂页失去了 DOM 覆盖。
现在两页各自断言。

用法：python3 scripts/dom-check.py [/tmp/sparkos-wb-brief.html]
"""
import os
import re
import subprocess
import sys

CHROME = os.environ.get("SPARKOS_TEST_CHROME") or (
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    if os.path.exists("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    else "/usr/bin/google-chrome"
)

ok = True


def check(name, cond, tag=""):
    global ok
    ok = ok and bool(cond)
    print(("OK   " if cond else "MISS ") + tag + name)


def dump_dom(path):
    """渲染 file:// 页面并返回 DOM 文本；Chrome 缺失或渲染失败返回 None。"""
    if not os.path.exists(path):
        return None
    if not os.path.exists(CHROME):
        print("SKIP: Chrome not found at " + CHROME)
        return None
    try:
        proc = subprocess.run(
            [CHROME, "--headless", "--disable-gpu", "--dump-dom", "file://" + path],
            capture_output=True, text=True, timeout=90,
        )
    except subprocess.TimeoutExpired:
        print("MISS Chrome 渲染超时：" + path)
        return None
    return proc.stdout or ""


# ============================================================ 简报台（默认入口）
brief = sys.argv[1] if len(sys.argv) > 1 else "/tmp/sparkos-wb-brief.html"
dom = dump_dom(brief)
if dom is None:
    print("MISS 简报台产物缺失或不可渲染：" + brief)
    ok = False
else:
    # 1. 首屏三个问题（本页的存在意义）
    for kw in ["SparkOS 简报台", "今日晨会", "今天该发什么", "今天可以写什么",
               "底层必读事件", "需要你动手", "今天哪条线在升温", "水位", "补卡清单"]:
        check("keyword " + kw, kw in dom, "[brief] ")

    # 2. 六个面板编号齐备
    panels = re.findall(r'<span class="num">(\d\d)</span>', dom)
    check("六个面板编号 01-06 齐备", panels == ["01", "02", "03", "04", "05", "06"], "[brief] ")
    check("排期区渲染（含空态兜底）",
          'id="schedule"' in dom and "sched-note" in dom and ("今日排期" in dom or "没有安排" in dom),
          "[brief] ")

    # 3. 数据钩子：每个决策都真的有出口
    for hook in ['data-mr="adopt"', 'data-mr="ignore"', "data-mr-id=", "data-take=",
                 "data-hook-copy=", "data-todo=", "data-copy-phrase=", "data-rt-toggle=",
                 "data-rt-copy-file=", "data-wb-remove=", "data-ds=", "data-card-copy="]:
        check("数据钩子 " + hook, hook in dom, "[brief] ")
    check("取用这篇文案", "取用这篇" in dom, "[brief] ")

    # 4. 只允许的写端点（简报台不做工厂动作）
    check("mutate 端点存在", "/sparkos/mutate" in dom, "[brief] ")
    check("草稿读取端点存在", "/sparkos/draft?file=" in dom, "[brief] ")
    check("待写回移除端点存在", "/sparkos/writeback/remove" in dom, "[brief] ")
    for forbidden in ["/sparkos/visual/decision", "/sparkos/visual/retry", "/sparkos/creation/decision",
                      "/sparkos/creation/revise", "/sparkos/editorial/decision", "/sparkos/visual/delivery",
                      "/sparkos/publish", "/sparkos/visual/queue", "visual-lightbox"]:
        check("不含工厂端点 " + forbidden, forbidden not in dom, "[brief] ")

    # 5. 折叠：长文本默认收起，首屏不被日志占据
    check("四个折叠抽屉", dom.count("<details>") == 4, "[brief] ")
    check("抽屉默认收起", "<details open" not in dom, "[brief] ")
    check("原始简报折叠标注", "原始简报全文" in dom and "默认收起" in dom, "[brief] ")
    check("系统建议标注守卫", "守卫" in dom, "[brief] ")

    # 6. 只读红线表述
    check("media-os 只读声明", "永久只读" in dom, "[brief] ")
    check("发布由人工执行声明", "发布动作永远由人" in dom or "平台后台执行" in dom, "[brief] ")

    # 7. 主题与响应式（品牌蓝图色板）
    check("蓝图色板 token",
          all(t in dom for t in ["--bg:#0B2545", "--ink:#E0FBFC", "--accent:#3BF4FB", "--warn:#FFB703"]),
          "[brief] ")
    check("响应式断点", "max-width:940px" in dom, "[brief] ")

# ============================================================ 工厂工作台（mode=full）
factory_dom = dump_dom("/tmp/sparkos-wb-factory.html")
if factory_dom is None:
    print("SKIP factory checks (no renderable /tmp/sparkos-wb-factory.html)")
else:
    for kw in ["SparkOS 统一工作台", "每日简报", "叙事主线", "时间线知识卡", "当日必读",
               "运行时草稿", "来源注册表", "融合产物", "下发建议", "归档计数",
               "情报簇", "每日 Top 5", "系统建议", "信源健康", "待写回"]:
        check("keyword " + kw, kw in factory_dom, "[factory] ")

    check("must_reads adopt/ignore",
          'data-mr-decide="adopt"' in factory_dom and 'data-mr-decide="ignore"' in factory_dom, "[factory] ")
    check("must_reads 走 mutate", "kind:'topic'" in factory_dom and "/sparkos/mutate" in factory_dom, "[factory] ")
    check("runtime draft viewer", "data-rt-draft" in factory_dom and "/sparkos/draft?file=" in factory_dom, "[factory] ")
    check("timeline search filter", "data-tl-q" in factory_dom, "[factory] ")
    check("editorial decision endpoint", "/sparkos/editorial/decision" in factory_dom, "[factory] ")
    check("distill adopt via mutate", "data-distill-decide" in factory_dom, "[factory] ")
    check("writeback remove endpoint", "/sparkos/writeback/remove" in factory_dom, "[factory] ")
    check("brief markdown safe render", "renderBriefMd" in factory_dom, "[factory] ")
    check("perf 区块有内容（空态或数据）",
          "尚未接入真实平台表现数据" in factory_dom or "发布表现" in factory_dom, "[factory] ")
    check("无 queue 写端点", "/sparkos/visual/queue" not in factory_dom, "[factory] ")
    check("visual task cards", "data-vis-task" in factory_dom or "visualRetryInfo" in factory_dom, "[factory] ")
    check("visual 审核动作齐备",
          "批准图片" in factory_dom and "驳回图片" in factory_dom and "按意见重试" in factory_dom, "[factory] ")
    check("visual 驳回意见必填", "驳回意见（必填）" in factory_dom and "确认驳回" in factory_dom, "[factory] ")
    check("lightbox dialog markup",
          'id="visual-lightbox"' in factory_dom and 'role="dialog"' in factory_dom, "[factory] ")
    check("lightbox 全套控件",
          all(x in factory_dom for x in ["data-lightbox-close", "data-lightbox-backdrop",
                                         "data-lightbox-prev", "data-lightbox-next"]), "[factory] ")
    check("lightbox 原始链接用系统 attemptId", "/sparkos/visual/asset?attemptId=" in factory_dom, "[factory] ")
    check("lightbox 防原生弹窗", "window.open(" not in factory_dom, "[factory] ")
    check("testOnly 闸门文案", "测试图片（stub）" in factory_dom, "[factory] ")

# ============================================================ 全页通用红线
for tag, text in (("[brief] ", dom), ("[factory] ", factory_dom)):
    if not text:
        continue
    check("无原生弹窗", all(x not in text for x in ["window.prompt(", "window.alert(", "window.confirm("]), tag)
    check("无 PUT/PATCH/DELETE 声明", all(x not in text for x in ['"PUT"', "'PUT'", '"PATCH"', '"DELETE"']), tag)
    check("按钮均显式声明 type", re.search(r"<button(?![^>]*type=)", text) is None, tag)
    check("注入文本走 esc()", "esc(" in text, tag)

print("RESULT:", "PASS" if ok else "FAIL")
sys.exit(0 if ok else 1)
