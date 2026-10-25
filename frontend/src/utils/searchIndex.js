/**
 * 后台全局搜索索引
 * type: page（页面）| setting（设置项，带 anchor）| action（功能操作）
 * tags: 额外关键词（含拼音首字母、别名）
 */
export const SEARCH_INDEX = [
  // ==================== 运维概览 ====================
  { type: 'page', path: '/admin/overview', title: '运维总览', desc: '平台整体运行状态、用户与代理规模', icon: 'tabler:gauge', tags: ['dashboard', 'gal', '总览', '概览', '首页'] },
  { type: 'page', path: '/admin/system', title: '运行状态', desc: 'CPU、内存、磁盘、Telegram 连通性', icon: 'tabler:activity', tags: ['yunxing', 'zhuangtai', 'cpu', '内存', '磁盘', '监控', 'jk'] },

  // ==================== 用户与代理 ====================
  { type: 'page', path: '/admin/users', title: '用户管理', desc: '注册用户、额度分配、禁用与删除', icon: 'tabler:users', tags: ['yonghu', 'yh', 'g管理', 'member', 'users', '分配流量'] },
  { type: 'page', path: '/admin/accounts', title: '代理管理', desc: '全平台代理账号、端口、密钥与进程', icon: 'tabler:affiliate', tags: ['daili', 'dl', 'proxy', '账号', '端口', '密钥', 'secret'] },
  { type: 'page', path: '/admin/nodes', title: '节点管理', desc: '代理节点地址、端口池与健康状态', icon: 'tabler:server-2', tags: ['jiedian', 'jd', 'node', '服务器', '端口池'] },
  { type: 'page', path: '/admin/tickets', title: '申请审核', desc: '用户流量申请的审核与批量处理', icon: 'tabler:ticket', tags: ['shenhe', 'sh', '工单', '申请', 'ticket', '审核'] },

  // ==================== 机器人 ====================
  { type: 'page', path: '/admin/bot', title: '机器人配置', desc: 'TG 机器人 Token、菜单、邀请、广播', icon: 'tabler:brand-telegram', tags: ['jiqiren', 'jqr', 'bot', 'telegram', 'tg'] },
  { type: 'setting', path: '/admin/bot', anchor: 'bot-token', tab: 'connect', title: 'Bot Token', desc: '机器人配置 · 连接设置', icon: 'tabler:key', tags: ['token', '令牌', 'tp'] },
  { type: 'setting', path: '/admin/bot', anchor: 'bot-commands', tab: 'connect', title: '机器人命令菜单', desc: '私聊 / 群组 / 管理员命令配置', icon: 'tabler:terminal', tags: ['mingling', 'ml', 'command', '菜单'] },
  { type: 'setting', path: '/admin/bot', anchor: 'bot-ops', tab: 'ops', title: '运营配置', desc: '初始额度、签到、白名单、文案', icon: 'tabler:adjustments', tags: ['yunying', 'yy', '额度', '签到', 'qiandao', 'qd'] },
  { type: 'setting', path: '/admin/bot', anchor: 'bot-admin-ids', tab: 'ops', title: '管理员 Telegram ID', desc: '拥有机器人管理权限的用户', icon: 'tabler:user-shield', tags: ['guanliyuan', 'gly', 'admin', '白名单'] },
  { type: 'page', path: '/admin/bot', anchor: 'bot-invite', tab: 'invite', title: '邀请奖励', desc: '专属邀请链接，每邀请一人奖励流量', icon: 'tabler:gift', tags: ['yaoqing', 'yq', 'invite', '邀请码', '奖励'] },
  { type: 'page', path: '/admin/bot', anchor: 'bot-broadcast', tab: 'broadcast', title: '通知广播', desc: '向全部用户、指定用户或群组发通知', icon: 'tabler:send', tags: ['guangbo', 'gb', 'broadcast', '通知', '群发'] },
  { type: 'page', path: '/admin/bot', anchor: 'bot-users', tab: 'users', title: '机器人用户', desc: 'TG 用户列表、余额、封禁', icon: 'tabler:user-check', tags: ['jqr用户', 'bot user', '余额'] },

  // ==================== AI ====================
  { type: 'page', path: '/admin/ai', title: 'AI 助手', desc: '接入大模型，群组 @机器人 智能回复', icon: 'tabler:sparkles', tags: ['ai', '智能', 'zhineng', 'zn', '大模型', 'llm', '对话', 'duihua', 'dh', 'gpt', 'deepseek'] },
  { type: 'setting', path: '/admin/ai', anchor: 'ai-scope', tab: 'config', title: 'AI 生效范围', desc: '选择哪些群组/频道启用 AI', icon: 'tabler:list-check', tags: ['ai', 'fanwei', 'fw', '范围', '群组'] },
  { type: 'setting', path: '/admin/ai', anchor: 'ai-models', tab: 'models', title: 'AI 模型配置', desc: 'API Key、模型选择、测试连接', icon: 'tabler:settings', tags: ['ai', 'moxing', 'mx', '模型', 'key', 'apikey', 'api'] },
  { type: 'setting', path: '/admin/ai', anchor: 'ai-logs', tab: 'logs', title: 'AI 调用日志', desc: '查看提问、回复、耗时与成功率', icon: 'tabler:file-text', tags: ['ai', 'rizhi', 'rz', '日志'] },
  { type: 'page', path: '/admin/workbuddy', title: 'WorkBuddy', desc: '登录账号、拉取模型、签到、查积分', icon: 'tabler:brand-openai', tags: ['wb', 'workbuddy', 'ai', '签到', 'qiandao', 'qd', '积分', 'jifen', '余额', 'yue'] },

  // ==================== 群组 ====================
  { type: 'page', path: '/admin/groups', title: '群组管理', desc: '入群验证、违禁词拦截、管理员权限', icon: 'tabler:users-group', tags: ['qunzu', 'qz', 'group', '群组', '频道', 'channel'] },
  { type: 'setting', path: '/admin/groups', anchor: 'grp-verify', tab: 'verify', title: '入群人机验证', desc: '新成员需答题验证，答错踢出', icon: 'tabler:shield-lock', tags: ['ruqun', 'rq', 'yzm', '验证', 'captcha'] },
  { type: 'setting', path: '/admin/groups', anchor: 'grp-filter', tab: 'filter', title: '违禁内容检测', desc: '违禁词、链接、二维码、刷屏拦截', icon: 'tabler:filter', tags: ['weijin', 'wj', '违禁词', '敏感词', 'filter', '链接'] },
  { type: 'setting', path: '/admin/groups', anchor: 'grp-admins', tab: 'admins', title: '群管理员权限', desc: '允许/禁用管理员使用放行按钮', icon: 'tabler:user-cog', tags: ['guanliyuan', 'gly', 'admin'] },
  { type: 'setting', path: '/admin/groups', anchor: 'grp-words', tab: 'filter', title: '违禁词库', desc: '关键词与正则规则、禁言时长', icon: 'tabler:list-search', tags: ['wenzi', 'wz', '词库', 'words'] },
  { type: 'page', path: '/admin/groups', anchor: 'grp-members', tab: 'members', title: '群成员', desc: '机器人在群内见过的成员列表', icon: 'tabler:users', tags: ['chengyuan', 'cy', 'members'] },
  { type: 'page', path: '/admin/groups', anchor: 'grp-sessions', tab: 'sessions', title: '验证记录', desc: '入群验证的通过/失败历史', icon: 'tabler:history', tags: ['jilu', 'jl', '验证记录'] },
  { type: 'page', path: '/admin/groups', anchor: 'grp-logs', tab: 'logs', title: '处理日志', desc: '拦截、禁言、踢出等操作记录', icon: 'tabler:file-text', tags: ['rizhi', 'rz', 'logs', '日志'] },

  // ==================== 内容运营 ====================
  { type: 'page', path: '/admin/notices', title: '公告管理', desc: '全站公告与滚动跑马灯', icon: 'tabler:speakerphone', tags: ['gonggao', 'gg', 'notice', '跑马灯', 'marquee'] },
  { type: 'page', path: '/admin/site', title: '站点设置', desc: '站点名称、Logo、图标、页脚', icon: 'tabler:world', tags: ['zhandian', 'zd', 'site', '名称', 'logo', '图标', 'favicon'] },
  { type: 'setting', path: '/admin/site', anchor: 'site-logo', title: '站点 Logo 上传', desc: '侧边栏顶部品牌标识', icon: 'tabler:photo', tags: ['logo', '标识', '品牌'] },
  { type: 'setting', path: '/admin/site', anchor: 'site-favicon', title: '网站图标 Favicon', desc: '浏览器标签页图标', icon: 'tabler:photo-heart', tags: ['favicon', '图标', 'ico'] },
  { type: 'setting', path: '/admin/site', anchor: 'site-loginbg', title: '登录页背景图', desc: '登录页左侧品牌区背景', icon: 'tabler:wallpaper', tags: ['登录', 'dengluye', '背景', 'bg'] },
  { type: 'page', path: '/admin/appearance', title: '外观主题', desc: '配色方案、圆角、侧栏风格、登录页样式', icon: 'tabler:palette', tags: ['waiguan', 'wg', '主题', 'zt', 'theme', '配色', '颜色'] },

  // ==================== 系统配置 ====================
  { type: 'page', path: '/admin/smtp', title: '发信配置', desc: 'SMTP 邮件服务与测试发送', icon: 'tabler:mail', tags: ['smtp', 'youjian', 'yj', '邮件', 'email', '发信'] },
  { type: 'setting', path: '/admin/smtp', anchor: 'smtp-preset', title: '邮箱服务商预设', desc: 'QQ/163/Gmail 等一键填充', icon: 'tabler:building-store', tags: ['youxiang', 'yx', '服务商', 'qq', '163'] },
  { type: 'setting', path: '/admin/smtp', anchor: 'smtp-auth', title: '发件账号与授权码', desc: '邮箱登录账号与应用授权码', icon: 'tabler:password', tags: ['授权码', 'shouquanma', 'sqm', '账号', '密码'] },
  { type: 'setting', path: '/admin/smtp', anchor: 'smtp-test', title: '发送测试邮件', desc: '验证邮件配置是否可用', icon: 'tabler:send', tags: ['测试', 'ceshi', 'cs', 'test'] },
  { type: 'page', path: '/admin/templates', title: '邮件模板', desc: '各类通知邮件的标题与正文，支持预览', icon: 'tabler:template', tags: ['moban', 'mb', '模板', 'template', '邮件内容'] },
  { type: 'page', path: '/admin/captcha', title: '人机验证', desc: '登录/注册防刷的图形验证码', icon: 'tabler:shield-lock', tags: ['renjiyanzheng', 'rjyz', '验证码', 'yzm', 'captcha', '滑块', 'huakuai'] },
  { type: 'setting', path: '/admin/captcha', anchor: 'captcha-provider', title: '验证方式', desc: '算术题/图形/滑块/第三方验证', icon: 'tabler:select', tags: ['fangshi', 'fs', '方式', 'provider'] },
  { type: 'setting', path: '/admin/captcha', anchor: 'captcha-scenes', title: '验证场景', desc: '登录、注册、提交流量申请', icon: 'tabler:list-check', tags: ['changjing', 'cj', '场景'] },
  { type: 'page', path: '/admin/security', title: '注册策略', desc: '注册开关、邮箱验证、额度与限制', icon: 'tabler:lock-access', tags: ['zhuce', 'zc', 'register', '策略'] },
  { type: 'setting', path: '/admin/security', anchor: 'sec-email-verify', title: '注册需邮箱验证', desc: '用户必须验证邮箱才能注册', icon: 'tabler:mail-check', tags: ['youxiangyanzheng', 'yxyz', '邮箱验证', 'verify'] },
  { type: 'setting', path: '/admin/security', anchor: 'sec-quota', title: '注册额度与限制', desc: '初始额度、代理数上限、密码长度', icon: 'tabler:adjustments', tags: ['edu', 'ed', '额度', '限制'] },
  { type: 'page', path: '/admin/loginsecurity', title: '登录安全', desc: '失败锁定、会话时长、登录日志', icon: 'tabler:shield-check', tags: ['denglu', 'dl', 'login', '安全', 'aq', '锁定'] },
  { type: 'page', path: '/admin/backup', title: '数据与备份', desc: '数据库备份、清理、维护模式', icon: 'tabler:database', tags: ['shujv', 'sj', 'data', '备份', 'beifen', 'bf', '维护'] },
  { type: 'setting', path: '/admin/backup', anchor: 'backup-create', title: '立即备份', desc: '生成数据库快照并可下载', icon: 'tabler:database-plus', tags: ['beifen', 'bf', 'backup', '快照'] },
  { type: 'setting', path: '/admin/backup', anchor: 'backup-maintenance', title: '维护模式', desc: '开启后仅管理员可登录', icon: 'tabler:tool', tags: ['weihu', 'wh', 'maintenance'] },
  { type: 'setting', path: '/admin/backup', anchor: 'backup-cleanup', title: '数据清理', desc: '清理过期日志与流量明细', icon: 'tabler:trash', tags: ['qingli', 'ql', 'cleanup', '清理'] },
  { type: 'page', path: '/admin/audit', title: '审计日志', desc: '所有关键操作与登录记录', icon: 'tabler:file-search', tags: ['shenji', 'sj', 'audit', '日志', 'rizhi'] },
  { type: 'page', path: '/admin/settings', title: '系统设置', desc: '站点、注册、邮件、代理等全部配置', icon: 'tabler:tool', tags: ['shezhi', 'sz', 'settings', '配置', 'peizhi'] },

  // ==================== 用户端 ====================
  { type: 'page', path: '/dashboard', title: '仪表盘', desc: '流量概况与代理状态', icon: 'tabler:layout-dashboard', tags: ['yibiaopan', 'ybp', 'dashboard'] },
  { type: 'page', path: '/accounts', title: '我的代理', desc: '创建与管理我的代理链接', icon: 'tabler:router', tags: ['daili', 'wddl', '我的代理'] },
  { type: 'page', path: '/traffic', title: '流量统计', desc: '按天查看流量消耗', icon: 'tabler:chart-area-line', tags: ['liuliang', 'll', '流量'] },
  { type: 'page', path: '/tickets', title: '申请流量', desc: '提交流量申请', icon: 'tabler:ticket', tags: ['shenqing', 'sq', '申请'] },
  { type: 'page', path: '/applications', title: '申请记录', desc: '查看申请与审核结果', icon: 'tabler:clipboard-list', tags: ['jilu', 'jl', '记录'] },
  { type: 'page', path: '/guide', title: '使用教程', desc: '代理配置与常见问题', icon: 'tabler:book', tags: ['jiaocheng', 'jc', 'guide', '帮助'] },
  { type: 'page', path: '/profile', title: '个人设置', desc: '账号资料、密码与偏好', icon: 'tabler:user-circle', tags: ['geren', 'gr', 'profile', '密码', 'mima'] },
  { type: 'page', path: '/notifications', title: '消息通知', desc: '平台公告与系统消息', icon: 'tabler:bell', tags: ['xiaoxi', 'xx', '通知', 'notification'] },
];
