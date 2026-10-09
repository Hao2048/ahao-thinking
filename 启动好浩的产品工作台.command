#!/bin/zsh
set -e
TASK_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$TASK_ROOT/apps/workbench"
NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" ]]; then
  echo "请安装 Node.js 24 或更新版本，并将 node 加入 PATH。"
  exit 1
fi
if [[ ! -x "$NODE_BIN" ]]; then
  echo "请先安装 Node.js 24 或更新版本。"
  exit 1
fi
export AIPM_OPEN_BROWSER=1
exec "$NODE_BIN" src/server.mjs
