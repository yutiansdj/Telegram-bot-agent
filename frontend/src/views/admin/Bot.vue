<script setup>
import { ref, onMounted, computed, h, reactive } from 'vue';
import {
  NButton, NIcon, NInput, NInputNumber, NSwitch, NForm, NFormItem, NSelect, NTag,
  NTabs, NTabPane, NAlert, NDataTable, NModal, NPopconfirm, NSpace, NProgress, NSpin,
  NRadioGroup, NRadio, NRadioButton, NStatistic, NDivider, NEmpty, NTooltip,
} from 'naive-ui';
import { Icon } from '@iconify/vue';
import PageHeader from '@/components/common/PageHeader.vue';
import { api } from '@/api';
import http from '@/api';
import { useSearchFocus } from '@/composables/useSearchFocus';
import { fmtDate, fmtRelative } from '@/utils/format';

const loading = ref(true);
const busy = ref('');
const status = ref(null);
const bots = ref([]);
const currentBotId = ref(null);
const s = ref({});
const tab = ref('ops');

// Token
const tokenInput = ref('');
const tokenValid = ref(null);

// 广播
const broadcasting = ref(false);
const bcast = reactive({ target: 'all', text: '', tgId: '', chatIds: [], withMenu: true, testChat: '', testing: false });
const bcastTargets = reactive({ users: 0, groups: [], recentUsers: [] });
const bcastResult = ref(null);
const previewText = computed(() => {
  return (bcast.text || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/&lt;(b|i|u|code|s)&gt;/g, '<$1>')
    .replace(/&lt;\/(b|i|u|code|s)&gt;/g, '</$1>').replace(/\n/g, '<br>');
});
const previewButtons = ['🚀 创建代理', '📋 我的代理', '📊 我的流量', '🎁 每日签到'];
const bcastHint = computed(() => {
  const map = {
    all: `将私聊发送给 ${bcastTargets.users || 0} 位用户`,
    one: bcast.tgId ? '仅发送给 1 位用户' : '请先选择目标用户',
    groups: `将发送到 ${bcast.chatIds.length || (bcastTargets.groups || []).length} 个群组`,
    mixed: `将发送给 ${bcastTargets.users || 0} 位用户 + ${bcast.chatIds.length || (bcastTargets.groups || []).length} 个群组`,
  };
  return map[bcast.target];
});

async function loadBcastTargets() {
  try {
    const res = await api.botBroadcastTargets();
    Object.assign(bcastTargets, res.data);
  } catch { /* ignore */ }
}

async function testChat() {
  if (!bcast.testChat) { window.$message.warning('请输入群组 ID'); return; }
  bcast.testing = true;
  try {
    const res = await api.botTestChat(bcast.testChat);
    window.$message.success(res.message);
  } catch (e) { window.$message.error(e.message); }
  finally { bcast.testing = false; }
}

// 按钮菜单
const buttons = reactive({ list: [], actions: [] });
const showBtn = ref(false);
const btnForm = ref({});

// 用户
const users = reactive({ list: [], total: 0, page: 1 });
const userQuery = ref('');
const showBalance = ref(false);
const balanceTarget = ref(null);
const balanceValue = ref(0);

// 命令
const commands = reactive({ list: [], total: 0, page: 1, stat: [] });
const inviteStats = reactive({ rewarded: 0, grantedMb: 0, top: [] });

async function loadInvite() {
  busy.value = 'inv';
  try {
    const res = await api.invites();
    Object.assign(inviteStats, res.data.stats, { top: res.data.top });
  } catch { /* ignore */ }
  finally { busy.value = ''; }
}

const cmdScope = ref('private');
const groupCommands = ref([]);
const adminCommands = ref([]);
const defCommands = ref([
  { command: 'start', description: '开始使用' },
  { command: 'create', description: '创建代理' },
  { command: 'my', description: '我的代理' },
  { command: 'usage', description: '查看流量' },
  { command: 'signin', description: '每日签到' },
  { command: 'help', description: '使用帮助' },
  { command: 'id', description: '查看我的 ID' },
]);
groupCommands.value = [
  { command: 'id', description: '查看我的 ID 与本群 ID' },
  { command: 'userid', description: '回复某人查看其 ID' },
  { command: 'rules', description: '查看群规则' },
  { command: 'help', description: '群内可用命令' },
  { command: 'mute', description: '回复某人后禁言 (/mute 30m)' },
  { command: 'unmute', description: '回复某人后解除禁言' },
  { command: 'kick', description: '回复某人后移出' },
  { command: 'ban', description: '回复某人后封禁' },
];
adminCommands.value = [
  { command: 'mute', description: '回复某人后禁言（如 /mute 30m）' },
  { command: 'unmute', description: '回复某人后解除禁言' },
  { command: 'kick', description: '回复某人后移出群组' },
  { command: 'ban', description: '回复某人后封禁' },
  { command: 'id', description: '查看本群 ID' },
];
const currentCmdList = computed(() => {
  return cmdScope.value === 'private' ? defCommands.value
    : cmdScope.value === 'group' ? groupCommands.value
    : adminCommands.value;
});
const defaultCommandsMap = {
  private: [
    { command: 'start', description: '开始使用' }, { command: 'create', description: '创建代理' },
    { command: 'my', description: '我的代理' }, { command: 'usage', description: '查看流量' },
    { command: 'signin', description: '每日签到' }, { command: 'invite', description: '邀请赚流量' },
    { command: 'id', description: '查看我的 ID' }, { command: 'help', description: '使用帮助' },
  ],
  group: [
    { command: 'id', description: '查看我的 ID 与本群 ID' }, { command: 'userid', description: '回复某人查看其 ID' },
    { command: 'rules', description: '查看群规则' }, { command: 'help', description: '群内可用命令' },
    { command: 'mute', description: '回复某人后禁言 (/mute 30m)' }, { command: 'unmute', description: '回复某人后解除禁言' },
    { command: 'kick', description: '回复某人后移出' }, { command: 'ban', description: '回复某人后封禁' },
  ],
  admins: [
    { command: 'id', description: '查看本群 ID' }, { command: 'rules', description: '查看群规则' },
  ],
};
function resetCmdScope() {
  const copy = JSON.parse(JSON.stringify(defaultCommandsMap[cmdScope.value]));
  if (cmdScope.value === 'private') defCommands.value = copy;
  else if (cmdScope.value === 'group') groupCommands.value = copy;
  else adminCommands.value = copy;
  window.$message.info('已恢复默认命令列表');
}

function toggle(k) { s.value[k] = s.value[k] === '1' ? '0' : '1'; }

// 加载机器人列表并选中当前机器人
async function loadBots() {
  try {
    const r = await http.get('/admin/bots');
    bots.value = r.data?.list || [];
    if (!currentBotId.value && bots.value.length) {
      currentBotId.value = bots.value.find((b) => b.is_primary)?.id || bots.value[0].id;
    }
  } catch { /* ignore */ }
}

// 切换机器人
function onBotChange(id) {
  currentBotId.value = id;
  load();
}

const botOptions = computed(() => bots.value.map((b) => ({
  label: `${b.name}${b.username ? ' (@' + b.username + ')' : ''}${b.is_primary ? ' · 主' : ''}`,
  value: b.id,
})));

const currentBot = computed(() => bots.value.find((b) => b.id === currentBotId.value) || null);

// 针对选中机器人执行操作
async function botAction(act) {
  if (!currentBotId.value) { window.$message.warning('请先选择机器人'); return; }
  busy.value = act;
  try {
    const r = await http.post(`/admin/bots/${currentBotId.value}/${act}`);
    window.$message.success(r.message || '操作完成');
    await loadBots();
    await load();
  } catch (e) {
    window.$message.error(e.message);
  } finally { busy.value = ''; }
}

async function load() {
  loading.value = true;
  try {
    const [st, stg] = await Promise.all([api.botStatus(), api.adminSettings()]);
    status.value = st.data;
    s.value = { ...stg.data.settings };
    // 数值型设置统一转 number，避免输入框空白
    for (const k of Object.keys(s.value)) {
      if (/_(mb|min|max|days|hours|limit|len|ttl|options|attempts|timeout|window|port|keep|size|percent|pct|rate)$/.test(k) || k === 'ui_radius' || k === 'ui_font_size') {
        if (s.value[k] !== '' && s.value[k] !== null && !isNaN(Number(s.value[k]))) s.value[k] = Number(s.value[k]);
        else if (s.value[k] === '') s.value[k] = null;
      }
    }
    tokenInput.value = s.value.bot_token || '';
    if (s.value.bot_token) tokenValid.value = true;
  } catch (e) { window.$message.error(e.message); }
  finally { loading.value = false; }
}

async function save() {
  busy.value = 'save';
  try {
    await api.adminSaveSettings(s.value);
    window.$message.success('机器人配置已保存');
    await refreshStatus();
  } catch (e) { window.$message.error(e.message); }
  finally { busy.value = ''; }
}

async function refreshStatus() {
  try {
    const res = await api.botStatus();
    status.value = res.data;
  } catch { /* ignore */ }
}

async function testToken() {
  if (!tokenInput.value.trim()) { window.$message.warning('请填写 Bot Token'); return; }
  busy.value = 'test';
  try {
    const res = await api.botTestToken(tokenInput.value.trim());
    s.value.bot_token = tokenInput.value.trim();
    s.value.bot_username = res.data.username;
    tokenValid.value = true;
    window.$message.success(res.message);
    await refreshStatus();
  } catch (e) {
    tokenValid.value = false;
    window.$message.error(e.message);
  } finally { busy.value = ''; }
}

async function startBot() {
  busy.value = 'start';
  try {
    s.value.bot_enabled = '1';
    await api.adminSaveSettings(s.value);
    const res = await api.botStart();
    window.$message.success(res.message);
    await refreshStatus();
  } catch (e) { window.$message.error(e.message); }
  finally { busy.value = ''; }
}

async function stopBot() {
  busy.value = 'stop';
  try {
    const res = await api.botStop();
    window.$message.success(res.message);
    await refreshStatus();
  } catch (e) { window.$message.error(e.message); }
  finally { busy.value = ''; }
}

async function restartBot() {
  busy.value = 'restart';
  try {
    const res = await api.botRestart();
    window.$message.success(res.message);
    await refreshStatus();
  } catch (e) { window.$message.error(e.message); }
  finally { busy.value = ''; }
}

async function doBroadcast() {
  if (!bcast.text.trim()) { window.$message.warning('请填写通知内容'); return; }
  if (bcast.target === 'one' && !String(bcast.tgId || '').trim()) { window.$message.warning('请选择目标用户'); return; }
  broadcasting.value = true;
  bcastResult.value = null;
  try {
    const res = await api.botBroadcast({
      text: bcast.text.trim(),
      target: bcast.target,
      tgId: bcast.tgId,
      chatIds: bcast.chatIds,
      withMenu: bcast.withMenu,
    });
    bcastResult.value = res.data;
    window.$message.success(res.message);
  } catch (e) { window.$message.error(e.message); }
  finally { broadcasting.value = false; }
}

async function loadButtons() {
  try {
    const res = await api.botButtons();
    buttons.list = res.data.list;
    buttons.actions = res.data.actions;
  } catch (e) { window.$message.error(e.message); }
}

function openBtn(row) {
  btnForm.value = row ? { ...row } : { label: '', action: 'create', payload: '', sort: buttons.list.length, active: true };
  showBtn.value = true;
}

async function saveBtn() {
  try {
    await api.botSaveButton(btnForm.value);
    window.$message.success('已保存');
    showBtn.value = false;
    await loadButtons();
  } catch (e) { window.$message.error(e.message); }
}

async function delBtn(id) {
  try { await api.botDeleteButton(id); await loadButtons(); } catch (e) { window.$message.error(e.message); }
}

async function loadUsers() {
  try {
    const res = await api.botUsers({ page: users.page, pageSize: 20, q: userQuery.value });
    users.list = res.data.list;
    users.total = res.data.total;
  } catch (e) { window.$message.error(e.message); }
}

function openBalance(row) {
  balanceTarget.value = row;
  balanceValue.value = Number(row.balance_mb) || 0;
  showBalance.value = true;
}

async function saveBalance() {
  try {
    await api.botUpdateUser(balanceTarget.value.id, { balance_mb: balanceValue.value });
    window.$message.success('已更新余额');
    showBalance.value = false;
    await loadUsers();
  } catch (e) { window.$message.error(e.message); }
}

async function toggleBan(row) {
  try {
    await api.botUpdateUser(row.id, { banned: !row.banned });
    await loadUsers();
  } catch (e) { window.$message.error(e.message); }
}

async function loadCommands() {
  try {
    const res = await api.botCommands({ page: commands.page, pageSize: 30 });
    commands.list = res.data.list;
    commands.total = res.data.total;
    commands.stat = res.data.stat;
  } catch (e) { window.$message.error(e.message); }
}

async function setMenu() {
  busy.value = 'menu';
  try {
    const res = await api.botSetCommands({
      private: defCommands.value,
      group: groupCommands.value,
      admins: adminCommands.value,
    });
    window.$message.success(res.message);
  } catch (e) { window.$message.error(e.message); }
  finally { busy.value = ''; }
}

function onTab(v) {
  tab.value = v;
  if (v === 'menu') loadButtons();
  if (v === 'users') loadUsers();
  if (v === 'commands') loadCommands();
  if (v === 'invite') loadInvite();
  if (v === 'broadcast') loadBcastTargets();
}

const running = computed(() => currentBot.value?.status === 'running');
// 邮件是否可用：优先后端结论，其次看本地已加载的 SMTP 配置
const mailReady = computed(() => {
  if (status.value?.mailReady) return true;
  return s.value.smtp_enabled === '1' && !!String(s.value.smtp_user || '').trim() && !!String(s.value.smtp_pass || '').trim();
});
const botLink = computed(() => status.value?.bot?.link || '');
const stats = computed(() => status.value?.stats || {});

const userColumns = [
  { title: 'Telegram', key: 'tg_id', width: 200, render: (r) => h('div', null, [
    h('div', { style: 'font-weight:500;font-size:13px' }, r.tg_first_name || '（未命名）'),
    h('div', { style: 'font-size:11.5px;color:var(--tg-text-3)' }, r.tg_username ? '@' + r.tg_username : 'ID ' + r.tg_id),
  ]) },
  { title: '平台账号', key: 'platform_username', width: 130, render: (r) => r.platform_username || h('span', { class: 'tg-text-3' }, '未绑定') },
  { title: '代理数', key: 'account_count', width: 80, align: 'center' },
  { title: '余额', key: 'balance_mb', width: 110, align: 'right', render: (r) => `${(Number(r.balance_mb) / 1024).toFixed(2)} GB` },
  { title: '签到', key: 'total_signin', width: 90, align: 'center', render: (r) => `${r.total_signin} 次` },
  { title: '连续', key: 'signin_streak', width: 70, align: 'center', render: (r) => `${r.signin_streak} 天` },
  { title: '最近活跃', key: 'last_active', width: 110, render: (r) => fmtRelative(r.last_active) },
  { title: '状态', key: 'banned', width: 80, render: (r) => h(NTag, { size: 'small', type: r.banned ? 'error' : 'success', bordered: false }, { default: () => (r.banned ? '已封禁' : '正常') }) },
  { title: '操作', key: 'actions', width: 150, fixed: 'right', render: (r) => h(NSpace, { size: 4, wrap: false }, {
    default: () => [
      h(NButton, { size: 'tiny', secondary: true, type: 'primary', onClick: () => openBalance(r) }, { default: () => '改余额' }),
      h(NButton, { size: 'tiny', quaternary: true, type: r.banned ? 'success' : 'error', onClick: () => toggleBan(r) }, { default: () => (r.banned ? '解封' : '封禁') }),
    ],
  }) },
];

const cmdColumns = [
  { title: '时间', key: 'created_at', width: 145, render: (r) => fmtDate(r.created_at) },
  { title: '用户', key: 'tg_username', width: 140, render: (r) => r.tg_username ? '@' + r.tg_username : r.tg_id },
  { title: '命令', key: 'command', width: 180, render: (r) => h(NTag, { size: 'small', bordered: false, type: 'info' }, { default: () => r.command }) },
  { title: '参数', key: 'payload', ellipsis: { tooltip: true }, render: (r) => r.payload || '-' },
];

useSearchFocus(tab);
onMounted(async () => { await loadBots(); await load(); });
</script>

<template>
  <div>
    <PageHeader title="机器人配置" subtitle="Telegram 机器人：自助注册、一键建代理、每日签到领流量" icon="tabler:brand-telegram">
      <template #actions>
        <NSelect
          v-if="botOptions.length"
          :value="currentBotId"
          :options="botOptions"
          size="small"
          style="width: 210px"
          placeholder="选择机器人"
          @update:value="onBotChange"
        />
        <NSpin v-if="!status" size="small" />
        <NTag v-else :type="currentBot?.status === 'running' ? 'success' : 'default'" :bordered="false" size="small">
          <NIcon size="11" class="mr-1 align-[-1px]"><Icon icon="tabler:point-filled" /></NIcon>
          {{ currentBot?.status === 'running' ? '运行中' : '已停止' }}
        </NTag>
        <NButton v-if="currentBot?.status === 'running'" size="small" tertiary type="warning"
                 :loading="busy === 'stop'" @click="botAction('stop')">停止</NButton>
        <NButton v-else size="small" tertiary type="primary"
                 :loading="busy === 'start'" @click="botAction('start')">启动</NButton>
        <NButton size="small" quaternary :loading="busy === 'restart'" @click="botAction('restart')">
          <template #icon><NIcon size="15"><Icon icon="tabler:refresh" /></NIcon></template>
        </NButton>
        <NButton type="primary" size="small" :loading="busy === 'save'" @click="save">保存配置</NButton>
      </template>
    </PageHeader>

    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
      <div class="tg-card p-4">
        <div class="text-xs tg-text-3">机器人用户</div>
        <div class="text-[22px] font-semibold mt-1">{{ stats.total ?? 0 }}</div>
        <div class="text-[11.5px] tg-text-3">今日新增 {{ stats.today ?? 0 }}</div>
      </div>
      <div class="tg-card p-4">
        <div class="text-xs tg-text-3">近 7 天活跃</div>
        <div class="text-[22px] font-semibold mt-1">{{ stats.active7 ?? 0 }}</div>
        <div class="text-[11.5px] tg-text-3">今日签到 {{ stats.signins ?? 0 }}</div>
      </div>
      <div class="tg-card p-4">
        <div class="text-xs tg-text-3">机器人状态</div>
        <div class="text-[17px] font-semibold mt-1.5" :class="running ? 'text-green-600' : 'tg-text-3'">{{ running ? '运行中' : '已停止' }}</div>
        <div class="text-[11.5px] tg-text-3">{{ (currentBot?.username || status?.bot?.username) ? '@' + (currentBot?.username || status.bot.username) : '未配置' }}</div>
      </div>
      <div class="tg-card p-4">
        <div class="text-xs tg-text-3">处理更新</div>
        <div class="text-[22px] font-semibold mt-1">{{ status?.state?.counters?.updates ?? 0 }}</div>
        <div class="text-[11.5px] tg-text-3">错误 {{ status?.state?.counters?.errors ?? 0 }}</div>
      </div>
    </div>

    <div class="tg-card">
      <NTabs :value="tab" type="line" size="small" class="px-4 pt-2" @update:value="onTab">
        <!-- 连接 -->
        <NTabPane name="ops" tab="运营配置"><div data-search-anchor="bot-ops">
          <div class="grid grid-cols-1 xl:grid-cols-2 gap-4 py-3">
            <div>
              <div class="tg-section-title mb-2">额度与签到</div>
              <div class="grid grid-cols-2 gap-3">
                <NFormItem label="初始额度（MB）">
                  <NInputNumber v-model:value.number="s.bot_default_quota_mb" :min="0" :step="512" class="!w-full" />
                </NFormItem>
                <NFormItem label="每人最多代理数">
                  <NInputNumber v-model:value.number="s.bot_max_accounts" :min="1" :max="100" class="!w-full" />
                </NFormItem>
              </div>
              <div class="row">
                <div>
                  <div class="row-title">额度模式</div>
                  <div class="row-desc">共享池：用平台账户额度；独立余额：机器人余额</div>
                </div>
                <NSelect :value="s.bot_quota_mode" size="small" style="width: 150px"
                  :options="[{ label: '共享账户额度', value: 'pool' }, { label: '独立机器人余额', value: 'standalone' }]"
                  @update:value="(v) => (s.bot_quota_mode = v)" />
              </div>
              <div class="row">
                <div>
                  <div class="row-title">允许每日签到</div>
                  <div class="row-desc">用户每天可领取一次流量</div>
                </div>
                <NSwitch :value="s.bot_signin_enabled === '1'" size="small" @update:value="toggle('bot_signin_enabled')" />
              </div>
              <div class="grid grid-cols-2 gap-3 mt-2">
                <NFormItem label="签到赠送（MB）">
                  <NInputNumber v-model:value.number="s.bot_signin_quota_mb" :min="0" :step="256" class="!w-full" />
                </NFormItem>
                <NFormItem label="连续签到上限（天）">
                  <NInputNumber v-model:value.number="s.bot_signin_streak_max" :min="1" :max="30" class="!w-full" />
                </NFormItem>
              </div>
              <div class="row">
                <div>
                  <div class="row-title">连续签到翻倍奖励</div>
                  <div class="row-desc">连续 N 天则获得 N 倍流量</div>
                </div>
                <NSwitch :value="s.bot_signin_streak_bonus === '1'" size="small" @update:value="toggle('bot_signin_streak_bonus')" />
              </div>
            </div>

            <div>
              <div class="tg-section-title mb-2">行为开关</div>
              <div class="row">
                <div>
                  <div class="row-title">/start 自动注册</div>
                  <div class="row-desc">首次对话自动创建平台账号</div>
                </div>
                <NSwitch :value="s.bot_auto_register === '1'" size="small" @update:value="toggle('bot_auto_register')" />
              </div>
              <div class="row">
                <div>
                  <div class="row-title">注册需邮箱验证</div>
                  <div class="row-desc">首次使用时需验证邮箱才发放额度</div>
                </div>
                <NSwitch :value="s.bot_require_email === '1'" size="small" @update:value="(v) => { s.bot_require_email = v ? '1' : '0'; }" />
              </div>
              <NAlert v-if="s.bot_require_email === '1' && !mailReady" type="warning" :bordered="false" class="mb-2">
                邮件服务未配置，该开关暂不生效（机器人会自动跳过邮箱验证）。
              </NAlert>
              <div v-if="s.bot_require_email === '1'" class="ev-box">
                <NFormItem label="提示文案" class="!mt-0 !mb-0">
                  <NInput v-model:value="s.bot_email_required_msg" type="textarea" :autosize="{ minRows: 3, maxRows: 6 }" />
                </NFormItem>
              </div>
              <div class="row">
                <div><div class="row-title">展示代理链接</div><div class="row-desc">允许在聊天中直接获取链接</div></div>
                <NSwitch :value="s.bot_show_link === '1'" size="small" @update:value="toggle('bot_show_link')" />
              </div>
              <div class="row">
                <div><div class="row-title">展示二维码</div><div class="row-desc">点击按钮发送扫码图片</div></div>
                <NSwitch :value="s.bot_show_qrcode === '1'" size="small" @update:value="toggle('bot_show_qrcode')" />
              </div>
              <div class="row">
                <div><div class="row-title">强制加入频道</div><div class="row-desc">使用前需加入指定频道</div></div>
                <NSwitch :value="s.bot_require_join === '1'" size="small" @update:value="toggle('bot_require_join')" />
              </div>
              <NInput v-if="s.bot_require_join === '1'" v-model:value="s.bot_require_channel" size="small" placeholder="@your_channel" class="mt-2" />
              <div class="grid grid-cols-2 gap-3 mt-3">
                <NFormItem label="限流（次/分钟）">
                  <NInputNumber v-model:value.number="s.bot_rate_limit" :min="1" :max="600" class="!w-full" />
                </NFormItem>
                <NFormItem label="代理有效期（天，0=永久）">
                  <NInputNumber v-model:value.number="s.bot_account_days" :min="0" class="!w-full" />
                </NFormItem>
              </div>
              <NFormItem data-search-anchor="bot-admin-ids" label="管理员 Telegram ID（逗号分隔，拥有机器人管理员权限）" class="!mb-0">
                <NInput v-model:value="s.bot_admin_ids" placeholder="123456789,987654321" />
              </NFormItem>
            </div>
          </div>

          <NDivider class="!my-2" />
          <div class="tg-section-title mb-2">文案</div>
          <div class="grid grid-cols-1 xl:grid-cols-2 gap-3">
            <NFormItem label="欢迎语（支持 {{site}} {{name}} {{quota}}）">
              <NInput v-model:value="s.bot_welcome" type="textarea" :autosize="{ minRows: 4, maxRows: 8 }" />
            </NFormItem>
            <NFormItem label="帮助文本（留空使用内置）">
              <NInput v-model:value="s.bot_help" type="textarea" :autosize="{ minRows: 4, maxRows: 8 }" />
            </NFormItem>
          </div>
        </div></NTabPane>

        <!-- 菜单按钮 -->
        <NTabPane name="menu" tab="菜单按钮">
          <div class="flex items-center justify-between py-3">
            <div class="text-xs tg-text-3">配置机器人在聊天中显示的按钮（最多 2 列，最多 8 个）</div>
            <NButton size="small" type="primary" @click="openBtn()">
              <template #icon><NIcon size="14"><Icon icon="tabler:plus" /></NIcon></template>
              添加按钮
            </NButton>
          </div>
          <div class="btn-preview">
            <div class="text-xs tg-text-3 mb-2 text-center">效果预览</div>
            <div class="chat-bubble">
              <div v-for="(row, i) in [buttons.list.filter(b => b.active).slice(0, 4), buttons.list.filter(b => b.active).slice(4)]" :key="i" class="btn-row">
                <button v-for="b in row" :key="b.id" class="chat-btn">{{ b.label }}</button>
              </div>
              <NEmpty v-if="!buttons.list.filter(b => b.active).length" size="small" description="未配置按钮" />
            </div>
          </div>
          <div class="mt-3">
            <div v-for="b in buttons.list" :key="b.id" class="btn-item">
              <NIcon size="14" class="tg-text-3"><Icon icon="tabler:rectangle" /></NIcon>
              <span class="font-medium text-[13px]">{{ b.label }}</span>
              <NTag size="tiny" :bordered="false">{{ b.action }}</NTag>
              <span v-if="b.payload" class="text-xs tg-text-3 truncate">{{ b.payload }}</span>
              <span class="flex-1" />
              <NTag size="tiny" :type="b.active ? 'success' : 'default'" :bordered="false">{{ b.active ? '启用' : '停用' }}</NTag>
              <NButton size="tiny" quaternary @click="openBtn(b)">
                <template #icon><NIcon size="13"><Icon icon="tabler:pencil" /></NIcon></template>
              </NButton>
              <NPopconfirm @positive-click="delBtn(b.id)">
                <template #trigger>
                  <NButton size="tiny" quaternary type="error"><template #icon><NIcon size="13"><Icon icon="tabler:trash" /></NIcon></template></NButton>
                </template>
                删除该按钮？
              </NPopconfirm>
            </div>
            <NEmpty v-if="!buttons.list.length" size="small" description="暂无按钮，使用默认菜单" />
          </div>
        </NTabPane>

        <!-- 邀请奖励 -->
        <NTabPane name="invite" tab="邀请奖励"><div data-search-anchor="bot-invite">
          <div class="grid grid-cols-1 xl:grid-cols-[1fr_420px] gap-4 py-3">
            <div>
              <div class="row">
                <div><div class="row-title">启用邀请奖励</div><div class="row-desc">用户分享专属链接，好友加入即可获得流量</div></div>
                <NSwitch :value="s.bot_ref_enabled === '1'" size="small" @update:value="toggle('bot_ref_enabled')" />
              </div>
              <div class="grid grid-cols-2 gap-3 mt-3">
                <NFormItem label="邀请人奖励（MB）">
                  <div class="w-full">
                    <NInputNumber v-model:value.number="s.bot_ref_bonus_mb" :min="0" :step="256" class="!w-full" />
                    <div class="text-xs tg-text-3 mt-1">约 {{ ((Number(s.bot_ref_bonus_mb) || 0) / 1024).toFixed(2) }} GB</div>
                  </div>
                </NFormItem>
                <NFormItem label="被邀请人奖励（MB）">
                  <NInputNumber v-model:value.number="s.bot_ref_invitee_mb" :min="0" :step="256" class="!w-full" />
                </NFormItem>
              </div>
              <div class="grid grid-cols-3 gap-3">
                <NFormItem label="每邀请倍数">
                  <NInputNumber v-model:value.number="s.bot_ref_per_invite" :min="1" :max="10" class="!w-full" />
                </NFormItem>
                <NFormItem label="单日上限（人，0=不限）">
                  <NInputNumber v-model:value.number="s.bot_ref_daily_limit" :min="0" class="!w-full" />
                </NFormItem>
                <NFormItem label="奖励总额上限（MB，0=不限）">
                  <NInputNumber v-model:value.number="s.bot_ref_max_reward" :min="0" class="!w-full" />
                </NFormItem>
              </div>
              <div class="row">
                <div><div class="row-title">需好友完成签到后到账</div><div class="row-desc">防刷：对方活跃后才发奖励</div></div>
                <NSwitch :value="s.bot_ref_need_verify === '1'" size="small" @update:value="toggle('bot_ref_need_verify')" />
              </div>
              <NFormItem label="邀请卡片文案（留空使用默认）" class="!mt-3">
                <NInput v-model:value="s.bot_ref_text" type="textarea" :autosize="{ minRows: 3 }" placeholder="支持 HTML 标签" />
              </NFormItem>
            </div>

            <div class="tg-card p-4" style="background: var(--tg-surface-2)">
              <div class="flex items-center justify-between mb-3">
                <div class="tg-section-title">邀请效果预览</div>
                <NButton size="tiny" quaternary :loading="busy === 'inv'" @click="loadInvite">{{ inviteStats.rewarded ?? 0 }} 人已邀请</NButton>
              </div>
              <div class="invite-card">
                <div class="text-sm font-semibold mb-2">🎉 邀请好友领流量</div>
                <div class="text-xs tg-text-2 mb-2">
                  每邀请 1 位新用户，你可获得
                  <b style="color: var(--tg-brand)">{{ ((Number(s.bot_ref_bonus_mb) || 0) / 1024).toFixed(2) }} GB</b> 流量
                </div>
                <div class="text-xs tg-text-3 mb-2">👥 已邀请 {{ inviteStats.rewarded ?? 0 }} 人 · 累计 {{ ((Number(inviteStats.grantedMb) || 0) / 1024).toFixed(2) }} GB</div>
                <div class="invite-link">https://t.me/{{ status?.bot?.username || 'your_bot' }}?start=ABC12345</div>
                <div class="flex gap-2 mt-2">
                  <NButton size="tiny" block secondary>📤 分享链接</NButton>
                  <NButton size="tiny" block secondary>📊 邀请记录</NButton>
                </div>
              </div>
              <div class="mt-3">
                <div class="tg-section-title mb-2">邀请排行榜</div>
                <div v-for="t in inviteStats.top || []" :key="t.inviter_tg_id" class="stat-row">
                  <span class="text-xs">@{{ t.tg_username || t.inviter_tg_id }}</span>
                  <span class="flex-1" />
                  <span class="text-xs tg-text-3">{{ t.cnt }} 人</span>
                  <span class="text-xs font-medium">{{ ((Number(t.mb) || 0) / 1024).toFixed(2) }} GB</span>
                </div>
                <NEmpty v-if="!inviteStats.top?.length" size="small" description="暂无邀请记录" />
              </div>
            </div>
          </div>
        </div></NTabPane>

        <!-- 用户 -->
        <NTabPane name="users" tab="机器人用户">
          <div class="flex gap-2 py-3">
            <NInput v-model:value="userQuery" size="small" placeholder="搜索 TG ID / 用户名" clearable style="width: 220px" @keyup.enter="loadUsers" />
            <NButton size="small" @click="loadUsers">搜索</NButton>
          </div>
          <div class="pb-3 -mx-4">
            <NDataTable :columns="userColumns" :data="users.list" :bordered="false" size="small"
              :row-key="(r) => r.id" :scroll-x="1050" :max-height="380"
              :pagination="{ page: users.page, pageSize: 20, itemCount: users.total, prefix: ({ itemCount }) => `共 ${itemCount} 人`, onChange: (p) => { users.page = p; loadUsers(); } }" />
          </div>
        </NTabPane>

        <!-- 广播 -->
        <NTabPane name="broadcast" tab="通知广播"><div data-search-anchor="bot-broadcast">
          <div class="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-4 py-3">
            <div>
              <div class="tg-section-title mb-2">① 选择发送对象</div>
              <div class="target-grid">
                <div class="target-card" :class="{ on: bcast.target === 'all' }" @click="bcast.target = 'all'">
                  <NIcon size="18"><Icon icon="tabler:users" /></NIcon>
                  <div class="flex-1">
                    <div class="font-medium text-[13px]">全部机器人用户</div>
                    <div class="text-xs tg-text-3">私聊通知 {{ bcastTargets.users || 0 }} 位用户</div>
                  </div>
                </div>
                <div class="target-card" :class="{ on: bcast.target === 'one' }" @click="bcast.target = 'one'">
                  <NIcon size="18"><Icon icon="tabler:user" /></NIcon>
                  <div class="flex-1">
                    <div class="font-medium text-[13px]">指定用户</div>
                    <div class="text-xs tg-text-3">只通知某一位用户</div>
                  </div>
                </div>
                <div class="target-card" :class="{ on: bcast.target === 'groups' }" @click="bcast.target = 'groups'">
                  <NIcon size="18"><Icon icon="tabler:users-group" /></NIcon>
                  <div class="flex-1">
                    <div class="font-medium text-[13px]">群组 / 频道</div>
                    <div class="text-xs tg-text-3">已接入的 {{ bcastTargets.groups?.length || 0 }} 个群组</div>
                  </div>
                </div>
                <div class="target-card" :class="{ on: bcast.target === 'mixed' }" @click="bcast.target = 'mixed'">
                  <NIcon size="18"><Icon icon="tabler:send" /></NIcon>
                  <div class="flex-1">
                    <div class="font-medium text-[13px]">全部（用户 + 群组）</div>
                    <div class="text-xs tg-text-3">一次性通知所有</div>
                  </div>
                </div>
              </div>

              <!-- 指定用户 -->
              <div v-if="bcast.target === 'one'" class="mt-3">
                <NFormItem label="Telegram 用户 ID / 用户名">
                  <NSelect
                    v-model:value="bcast.tgId" filterable tag
                    :options="(bcastTargets.recentUsers || []).map(u => ({ label: `${u.tg_username ? '@' + u.tg_username : u.tg_first_name || u.tg_id} (${u.tg_id})`, value: u.tg_id }))"
                    placeholder="选择或输入用户的 Telegram 数字 ID"
                  />
                </NFormItem>
              </div>

              <!-- 选择群组 -->
              <div v-if="bcast.target === 'groups' || bcast.target === 'mixed'" class="mt-3">
                <div class="flex items-center justify-between mb-1">
                  <span class="text-xs tg-text-3">选择要发送的群组（不选则全部）</span>
                  <NButton size="tiny" text type="primary" @click="bcast.chatIds = bcast.chatIds.length ? [] : (bcastTargets.groups || []).map(g => g.chat_id)">
                    {{ bcast.chatIds.length ? '取消全选' : '全选' }}
                  </NButton>
                </div>
                <div class="group-picker">
                  <label
                    v-for="g in bcastTargets.groups || []" :key="g.chat_id"
                    class="group-item" :class="{ checked: bcast.chatIds.includes(g.chat_id) }"
                  >
                    <input type="checkbox" :value="g.chat_id" v-model="bcast.chatIds" class="sr-only" />
                    <span class="tg-check">
                      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
                        <path d="M3.5 8.5 6.5 11.5 12.5 5" stroke="currentColor" stroke-width="2"
                              stroke-linecap="round" stroke-linejoin="round" />
                      </svg>
                    </span>
                    <span class="flex-1 truncate">{{ g.title }}</span>
                    <span class="text-xs tg-text-3 font-mono">{{ g.chat_id }}</span>
                  </label>
                  <NEmpty v-if="!bcastTargets.groups?.length" size="small" description="还没有接入任何群组（先把机器人拉进群并设为管理员）" class="py-4" />
                </div>
                <div class="flex gap-2 mt-2">
                  <NInput v-model:value="bcast.testChat" size="small" placeholder="手动检测群组 ID，如 -1001234567890" />
                  <NButton size="small" :loading="bcast.testing" @click="testChat">检测</NButton>
                </div>
              </div>

              <NDivider class="!my-3" />
              <div class="tg-section-title mb-2">② 编辑消息内容</div>
              <NInput
                v-model:value="bcast.text" type="textarea" :autosize="{ minRows: 6, maxRows: 14 }"
                placeholder="支持 HTML 标签，例如：<b>重要通知</b>&#10;今晚 23:00 系统维护"
                show-count :maxlength="4000"
              />
              <div class="flex flex-wrap items-center gap-4 mt-2">
                <label class="flex items-center gap-2 text-[13px]">
                  <NSwitch v-model:value="bcast.withMenu" size="small" />
                  <span>附带功能菜单按钮</span>
                </label>
                <span class="text-xs tg-text-3">提示：Telegram 限制单条消息 4096 字符</span>
              </div>

              <div class="flex items-center gap-2 mt-3">
                <NPopconfirm @positive-click="doBroadcast">
                  <template #trigger>
                    <NButton type="primary" size="small" :loading="broadcasting" :disabled="!bcast.text.trim()">
                      <template #icon><NIcon size="14"><Icon icon="tabler:send" /></NIcon></template>
                      立即发送
                    </NButton>
                  </template>
                  {{ bcastHint }}
                </NPopconfirm>
                <span class="text-xs tg-text-3">{{ bcastHint }}</span>
              </div>

              <NAlert v-if="bcastResult" :type="bcastResult.fail ? 'warning' : 'success'" :bordered="false" class="mt-3" closable @close="bcastResult = null">
                <div class="text-[13px]">
                  发送完成：成功 <b>{{ bcastResult.ok }}</b> · 失败 <b>{{ bcastResult.fail }}</b>
                  <span v-if="bcastResult.users">（用户 {{ bcastResult.users.ok }}/{{ bcastResult.groups?.ok ?? 0 }} 群组）</span>
                </div>
                <div v-if="bcastResult.fails?.length" class="mt-1 text-xs">
                  <div v-for="f in bcastResult.fails.slice(0, 5)" :key="f.chat" class="text-red-500">
                    {{ f.name || f.chat }}：{{ f.error }}
                  </div>
                </div>
              </NAlert>
            </div>

            <div class="tg-card p-4" style="background: var(--tg-surface-2)">
              <div class="tg-section-title mb-3">消息预览</div>
              <div class="chat-preview">
                <div class="preview-msg" v-html="previewText || '<span class=\'tg-text-3\'>在左侧输入内容…</span>'"></div>
                <template v-if="bcast.withMenu">
                  <div class="preview-btns">
                    <span v-for="b in previewButtons" :key="b" class="preview-btn">{{ b }}</span>
                  </div>
                </template>
              </div>
              <div class="text-xs tg-text-3 mt-3 leading-relaxed">
                预览为近似效果。群组/频道需要已把机器人拉入并授予发言权限，否则发送会失败。
              </div>
            </div>
          </div>
        </div></NTabPane>

        <!-- 命令日志 -->
        <NTabPane name="commands" tab="使用统计">
          <div class="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4 py-3">
            <div>
              <div class="tg-section-title mb-2">近 7 天命令排行</div>
              <div v-for="c in commands.stat" :key="c.command" class="stat-row">
                <span class="text-xs font-mono">{{ c.command }}</span>
                <div class="flex-1 h-1.5 rounded bg-[var(--tg-border)] overflow-hidden">
                  <div class="h-full rounded" :style="{ width: Math.min(100, (c.c / (commands.stat[0]?.c || 1)) * 100) + '%', background: 'var(--tg-brand)' }" />
                </div>
                <span class="text-xs tg-text-3 w-8 text-right">{{ c.c }}</span>
              </div>
              <NEmpty v-if="!commands.stat.length" size="small" description="暂无数据" />
            </div>
            <div>
              <NDataTable :columns="cmdColumns" :data="commands.list" :bordered="false" size="small"
                :row-key="(r) => r.id" :max-height="400" :scroll-x="600"
                :pagination="{ page: commands.page, pageSize: 30, itemCount: commands.total, prefix: ({ itemCount }) => `共 ${itemCount} 条`, onChange: (p) => { commands.page = p; loadCommands(); } }" />
            </div>
          </div>
        </NTabPane>
      </NTabs>
    </div>

    <!-- 按钮编辑 -->
    <NModal v-model:show="showBtn" preset="card" :title="btnForm.id ? '编辑按钮' : '添加按钮'" style="max-width: 420px" :bordered="false" size="small">
      <NForm label-placement="top">
        <NFormItem label="按钮文字（最多 32 字）">
          <NInput v-model:value="btnForm.label" :maxlength="32" placeholder="🚀 创建代理" />
        </NFormItem>
        <NFormItem label="点击动作">
          <NSelect v-model:value="btnForm.action" :options="buttons.actions" />
        </NFormItem>
        <NFormItem v-if="btnForm.action === 'url'" label="跳转链接">
          <NInput v-model:value="btnForm.payload" placeholder="https://t.me/..." />
        </NFormItem>
        <div class="flex items-center gap-4">
          <div class="flex items-center gap-2">
            <NSwitch v-model:value="btnForm.active" size="small" />
            <span class="text-[13px]">启用</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-[13px]">排序</span>
            <NInputNumber v-model:value="btnForm.sort" :min="0" size="small" style="width: 80px" />
          </div>
        </div>
      </NForm>
      <template #footer>
        <div class="flex justify-end gap-2">
          <NButton size="small" @click="showBtn = false">取消</NButton>
          <NButton size="small" type="primary" @click="saveBtn">保存</NButton>
        </div>
      </template>
    </NModal>

    <!-- 余额 -->
    <NModal v-model:show="showBalance" preset="card" :title="`调整余额 · ${balanceTarget?.tg_username || balanceTarget?.tg_id || ''}`" style="max-width: 380px" :bordered="false" size="small">
      <NInputNumber v-model:value="balanceValue" :min="0" :step="512" class="!w-full">
        <template #suffix>MB</template>
      </NInputNumber>
      <div class="text-xs tg-text-3 mt-2">当前余额 {{ ((Number(balanceTarget?.balance_mb) || 0) / 1024).toFixed(2) }} GB</div>
      <template #footer>
        <div class="flex justify-end gap-2">
          <NButton size="small" @click="showBalance = false">取消</NButton>
          <NButton size="small" type="primary" @click="saveBalance">保存</NButton>
        </div>
      </template>
    </NModal>
  </div>
</template>

<style scoped>
.target-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
@media (max-width: 640px) { .target-grid { grid-template-columns: 1fr; } }
.target-card {
  display: flex; align-items: center; gap: 10px; padding: 10px 12px;
  border: 1px solid var(--tg-border); border-radius: 9px; cursor: pointer;
  transition: all .15s ease; color: var(--tg-text-2);
}
.target-card:hover { border-color: var(--tg-border-strong); background: var(--tg-surface-2); }
.target-card.on { border-color: var(--tg-brand); background: var(--tg-brand-soft); color: var(--tg-brand); }
.target-card.on .tg-text-3 { color: var(--tg-brand); opacity: .75; }
.group-picker { max-height: 160px; overflow-y: auto; border: 1px solid var(--tg-border); border-radius: 8px; padding: 4px; }
.group-item {
  display: flex; align-items: center; gap: 9px;
  padding: 7px 9px; border-radius: 7px; cursor: pointer; font-size: 13px;
  border: 1px solid transparent;
  transition: background .15s ease, border-color .15s ease;
  user-select: none;
}
.group-item:hover { background: var(--tg-surface-2); }
.group-item.checked {
  background: var(--tg-brand-soft);
  border-color: color-mix(in srgb, var(--tg-brand) 22%, transparent);
}
.group-item input.sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0;
}

/* 自定义复选框 */
.tg-check {
  width: 18px; height: 18px; flex-shrink: 0;
  border-radius: 5px;
  border: 1.5px solid var(--tg-border-strong);
  background: var(--tg-surface);
  display: grid; place-items: center;
  color: transparent;
  transition: background .16s ease, border-color .16s ease, color .16s ease, transform .12s ease;
}
.tg-check svg { width: 13px; height: 13px; display: block; }
.tg-check svg path {
  stroke-dasharray: 14; stroke-dashoffset: 14;
  transition: stroke-dashoffset .22s cubic-bezier(.4,0,.2,1);
}
.group-item:hover .tg-check { border-color: var(--tg-brand); }
.group-item.checked .tg-check {
  background: var(--tg-brand);
  border-color: var(--tg-brand);
  color: #fff;
}
.group-item.checked .tg-check svg path { stroke-dashoffset: 0; }
.group-item:active .tg-check { transform: scale(.92); }
.group-item input:focus-visible + .tg-check {
  outline: 2px solid color-mix(in srgb, var(--tg-brand) 40%, transparent);
  outline-offset: 2px;
}
.chat-preview { background: var(--tg-surface); border: 1px solid var(--tg-border); border-radius: 10px; padding: 10px; }
.preview-msg {
  background: var(--tg-brand-soft); border-radius: 10px; padding: 9px 11px;
  font-size: 12.5px; line-height: 1.7; word-break: break-word; min-height: 60px;
}
.preview-btns { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 6px; }
.preview-btn {
  padding: 7px; text-align: center; border-radius: 7px;
  background: var(--tg-surface); border: 1px solid var(--tg-border); font-size: 12px;
}

.row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 9px 0; border-bottom: 1px dashed var(--tg-border); }
.row:last-child { border-bottom: none; }
.row-title { font-size: 13px; font-weight: 500; }
.row-desc { font-size: 11.5px; color: var(--tg-text-3); margin-top: 1px; }

.bot-card {
  border: 1px solid var(--tg-border);
  background: var(--tg-surface-2);
  border-radius: 9px;
  padding: 10px 12px;
  margin-top: 4px;
}
.cmd-editor { display: flex; flex-direction: column; gap: 6px; }
.cmd-row { display: flex; gap: 6px; align-items: center; }

.btn-preview { background: var(--tg-surface-2); border: 1px solid var(--tg-border); border-radius: 10px; padding: 14px; max-width: 380px; margin: 0 auto; }
.chat-bubble { display: flex; flex-direction: column; gap: 6px; }
.btn-row { display: flex; gap: 6px; }
.chat-btn {
  flex: 1; padding: 7px 10px; border-radius: 7px; border: 1px solid var(--tg-border);
  background: var(--tg-surface); color: var(--tg-text); font-size: 12.5px; cursor: default;
}
.btn-item {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px; border-bottom: 1px dashed var(--tg-border);
}
.stat-row { display: flex; align-items: center; gap: 8px; padding: 5px 0; }
</style>
