#!/bin/bash
# 安装 SparkOS 晨会推送定时任务（launchd）。
#
#   bash launch/install-morning-digest.sh              # 安装并加载
#   bash launch/install-morning-digest.sh --uninstall
#
# 时间线：07:30 com.sparkos.daily 跑内容循环 → 08:00 本任务推送晨会结论到 Telegram。
# 不需要 agent（摘要是确定性代码），零 token。
#
# 数据目录与 src/vault.ts 相同：SPARKOS_VAULT_ROOT，否则 $DSH_HOME/sparkos，否则 ~/.dsh/sparkos。
# 下面这些变量若在安装前 export，会原样写进 plist；留空则任务里也不设个人路径：
#   SPARKOS_KNOWLEDGE_ROOT SPARKOS_CONTENTOS_ROOT SPARKOS_MEDIA_OS_ROOT
#   SPARKOS_DAILY_BRIEF_DIR SPARKOS_PERF_DIR SPARKOS_RUNTIME_DISTILL_QUEUE
#   SPARKOS_RUNTIME_EVENTS SPARKOS_ALPHA_ARCHIVE SPARKOS_HN_ARCHIVE
#   SPARKOS_HERMES_ARCHIVE SPARKOS_BAICAOTANG_ARCHIVE TELEGRAM_BRIDGE_DIR DSH_HOME
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=env.sh
source "$SCRIPT_DIR/env.sh"

PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VAULT_ROOT="$(resolve_vault)"
BRIDGE_DIR="$(opt_path "${TELEGRAM_BRIDGE_DIR:-}")"
LABEL="com.sparkos.morning-digest"
TARGET="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"

if [ "${1:-}" = "--uninstall" ]; then
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  rm -f "$TARGET"
  echo "已卸载 $LABEL"
  exit 0
fi

chmod +x "$PLUGIN_ROOT/launch/sparkos-morning-digest.sh"
mkdir -p "$VAULT_ROOT/system"

render_plist "$PLUGIN_ROOT/launch/$LABEL.plist.template" "$TARGET" \
  "__PLUGIN_ROOT__=$PLUGIN_ROOT" \
  "__HOME__=$HOME" \
  "__VAULT_ROOT__=$VAULT_ROOT" \
  "__BRIDGE_DIR__=$BRIDGE_DIR" \
  "__DSH_HOME__=$(opt_path "${DSH_HOME:-}")" \
  "__KNOWLEDGE_ROOT__=$(opt_path "${SPARKOS_KNOWLEDGE_ROOT:-}")" \
  "__CONTENTOS_ROOT__=$(opt_path "${SPARKOS_CONTENTOS_ROOT:-}")" \
  "__MEDIA_OS_ROOT__=$(opt_path "${SPARKOS_MEDIA_OS_ROOT:-}")" \
  "__DAILY_BRIEF_DIR__=$(opt_path "${SPARKOS_DAILY_BRIEF_DIR:-}")" \
  "__PERF_DIR__=$(opt_path "${SPARKOS_PERF_DIR:-}")" \
  "__DISTILL_QUEUE__=$(opt_path "${SPARKOS_RUNTIME_DISTILL_QUEUE:-}")" \
  "__EVENTS__=$(opt_path "${SPARKOS_RUNTIME_EVENTS:-}")" \
  "__ALPHA_ARCHIVE__=$(opt_path "${SPARKOS_ALPHA_ARCHIVE:-}")" \
  "__HN_ARCHIVE__=$(opt_path "${SPARKOS_HN_ARCHIVE:-}")" \
  "__HERMES_ARCHIVE__=$(opt_path "${SPARKOS_HERMES_ARCHIVE:-}")" \
  "__BAICAOTANG_ARCHIVE__=$(opt_path "${SPARKOS_BAICAOTANG_ARCHIVE:-}")"

launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$TARGET"

echo "已安装并加载 $LABEL"
echo "  脚本：$PLUGIN_ROOT/launch/sparkos-morning-digest.sh"
echo "  日志：$VAULT_ROOT/system/morning-digest.log"
if [ -n "$BRIDGE_DIR" ]; then
  echo "  桥接：已写入 TELEGRAM_BRIDGE_DIR"
else
  echo "  桥接：未设置 TELEGRAM_BRIDGE_DIR（可改用 TELEGRAM_BOT_TOKEN + SPARKOS_PUSH_CHAT_ID）"
fi
launchctl list | grep "$LABEL" || true
