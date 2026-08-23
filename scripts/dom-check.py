#!/usr/bin/env python3
"""Chrome headless DOM 渲染检查（工作台升级后断言集：真实每日产物渲染）。"""
import subprocess, sys, os

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
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

for kw in ["SparkOS 工作台", "今日中心", "情报中心", "创作中心", "审核中心", "增长中心",
           "今日简报", "叙事主线", "选题推荐", "草稿工作区", "蒸馏审核", "待写回",
           "信息源", "发布表现", "系统建议", "情报源健康", "每日 Top 5", "情报簇", "下发建议"]:
    check("keyword " + kw, kw in dom)

# 结构断言
check("swim rows >= 5", dom.count('class="swim"') >= 5)
check("table rows >= 60", dom.count("<tr>") >= 60)
check("stats has 今日必读", "今日必读" in dom)
check("topic rows rendered (real daily data)", dom.count('class="topic-row"') >= 1)
check("nav centers = 5", dom.count('class="nav-tab') >= 5)
check("real perf empty state", "暂无真实发布表现数据" in dom)
check("rejected draft review note", "驳回意见：需要重写开头" in dom)
check("v2 parent review note", "父版本驳回意见：需要重写开头" in dom)
check("reject requires prompt", "请输入驳回草稿的审核意见（必填）" in dom)
check("reject cancel or blank stops submit", "input===null||!input.trim())return" in dom)
check("reject request carries note", "if(note)body.note=note" in dom)
check("visual asset cards", dom.count('class="visual-asset"') >= 2)
check("visual approve action", "批准图片" in dom)
check("visual reject action", "驳回图片" in dom)
check("visual retry action", "按意见重试" in dom)
check("visual inline review controls", "驳回意见（必填）" in dom and "确认驳回" in dom and "取消" in dom)
check("visual review avoids native prompt", 'window.prompt("请输入驳回图片' not in dom)
check("visual error feedback", 'class=\"visual-feedback error\"' in dom or 'visual-feedback error' in dom)
check("rendered buttons have explicit type", '<button class=' not in dom)
check("visual test-only gate", "测试图片，不可发布" in dom and "readyForPublication=false" in dom)
check("visual review note escaped", "&lt;img src=x onerror=reviewAttack()&gt;" in dom and '<img src="x" onerror="reviewAttack()">' not in dom)
check("visual prompt escaped", "&lt;b&gt;必须转义的提示词&lt;/b&gt;" in dom)
print("RESULT:", "PASS" if ok else "FAIL")
sys.exit(0 if ok else 1)
