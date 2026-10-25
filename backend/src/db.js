import Database from 'better-sqlite3';
import { config } from './config.js';
import { hashPassword, randomToken } from './crypto.js';

export const db = new Database(config.dbFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  email TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  status TEXT NOT NULL DEFAULT 'active',
  quota_mb INTEGER NOT NULL DEFAULT 10240,
  note TEXT DEFAULT '',
  last_login_at TEXT,
  last_login_ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  host TEXT NOT NULL,
  ip_version TEXT NOT NULL DEFAULT 'ipv4',
  port_base INTEGER NOT NULL DEFAULT 20000,
  port_range INTEGER NOT NULL DEFAULT 1000,
  status TEXT NOT NULL DEFAULT 'online',
  public_ip TEXT,
  domain TEXT,
  note TEXT DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  node_id INTEGER NOT NULL REFERENCES nodes(id),
  name TEXT NOT NULL,
  secret TEXT NOT NULL,
  port INTEGER NOT NULL,
  protocol TEXT NOT NULL DEFAULT 'mtproto',
  status TEXT NOT NULL DEFAULT 'active',
  quota_mb INTEGER NOT NULL DEFAULT 0,
  used_bytes INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT,
  expires_at TEXT,
  remark TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_accounts_port ON accounts(node_id, port);

CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  node_id INTEGER REFERENCES nodes(id),
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  node_name TEXT,
  amount_mb INTEGER NOT NULL DEFAULT 0,
  reason TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  admin_note TEXT DEFAULT '',
  reviewed_by INTEGER,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status, created_at DESC);

CREATE TABLE IF NOT EXISTS traffic_daily (
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  up_bytes INTEGER NOT NULL DEFAULT 0,
  down_bytes INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, day)
);
CREATE INDEX IF NOT EXISTS idx_traffic_day ON traffic_daily(day);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  username TEXT,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS login_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  username TEXT,
  success INTEGER NOT NULL DEFAULT 0,
  ip TEXT,
  ua TEXT,
  message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_login_created ON login_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'info',
  level TEXT NOT NULL DEFAULT 'normal',
  target TEXT NOT NULL DEFAULT 'all',
  pinned INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  starts_at TEXT,
  ends_at TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mail_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  to_addr TEXT NOT NULL,
  subject TEXT NOT NULL,
  template TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mail_created ON mail_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS annc_marquee (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  icon TEXT DEFAULT 'tabler:speakerphone',
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS captcha_challenges (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  answer TEXT NOT NULL,
  meta TEXT,
  ip TEXT,
  used INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bot_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id TEXT NOT NULL UNIQUE,
  tg_username TEXT,
  tg_first_name TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  balance_mb REAL NOT NULL DEFAULT 1024,
  total_signin INTEGER NOT NULL DEFAULT 0,
  last_signin TEXT,
  signin_streak INTEGER NOT NULL DEFAULT 0,
  banned INTEGER NOT NULL DEFAULT 0,
  state TEXT,
  email TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_active TEXT
);

CREATE TABLE IF NOT EXISTS bot_commands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id TEXT NOT NULL,
  command TEXT NOT NULL,
  payload TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_botcmd ON bot_commands(created_at DESC);

CREATE TABLE IF NOT EXISTS bot_buttons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent TEXT NOT NULL DEFAULT 'main',
  label TEXT NOT NULL,
  action TEXT NOT NULL,
  payload TEXT,
  icon TEXT DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  admin_only INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tg_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL UNIQUE,
  title TEXT,
  type TEXT DEFAULT 'supergroup',
  verify_enabled INTEGER NOT NULL DEFAULT 1,
  captcha_type TEXT DEFAULT 'choice',
  captcha_options INTEGER NOT NULL DEFAULT 4,
  captcha_attempts INTEGER NOT NULL DEFAULT 3,
  captcha_timeout INTEGER NOT NULL DEFAULT 120,
  welcome_text TEXT,
  joined_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS group_admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  tg_id TEXT NOT NULL,
  title TEXT,
  blocked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(chat_id, tg_id)
);

CREATE TABLE IF NOT EXISTS verify_sessions (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  tg_id TEXT NOT NULL,
  tg_name TEXT,
  answer TEXT NOT NULL,
  options TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  status TEXT NOT NULL DEFAULT 'pending',
  message_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_verify_chat ON verify_sessions(chat_id, tg_id, status);

CREATE TABLE IF NOT EXISTS banned_words (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  word TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'word',
  action TEXT NOT NULL DEFAULT 'delete',
  mute_minutes INTEGER NOT NULL DEFAULT 5,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mod_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT,
  tg_id TEXT,
  tg_name TEXT,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_modlog ON mod_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS invite_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  inviter_tg_id TEXT NOT NULL,
  inviter_user_id INTEGER,
  title TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used TEXT,
  use_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_invite_inviter ON invite_links(inviter_tg_id);

CREATE TABLE IF NOT EXISTS invite_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT,
  inviter_tg_id TEXT NOT NULL,
  invitee_tg_id TEXT NOT NULL UNIQUE,
  invitee_name TEXT,
  reward_mb REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_invrec_inviter ON invite_records(inviter_tg_id);

CREATE TABLE IF NOT EXISTS group_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  tg_id TEXT NOT NULL,
  name TEXT,
  status TEXT DEFAULT 'member',
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen TEXT,
  UNIQUE(chat_id, tg_id)
);
CREATE INDEX IF NOT EXISTS idx_gm_chat ON group_members(chat_id);

CREATE TABLE IF NOT EXISTS email_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  scene TEXT NOT NULL DEFAULT 'register',
  attempts INTEGER NOT NULL DEFAULT 0,
  used INTEGER NOT NULL DEFAULT 0,
  ip TEXT,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_email_code ON email_codes(email, scene);
CREATE INDEX IF NOT EXISTS idx_email_ip ON email_codes(ip, created_at);

CREATE TABLE IF NOT EXISTS bots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  token TEXT NOT NULL,
  username TEXT,
  display_name TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  is_primary INTEGER NOT NULL DEFAULT 0,
  mode TEXT NOT NULL DEFAULT 'polling',
  webhook_url TEXT,
  webhook_secret TEXT,
  ai_enabled INTEGER NOT NULL DEFAULT 1,
  ai_persona TEXT,
  welcome TEXT,
  status TEXT NOT NULL DEFAULT 'stopped',
  last_error TEXT,
  started_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ai_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'openai',
  base_url TEXT NOT NULL DEFAULT '',
  api_key TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  temperature REAL NOT NULL DEFAULT 0.7,
  max_tokens INTEGER NOT NULL DEFAULT 1024,
  system_prompt TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  is_default INTEGER NOT NULL DEFAULT 0,
  used_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ai_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_id INTEGER,
  tg_id TEXT,
  chat_id TEXT,
  prompt TEXT,
  reply TEXT,
  model TEXT,
  tokens INTEGER DEFAULT 0,
  latency_ms INTEGER DEFAULT 0,
  status TEXT DEFAULT 'ok',
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ailog ON ai_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS wb_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at INTEGER DEFAULT 0,
  domain TEXT,
  region TEXT NOT NULL DEFAULT 'cn',
  nickname TEXT,
  last_balance REAL DEFAULT 0,
  last_checkin TEXT,
  checkin_streak INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wb_models (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  model_id TEXT NOT NULL,
  name TEXT,
  vendor TEXT
);

CREATE TABLE IF NOT EXISTS ai_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notes_tg ON ai_notes(tg_id, id DESC);

CREATE TABLE IF NOT EXISTS ai_conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_id INTEGER NOT NULL DEFAULT 0,
  chat_id TEXT NOT NULL,
  tg_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_conv ON ai_conversations(bot_id, chat_id, tg_id, id DESC);

CREATE TABLE IF NOT EXISTS ai_user_prefs (
  tg_id TEXT PRIMARY KEY,
  model TEXT NOT NULL DEFAULT '',
  config_id INTEGER DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

export const defaults = {
  // ---- 站点信息 ----
  site_name: 'TG 代理申请平台',
  site_desc: '免费 Telegram MTProto 代理申请与自助管理平台',
  site_keywords: 'TG代理,MTProto,免费代理,Telegram',
  site_logo: '',
  site_favicon: '',
  site_footer: '',
  icp: '',
  support_contact: '@tgproxy_admin',
  support_email: '',
  announcement: '',
  show_public_status: '1',
  // ---- 界面主题 ----
  ui_theme: 'default',            // default | blue | green | violet | orange
  ui_radius: '7',                 // 圆角 px
  ui_primary_light: '#2450eb',    // 浅色主色
  ui_primary_dark: '#6b8ff8',     // 深色主色
  ui_sidebar_style: 'light',      // light | brand
  ui_font_size: '14',
  ui_density: 'normal',           // compact | normal | loose
  ui_login_style: 'split',        // split | center
  ui_login_bg: '',
  // ---- 注册与用户 ----
  register_enabled: '1',
  register_quota_mb: '10240',
  register_need_email: '0',
  register_email_verify: '0',        // 1 = 注册必须完成邮箱验证
  verify_code_len: '6',
  verify_code_ttl: '10',             // 分钟
  verify_code_cooldown: '60',        // 秒
  verify_code_daily_limit: '5',      // 每邮箱每日发送上限
  verify_code_ip_limit: '20',        // 每 IP 每日发送上限
  verify_code_max_attempts: '5',
  verify_template_subject: '【{{site}}】邮箱验证码 {{code}}',
  verify_template_body: '',
  register_ip_limit: '5',
  login_captcha: '0',
  login_fail_limit: '5',
  login_fail_lock_min: '10',
  password_min_len: '6',
  // ---- 代理与流量 ----
  default_quota_mb: '10240',
  daily_transfer_limit_mb: '2048',
  max_accounts_per_user: '3',
  node_public_ip: '154.222.24.221',
  secret_domain: 'vpn.ack4.cn',
  fake_domains: 'vpn.ack4.cn',
  account_auto_recover: '1',
  usage_notify_pct: '80',
  // ---- 流量申请 ----
  ticket_enabled: '1',
  ticket_auto_approve: '0',
  ticket_max_pending: '3',
  ticket_max_amount_mb: '102400',
  ticket_notice: '',
  // ---- 邮件 ----
  smtp_enabled: '0',
  smtp_preset: '',                 // '' | qq | 163 | 126 | gmail | outlook | aliyun | custom
  smtp_auto: '1',                  // 选中预设后自动带出主机与端口
  smtp_host: '',
  smtp_port: '465',
  smtp_secure: 'ssl',             // ssl | tls | none
  smtp_user: '',
  smtp_pass: '',
  smtp_from: '',
  smtp_from_name: 'TG 代理平台',
  mail_notify_register: '0',
  mail_notify_ticket: '1',
  mail_notify_quota: '1',
  mail_test_to: '',
  // ---- Telegram 机器人 ----
  bot_enabled: '0',
  bot_token: '',
  bot_username: '',
  bot_name: '',
  bot_link: '',
  bot_webhook_mode: '0',
  bot_webhook_url: '',
  bot_webhook_secret: '',
  bot_welcome: '👋 欢迎使用 {{site}}！\n\n我可以帮你自助开通 Telegram 代理：\n• 创建专属代理链接\n• 查看剩余流量\n• 每日签到领流量',
  bot_help: '',
  bot_register_on_start: '1',
  bot_auto_register: '1',
  bot_require_email: '0',          // 机器人注册是否要求邮箱验证
  bot_email_required_msg: '📧 为确保账号安全，首次使用需要验证邮箱。\n请直接发送你的邮箱地址给我。',
  bot_default_quota_mb: '1024',
  bot_quota_mode: 'pool',            // pool 共享用户额度 | standalone 独立余额
  bot_signin_enabled: '1',
  bot_signin_quota_mb: '512',
  bot_signin_reset_hour: '0',
  bot_signin_streak_bonus: '1',
  bot_signin_streak_max: '7',
  bot_max_accounts: '3',
  bot_account_days: '0',
  bot_show_link: '1',
  bot_show_qrcode: '1',
  bot_show_usage: '1',
  bot_show_nodes: '1',
  bot_require_join: '0',
  bot_require_channel: '',
  bot_rate_limit: '20',
  bot_admin_ids: '',
  bot_notify_admin: '0',
  bot_log_commands: '1',
  bot_parse_mode: 'HTML',
  bot_ref_enabled: '1',
  bot_ref_bonus_mb: '716',            // 0.7GB = 716.8MB，取 716
  bot_ref_invitee_mb: '0',            // 被邀请人奖励
  bot_ref_per_invite: '1',
  bot_ref_max_reward: '0',            // 0 表示不限制
  bot_ref_daily_limit: '0',
  bot_ref_need_verify: '1',           // 被邀请人需完成验证/签到后才生效
  bot_ref_auto_code: '1',             // 自动生成专属邀请码
  bot_ref_text: '',
  bot_menu_main: '',
  bot_menu_account: '',
  bot_menu_help: '',
  bot_button_style: 'inline',         // inline | reply
  bot_maintenance_msg: '机器人维护中，请稍后再试～',
  bot_disable_link_msg: '代理链接已在后台关闭展示，请登录网页版查看',
  bot_channel_link: '',
  bot_group_link: '',
  bot_support_link: '',
  bot_tos: '本机器人仅供合法用途，禁止用于任何违法活动。',
  // ---- 群组守卫 ----
  grp_verify_enabled: '1',
  grp_captcha_type: 'choice',        // choice 多选答案 | math 算术
  grp_captcha_options: '4',
  grp_captcha_attempts: '3',
  grp_captcha_timeout: '120',
  grp_show_admin_pass: '1',
  grp_kick_on_fail: '1',
  grp_on_join_mute: '1',
  grp_welcome_text: '',
  grp_pass_text: '✅ 验证通过，欢迎 {{name}} 加入 {{group}}！',
  grp_fail_text: '❌ 验证失败，你已被移出群组',
  grp_timeout_text: '⏰ 验证超时，你已被移出群组',
  grp_admin_allow_all: '1',
  grp_admin_whitelist: '',
  grp_word_filter_enabled: '1',
  grp_filter_words: '1',
  grp_filter_links: '1',
  grp_filter_qrcode: '1',
  grp_filter_channels: '0',        // 频道帖子是否参与检测（频道只有管理员能发帖，默认关闭）
  grp_filter_forward: '0',
  grp_filter_mention_all: '1',
  grp_filter_sticker_flood: '1',
  grp_word_action: 'delete_mute',    // delete | mute | delete_mute | kick
  grp_word_mute_minutes: '5',
  grp_flood_enabled: '1',
  grp_flood_limit: '8',
  grp_flood_window: '10',
  grp_flood_action: 'mute',
  grp_flood_mute_minutes: '10',
  grp_log_channel: '',
  grp_filter_whitelist: '',      // 免检测的用户 TG ID（逗号分隔）
  grp_link_whitelist: '',        // 链接白名单关键词（如自己的邀请链接、域名）
  grp_admin_bypass: '1',         // 管理员发的消息不检测
  grp_auto_welcome: '0',
  // ---- AI 助手 ----
  ai_enabled: '0',
  ai_default_provider: 'openai',      // openai | deepseek | moonshot | zhipu | qwen | custom
  ai_fallback_enabled: '1',
  ai_reply_private: '0',              // 私聊不启用 AI
  ai_reply_group: '1',
  ai_chat_scope: 'whitelist',         // whitelist 仅指定群组/频道 | all 所有群组
  ai_chat_ids: '',                    // 生效的群组/频道 ID（逗号分隔）
  ai_trigger: 'mention',              // mention 仅@机器人 | all 所有消息 | prefix 前缀触发
  ai_prefix: '/ai ',
  ai_typing: '1',
  ai_tools_enabled: '1',              // 允许 AI 调用工具
  ai_max_tool_rounds: '4',            // 单轮最多工具调用次数
  ai_max_history: '10',
  ai_cooldown: '3',
  ai_admin_only: '0',
  ai_unknown_fallback: '我是智能助手，可以帮你回答关于代理平台的问题。发送 /help 查看全部功能。',
  // ---- WorkBuddy ----
  wb_enabled: '0',
  wb_region: 'cn',
  wb_default_model: '',
  wb_default_account: '',
  wb_auto_checkin: '0',
  wb_checkin_hour: '9',
  // ---- 安全与维护 ----
  maintenance_mode: '0',
  maintenance_notice: '平台正在维护，请稍后再试',
  session_hours: '168',
  audit_retention_days: '90',
  force_single_session: '0',
  // ---- 人机验证 ----
  captcha_enabled: '1',
  captcha_provider: 'math',        // math | slider | image | hcaptcha | turnstile | recaptcha  (后三种需密钥)
  captcha_login: '1',
  captcha_register: '1',
  captcha_ticket: '0',
  captcha_difficulty: '2',         // 1 简单 2 普通 3 困难
  captcha_hcaptcha_site: '',
  captcha_hcaptcha_secret: '',
  captcha_turnstile_site: '',
  captcha_turnstile_secret: '',
  captcha_recaptcha_site: '',
  captcha_recaptcha_secret: '',
  // ---- 邮件模板 ----
  mail_tpl_register_subject: '欢迎加入 {{site}}',
  mail_tpl_register_body: '',
  mail_tpl_ticket_subject: '流量申请{{status}} · {{site}}',
  mail_tpl_ticket_body: '',
  mail_tpl_quota_subject: '流量使用提醒（已达 {{pct}}%）',
  mail_tpl_quota_body: '',
  mail_tpl_test_subject: 'SMTP 配置测试 · {{site}}',
  mail_tpl_test_body: '',
  mail_tpl_theme_color: '#2450eb',
  backup_keep: '10',
};
// 轻量迁移：为旧库补列（幂等）
function migrate() {
  const cols = db.prepare("PRAGMA table_info(bot_users)").all().map((c) => c.name);
  if (!cols.includes('email')) { try { db.exec('ALTER TABLE bot_users ADD COLUMN email TEXT'); } catch { /* ignore */ } }
  if (!cols.includes('email_verified')) { try { db.exec('ALTER TABLE bot_users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0'); } catch { /* ignore */ } }
}
migrate();

export function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : (defaults[key] ?? '');
}

export function getSettings() {
  const out = { ...defaults };
  for (const row of db.prepare('SELECT key, value FROM settings').all()) out[row.key] = row.value;
  return out;
}

export function setSetting(key, value) {
  db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value ?? ''));
}

export function getSettingNum(key) {
  const n = Number(getSetting(key));
  return Number.isFinite(n) ? n : Number(defaults[key] || 0);
}

export function getSettingBool(key) {
  const v = String(getSetting(key));
  return v === '1' || v === 'true';
}

/** 首次启动初始化管理员与默认节点 */
/** 把默认设置写入数据库（缺失项补全，幂等） */
export function seedSettings() {
  const ins = db.prepare('INSERT OR IGNORE INTO settings(key, value) VALUES(?, ?)');
  let n = 0;
  for (const [k, v] of Object.entries(defaults)) n += ins.run(k, v).changes;
  return n;
}

export async function seed() {
  const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
  if (!admin) {
    const pwd = process.env.INIT_ADMIN_PASSWORD || randomToken(9);
    db.prepare(`INSERT INTO users(username, password_hash, role, quota_mb, note)
                VALUES(?, ?, 'admin', 0, '系统管理员')`)
      .run(process.env.INIT_ADMIN_USER || 'admin', await hashPassword(pwd));
    return { adminCreated: true, adminPassword: pwd };
  }
  return { adminCreated: false };
}

export function audit(user, action, target, detail, ip) {
  try {
    db.prepare('INSERT INTO audit_logs(user_id, username, action, target, detail, ip) VALUES(?,?,?,?,?,?)')
      .run(user?.id ?? null, user?.username ?? null, action, target ?? '', detail ? String(detail).slice(0, 2000) : '', ip ?? '');
  } catch { /* ignore */ }
}
