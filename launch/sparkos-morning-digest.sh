#!/bin/bash
# SparkOS 晨会推送（launchd com.sparkos.morning-digest）
#
# 与 P4 的簇分析（com.sparkos.intel-analysis）关键区别：
#   **这个不需要 agent**。摘要是确定性代码从 VAULT 数据算出来的，不调 LLM、
#   不占会话、零 token。所以它可以直接跑，没有「空转白烧 token」的问题。
#
# 时线：07:30 com.sparkos.daily 跑内容循环 → 08:00 本任务推送晨会结论。
#
# 手动验证：
#   bash launch/sparkos-morning-digest.sh --dry-run   # 只打印不发送
set -uo pipefail

# 插件根：launchd 经 plist 注入；直接手跑时回退到脚本自身位置（不依赖占位符替换）
PLUGIN_ROOT="${SPARKOS_PLUGIN_ROOT:-}"
if [ -z "$PLUGIN_ROOT" ] || [ ! -d "$PLUGIN_ROOT" ]; then
  PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi
cd "$PLUGIN_ROOT" || { echo "FAIL: 找不到插件目录 $PLUGIN_ROOT"; exit 1; }

# launchd 的 PATH 极简，node 必须绝对路径
NODE_BIN="${NODE_BIN:-}"
if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
  for cand in "$HOME/.local/bin/node" "$(command -v node 2>/dev/null)" /opt/homebrew/bin/node /usr/local/bin/node; do
    if [ -n "${cand:-}" ] && [ -x "$cand" ]; then NODE_BIN="$cand"; break; fi
  done
fi
if [ -z "$NODE_BIN" ]; then echo "FAIL: 找不到 node"; exit 1; fi

PASSTHROUGH=""
if [ "${1:-}" = "--dry-run" ]; then PASSTHROUGH="--dry-run"; fi

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] launch: $NODE_BIN scripts/push-digest.mjs $PASSTHROUGH"
exec "$NODE_BIN" --experimental-strip-types scripts/push-digest.mjs $PASSTHROUGH
