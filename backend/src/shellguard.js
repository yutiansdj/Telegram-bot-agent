/**
 * Shell 命令安全过滤器
 *
 * 三层防护：
 *   1. 白名单命令检查（只允许明确安全的只读命令）
 *   2. 危险模式拦截（黑名单正则，兜底）
 *   3. 参数校验（禁止重定向、管道到危险命令、命令替换等）
 *
 * 设计原则：默认拒绝（fail-closed），只放行明确知道安全的命令。
 */

// ---------- 严格白名单：只允许这些命令 ----------
const ALLOW_CMDS = new Set([
  // 系统信息（只读）
  'uptime', 'whoami', 'id', 'uname', 'hostname', 'date', 'cal',
  'free', 'vmstat', 'iostat', 'mpstat', 'nproc', 'lscpu',
  // 磁盘/内存（只读）
  'df', 'du', 'lsblk', 'stat',
  // 进程（只读）
  'ps', 'top', 'pgrep', 'pidof',
  // 网络诊断（只读）
  'ping', 'traceroute', 'mtr', 'dig', 'nslookup', 'host', 'whois',
  'curl', 'wget',
  // 文件查看（只读，不含写入）
  'ls', 'cat', 'head', 'tail', 'wc', 'grep', 'egrep', 'find', 'file', 'less', 'more',
  'md5sum', 'sha256sum', 'cksum',
  // 文本处理（无副作用）
  'echo', 'printf', 'sort', 'uniq', 'cut', 'tr', 'awk', 'sed', 'jq', 'column',
  // 其他只读
  'which', 'whereis', 'type', 'env', 'printenv', 'locale',
  'ss', 'netstat', 'ip', 'ifconfig', 'route', 'arp',
  'systemctl', 'journalctl', 'service',  // 见下方参数限制
  'sqlite3',
  'nvidia-smi', 'sensors',
  'git', 'node', 'npm', 'python3', 'python',
  'docker', 'docker-compose',
]);

// ---------- 危险命令黑名单（即使白名单里也要拦） ----------
const DENY_CMDS = new Set([
  'rm', 'rmdir', 'unlink', 'shred', 'wipe',
  'dd', 'mkfs', 'mke2fs', 'fdisk', 'parted', 'sgdisk', 'gdisk',
  'apt', 'apt-get', 'aptitude', 'dpkg', 'yum', 'dnf', 'pacman', 'zypper', 'apk', 'snap',
  'pip', 'pip3', 'gem', 'cargo', 'go',
  'chmod', 'chown', 'chgrp', 'chattr', 'setfacl',
  'mv', 'cp', 'ln', 'install', 'tee',
  'sh', 'bash', 'zsh', 'fish', 'dash', 'csh', 'ksh',
  'sudo', 'su', 'doas', 'pkexec',
  'reboot', 'shutdown', 'halt', 'poweroff', 'init', 'systemd',
  'kill', 'killall', 'pkill', 'xkill',
  'iptables', 'ip6tables', 'nft', 'ufw', 'firewall-cmd',
  'mount', 'umount', 'swapon', 'swapoff',
  'useradd', 'userdel', 'usermod', 'groupadd', 'groupdel', 'passwd', 'chpasswd',
  'crontab', 'at', 'batch',
  'nc', 'ncat', 'netcat', 'telnet', 'socat',
  'ssh', 'scp', 'sftp', 'rsync',
  'eval', 'exec', 'source', '.',
  'alias', 'unalias', 'export', 'unset', 'set',
  'truncate', 'split', 'csplit',
  'xargs', 'parallel',
]);

// ---------- 危险模式正则（字符串级拦截） ----------
const DANGEROUS_PATTERNS = [
  // 文件系统破坏
  /\brm\s+-[a-z]*[rf]/, /\brm\s+--no-preserve-root/,
  /\bdd\b\s.*of=/, /\bmkfs\b/, /\bof=\/dev\//,
  // 重定向写文件
  />>?\s*\/|>>?\s*[^\s]+\s*$/, /\|&?/, /`[^`]*`/, /\$\([^)]*\)/,
  // 命令串联
  /;/, /&&/, /\|\|/,
  // 权限提升 / 进程控制
  /\bsudo\b/, /\bsu\s+-?/,
  // 危险路径
  /\/etc\/passwd/, /\/etc\/shadow/, /\/root\/\.ssh/, /\.ssh\//,
  /\/dev\/(sd|nvme|mmcblk|loop)/, /\/proc\/(kcore|sysrq-trigger)/,
  // 网络危险
  /\bnc\s+-[ln]/, /\/dev\/tcp\//, /\/dev\/udp\//,
  // 环境变量破坏
  /\bPATH=/, /\bLD_PRELOAD\b/, /\bLD_LIBRARY_PATH\b/,
  // fork bomb
  /:\(\)\s*\{/, /\.\(\)\s*\{/,
];

/** 命令级别的参数限制 */
const CMD_ARG_RULES = {
  'systemctl': (args) => {
    // 只允许查看状态，禁止 start/stop/restart/disable/enable
    const allowed = ['status', 'show', 'list-units', 'list-unit-files', 'is-active', 'is-enabled', 'is-failed', 'cat'];
    const sub = (args[0] || '').toLowerCase();
    return allowed.includes(sub) ? null : `systemctl 只允许查询子命令（${allowed.join('/')}），不允许 ${sub}`;
  },
  'journalctl': (args) => {
    // 禁止清理日志
    if (args.some((a) => /^--vacuum/.test(a))) return 'journalctl 不允许清理日志';
    return null;
  },
  'service': (args) => {
    const sub = (args[0] || '').toLowerCase();
    return ['status'].includes(sub) ? null : 'service 只允许 status';
  },
  'git': (args) => {
    const write = ['push', 'reset', 'checkout', 'clean', 'rebase', 'merge', 'commit', 'add', 'rm', 'mv', 'clone', 'pull', 'fetch', 'init'];
    const sub = (args[0] || '').toLowerCase();
    return write.includes(sub) ? `git ${sub} 会修改数据，禁止执行` : null;
  },
  'npm': (args) => {
    const write = ['install', 'i', 'uninstall', 'remove', 'publish', 'update', 'prune', 'ci'];
    const sub = (args[0] || '').toLowerCase();
    return write.includes(sub) ? `npm ${sub} 会修改依赖，禁止执行` : null;
  },
  'pip': (args) => {
    const write = ['install', 'uninstall', 'download'];
    const sub = (args[0] || '').toLowerCase();
    return write.includes(sub) ? `pip ${sub} 禁止执行` : null;
  },
  'curl': (args) => {
    // 禁止下载到文件 / 上传数据
    const bad = ['-o', '--output', '-O', '--remote-name', '-T', '--upload-file', '-d', '--data', '-F', '--form', '-X', '--request'];
    const hit = args.find((a) => bad.includes(a) || bad.some((b) => a.startsWith(b + '=')));
    return hit ? `curl 参数 ${hit} 会写入或修改数据，禁止使用` : null;
  },
  'wget': (args) => {
    const bad = ['-O', '--output-document', '-P', '--directory-prefix', '--post-data', '--post-file'];
    const hit = args.find((a) => bad.includes(a) || bad.some((b) => a.startsWith(b + '=')));
    return hit ? `wget 参数 ${hit} 会写入文件，禁止使用` : null;
  },
  'docker': (args) => {
    const write = ['run', 'exec', 'rm', 'rmi', 'stop', 'kill', 'restart', 'start', 'create', 'build', 'push', 'pull'];
    const sub = (args[0] || '').toLowerCase();
    return write.includes(sub) ? `docker ${sub} 会改变运行状态，禁止执行` : null;
  },
  'sed': (args) => {
    // 禁止 -i 原地修改
    if (args.some((a) => /^-i/.test(a) || a === '--in-place')) return 'sed -i 会修改文件，禁止使用';
    return null;
  },
  'find': (args) => {
    // 禁止 -delete / -exec
    if (args.includes('-delete')) return 'find -delete 会删除文件，禁止使用';
    if (args.includes('-exec') || args.includes('-execdir')) return 'find -exec 可执行任意命令，禁止使用';
    return null;
  },
  'sqlite3': (args) => {
    // 只允许 SELECT 查询
    const sqlPart = args.filter((a) => !a.startsWith('-')).join(' ');
    if (!/^\s*select\b/i.test(sqlPart)) return 'sqlite3 只允许 SELECT 查询';
    return null;
  },
};

/**
 * 简单的 shell 词法分析（支持引号）
 */
function tokenize(cmd) {
  const tokens = [];
  let cur = '';
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (c === "'" && !inDouble) { inSingle = !inSingle; continue; }
    if (c === '"' && !inSingle) { inDouble = !inDouble; continue; }
    if (/\s/.test(c) && !inSingle && !inDouble) {
      if (cur) { tokens.push(cur); cur = ''; }
      continue;
    }
    cur += c;
  }
  if (cur) tokens.push(cur);
  return tokens;
}

/**
 * 检查命令是否安全
 * @returns {{ok: boolean, reason?: string, command?: string, args?: string[]}}
 */
export function checkCommand(raw) {
  const cmd = String(raw || '').trim();
  if (!cmd) return { ok: false, reason: '命令为空' };
  if (cmd.length > 500) return { ok: false, reason: '命令过长（最多 500 字符）' };

  // 1) 危险模式检查（字符串级）
  for (const re of DANGEROUS_PATTERNS) {
    if (re.test(cmd)) {
      return { ok: false, reason: `命令包含被禁止的模式：${re.source.slice(0, 40)}` };
    }
  }

  // 2) 词法分析
  const tokens = tokenize(cmd);
  if (!tokens.length) return { ok: false, reason: '命令为空' };

  const bin = tokens[0].toLowerCase().replace(/^.*\//, '');  // 去掉路径
  const args = tokens.slice(1);

  // 3) 黑名单
  if (DENY_CMDS.has(bin)) {
    return { ok: false, reason: `命令 ${bin} 在禁止列表中` };
  }

  // 4) 白名单
  if (!ALLOW_CMDS.has(bin)) {
    return { ok: false, reason: `命令 ${bin} 不在允许列表中` };
  }

  // 5) 参数级规则
  const rule = CMD_ARG_RULES[bin];
  if (rule) {
    const err = rule(args);
    if (err) return { ok: false, reason: err };
  }

  return { ok: true, command: bin, args };
}

/** 给 AI 的说明文本 */
export function safetyHelp() {
  return {
    allowed: [...ALLOW_CMDS].sort(),
    denied_binaries: [...DENY_CMDS].sort(),
    rules: [
      '禁止：文件删除、移动、复制、权限修改',
      '禁止：包管理器（apt/yum/pip/npm install 等）',
      '禁止：服务启停（systemctl start/stop/restart）',
      '禁止：shell 重定向 > >> <、管道 | 、命令串联 ; && ||、命令替换 $() `` ',
      '禁止：curl/wget 下载文件、上传数据',
      '禁止：sudo/su 提权',
      '禁止：进程终止 kill/pkill',
      '禁止：防火墙、挂载、用户管理',
    ],
  };
}
