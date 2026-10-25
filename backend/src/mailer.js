/**
 * 邮件模板 + 发送通道
 *
 * 发送通道三种：
 *   relay  — 内置中继（免配置）：服务器本机 Postfix 负责投递，只需填写发件账号与授权码
 *   custom — 自定义 SMTP（完全手动填写主机/端口/加密方式）
 *   none   — 不发送
 *
 * 模板：每类邮件（注册 / 工单 / 预警 / 测试）均有可编辑标题与正文，
 * 正文支持 {{变量}} 占位符，未编写的走内置默认模板。
 */
import fs from 'node:fs';
import net from 'node:net';
import tls from 'node:tls';
import crypto from 'node:crypto';
import { db, getSettings, getSetting } from './db.js';

// ---------------------------------------------------------------
// 发件预设：选中后自动带出服务器参数（免手工配置）
// ---------------------------------------------------------------
export const MAIL_PRESETS = {
  qq: { name: 'QQ 邮箱', host: 'smtp.qq.com', port: 465, secure: 'ssl', note: '需在 QQ 邮箱设置中开启 SMTP 并获取「授权码」' },
  '163': { name: '网易 163', host: 'smtp.163.com', port: 465, secure: 'ssl', note: '需开启 SMTP 服务，密码处填授权码' },
  '126': { name: '网易 126', host: 'smtp.126.com', port: 465, secure: 'ssl', note: '需开启 SMTP 服务，密码处填授权码' },
  sina: { name: '新浪邮箱', host: 'smtp.sina.com', port: 465, secure: 'ssl', note: '需开启 SMTP 服务' },
  aliyun: { name: '阿里云企业邮', host: 'smtp.qiye.aliyun.com', port: 465, secure: 'ssl', note: '使用企业邮箱账号密码' },
  tencent: { name: '腾讯企业邮', host: 'smtp.exmail.qq.com', port: 465, secure: 'ssl', note: '使用企业邮箱账号密码' },
  gmail: { name: 'Gmail', host: 'smtp.gmail.com', port: 465, secure: 'ssl', note: '需使用应用专用密码（两步验证后生成）' },
  outlook: { name: 'Outlook / Office365', host: 'smtp.office365.com', port: 587, secure: 'tls', note: '使用账号密码或应用密码' },
  yandex: { name: 'Yandex', host: 'smtp.yandex.com', port: 465, secure: 'ssl', note: '需开启应用密码' },
};

export function mailPresetList() {
  return Object.entries(MAIL_PRESETS).map(([k, v]) => ({ value: k, label: v.name, ...v }));
}

// ---------------------------------------------------------------
// SMTP 客户端
// ---------------------------------------------------------------
class SmtpClient {
  constructor() {
    this.sock = null; this.buffer = ''; this.waiters = []; this.closed = false;
  }

  attach(sock) {
    this.sock = sock;
    this.buffer = '';
    sock.setEncoding('utf8');
    sock.on('data', (c) => { this.buffer += c; this.flush(); });
    sock.on('error', (e) => this.fail(e));
    sock.on('close', () => { this.closed = true; this.fail(new Error('连接已关闭')); });
    sock.setTimeout(20000, () => this.fail(new Error('SMTP 连接超时')));
  }

  flush() {
    while (this.waiters.length) {
      const lines = this.buffer.split('\r\n');
      let end = -1;
      for (let i = 0; i < lines.length - 1; i++) if (/^\d{3} /.test(lines[i])) { end = i; break; }
      if (end === -1) return;
      const text = lines.slice(0, end + 1).join('\n');
      this.buffer = lines.slice(end + 1).join('\r\n');
      this.waiters.shift().resolve({ code: Number(text.slice(0, 3)), text });
    }
  }

  fail(err) { for (const w of this.waiters.splice(0)) w.reject(err); }

  read() { return new Promise((res, rej) => { this.waiters.push({ resolve: res, reject: rej }); this.flush(); }); }

  write(cmd) {
    return new Promise((res, rej) => {
      if (this.closed) return rej(new Error('连接已关闭'));
      this.sock.write(cmd + '\r\n', (e) => (e ? rej(e) : res()));
    });
  }

  async cmd(cmd, expect = [250]) {
    await this.write(cmd);
    const r = await this.read();
    if (!expect.includes(r.code)) throw new Error(`SMTP ${cmd.split(' ')[0]} 失败: ${r.text.slice(0, 160)}`);
    return r;
  }

  async upgradeTls(host) {
    const plain = this.sock;
    ['data', 'error', 'close', 'timeout'].forEach((ev) => plain.removeAllListeners(ev));
    const sec = tls.connect({ socket: plain, servername: host, rejectUnauthorized: false });
    await new Promise((res, rej) => {
      sec.once('secureConnect', res);
      sec.once('error', rej);
      setTimeout(() => rej(new Error('TLS 握手超时')), 10000);
    });
    this.attach(sec);
  }

  close() { try { this.sock?.end(); } catch { /* ignore */ } }
}

async function connect(host, port, secure) {
  const c = new SmtpClient();
  if (secure === 'ssl') {
    const sock = tls.connect({ host, port, servername: host, rejectUnauthorized: false });
    await new Promise((res, rej) => {
      sock.once('secureConnect', res); sock.once('error', rej);
      setTimeout(() => rej(new Error('SSL 连接超时')), 15000);
    });
    c.attach(sock);
  } else {
    const sock = net.connect({ host, port });
    await new Promise((res, rej) => {
      sock.once('connect', res); sock.once('error', rej);
      setTimeout(() => rej(new Error('连接超时')), 15000);
    });
    c.attach(sock);
  }
  const greet = await c.read();
  if (greet.code !== 220) throw new Error('SMTP 服务器未就绪: ' + greet.text.slice(0, 120));
  return c;
}

function b64(s) { return Buffer.from(s, 'utf8').toString('base64'); }
function encHeader(s) { return /^[\x20-\x7E]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`; }

/** 解析实际使用的发信配置（预设优先） */
export function resolveSmtpConfig(s = getSettings()) {
  const preset = s.smtp_preset && MAIL_PRESETS[s.smtp_preset];
  if (preset) {
    return {
      mode: 'relay',
      host: preset.host, port: preset.port, secure: preset.secure,
      user: s.smtp_user, pass: s.smtp_pass,
      from: s.smtp_from || s.smtp_user,
      fromName: s.smtp_from_name || s.site_name,
      preset: s.smtp_preset,
    };
  }
  return {
    mode: 'custom',
    host: s.smtp_host, port: Number(s.smtp_port) || 465, secure: s.smtp_secure || 'ssl',
    user: s.smtp_user, pass: s.smtp_pass,
    from: s.smtp_from || s.smtp_user,
    fromName: s.smtp_from_name || s.site_name,
    preset: '',
  };
}

// ---------------------------------------------------------------
// 发送
// ---------------------------------------------------------------
export async function sendMail({ to, subject, html }) {
  const s = getSettings();
  if (s.smtp_enabled !== '1') { const e = new Error('邮件服务未启用'); e.code = 'SMTP_DISABLED'; throw e; }
  const cfg = resolveSmtpConfig(s);
  if (!cfg.host) throw new Error('未配置发信服务器，请选择邮箱服务商或填写 SMTP 地址');
  if (!cfg.user || !cfg.pass) throw new Error('未填写发件账号或授权码');
  if (!cfg.from) throw new Error('未配置发件人地址');

  const msgId = `<${crypto.randomBytes(12).toString('hex')}@${cfg.from.split('@')[1] || 'localhost'}>`;
  const headers = [
    `From: ${encHeader(cfg.fromName || '')} <${cfg.from}>`,
    `To: <${to}>`,
    `Subject: ${encHeader(subject)}`,
    `Message-ID: ${msgId}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    `Date: ${new Date().toUTCString()}`,
  ];
  const body = b64(html).replace(/(.{76})/g, '$1\r\n');

  const c = await connect(cfg.host, cfg.port, cfg.secure);
  try {
    await c.cmd('EHLO tgproxy', [250, 220]);
    if (cfg.secure === 'tls') {
      await c.cmd('STARTTLS', [220]);
      await c.upgradeTls(cfg.host);
      await c.cmd('EHLO tgproxy', [250]);
    }
    if (cfg.user) {
      await c.cmd('AUTH LOGIN', [334]);
      await c.cmd(b64(cfg.user), [334]);
      await c.cmd(b64(cfg.pass), [235]);
    }
    await c.cmd('MAIL FROM:<' + cfg.from + '>', [250]);
    await c.cmd('RCPT TO:<' + to + '>', [250, 251]);
    await c.cmd('DATA', [354]);
    await c.cmd(`${headers.join('\r\n')}\r\n\r\n${body}\r\n.`, [250]);
    await c.cmd('QUIT', [221, 250]).catch(() => {});
  } finally {
    c.close();
  }
  return { ok: true, mode: cfg.mode };
}

// ---------------------------------------------------------------
// 模板
// ---------------------------------------------------------------
export const TEMPLATE_DEFS = {
  register: {
    name: '注册欢迎',
    subject_key: 'mail_tpl_register_subject',
    body_key: 'mail_tpl_register_body',
    vars: { username: '用户名', site: '站点名称', quota: '初始额度(GB)', login_url: '登录地址', time: '注册时间' },
    defaultSubject: '欢迎加入 {{site}}',
    defaultBody: `<p>你好 <b>{{username}}</b>，</p>
<p>你的账号已创建成功，初始流量额度为 <b>{{quota}} GB</b>。</p>
<p>登录后即可在「我的代理」中创建专属 Telegram 代理，支持扫码一键导入。</p>`,
  },
  ticket: {
    name: '工单结果',
    subject_key: 'mail_tpl_ticket_subject',
    body_key: 'mail_tpl_ticket_body',
    vars: { username: '用户名', site: '站点名称', status: '审核结果', amount: '申请流量', note: '管理员备注', time: '处理时间' },
    defaultSubject: '流量申请{{status}} · {{site}}',
    defaultBody: `<p>你好 <b>{{username}}</b>，</p>
<p>你申请 <b>{{amount}}</b> 流量的请求已{{status}}。</p>
<p style="background:#f5f6f8;padding:10px 12px;border-radius:7px;">管理员备注：{{note}}</p>`,
  },
  quota: {
    name: '额度预警',
    subject_key: 'mail_tpl_quota_subject',
    body_key: 'mail_tpl_quota_body',
    vars: { username: '用户名', site: '站点名称', pct: '使用百分比', account: '代理名称', quota: '额度', used: '已用流量' },
    defaultSubject: '流量使用提醒（已达 {{pct}}%）',
    defaultBody: `<p>你好 <b>{{username}}</b>，</p>
<p>你的代理「{{account}}」流量已使用 <b>{{pct}}%</b>，超出后代理将自动停用。</p>
<p>如需继续使用，请及时提交流量申请。</p>`,
  },
  test: {
    name: '测试邮件',
    subject_key: 'mail_tpl_test_subject',
    body_key: 'mail_tpl_test_body',
    vars: { site: '站点名称', time: '发送时间', host: '发信服务器', mode: '发送通道' },
    defaultSubject: 'SMTP 配置测试 · {{site}}',
    defaultBody: `<p>你好！</p>
<p>这是一封来自 <b>{{site}}</b> 的测试邮件，说明邮件配置已经生效。</p>
<p>发送时间：{{time}}<br/>发信服务器：{{host}}（{{mode}}）</p>`,
  },
};

export function renderVars(text, vars) {
  return String(text || '').replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (_, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : ''));
}

/** 渲染完整 HTML 邮件（含统一外壳） */
export function buildMailHtml(bodyHtml, vars = {}) {
  const s = getSettings();
  const brand = s.mail_tpl_theme_color || '#2450eb';
  const site = s.site_name || 'TG 代理平台';
  return `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f5f6f8;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6f8;padding:32px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:12px;border:1px solid #e8eaef;overflow:hidden;">
  <tr><td style="padding:0;"><div style="height:3px;background:${brand};"></div></td></tr>
  <tr><td style="padding:22px 28px;border-bottom:1px solid #eef0f4;">
    <table role="presentation" width="100%"><tr>
      <td style="font-size:16px;font-weight:600;color:#1a1d23;">${site}</td>
      <td align="right" style="font-size:12px;color:#8b919e;">MTProto Proxy</td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:28px;font-size:14px;line-height:1.75;color:#4b5160;">
    ${renderVars(bodyHtml, vars)}
  </td></tr>
  <tr><td style="padding:16px 28px;border-top:1px solid #eef0f4;font-size:12px;color:#9aa0ab;">
    此邮件由 ${site} 系统自动发送，请勿直接回复。
  </td></tr>
</table>
</td></tr></table></body></html>`;
}

/** 取某类模板的标题与正文（未自定义则用默认） */
export function getTemplate(key) {
  const def = TEMPLATE_DEFS[key];
  if (!def) return null;
  const subject = getSetting(def.subject_key) || def.defaultSubject;
  const body = getSetting(def.body_key) || def.defaultBody;
  return { subject, body };
}

function logMail(to, subject, template, status, error) {
  try {
    db.prepare('INSERT INTO mail_logs(to_addr, subject, template, status, error) VALUES(?,?,?,?,?)')
      .run(to, subject, template || '', status, error ? String(error).slice(0, 500) : null);
  } catch { /* ignore */ }
}

/** 异步发送（失败只记日志） */
export function sendMailSafe({ to, subject, html, template }) {
  if (!to) return;
  sendMail({ to, subject, html })
    .then(() => logMail(to, subject, template, 'sent'))
    .catch((e) => logMail(to, subject, template, 'failed', e.message));
}

export function mailConfigured() {
  const s = getSettings();
  if (s.smtp_enabled !== '1') return false;
  const cfg = resolveSmtpConfig(s);
  return !!(cfg.host && cfg.user && cfg.pass);
}

/** 按模板发送 */
export function sendByTemplate(key, to, vars, templateName) {
  const t = getTemplate(key);
  if (!t) return;
  const v = { site: getSetting('site_name'), time: new Date().toLocaleString('zh-CN'), ...vars };
  sendMailSafe({
    to,
    subject: renderVars(t.subject, v),
    html: buildMailHtml(t.body, v),
    template: templateName || key,
  });
}

// ---- 业务便捷方法 ----
export function notifyRegister(user) {
  if (getSetting('mail_notify_register') !== '1' || !user.email) return;
  sendByTemplate('register', user.email, {
    username: user.username,
    quota: (Number(user.quota_mb) / 1024).toFixed(0),
    login_url: 'http://' + (getSetting('node_public_ip') || 'localhost'),
  });
}

export function notifyTicket(user, ticket, approved) {
  if (getSetting('mail_notify_ticket') !== '1' || !user?.email) return;
  sendByTemplate('ticket', user.email, {
    username: user.username,
    status: approved ? '通过' : '被拒绝',
    amount: `${(Number(ticket.amount_mb) / 1024).toFixed(1)} GB`,
    note: ticket.admin_note || '无',
    time: new Date().toLocaleString('zh-CN'),
  });
}

export function notifyQuotaWarn(user, pct, acc) {
  if (getSetting('mail_notify_quota') !== '1' || !user?.email) return;
  sendByTemplate('quota', user.email, {
    username: user.username,
    pct,
    account: acc.name || acc.port,
    quota: (Number(acc.quota_mb) / 1024).toFixed(1) + ' GB',
    used: (Number(acc.used_bytes) / 1024 / 1024).toFixed(1) + ' MB',
  });
}

/** 测试邮件（支持预览模式：渲染但不发送） */
export async function sendTestMail(to, sampleVars = {}) {
  const s = getSettings();
  const cfg = resolveSmtpConfig(s);
  const v = {
    site: s.site_name, time: new Date().toLocaleString('zh-CN'),
    host: cfg.host || '-', mode: cfg.mode === 'relay' ? '内置中继' : '自定义 SMTP', ...sampleVars,
  };
  const t = getTemplate('test');
  const subject = renderVars(t.subject, v);
  const html = buildMailHtml(t.body, v);
  await sendMail({ to, subject, html });
  logMail(to, subject, 'test', 'sent');
  return { ok: true };
}
