#!/bin/bash
# SparkOS 情报簇分析 · 定时唤起 agent（launchd com.sparkos.intel-analysis）
#
# 设计要点：
#   1. 插件不调 LLM（红线）→ 簇分析必须由 agent 做 → 只能靠 launchd 唤起 headless 会话。
#   2. 先查 T0 队列再决定是否唤起：**agent 会话本身也要花 token**，
#      没有 T0 候选就跳过，避免空转一天白烧一次。
#   3. T0 由插件在 09:30 融合时筛好（跨源优先 + 真实热度，上限 8 条），
#      agent 只消费有界工作量，不做全量 30+ 簇分析。
#
# 退出码：0=正常（含跳过）；非 0 表示队列文件损坏等异常。
set -uo pipefail

PLUGIN_ROOT="${SPARKOS_PLUGIN_ROOT:-__PLUGIN_ROOT__}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=env.sh
source "$SCRIPT_DIR/env.sh"
VAULT="$(resolve_vault)"
if [ -n "${DSH_CLI:-}" ]; then
  DSH_CLI="$(opt_path "$DSH_CLI")"
fi
ANALYZE_DIR="$VAULT/ops-intel/clusters"

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }

ANALYZE="$(ls -t "$ANALYZE_DIR"/analyze-*.json 2>/dev/null | head -1 || true)"
if [ -z "${ANALYZE:-}" ]; then
  log "skip: 没有 analyze-*.json（由插件在 09:30 融合时生成）"
  exit 0
fi

# 只认当天队列：拿旧队列去分析等于重复消费 token
STAMP="$(date +%Y%m%d)"
case "$(basename "$ANALYZE")" in
  "analyze-$STAMP.json") ;;
  *) log "skip: 最新队列 $(basename "$ANALYZE") 不是今天的（$STAMP）"; exit 0 ;;
esac

T0="$(/usr/bin/python3 -c "import json,sys;print(len(json.load(open(sys.argv[1])).get('t0') or []))" "$ANALYZE" 2>/dev/null || echo 0)"
if [ "${T0:-0}" -eq 0 ]; then
  log "skip: t0 为空（$ANALYZE）—— 当日无新稿或已全部提交，不唤起 agent"
  exit 0
fi

if [ -z "${DSH_CLI:-}" ] || { [ ! -x "$DSH_CLI" ] && [ ! -f "$DSH_CLI" ]; }; then
  log "FAIL: 未设置或不存在 DSH_CLI（指向 dsh-cli.sh，没有默认路径）"
  exit 1
fi

log "spawn agent: t0=$T0 file=$ANALYZE"

# 干跑：只打印决策不唤起 agent（用于验证调度链路，不花 token）
if [ "${SPARKOS_DRY_RUN:-0}" = "1" ]; then
  log "dry-run: 跳过唤起（去掉 SPARKOS_DRY_RUN=1 即真跑）"
  exit 0
fi

exec /bin/bash "$DSH_CLI" "情报簇分析（T0 限定，控制上下文成本）。
1) 读 $ANALYZE 的 t0 数组（共 $T0 条，插件已按「跨源优先 + 真实热度」筛好）。pending 是完整清单，本次**不要**全量处理。
2) 按 ~/.dsh/skills/sparkos-intel-cluster-analysis.md 的规则逐簇分析 t0，补 topic / coreFacts / novelty / knowledgeCards / credibility / risks / platforms / angleSuggestions / judgment；知识卡必须真实存在（obs://NNN、model://NNN 能在 spark-notes 找到）；规则字段 clusterId / date / heat / sourceCount / evidenceUrls / eventKeys 只读。
3) 每簇用 sparkos_run {action:\"intel\", payload:{submitCluster:<簇对象>}} 提交；validateCluster FAIL 必须修复后重提，不许跳过。
4) 全部提交后跑 sparkos_run {action:\"intel\", payload:{rank:true}} 刷新每日 Top5。
5) 收尾只报告：成功提交 N 簇 / 失败 M 簇 / Top5 首位主题。"
