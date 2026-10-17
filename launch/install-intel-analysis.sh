#!/bin/bash
# 安装 SparkOS 情报簇分析定时任务（launchd）。
#
#   bash launch/install-intel-analysis.sh          # 安装并加载
#   bash launch/install-intel-analysis.sh --uninstall
#
# 把模板里的占位符渲染成当时的环境变量后写入 ~/Library/LaunchAgents/ 并 launchctl 加载。
# 时间线：09:30 插件融合+生成 T0 队列 → 10:00 唤起 agent。
#
# 数据目录与 src/vault.ts 相同：SPARKOS_VAULT_ROOT，否则 $DSH_HOME/sparkos，否则 ~/.dsh/sparkos。
# DSH_CLI 没有默认路径，唤起 agent 前必须已设置。其余 SPARKOS_* 留空则不设个人路径。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=env.sh
source "$SCRIPT_DIR/env.sh"

PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VAULT_ROOT="$(resolve_vault)"
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

render_plist "$PLUGIN_ROOT/launch/$LABEL.plist.template" "$TARGET" \
  "__PLUGIN_ROOT__=$PLUGIN_ROOT" \
  "__VAULT_ROOT__=$VAULT_ROOT" \
  "__DSH_CLI__=$(opt_path "${DSH_CLI:-}")" \
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

# 幂等：已加载则先卸载再装，避免 bootstrap 报 already loaded
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$TARGET"

echo "已安装并加载 $LABEL"
echo "  脚本：$PLUGIN_ROOT/launch/sparkos-intel-analysis.sh"
echo "  日志：$VAULT_ROOT/system/intel-analysis.log"
if [ -z "${DSH_CLI:-}" ]; then
  echo "  DSH_CLI 未设置：队列非空时任务会失败，安装前请 export DSH_CLI"
fi
launchctl list | grep "$LABEL" || true
