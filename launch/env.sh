# 数据目录与 plist 渲染。安装脚本和定时脚本共用。
# 优先级与 src/vault.ts 一致：SPARKOS_VAULT_ROOT → $DSH_HOME/sparkos → ~/.dsh/sparkos。
# 不探测、不回落到任何个人目录。

expand_home() {
  local raw=$1
  case "$raw" in
    '~') printf '%s' "$HOME" ;;
    '~/'*) printf '%s' "$HOME/${raw#~/}" ;;
    *) printf '%s' "$raw" ;;
  esac
}

abspath() {
  python3 -c 'import os,sys; print(os.path.abspath(sys.argv[1]))' "$1"
}

# 可选路径：空串保持空串；否则展开 ~ 并变成绝对路径。
opt_path() {
  local raw=${1:-}
  if [ -z "$raw" ]; then
    printf ''
    return
  fi
  abspath "$(expand_home "$raw")"
}

resolve_vault() {
  local raw base
  if [ -n "${SPARKOS_VAULT_ROOT:-}" ]; then
    raw="$(expand_home "$SPARKOS_VAULT_ROOT")"
  else
    base="${DSH_HOME:-$HOME/.dsh}"
    base="$(expand_home "$base")"
    raw="$base/sparkos"
  fi
  abspath "$raw"
}

# 按字面替换 __PLACEHOLDER__。值先做 XML 转义，不经过 sed，因此 | & \ < > 都安全。
render_plist() {
  local src=$1 dest=$2
  shift 2
  python3 - "$src" "$dest" "$@" <<'PY'
import html, sys
from pathlib import Path
src, dest, *pairs = sys.argv[1:]
text = Path(src).read_text()
for pair in pairs:
    key, sep, val = pair.partition("=")
    if sep != "=":
        raise SystemExit("expected KEY=VALUE")
    text = text.replace(key, html.escape(val, quote=False))
Path(dest).write_text(text)
PY
}
