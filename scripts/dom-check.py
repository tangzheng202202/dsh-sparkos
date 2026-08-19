#!/usr/bin/env python3
"""Chrome headless DOM 渲染检查（P1 验收习惯：关键词断言）。"""
import subprocess, sys

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
src = sys.argv[1] if len(sys.argv) > 1 else "/tmp/sparkos-wb.html"
dom = subprocess.run([CHROME, "--headless", "--disable-gpu", "--dump-dom", "file://" + src],
                     capture_output=True, text=True, timeout=60).stdout
ok = True
for kw in ["今日简报", "叙事主线", "选题推荐", "草稿工作区", "知识卡", "信息源", "发布表现", "系统建议",
           "SparkOS 工作台", "泳道", "蒸馏审核"]:
    hit = kw in dom
    ok = ok and hit
    print(("OK " if hit else "MISS ") + kw)
print("swim rows:", dom.count('class="swim"'))
print("table rows:", dom.count("<tr>"))
print("active nav:", dom.count('class="nav-tab active"'))
print("RESULT:", "PASS" if ok and dom.count('class="swim"') >= 5 and dom.count("<tr>") >= 70 else "FAIL")
