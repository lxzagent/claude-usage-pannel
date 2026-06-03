#!/usr/bin/env bash
# 本机安装：部署 statusline 记录器 + 透传包裹器，并把 ~/.claude/settings.json 的
# statusLine.command 切到包裹器。让面板拿到本机会话的精确上下文窗口（200k/1M）。
#   用法:  bash statusline/install-local.sh
#   还原:  cp ~/.claude/settings.json.cu-bak ~/.claude/settings.json
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CFG="$HOME/.config/claude-usage"
NODE="$(command -v node 2>/dev/null || echo /usr/local/bin/node)"
echo "node = $NODE"

mkdir -p "$CFG/context-cache"
cp "$SCRIPT_DIR/record.mjs" "$CFG/statusline-record.mjs"

# 保存原 statusLine 命令（已是包裹器则跳过，防递归）
node -e 'const fs=require("fs"),p=process.env.HOME+"/.claude/settings.json",j=JSON.parse(fs.readFileSync(p,"utf8"));const c=j.statusLine&&j.statusLine.command;if(!c){console.error("无 statusLine.command：请先在 Claude Code 配好 statusLine");process.exit(1)}if(/statusline\.sh/.test(c)){console.log("已是包裹器，保留既有 orig-command.txt（防递归）");process.exit(0)}fs.writeFileSync(process.env.HOME+"/.config/claude-usage/statusline.orig-command.txt",c+"\n")'

# 写本机透传包裹器
cat > "$CFG/statusline.sh" <<EOF
#!/usr/bin/env bash
# claude-usage 透传包裹 statusline（本机）。还原: cp ~/.claude/settings.json.cu-bak ~/.claude/settings.json
NODE=$NODE
REC="\$HOME/.config/claude-usage/statusline-record.mjs"
ORIG_FILE="\$HOME/.config/claude-usage/statusline.orig-command.txt"
input="\$(cat)"
printf '%s' "\$input" | "\$NODE" "\$REC" >/dev/null 2>&1 &
[ -r "\$ORIG_FILE" ] && printf '%s' "\$input" | eval "\$(cat "\$ORIG_FILE")"
EOF

cp "$HOME/.claude/settings.json" "$HOME/.claude/settings.json.cu-bak"
node -e 'const fs=require("fs"),p=process.env.HOME+"/.claude/settings.json",j=JSON.parse(fs.readFileSync(p,"utf8"));j.statusLine.command="bash "+process.env.HOME+"/.config/claude-usage/statusline.sh";fs.writeFileSync(p,JSON.stringify(j,null,2)+"\n")'
echo "✅ 完成。重开 Claude Code 或等下次 statusline 刷新即生效。"
