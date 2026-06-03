#!/usr/bin/env bash
# 在远端 SSH 主机安装 statusline 记录器并包裹其 statusline，
# 使该主机的上下文窗口大小（200k/1M）对面板精确可见。
#
#   用法:  bash statusline/install-remote.sh <ssh-host>
#   还原:  ssh <ssh-host> 'cp ~/.claude/settings.json.cu-bak ~/.claude/settings.json'
#
# 远端 collector 在远端 node 上执行，读远端 ~/.config/claude-usage/context-cache/。
# 装好后远端每次 statusline 刷新会把精确窗口写进该缓存；没装则面板自动回退启发式。
set -euo pipefail
HOST="${1:?用法: bash statusline/install-remote.sh <ssh-host>}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_REC="$SCRIPT_DIR/record.mjs"
[ -f "$LOCAL_REC" ] || { echo "缺少 $LOCAL_REC"; exit 1; }

echo "[1/5] 探测远端 node 路径..."
RNODE=$(ssh "$HOST" 'command -v node 2>/dev/null || ls /opt/homebrew/opt/node@22/bin/node /usr/local/bin/node 2>/dev/null | head -1' | tail -1)
[ -n "$RNODE" ] || { echo "远端找不到 node"; exit 1; }
echo "      远端 node = $RNODE"

echo "[2/5] 部署记录器到远端 ~/.config/claude-usage/ ..."
ssh "$HOST" 'mkdir -p ~/.config/claude-usage/context-cache'
ssh "$HOST" 'cat > ~/.config/claude-usage/statusline-record.mjs' < "$LOCAL_REC"

echo "[3/5] 备份远端 settings.json + 保存其原 statusLine 命令..."
ssh "$HOST" 'cp ~/.claude/settings.json ~/.claude/settings.json.cu-bak'
ssh "$HOST" 'node -e "const fs=require(\"fs\"),p=process.env.HOME+\"/.claude/settings.json\",j=JSON.parse(fs.readFileSync(p,\"utf8\"));const c=j.statusLine&&j.statusLine.command;if(!c){console.error(\"远端无 statusLine.command\");process.exit(1)}if(/statusline\\.sh/.test(c)){console.log(\"      已是包裹器，保留既有 orig-command.txt（防递归）\");process.exit(0)}fs.writeFileSync(process.env.HOME+\"/.config/claude-usage/statusline.orig-command.txt\",c+\"\n\")"'

echo "[4/5] 写远端透传包裹器 statusline.sh（node=$RNODE）..."
cat <<EOF | ssh "$HOST" 'cat > ~/.config/claude-usage/statusline.sh'
#!/usr/bin/env bash
# claude-usage 透传包裹 statusline（远端）。还原: cp ~/.claude/settings.json.cu-bak ~/.claude/settings.json
NODE=$RNODE
REC="\$HOME/.config/claude-usage/statusline-record.mjs"
ORIG_FILE="\$HOME/.config/claude-usage/statusline.orig-command.txt"
input="\$(cat)"
printf '%s' "\$input" | "\$NODE" "\$REC" >/dev/null 2>&1 &
[ -r "\$ORIG_FILE" ] && printf '%s' "\$input" | eval "\$(cat "\$ORIG_FILE")"
EOF

echo "[5/5] 切换远端 statusLine.command → 包裹器..."
ssh "$HOST" 'node -e "const fs=require(\"fs\"),p=process.env.HOME+\"/.claude/settings.json\",j=JSON.parse(fs.readFileSync(p,\"utf8\"));j.statusLine.command=\"bash \"+process.env.HOME+\"/.config/claude-usage/statusline.sh\";fs.writeFileSync(p,JSON.stringify(j,null,2)+\"\n\")"'

echo "✅ 完成。远端下次 statusline 刷新即开始记录窗口大小（面板远端快照缓存后体现）。"
echo "   还原: ssh $HOST 'cp ~/.claude/settings.json.cu-bak ~/.claude/settings.json'"
