# TG 免费代理申请平台

Telegram MTProto 代理自助申请与管理平台，附带 AI 智能助手、多机器人管理、群组守卫、WorkBuddy 集成。

---

## 一、快速安装

### 环境要求
- Debian 11+ / Ubuntu 20.04+
- 2 核 2G 起（推荐 2 核 4G，AI 截图功能需额外内存）
- 需要 **IPv6 出口**（代理走 IPv6 连接 Telegram）

### 安装步骤

```bash
unzip tgproxy.zip
cd tgproxy
sudo bash install.sh              # 默认装到 /opt/tgproxy
sudo bash install.sh /www/tg     # 或指定目录
```

安装程序自动完成 **11 个步骤**：
1. 基础依赖（nginx/sqlite3/iptables/python3）
2. Node.js 20
3. MTProto 代理内核（mtprotoproxy）
4. **Chromium + 中文字体**（AI 网页截图）
5. Postfix 邮件中继
6. 部署程序文件
7. 生成 .env（随机 JWT 密钥）
8. 后端依赖
9. 前端构建
10. systemd + Nginx 配置
11. 防火墙计费链初始化

---

## 二、核心功能

### 用户端
- 自助创建 MTProto 代理（独立端口 + 独立密钥）
- 流量统计、每日签到、邀请奖励
- 代理链接一键导入 Telegram

### 管理端
| 模块 | 功能 |
|---|---|
| 运维总览 | 用户/代理/流量全局统计 |
| 用户与代理 | 用户管理、代理管理、节点管理、申请审核 |
| 机器人 | **多机器人**（独立 Token 并行运行）、命令菜单、邀请奖励、广播 |
| **AI 助手** | 多供应商模型配置、生效范围、调用日志 |
| **WorkBuddy** | 登录账号、拉取模型、签到、查积分、接入 AI |
| 群组管理 | 入群验证、违禁词拦截、管理员权限、群成员 |
| 内容运营 | 公告、站点设置、外观主题 |
| 系统配置 | 邮件、人机验证、注册策略、登录安全、备份、审计 |

---

## 三、AI 智能助手

### 支持的供应商
```
OpenAI · DeepSeek · Moonshot(Kimi) · 智谱GLM
通义千问 · 硅基流动 · OpenRouter · WorkBuddy · 自定义
```

### 触发方式
在后台指定的群组里 @机器人：
```
@你的机器人 你好
```

### AI 能做的事（工具系统）

**普通用户**：
- 查自己的余额、流量、代理列表
- 平台使用帮助
- 写笔记、列笔记
- **报告自己的模型名**
- **打开网页并截图**（`帮我打开 https://bing.com/`）

**管理员额外**：
- 查平台概况、机器人状态、群组列表
- 搜索操作日志
- **执行安全的只读 shell 命令**（`df -h`、`ps aux`、`systemctl status`）

### 安全红线（永远禁止）

| 禁止项 | 说明 |
|---|---|
| ❌ 群管理命令 | AI 不能执行 ban/mute/kick，只能人工操作 |
| ❌ 修改群组设置 | 不能改入群验证、违禁词、管理员权限 |
| ❌ 危险 shell | rm/dd/apt/chmod/sudo/管道/重定向/命令串联 全部拦截 |
| ❌ 内网访问 | 截图不能访问 127.x/10.x/192.168.x/云元数据 |
| ❌ 泄露账号 | API Key、UID、邮箱、手机号自动脱敏 |

### 对话记忆
- 每个用户在每个群有**独立上下文**
- 持久化到数据库，重启不丢失
- 默认记住最近 10 轮
- 发送 `/reset` 清空对话

---

## 四、WorkBuddy 集成

1. 后台 → **WorkBuddy → 添加账号**
2. 选择国内版/国际版 → 获取授权链接
3. 浏览器登录 → 自动获取 Token
4. 可查看：**模型列表（34个）、积分余额、每日签到**
5. 点「接入AI」→ 自动同步到 AI 助手

在 AI 模型配置里选 WorkBuddy 供应商，会**自动列出已登录账号**，无需手动填 API Key。

---

## 五、目录结构

```
/opt/tgproxy/
├── backend/
│   ├── src/
│   │   ├── ai.js           # AI 对话与工具循环
│   │   ├── aitools.js      # 工具定义（白名单）
│   │   ├── shellguard.js   # shell 命令安全过滤
│   │   ├── screenshot.js   # 网页截图
│   │   ├── workbuddy.js    # WorkBuddy 协议
│   │   ├── botmanager.js   # 多机器人管理
│   │   ├── bot.js          # 机器人核心
│   │   └── ...
│   ├── data/app.db         # SQLite 数据库
│   └── .env                # 配置（勿泄露）
├── frontend/dist/          # 前端构建产物
├── instances/              # 各代理配置
├── uploads/shots/          # AI 截图缓存
└── venv/                   # 代理内核环境
```

---

## 六、常用命令

```bash
systemctl status tgproxy        # 后端状态
systemctl restart tgproxy       # 重启（会自动拉起全部代理和机器人）
journalctl -u tgproxy -f        # 实时日志

cd /opt/tgproxy/frontend && npm run build   # 改造前端后重新构建

iptables -L TGACCT -v -n -x     # 查看流量计数

# 重置管理员密码
cd /opt/tgproxy/backend
node -e "
const argon2=require(argon2);
const db=require(better-sqlite3)(data/app.db);
argon2.hash(新密码).then(h=>{
  db.prepare(\"UPDATE users SET password_hash=? WHERE role=admin\").run(h);
  console.log(已重置);
});"
```

---

## 七、首次配置清单

1. **站点设置** — 改站名、上传 Logo
2. **邮件服务** — 选邮箱服务商，填账号和**授权码**
3. **人机验证** — 选验证方式
4. **机器人 → 多机器人** — 粘贴 @BotFather 的 Token，「保存并启动」
5. **群组管理** — 机器人设为群管理员，**必须开启「删除消息」「封禁用户」**
6. **AI 助手** — 添加模型（或用 WorkBuddy 账号），选择生效群组

---

## 八、故障排查

| 现象 | 排查 |
|---|---|
| 网页打不开 | `systemctl status nginx tgproxy` |
| 机器人不响应 | `journalctl -u tgproxy -f`，检查是否为 `Conflict` |
| **机器人报 Conflict** | 同一 Token 只能有一个实例轮询，检查是否重复添加 |
| 截图中文变方框 | `apt install fonts-noto-cjk && fc-cache -f` |
| 截图失败 | `which chromium`，检查 `.env` 里 CHROMIUM_PATH |
| AI 调用失败 | 后台「AI 助手 → 调用日志」看错误 |
| WorkBuddy 报 11148 | 已知限制，系统已自动改为单轮模式 |
| 收不到邮件 | 后台「邮件服务」点「发送测试」看报错 |

---

## 九、安全建议

1. **立即修改管理员密码**
2. **配置 HTTPS**：`certbot --nginx -d 你的域名`
3. **保护 .env**：`chmod 600 /opt/tgproxy/backend/.env`
4. **定期备份**：后台「数据与备份」或 `sqlite3 app.db ".backup backup.db"`
5. **审慎使用 shell 工具**：虽有三层过滤，仍建议只给信任的管理员

---

## 十、许可

仅供学习与合法用途，禁止用于任何违法活动。
