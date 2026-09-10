#!/bin/bash
# 安装 SparkOS 晨会推送定时任务（launchd）。
#
#   bash launch/install-morning-digest.sh              # 安装并加载
#   bash launch/install-morning-digest.sh --uninstall
#
# 时间线：07:30 com.sparkos.daily 跑内容循环 → 08:00 本任务推送晨会结论到 Telegram。
# 不需要 agent（摘要是确定性代码），零 token。
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VAULT_ROOT="${SPARKOS_VAULT_ROOT:-$HOME/DeepSeek harness/sparkos}"
BRIDGE_DIR="${TELEGRAM_BRIDGE_DIR:-$HOME/DeepSeek harness/telegram-bridge}"
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

sed -e "s|__PLUGIN_ROOT__|$PLUGIN_ROOT|g" \
    -e "s|__VAULT_ROOT__|$VAULT_ROOT|g" \
    -e "s|__BRIDGE_DIR__|$BRIDGE_DIR|g" \
  "$PLUGIN_ROOT/launch/$LABEL.plist.template" > "$TARGET"

launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$TARGET"

echo "已安装并加载 $LABEL"
echo "  脚本：$PLUGIN_ROOT/launch/sparkos-morning-digest.sh"
echo "  日志：$VAULT_ROOT/system/morning-digest.log"
echo "  桥接：$BRIDGE_DIR"
launchctl list | grep "$LABEL" || true
