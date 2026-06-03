// claude-usage —— Übersicht 桌面卡片
// 每台主机一张独立卡片，可分别拖拽（位置按主机名存 localStorage）；中等毛玻璃。
// 取数：curl 本地面板服务 /api/stats（由 LaunchAgent com.lxz.claude-usage 常驻）。
export const command = 'curl -s --max-time 4 http://127.0.0.1:4317/api/stats';

export const refreshFrequency = 5000;

// 容器锚在屏幕左上原点；每张卡片用 absolute + 屏幕坐标自管理位置（拖拽改这两个值）。
export const className = `
  top: 0; left: 0;
  font-family: -apple-system, "PingFang SC", system-ui, sans-serif;
  color: #e6e8ee;
  -webkit-font-smoothing: antialiased;

  .cu-card {
    position: absolute;
    box-sizing: border-box;
    width: 300px;
    background: rgba(18,20,26,0.5);
    border: 1px solid rgba(255,255,255,0.10);
    border-radius: 14px;
    padding: 14px 16px;
    -webkit-backdrop-filter: blur(18px) saturate(1.3);
    backdrop-filter: blur(18px) saturate(1.3);
    box-shadow: 0 10px 34px rgba(0,0,0,0.45);
    cursor: grab;
    user-select: none;
    -webkit-user-select: none;
  }
  .cu-card:active { cursor: grabbing; }
  .cu-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 9px; }
  .cu-name { font-weight: 600; font-size: 13px; }
  .cu-pill { font-size: 10px; padding: 1px 8px; border-radius: 999px; background: rgba(217,119,87,0.18); color: #d97757; }
  .cu-pill.err { background: rgba(224,98,91,0.16); color: #e0625b; }
  .cu-row { margin: 7px 0; }
  .cu-label { display: flex; justify-content: space-between; font-size: 10px; color: #8b90a0; margin-bottom: 3px; }
  .cu-label b { color: #e6e8ee; font-weight: 600; }
  .cu-track { height: 6px; background: rgba(255,255,255,0.10); border-radius: 999px; overflow: hidden; }
  .cu-fill { height: 100%; border-radius: 999px; }
  .cu-empty { color: #8b90a0; font-size: 11px; padding: 3px 0; }
  .cu-cost {
    display: flex; justify-content: space-between; gap: 6px;
    font-size: 10px; color: #8b90a0;
    margin-top: 10px; padding-top: 9px; border-top: 1px solid rgba(255,255,255,0.10);
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

// ---------- 位置持久化 ----------
const CARD_W = 300;
const posKey = (name) => 'cu-pos:' + name;
const screenW = () => (typeof window !== 'undefined' ? window.innerWidth : 1440);

function loadPos(name, i) {
  try {
    const raw = localStorage.getItem(posKey(name));
    if (raw) {
      const p = JSON.parse(raw);
      if (typeof p.x === 'number' && typeof p.y === 'number') return p;
    }
  } catch (e) {}
  // 默认：沿右侧竖向依次排开，用户可任意拖走
  return { x: screenW() - CARD_W - 36, y: 36 + i * 210 };
}

// ---------- 拖拽（window 全局委托，仅注册一次；跨 5s 刷新仍有效）----------
if (typeof window !== 'undefined' && !window.__cuDragInit) {
  window.__cuDragInit = true;
  let drag = null;
  window.addEventListener('mousedown', (e) => {
    const card = e.target && e.target.closest ? e.target.closest('.cu-card') : null;
    if (!card || e.button !== 0) return;
    const host = card.getAttribute('data-host');
    if (!host) return;
    const r = card.getBoundingClientRect();
    drag = { host, sx: e.clientX, sy: e.clientY, ox: r.left, oy: r.top };
    e.preventDefault();
  }, true);
  window.addEventListener('mousemove', (e) => {
    if (!drag) return;
    const nx = drag.ox + (e.clientX - drag.sx);
    const ny = drag.oy + (e.clientY - drag.sy);
    // 每次刷新会重建 DOM，按 host 重新查活节点，避免拖拽中遇到刷新而卡死
    const card = document.querySelector('.cu-card[data-host="' + drag.host + '"]');
    if (card) { card.style.left = nx + 'px'; card.style.top = ny + 'px'; }
    try { localStorage.setItem(posKey(drag.host), JSON.stringify({ x: nx, y: ny })); } catch (e2) {}
  }, true);
  window.addEventListener('mouseup', () => { drag = null; }, true);
}

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

const HostCard = (h, pos) => (
  <div className="cu-card" key={h.name} data-host={h.name} style={{ left: pos.x + 'px', top: pos.y + 'px' }}>
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
);

export const render = ({ output }) => {
  let data;
  try {
    data = JSON.parse(output);
  } catch (e) {
    return (
      <div className="cu-card" data-host="__err" style={{ left: (screenW() - CARD_W - 36) + 'px', top: '36px' }}>
        <div className="cu-empty">面板服务未运行（127.0.0.1:4317）</div>
      </div>
    );
  }

  const hosts = data.hosts || [];
  return <div>{hosts.map((h, i) => HostCard(h, loadPos(h.name, i)))}</div>;
};
