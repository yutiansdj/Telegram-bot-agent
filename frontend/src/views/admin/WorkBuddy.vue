<script setup>
import { ref, onMounted, computed, h, onBeforeUnmount } from 'vue';
import {
  NCard, NButton, NDataTable, NIcon, NTag, NAlert, NEmpty, NModal,
  NRadioGroup, NRadioButton, NSpin, NSpace, NInput, NSelect, NSwitch,
  NPopconfirm, NDivider, NDescriptions, NDescriptionsItem, NProgress,
} from 'naive-ui';
import { Icon } from '@iconify/vue';
import http from '@/api';
import PageHeader from '@/components/common/PageHeader.vue';

const accounts = ref([]);
const loading = ref(false);
const busy = ref('');

// 登录弹窗
const showLogin = ref(false);
const region = ref('cn');
const loginStep = ref('idle'); // idle | waiting | done | error
const authUrl = ref('');
const loginState = ref('');
const loginMsg = ref('');
const pollTimer = ref(null);

// 详情
const showDetail = ref(false);
const current = ref(null);
const models = ref([]);
const balance = ref(null);
const modelLoading = ref(false);
const testPrompt = ref('你好，请回复"可用"两个字');
const testResult = ref(null);
const testing = ref(false);
const selectedModel = ref('');

async function load() {
  loading.value = true;
  try {
    const r = await http.get('/admin/wb/accounts');
    accounts.value = r.data?.list || [];
  } finally { loading.value = false; }
}

// ---------------- 登录流程 ----------------
async function startLogin() {
  busy.value = 'login';
  loginStep.value = 'waiting';
  loginMsg.value = '正在获取授权链接…';
  authUrl.value = '';
  try {
    const r = await http.post('/admin/wb/login/start', { region: region.value });
    authUrl.value = r.data.authUrl;
    loginState.value = r.data.state;
    loginMsg.value = '请点击下方按钮打开授权页面，完成登录后会自动获取 Token';
    startPolling();
  } catch (e) {
    loginStep.value = 'error';
    loginMsg.value = e.message;
  } finally { busy.value = ''; }
}

const waited = ref(0);

function startPolling() {
  stopPolling();
  waited.value = 0;
  pollTimer.value = setInterval(async () => {
    waited.value += 2;
    if (waited.value > 300) { // 5 分钟
      stopPolling();
      loginStep.value = 'error';
      loginMsg.value = '登录超时（5 分钟），请重新获取链接';
      return;
    }
    try {
      const r = await http.get('/admin/wb/login/poll', {
        params: { state: loginState.value, region: region.value },
      });
      if (r.data?.done) {
        stopPolling();
        loginStep.value = 'done';
        loginMsg.value = `✅ 登录成功${r.data.nickname ? '：' + r.data.nickname : ''}`;
        await load();
        setTimeout(() => { showLogin.value = false; }, 1500);
      } else if (r.data?.error) {
        stopPolling();
        loginStep.value = 'error';
        loginMsg.value = r.data.error;
      }
    } catch (e) {
      // 网络抖动时继续轮询，不中断
      console.warn('[poll]', e.message);
    }
  }, 2000);
}

/** 手动检查一次（授权完成后立刻点，不用等自动轮询） */
async function checkNow() {
  if (!loginState.value) return;
  busy.value = 'check';
  try {
    const r = await http.get('/admin/wb/login/poll', {
      params: { state: loginState.value, region: region.value },
    });
    if (r.data?.done) {
      stopPolling();
      loginStep.value = 'done';
      loginMsg.value = `✅ 登录成功${r.data.nickname ? '：' + r.data.nickname : ''}`;
      await load();
      setTimeout(() => { showLogin.value = false; }, 1200);
    } else {
      window.$message.info('还没有检测到授权完成，请在浏览器里完成登录');
    }
  } catch (e) {
    window.$message.error(e.message);
  } finally { busy.value = ''; }
}

function stopPolling() {
  if (pollTimer.value) { clearInterval(pollTimer.value); pollTimer.value = null; }
}

function openLogin() {
  showLogin.value = true;
  loginStep.value = 'idle';
  authUrl.value = '';
  loginMsg.value = '';
  region.value = 'cn';
}

function openAuth() {
  if (authUrl.value) window.open(authUrl.value, '_blank');
  if (navigator.clipboard) navigator.clipboard.writeText(authUrl.value).catch(() => {});
}

// ---------------- 账号操作 ----------------
async function viewAccount(row) {
  current.value = row;
  showDetail.value = true;
  models.value = [];
  balance.value = null;
  testResult.value = null;
  await Promise.all([loadModels(row), loadBalance(row)]);
}

async function loadModels(row) {
  modelLoading.value = true;
  try {
    const r = await http.post(`/admin/wb/accounts/${row.id}/models`);
    models.value = r.data?.list || [];
    if (models.value.length && !selectedModel.value) selectedModel.value = models.value[0].id;
  } catch (e) {
    window.$message.error(e.message);
  } finally { modelLoading.value = false; }
}

async function loadBalance(row) {
  try {
    const r = await http.get(`/admin/wb/accounts/${row.id}/balance`);
    balance.value = r.data;
  } catch (e) {
    window.$message.error(e.message);
  }
}

async function doCheckin(row) {
  busy.value = 'checkin' + row.id;
  try {
    const r = await http.post(`/admin/wb/accounts/${row.id}/checkin`);
    window.$message.success(r.message || '签到成功');
    await load();
    if (current.value?.id === row.id) await loadBalance(row);
  } catch (e) {
    window.$message.error(e.message);
  } finally { busy.value = ''; }
}

async function doTest() {
  if (!current.value) return;
  testing.value = true;
  testResult.value = null;
  try {
    const r = await http.post('/admin/wb/test', {
      id: current.value.id, model: selectedModel.value, prompt: testPrompt.value,
    });
    testResult.value = { ok: true, text: r.data?.text };
  } catch (e) {
    testResult.value = { ok: false, text: e.message };
  } finally { testing.value = false; }
}

async function syncToAi(row) {
  busy.value = 'sync' + row.id;
  try {
    const r = await http.post('/admin/wb/sync-ai', { id: row.id });
    window.$message.success(r.message);
  } catch (e) {
    window.$message.error(e.message);
  } finally { busy.value = ''; }
}

async function remove(row) {
  try {
    await http.delete(`/admin/wb/accounts/${row.id}`);
    window.$message.success('已删除');
    load();
  } catch (e) { window.$message.error(e.message); }
}

const columns = computed(() => [
  {
    title: '账号', key: 'nickname', minWidth: 160,
    render: (row) => h('div', { class: 'flex items-center gap-2 cursor-pointer', onClick: () => viewAccount(row) }, [
      h('div', { class: 'wb-avatar' }, (row.nickname || row.uid || 'W').slice(0, 1)),
      h('div', { class: 'min-w-0' }, [
        h('div', { class: 'font-medium text-[13.5px]' }, row.nickname || '未命名'),
        h('div', { class: 'text-[11.5px] tg-text-3' }, row.uid ? 'UID ' + row.uid : '—'),
      ]),
    ]),
  },
  {
    title: '版本', key: 'region', width: 90,
    render: (row) => h(NTag, { size: 'small', bordered: false, type: row.region === 'global' ? 'info' : 'default' },
      { default: () => row.region === 'global' ? '国际版' : '国内版' }),
  },
  {
    title: '积分余额', key: 'last_balance', width: 110,
    render: (row) => h('span', { class: 'font-medium' }, Number(row.last_balance || 0).toFixed(2)),
  },
  {
    title: '上次签到', key: 'last_checkin', width: 120,
    render: (row) => row.last_checkin || h('span', { class: 'tg-text-3' }, '未签到'),
  },
  {
    title: 'Token', key: 'token', width: 160,
    render: (row) => h('code', { class: 'text-[11px] tg-text-3' }, row.token),
  },
  {
    title: '操作', key: 'ops', width: 260,
    render: (row) => h(NSpace, { size: 4, wrap: false }, {
      default: () => [
        h(NButton, { size: 'tiny', quaternary: true, type: 'primary', loading: busy.value === 'checkin' + row.id, onClick: () => doCheckin(row) }, { default: () => '签到' }),
        h(NButton, { size: 'tiny', quaternary: true, onClick: () => viewAccount(row) }, { default: () => '模型' }),
        h(NButton, { size: 'tiny', quaternary: true, onClick: () => syncToAi(row) }, { default: () => '接入AI' }),
        h(NPopconfirm, { onPositiveClick: () => remove(row) }, {
          trigger: () => h(NButton, { size: 'tiny', quaternary: true, type: 'error' }, { default: () => '删除' }),
          default: () => '确定删除该账号？',
        }),
      ],
    }),
  },
]);

onMounted(load);
onBeforeUnmount(stopPolling);
</script>

<template>
  <div>
    <PageHeader title="WorkBuddy" desc="登录 WorkBuddy 账号，管理模型、签到、余额，可接入 Bot">
      <template #extra>
        <NButton type="primary" size="small" @click="openLogin">
          <template #icon><NIcon><Icon icon="tabler:login" /></NIcon></template>
          登录 WorkBuddy
        </NButton>
      </template>
    </PageHeader>

    <NAlert type="info" :bordered="false" class="mb-3">
      <div class="text-[12.5px] leading-relaxed">
        点击「登录 WorkBuddy」→ 在浏览器完成授权 → Token 自动获取。
        登录后可拉取可用模型、查看积分余额、每日签到，并可一键接入 AI 助手让机器人使用 WorkBuddy 的模型。
      </div>
    </NAlert>

    <NCard :bordered="false" class="tg-card">
      <div class="flex justify-end mb-2">
        <NButton type="primary" size="small" @click="openLogin">
          <template #icon><NIcon><Icon icon="tabler:plus" /></NIcon></template>
          添加账号
        </NButton>
      </div>
      <NDataTable :columns="columns" :data="accounts" :loading="loading" :bordered="false" size="small" :row-key="(r) => r.id">
        <template #empty>
          <NEmpty description="还没有登录 WorkBuddy 账号">
            <template #extra>
              <NButton size="small" type="primary" @click="openLogin">登录第一个账号</NButton>
            </template>
          </NEmpty>
        </template>
      </NDataTable>
    </NCard>

    <!-- 登录弹窗 -->
    <NModal v-model:show="showLogin" preset="card" title="登录 WorkBuddy" style="max-width: 560px">
      <div v-if="loginStep === 'idle'">
        <div class="mb-3 text-[13px]">
          <div class="mb-2 tg-text-3">选择要登录的版本：</div>
          <NRadioGroup v-model:value="region">
            <NRadioButton value="cn">国内版（腾讯）</NRadioButton>
            <NRadioButton value="global">国际版</NRadioButton>
          </NRadioGroup>
        </div>
        <NButton type="primary" class="w-full" :loading="busy === 'login'" @click="startLogin">
          获取授权链接
        </NButton>
      </div>

      <div v-else>
        <div class="flex items-center gap-3 mb-3">
          <NSpin :size="18" v-if="loginStep === 'waiting'" />
          <NIcon v-else-if="loginStep === 'done'" size="20" color="#18a058"><Icon icon="tabler:circle-check" /></NIcon>
          <NIcon v-else size="20" color="#d03050"><Icon icon="tabler:circle-x" /></NIcon>
          <span class="text-[13px]">{{ loginMsg }}</span>
        </div>

        <NAlert v-if="loginStep === 'waiting'" type="warning" :bordered="false">
          <div class="text-[12.5px]">
            请在浏览器中完成登录。如果按钮无法打开，复制下方链接到浏览器：
            <div class="mt-2 p-2 bg-black/5 rounded text-[11px] break-all font-mono">{{ authUrl }}</div>
          </div>
        </NAlert>

        <template v-if="loginStep === 'waiting'">
          <NButton type="primary" block class="mt-3" @click="openAuth">
            打开授权页面
          </NButton>
          <div class="flex items-center justify-between mt-2">
            <span class="text-[11.5px] tg-text-3">等待授权中… 已等待 {{ waited }} 秒</span>
            <NButton size="tiny" :loading="busy === 'check'" @click="checkNow">我已登录，立即检查</NButton>
          </div>
          <NButton size="small" quaternary block class="mt-1" @click="startLogin">
            重新获取链接
          </NButton>
        </template>

        <NButton v-if="loginStep === 'error'" class="mt-3 w-full" @click="startLogin">重试</NButton>
      </div>
    </NModal>

    <!-- 账号详情 -->
    <NModal v-model:show="showDetail" preset="card" :title="current?.nickname || 'WorkBuddy 账号'" style="max-width: 720px">
      <template v-if="current">
        <NDescriptions :column="2" label-placement="left" size="small" bordered>
          <NDescriptionsItem label="昵称">{{ current.nickname || '—' }}</NDescriptionsItem>
          <NDescriptionsItem label="UID">{{ current.uid || '—' }}</NDescriptionsItem>
          <NDescriptionsItem label="版本">{{ current.region === 'global' ? '国际版' : '国内版' }}</NDescriptionsItem>
          <NDescriptionsItem label="上次签到">{{ current.last_checkin || '未签到' }}</NDescriptionsItem>
        </NDescriptions>

        <NDivider>积分余额</NDivider>
        <div v-if="balance">
          <div class="text-[24px] font-semibold">{{ balance.total.toFixed(2) }}</div>
          <div class="text-[12px] tg-text-3 mb-2">总剩余积分</div>
          <div v-for="(a, i) in balance.accounts" :key="i" class="flex justify-between text-[12.5px] py-1 border-t border-[var(--tg-border)]">
            <span>{{ a.name }}</span>
            <span class="font-medium">{{ a.remain.toFixed(2) }} / {{ a.size.toFixed(2) }}</span>
          </div>
        </div>
        <div v-else class="text-[12px] tg-text-3">加载中…</div>

        <NDivider>可用模型（{{ models.length }}）</NDivider>
        <NSpin v-if="modelLoading" size="small" />
        <div v-else class="max-h-[160px] overflow-y-auto">
          <NSelect v-model:value="selectedModel" :options="models.map(m => ({ label: m.name + (m.vendor ? ' · ' + m.vendor : ''), value: m.id }))" size="small" filterable />
        </div>

        <NDivider>测试对话</NDivider>
        <div class="flex gap-2">
          <NInput v-model:value="testPrompt" size="small" placeholder="输入测试内容" />
          <NButton size="small" type="primary" :loading="testing" @click="doTest">测试</NButton>
        </div>
        <NAlert v-if="testResult" :type="testResult.ok ? 'success' : 'error'" :bordered="false" class="mt-2">
          <div class="text-[12.5px] whitespace-pre-wrap break-all">{{ testResult.text }}</div>
        </NAlert>
      </template>
    </NModal>
  </div>
</template>

<style scoped>
.wb-avatar {
  width: 30px; height: 30px; min-width: 30px; border-radius: 8px; flex-shrink: 0;
  display: grid; place-items: center;
  background: linear-gradient(135deg, #6366f1, #8b5cf6); color: #fff;
  font-weight: 600; font-size: 13px;
}
</style>
