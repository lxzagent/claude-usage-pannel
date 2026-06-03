# claude-usage

本地 HTTP 面板，展示已登录 Claude 账号的官方 **5h / 周用量**、**当前活跃会话的 Context 占用**，以及**按滚动窗口（近 5h / 24h / 本周）估算的成本**。支持通过 SSH 聚合多台主机。

## 数据来源

- **官方额度**：`GET https://api.anthropic.com/api/oauth/usage`，用本机 OAuth 凭证（macOS 钥匙串 `Claude Code-credentials` 或 `~/.claude/.credentials.json`）。token 仅在本机使用，**不下发前端、不经聚合端传输、不写日志**。
- **会话 / 成本**：解析 `~/.claude/projects/**/*.jsonl`，无需凭证。
  - 当前 Context ≈ 最近一条 assistant 消息的 `input + cache_read + cache_creation`。
  - 成本按每条消息 `timestamp` 分入近 5h / 24h / 7d 滚动窗口，× 模型单价（`src/pricing.ts`，**近似可改**）。

## 运行

```bash
npm install
npm run dev        # 起面板 → http://127.0.0.1:4317
npm run collect    # 调试：打印本机一份 HostSnapshot
```

## 配置

复制 `hosts.example.json` 到 `~/.config/claude-usage/hosts.json` 后编辑（不存在时默认仅本机）：

| 字段 | 说明 |
|---|---|
| `port` | 监听端口（仅绑 127.0.0.1） |
| `pollSeconds` | 前端轮询间隔 |
| `activeWindowSeconds` | JSONL mtime 在此窗口内视为活跃会话（默认 300） |
| `contextWindow` | `0`=自动推断窗口大小；填 `1000000` 可强制按 1M 算占用百分比 |
| `remoteCacheSeconds` | 远端 SSH 快照缓存秒数 |
| `hosts[]` | `{name,type:'local'\|'ssh',ssh:'user@host 或 ssh 别名'}` |

## 上下文窗口推断

transcript 不记录窗口大小（Claude Code 仅在 statusline 的 stdin 中提供），故按：**配置覆盖 > 观测峰值 >20 万判 1M > model 含 `[1m]` > 默认 20 万**。Token 数始终精确；仅"百分比"依赖此推断。全程跑 `[1m]` 的话建议把 `contextWindow` 设为 `1000000`（但会令真正 200k 的 sonnet/haiku 会话占比偏低）。

## 多主机 (SSH)

聚合端对每个 `ssh` 主机执行 `ssh <host> 'node - ...'`，把打包好的 `collector.bundle.cjs` 经 stdin 注入远端 node 执行，只回传算好的快照。

- 远端零安装，只需有 `node`，复用你的 `~/.ssh/config` / 密钥 / agent。
- **远端 macOS**：非交互 SSH 会话钥匙串常被锁 → 该主机 `account` 降级显示（`keychain-locked`），但会话/成本仍正常（不依赖凭证）。
- 远端 Linux：直读 `~/.claude/.credentials.json`，无此问题。
