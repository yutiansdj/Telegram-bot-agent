/** 字节 /容量格式化 */
export function fmtBytes(n, digits = 2) {
  n = Number(n) || 0;
  if (n === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i === 0 ? 0 : digits)} ${units[i]}`;
}

export function fmtMB(mb) {
  return fmtBytes(Number(mb || 0) * 1024 * 1024);
}

/** 日期格式化：支持 "2026-10-23 12:00:00" / ISO */
export function fmtDate(v, withTime = true) {
  if (!v) return '-';
  let s = String(v);
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) s = s.replace(' ', 'T') + 'Z';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return v;
  const pad = (x) => String(x).padStart(2, '0');
  const base = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (!withTime) return base;
  return `${base} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const DAY = 86400000;
export function fmtRelative(v) {
  if (!v) return '从未';
  let s = String(v);
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) s = s.replace(' ', 'T') + 'Z';
  const t = new Date(s).getTime();
  if (Number.isNaN(t)) return v;
  const diff = Date.now() - t;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < DAY) return `${Math.floor(diff / 3600000)} 小时前`;
  if (diff < DAY * 30) return `${Math.floor(diff / DAY)} 天前`;
  return fmtDate(v, false);
}

export function fmtUptime(sec) {
  sec = Math.floor(sec);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d) return `${d} 天 ${h} 小时`;
  if (h) return `${h} 小时 ${m} 分`;
  return `${m} 分钟`;
}

/** 复制到剪贴板（兼容移动端非 https） */
export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through */ }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); return true; } catch { return false; } finally { document.body.removeChild(ta); }
}

export const statusMeta = {
  running: { text: '运行中', type: 'success' },
  active: { text: '已启用', type: 'info' },
  stopped: { text: '已停止', type: 'default' },
  disabled: { text: '已停用', type: 'warning' },
  expired: { text: '已到期', type: 'error' },
  exhausted: { text: '流量用尽', type: 'error' },
  online: { text: '在线', type: 'success' },
  offline: { text: '离线', type: 'error' },
  pending: { text: '待审核', type: 'warning' },
  approved: { text: '已通过', type: 'success' },
  rejected: { text: '已拒绝', type: 'error' },
};
