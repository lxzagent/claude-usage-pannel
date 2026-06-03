// claude-usage —— Übersicht 桌面卡片
// 取数：curl 本地面板服务 /api/stats（由 LaunchAgent com.lxz.claude-usage 常驻）。
export const command = 'curl -s --max-time 4 http://127.0.0.1:4317/api/stats';

export const refreshFrequency = 5000;

export const className = `
  top: 36px;
  right: 36px;
  width: 300px;
  font-family: -apple-system, "PingFang SC", system-ui, sans-serif;
  color: #e6e8ee;
  -webkit-font-smoothing: antialiased;

  .cu-card {
    background: rgba(18,20,26,0.9);
    border: 1px solid #2a2d36;
    border-radius: 14px;
    padding: 14px 16px;
    backdrop-filter: blur(14px);
    box-shadow: 0 10px 34px rgba(0,0,0,0.45);
  }
  .cu-host { margin-bottom: 14px; }
  .cu-host:last-child { margin-bottom: 0; }
  .cu-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 9px; }
  .cu-name { font-weight: 600; font-size: 13px; }
  .cu-pill { font-size: 10px; padding: 1px 8px; border-radius: 999px; background: rgba(217,119,87,0.18); color: #d97757; }
  .cu-pill.err { background: rgba(224,98,91,0.16); color: #e0625b; }
  .cu-row { margin: 7px 0; }
  .cu-label { display: flex; justify-content: space-between; font-size: 10px; color: #8b90a0; margin-bottom: 3px; }
  .cu-label b { color: #e6e8ee; font-weight: 600; }
  .cu-track { height: 6px; background: #23262f; border-radius: 999px; overflow: hidden; }
  .cu-fill { height: 100%; border-radius: 999px; }
  .cu-empty { color: #8b90a0; font-size: 11px; padding: 3px 0; }
  .cu-cost {
    display: flex; justify-content: space-between; gap: 6px;
    font-size: 10px; color: #8b90a0;
    margin-top: 10px; padding-top: 9px; border-top: 1px solid #2a2d36;
  }
  .cu-cost .col { flex: 1; text-align: center; }
  .cu-cost .col span { display: block; opacity: 0.8; }
  .cu-cost .col b { color: #e6e8ee; font-size: 12px; font-variant-numeric: tabular-nums; }
`;

const ERR = {
  'no-credentials': '未登录',
  'keychain-locked': '钥匙串锁定',
  'token-expired': '凭证过期',
  'api-user': 'API 用户',
  'api-error': 'API 异常',
  'rate-limited': '限流',
  'custom-endpoint': '自定义端点',
};

const barColor = (p) => (p >= 90 ? '#e0625b' : p >= 70 ? '#e0b341' : '#d97757');
const fmtTok = (n) =>
  n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n);

const Bar = (label, info) =>
  info ? (
    <div className="cu-row">
      <div className="cu-label">
        <span>{label}</span>
        <span><b>{info.pct}%</b></span>
      </div>
      <div className="cu-track">
        <div className="cu-fill" style={{ width: info.pct + '%', background: barColor(info.pct) }} />
      </div>
    </div>
  ) : null;

export const render = ({ output }) => {
  let data;
  try {
    data = JSON.parse(output);
  } catch (e) {
    return (
      <div className="cu-card">
        <div className="cu-empty">面板服务未运行（127.0.0.1:4317）</div>
      </div>
    );
  }

  return (
    <div className="cu-card">
      {(data.hosts || []).map((h, i) => (
        <div className="cu-host" key={i}>
          <div className="cu-head">
            <span className="cu-name">{h.name}</span>
            {h.account ? (
              <span className="cu-pill">{h.account.plan}</span>
            ) : (
              <span className="cu-pill err">{ERR[h.accountError] || '无额度'}</span>
            )}
          </div>

          {h.account && Bar('5 小时', h.account.fiveHour)}
          {h.account && Bar('本周', h.account.sevenDay)}

          {h.sessions && h.sessions.length ? (
            h.sessions.slice(0, 2).map((s, j) => (
              <div className="cu-row" key={j}>
                <div className="cu-label">
                  <span>{s.project}</span>
                  <span><b>{s.contextPct}%</b> · {fmtTok(s.contextTokens)}</span>
                </div>
                <div className="cu-track">
                  <div className="cu-fill" style={{ width: s.contextPct + '%', background: barColor(s.contextPct) }} />
                </div>
              </div>
            ))
          ) : (
            <div className="cu-empty">无活跃会话</div>
          )}

          <div className="cu-cost">
            <div className="col"><span>近 5h</span><b>${h.cost.fiveHour.usd.toFixed(2)}</b></div>
            <div className="col"><span>近 24h</span><b>${h.cost.day.usd.toFixed(2)}</b></div>
            <div className="col"><span>本周</span><b>${h.cost.week.usd.toFixed(2)}</b></div>
          </div>
        </div>
      ))}
    </div>
  );
};
