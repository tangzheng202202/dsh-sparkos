#!/usr/bin/env python3
"""P1 剩余项 DOM 断言：全部 10 主线渲染 + 蒸馏条目出现/消失双向检查。"""
import subprocess, sys

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
src = sys.argv[1] if len(sys.argv) > 1 else "/tmp/sparkos-wb.html"
dom = subprocess.run([CHROME, "--headless", "--disable-gpu", "--dump-dom", "file://" + src],
                     capture_output=True, text=True, timeout=60).stdout

LINES = [
    "产品化门槛", "Agent 长出品味", "平台空心化", "认知缴械量化", "三线作战",
    "开放权重战略共识", "能力通胀的三重反噬", "开放权重的反攻", "防御日常化", "共识凝聚",
]
ok = True
for kw in LINES:
    hit = kw in dom
    ok = ok and hit
    print(("OK 主线 " if hit else "MISS 主线 ") + kw)

# 蒸馏条目：干净条目与违规条目都应在待审列表出现
for kw in ["2026-08-20-clean.md", "2026-08-20-danger.md", "采纳（过四红线）", "驳回"]:
    hit = kw in dom
    ok = ok and hit
    print(("OK 蒸馏 " if hit else "MISS 蒸馏 ") + kw)

# 应消失项：蒸馏区不得再用旧占位（草稿空态出现是合法的）
distill_section = dom.split('id="distillBody"')[1].split('id="sourcesBody"')[0] if 'id="distillBody"' in dom else dom
for bad in ["暂无数据（待子命令产出）"]:
    gone = bad not in distill_section
    ok = ok and gone
    print(("OK 已消失 " if gone else "FAIL 残留 ") + bad + "（蒸馏区）")

# 渲染泳道数（排除 script 源码内模板字符串）
rendered = dom.count('class="swim"') - 1
print("rendered swim rows:", rendered)
ok = ok and rendered == 10
print("RESULT:", "PASS" if ok else "FAIL")
sys.exit(0 if ok else 1)
