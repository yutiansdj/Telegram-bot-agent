#!/usr/bin/env bash
#
# TG 免费代理申请平台 · 一键安装脚本
# 支持: Debian 10+ / Ubuntu 20.04+
# 用法: sudo bash install.sh [安装目录]
#
set -euo pipefail

# ============ 配置 ============
TG_ROOT="${1:-/opt/tgproxy}"
TG_USER="root"
NODE_VER="20.18.1"
MTG_VER="2.2.8"
PORT_API=3001
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ============ 输出 ============
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${BLUE}[信息]${NC} $*"; }
ok()    { echo -e "${GREEN}[完成]${NC} $*"; }
warn()  { echo -e "${YELLOW}[警告]${NC} $*"; }
err()   { echo -e "${RED}[错误]${NC} $*" >&2; }
step()  { echo -e "\n${CYAN}━━━ $* ━━━${NC}"; }

banner() {
cat <<'BANNER'
  ╔══════════════════════════════════════════════╗
  ║   TG 免费代理申请平台 · 一键部署             ║
  ║   MTProto Proxy Platform Installer           ║
  ╚══════════════════════════════════════════════╝
BANNER
}

# ============ 检查 ============
check_root() {
  [ "$(id -u)" -eq 0 ] || { err "请使用 root 用户运行：sudo bash install.sh"; exit 1; }
}

check_os() {
  if [ -f /etc/os-release ]; then
    . /etc/os-release
    info "系统: $PRETTY_NAME"
  else
    warn "无法识别系统版本，继续尝试..."
  fi
  ARCH=$(uname -m)
  case "$ARCH" in
    x86_64|amd64) ARCH_TAG="amd64" ;;
    aarch64|arm64) ARCH_TAG="arm64" ;;
    *) err "不支持的架构: $ARCH（仅支持 x86_64 / arm64）"; exit 1 ;;
  esac
  info "架构: $ARCH"
}

# ============ 依赖 ============
install_base() {
  step "1/11 安装基础依赖"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq 2>/dev/null || warn "apt update 有警告，继续"
  apt-get install -y -qq curl wget ca-certificates xz-utils tar unzip \
      build-essential python3 python3-venv python3-dev \
      nginx sqlite3 iptables iproute2 jq cron 2>&1 | grep -vE "^(Reading|Building|Fetched)" || true
  ok "基础依赖安装完成"
}

install_node() {
  step "2/11 安装 Node.js ${NODE_VER}"
  if command -v node >/dev/null 2>&1; then
    CUR=$(node -v | sed 's/v//' | cut -d. -f1)
    if [ "$CUR" -ge 18 ]; then
      info "已安装 Node.js $(node -v)，跳过"
      return
    fi
  fi
  info "下载 Node.js ${NODE_VER}..."
  cd /tmp
  wget -q "https://nodejs.org/dist/v${NODE_VER}/node-v${NODE_VER}-linux-x64.tar.xz" -O node.tar.xz || {
    err "Node.js 下载失败，请检查网络"; exit 1; }
  tar -xJf node.tar.xz -C /usr/local --strip-components=1 --exclude=CHANGELOG.md --exclude=LICENSE --exclude=README.md
  hash -r
  ok "Node.js $(node -v) / npm $(npm -v)"
}

install_mtg() {
  step "3/11 安装 MTProto 代理内核（mtprotoproxy）"
  mkdir -p "$TG_ROOT/bin"
  python3 -m venv "$TG_ROOT/venv"
  "$TG_ROOT/venv/bin/pip" install -q --upgrade pip 2>/dev/null || true
  "$TG_ROOT/venv/bin/pip" install -q mtprotoproxy || { err "mtprotoproxy 安装失败"; exit 1; }
  ok "代理内核就绪：$($TG_ROOT/venv/bin/pip show mtprotoproxy 2>/dev/null | grep Version || echo OK)"
}

install_chromium() {
  step "4/11 安装网页截图组件（Chromium）"
  export DEBIAN_FRONTEND=noninteractive
  info "安装 Chromium 浏览器（约 200MB，用于 AI 网页截图功能）..."
  apt-get install -y -qq chromium 2>&1 | tail -1 || {
    warn "chromium 安装失败，网页截图功能将不可用"
    return
  }
  info "安装中文字体（避免截图中文显示为方框）..."
  apt-get install -y -qq fonts-noto-cjk fonts-wqy-zenhei fontconfig 2>&1 | tail -1 || warn "字体安装失败"
  fc-cache -f >/dev/null 2>&1 || true
  if command -v chromium >/dev/null 2>&1; then
    ok "Chromium $(chromium --version 2>/dev/null | awk '{print $2}') 就绪"
    info "中文字体: $(fc-list :lang=zh 2>/dev/null | wc -l) 个"
  else
    warn "Chromium 未安装成功"
  fi
}

install_postfix() {
  step "5/11 安装内置邮件中继（Postfix）"
  echo "postfix postfix/main_mailer_type select Internet Site" | debconf-set-selections 2>/dev/null || true
  echo "postfix postfix/mailname string localhost" | debconf-set-selections 2>/dev/null || true
  apt-get install -y -qq postfix 2>&1 | tail -1 || warn "Postfix 安装失败（邮件功能将不可用）"
  if command -v postfix >/dev/null 2>&1; then
    postconf -e "inet_interfaces = loopback-only" 2>/dev/null || true
    postconf -e "inet_protocols = ipv4" 2>/dev/null || true
    systemctl enable postfix >/dev/null 2>&1 || true
    systemctl restart postfix >/dev/null 2>&1 || true
    ok "Postfix 已启动（本机中继）"
  fi
}

# ============ 部署 ============
deploy_files() {
  step "6/11 部署程序文件"
  mkdir -p "$TG_ROOT"/{backend/data,frontend,instances,uploads,run,bin}
  [ -d "$SCRIPT_DIR/backend" ] || { err "找不到 backend 目录，请确保在解压后的项目根目录运行"; exit 1; }

  cp -r "$SCRIPT_DIR/backend/src" "$TG_ROOT/backend/"
  cp "$SCRIPT_DIR/backend/package.json" "$TG_ROOT/backend/"
  [ -f "$SCRIPT_DIR/backend/package-lock.json" ] && cp "$SCRIPT_DIR/backend/package-lock.json" "$TG_ROOT/backend/"

  cp -r "$SCRIPT_DIR/frontend/src" "$TG_ROOT/frontend/"
  [ -d "$SCRIPT_DIR/frontend/public" ] && cp -r "$SCRIPT_DIR/frontend/public" "$TG_ROOT/frontend/"
  [ -d "$SCRIPT_DIR/frontend/scripts" ] && cp -r "$SCRIPT_DIR/frontend/scripts" "$TG_ROOT/frontend/"
  for f in package.json vite.config.js tailwind.config.js postcss.config.js index.html; do
    [ -f "$SCRIPT_DIR/frontend/$f" ] && cp "$SCRIPT_DIR/frontend/$f" "$TG_ROOT/frontend/"
  done
  [ -f "$SCRIPT_DIR/README.md" ] && cp "$SCRIPT_DIR/README.md" "$TG_ROOT/"
  ok "文件已复制到 $TG_ROOT"
}

gen_env() {
  step "7/11 生成配置文件"
  if [ -f "$TG_ROOT/backend/.env" ]; then
    warn ".env 已存在，保留原配置（不覆盖）"
  else
    JWT=$(head -c 48 /dev/urandom | md5sum | cut -d' ' -f1)$(head -c 16 /dev/urandom | md5sum | cut -d' ' -f1)
    IP=$(curl -s4 --max-time 5 https://api.ipify.org 2>/dev/null || echo "")
    cat > "$TG_ROOT/backend/.env" <<EOF
# ---- 服务配置 ----
PORT=${PORT_API}
HOST=127.0.0.1
JWT_SECRET=${JWT}
TOKEN_TTL=604800
TGPROXY_ROOT=${TG_ROOT}
LOG_REQUESTS=1
CHROMIUM_PATH=/usr/bin/chromium
EOF
    chmod 600 "$TG_ROOT/backend/.env"
    ok ".env 已生成（JWT 密钥随机）"
    [ -n "$IP" ] && info "检测到公网 IP: $IP"
  fi
}

build_backend() {
  step "8/11 安装后端依赖"
  cd "$TG_ROOT/backend"
  npm install --production --no-audit --no-fund 2>&1 | tail -3
  npm install playwright-core --no-audit --no-fund 2>&1 | tail -1 || warn "playwright-core 安装失败，截图功能不可用"
  ok "后端依赖安装完成"
}

build_frontend() {
  step "9/11 构建前端"
  cd "$TG_ROOT/frontend"
  rm -rf node_modules/.vite dist
  npm install --no-audit --no-fund 2>&1 | tail -3
  npm run build 2>&1 | tail -6
  find "$TG_ROOT/frontend" -maxdepth 1 -type d -exec chmod 755 {} \;
  chmod -R a+rX "$TG_ROOT/frontend/dist"
  ok "前端构建完成"
}

# ============ 系统集成 ============
setup_systemd() {
  step "10/11 配置系统服务"
  cat > /etc/systemd/system/tgproxy.service <<EOF
[Unit]
Description=TG Proxy Platform API
After=network-online.target postfix.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${TG_ROOT}/backend
ExecStart=/usr/local/bin/node src/index.js
Environment=NODE_ENV=production
Restart=always
RestartSec=3
LimitNOFILE=1048576
KillMode=control-group
TimeoutStopSec=10

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable tgproxy >/dev/null 2>&1
  systemctl restart tgproxy
  sleep 4
  if systemctl is-active --quiet tgproxy; then
    ok "后端服务已启动"
  else
    err "后端启动失败，查看日志: journalctl -u tgproxy -n 50"
    journalctl -u tgproxy -n 20 --no-pager
    exit 1
  fi
}

setup_nginx() {
  info "配置 Nginx 反向代理"
  cat > /etc/nginx/sites-available/tgproxy <<EOF
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    root ${TG_ROOT}/frontend/dist;
    index index.html;
    client_max_body_size 8m;

    gzip on;
    gzip_comp_level 5;
    gzip_min_length 1024;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml image/svg+xml;

    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options SAMEORIGIN always;

    location /api/ {
        proxy_pass http://127.0.0.1:${PORT_API};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
    }

    location /uploads/ {
        alias ${TG_ROOT}/uploads/;
        expires 1d;
        access_log off;
        try_files \$uri =404;
    }

    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        try_files \$uri =404;
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
EOF
  rm -f /etc/nginx/sites-enabled/default
  ln -sf /etc/nginx/sites-available/tgproxy /etc/nginx/sites-enabled/tgproxy
  nginx -t 2>&1 | grep -q "successful" && systemctl reload nginx && ok "Nginx 已配置并重载" || { err "Nginx 配置有误"; nginx -t; }
}

setup_firewall() {
  info "配置防火墙规则"
  # iptables 计费链
  iptables -N TGACCT 2>/dev/null || true
  iptables -C OUTPUT -j TGACCT 2>/dev/null || iptables -I OUTPUT 1 -j TGACCT 2>/dev/null || true
  iptables -N TGGATE 2>/dev/null || true
  iptables -C OUTPUT -j TGGATE 2>/dev/null || iptables -I OUTPUT 1 -j TGGATE 2>/dev/null || true
  sysctl -w net.ipv4.conf.all.route_localnet=1 >/dev/null 2>&1 || true
  ok "计费规则已初始化"
}

service_ipv6() {
  # 代理端口需要外网访问（IPv6）
  local IFACE=$(ip -o -6 route show default 2>/dev/null | awk '{print $5}' | head -1)
  if [ -n "$IFACE" ]; then
    ip6tables -C INPUT -p tcp --dport 20000:65535 -j ACCEPT 2>/dev/null || \
      ip6tables -I INPUT -p tcp --dport 20000:65535 -j ACCEPT 2>/dev/null || true
    ok "已放行代理端口（IPv6: 20000-65535）"
  fi
  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
    ufw allow 80/tcp >/dev/null 2>&1 || true
    ufw allow 20000:20100/tcp >/dev/null 2>&1 || true
    ok "UFW 规则已添加"
  fi
  ok "端口放行完成"
}

setup_billing_users() {
  info "初始化计费系统用户组"
  if ! getent group tgproxy >/dev/null 2>&1; then
    groupadd -r tgproxy 2>/dev/null || true
  fi
  ok "计费用户组就绪"
}

# ============ 结果 ============
show_result() {
  # 优先公网 IPv4，其次内网 IPv4，最后才用 IPv6
  local IP=$(curl -s4 --max-time 5 https://ipinfo.io/ip 2>/dev/null | tr -d '\n' || true)
  [ -z "$IP" ] && IP=$(curl -s4 --max-time 5 https://api.ipify.org 2>/dev/null | tr -d '\n' || true)
  if [ -z "$IP" ]; then
    IP=$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' | grep -v '^127\.' | head -1 || true)
  fi
  if [ -z "$IP" ]; then
    IP=$(hostname -I 2>/dev/null | awk '{print $1}' || true)
  fi
  local PASS_FILE="$TG_ROOT/backend/data/INIT_ADMIN_PASSWORD"
  local ADMIN_USER="admin"
  local ADMIN_PASS=""

  if [ -f "$PASS_FILE" ]; then
    ADMIN_USER=$(awk '{print $1}' "$PASS_FILE" | head -1)
    ADMIN_PASS=$(awk '{print $3}' "$PASS_FILE" | head -1)
  fi

  # 若拿不到公网 IP，用网卡地址兜底
  if [ -z "$IP" ]; then
    IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "服务器IP")
  fi

  echo ""
  echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${GREEN}║                  🎉  部 署 成 功                            ║${NC}"
  echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
  echo ""
  echo -e "  ${CYAN}▸ 后台地址${NC}"
  echo -e "      http://${IP}/"
  echo -e "      http://${IP}/admin/overview"
  echo ""
  echo -e "  ${CYAN}▸ 管理员账号${NC}"
  if [ -n "$ADMIN_PASS" ]; then
    echo -e "      用户名：${GREEN}${ADMIN_USER}${NC}"
    echo -e "      密　码：${GREEN}${ADMIN_PASS}${NC}"
  else
    echo -e "      用户名：${ADMIN_USER}"
    echo -e "      密　码：${YELLOW}（请查看 ${PASS_FILE}）${NC}"
  fi
  echo ""
  echo -e "  ${YELLOW}⚠️  首次登录需要完成人机验证（算术题），答对即可进入${NC}"
  echo -e "  ${YELLOW}⚠️  登录后请立即到「个人设置」修改密码，并删除密码文件：${NC}"
  echo -e "      rm -f ${PASS_FILE}"
  echo ""
  echo -e "  ${CYAN}▸ 常用命令${NC}"
  echo "      systemctl status tgproxy      # 查看后端状态"
  echo "      systemctl restart tgproxy     # 重启后端（自动拉起全部代理）"
  echo "      journalctl -u tgproxy -f      # 实时查看日志"
  echo "      bash ${TG_ROOT}/build-fe.sh   # 修改前端后重新构建"
  echo ""
  echo -e "  ${CYAN}▸ 接下来需要配置（登录后台完成）${NC}"
  echo "      1. 系统配置 → 站点设置      改站点名称、上传 Logo"
  echo "      2. 系统配置 → 邮件服务      填邮箱账号和授权码（用于发验证码）"
  echo "      3. 系统配置 → 机器人配置    填入 @BotFather 获取的 Bot Token"
  echo "      4. 系统配置 → 群组管理      把机器人拉进群并设为管理员"
  echo "      5. 用户与代理 → 节点管理    确认节点端口池范围"
  echo ""
  echo -e "  ${CYAN}▸ 详细文档${NC}: ${TG_ROOT}/README.md"
  echo ""
  echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
  echo ""
}
# ============ 主流程 ============
main() {
  banner
  check_root
  check_os
  install_base
  install_node
  install_mtg
  install_postfix
  install_chromium
  deploy_files
  gen_env
  build_backend
  build_frontend
  setup_systemd
  setup_nginx
  setup_firewall
  service_ipv6
  setup_billing_users
  show_result
}

main "$@"
