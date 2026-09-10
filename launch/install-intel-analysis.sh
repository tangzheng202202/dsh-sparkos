#!/bin/bash
# 安装 SparkOS 情报簇分析定时任务（launchd）。
#
#   bash launch/install-intel-analysis.sh          # 安装并加载
#   bash launch/install-intel-analysis.sh --uninstall
#
# 把模板里的 __PLUGIN_ROOT__ / __VAULT_ROOT__ 渲染成真实路径后写入
# ~/Library/LaunchAgents/ 并 launchctl 加载。时间线：09:30 插件融合+生成 T0 队列 → 10:00 唤起 agent。
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VAULT_ROOT="${SPARKOS_VAULT_ROOT:-$HOME/DeepSeek harness/sparkos}"
LABEL="com.sparkos.intel-analysis"
TARGET="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"

if [ "${1:-}" = "--uninstall" ]; then
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  rm -f "$TARGET"
  echo "已卸载 $LABEL"
  exit 0
fi

chmod +x "$PLUGIN_ROOT/launch/sparkos-intel-analysis.sh"
mkdir -p "$VAULT_ROOT/system"

sed -e "s|__PLUGIN_ROOT__|$PLUGIN_ROOT|g" -e "s|__VAULT_ROOT__|$VAULT_ROOT|g" \
  "$PLUGIN_ROOT/launch/$LABEL.plist.template" > "$TARGET"

# 幂等：已加载则先卸载再装，避免 bootstrap 报 already loaded
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$TARGET"

echo "已安装并加载 $LABEL"
echo "  脚本：$PLUGIN_ROOT/launch/sparkos-intel-analysis.sh"
echo "  日志：$VAULT_ROOT/system/intel-analysis.log"
launchctl list | grep "$LABEL" || true
