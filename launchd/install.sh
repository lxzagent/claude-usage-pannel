#!/usr/bin/env bash
# 安装/更新 claude-usage 开机自启 LaunchAgent。
# 按本机 node 路径与仓库实际位置动态生成 plist，避免硬编码到别的机器（防"照抄就坏"）。
#   安装/更新/重启:  bash launchd/install.sh
#   卸载:           launchctl bootout gui/$(id -u)/com.lxz.claude-usage 2>/dev/null; rm ~/Library/LaunchAgents/com.lxz.claude-usage.plist
#   日志:           /tmp/claude-usage.out.log  /tmp/claude-usage.err.log
set -euo pipefail

LABEL="com.lxz.claude-usage"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE="$REPO/launchd/$LABEL.plist"
PLIST_DST="$HOME/Library/LaunchAgents/$LABEL.plist"

NODE="$(command -v node || true)"
[ -z "$NODE" ] && { echo "❌ 找不到 node，请先装 node 或把它加进 PATH"; exit 1; }
NODE_DIR="$(dirname "$NODE")"
SERVER_JS="$REPO/dist/server.js"

# 没构建过先构建（dist/server.js 是服务入口）
if [ ! -f "$SERVER_JS" ]; then
  echo "dist/server.js 不存在，先 npm run build…"
  (cd "$REPO" && npm run build)
fi

mkdir -p "$HOME/Library/LaunchAgents"
# 用 | 作分隔符（路径不含 |）；占位符替换后写入目标
sed -e "s|__NODE__|$NODE|g" \
    -e "s|__NODE_DIR__|$NODE_DIR|g" \
    -e "s|__REPO__|$REPO|g" \
    -e "s|__HOME__|$HOME|g" \
    "$TEMPLATE" > "$PLIST_DST"

echo "已生成 $PLIST_DST"
echo "  node   = $NODE"
echo "  server = $SERVER_JS"

# 重新加载（先 bootout 再 bootstrap，兼容首装与已加载两种情况），再强制重启拉起最新代码
DOMAIN="gui/$(id -u)"
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$PLIST_DST"
launchctl enable "$DOMAIN/$LABEL"
launchctl kickstart -k "$DOMAIN/$LABEL"

echo "✅ 已加载并启动。验证："
sleep 1
if lsof -nP -iTCP:4317 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "✅ 127.0.0.1:4317 正在监听"
else
  echo "⏳ node 正在启动，几秒后用 'curl -s http://127.0.0.1:4317/api/stats' 验证"
fi
