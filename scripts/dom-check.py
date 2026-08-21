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
           "信息源", "发布表现", "系统建议", "情报源健康", "情报簇", "下发建议"]:
    check("keyword " + kw, kw in dom)

# 结构断言
check("swim rows >= 5", dom.count('class="swim"') >= 5)
check("table rows >= 60", dom.count("<tr>") >= 60)
check("stats has 今日必读", "今日必读" in dom)
check("topic rows rendered (real daily data)", dom.count('class="topic-row"') >= 1)
check("nav centers = 5", dom.count('class="nav-tab') >= 5)
print("RESULT:", "PASS" if ok else "FAIL")
sys.exit(0 if ok else 1)