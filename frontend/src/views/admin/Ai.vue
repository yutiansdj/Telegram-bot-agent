<script setup>
import { ref, onMounted, computed, h } from 'vue';
import {
  NCard, NButton, NInput, NSelect, NInputNumber, NSwitch, NForm, NFormItem,
  NDataTable, NModal, NIcon, NPopconfirm, NTag, NAlert, NDivider, NSpace, NEmpty,
  NInputGroup, NTabs, NTabPane, NRadioGroup, NRadioButton, NCheckbox, NCheckboxGroup,
} from 'naive-ui';
import { Icon } from '@iconify/vue';
import http from '@/api';
import PageHeader from '@/components/common/PageHeader.vue';

const tab = ref('config');
const list = ref([]);
const presets = ref([]);
const stats = ref({});
const loading = ref(false);

// 全局 AI 设置
const settings = ref({
  ai_enabled: '0',
  ai_trigger: 'mention',
  ai_prefix: '/ai ',
  ai_chat_scope: 'whitelist',
  ai_chat_ids: '',
  ai_typing: '1',
  ai_max_history: '10',
  ai_cooldown: '3',
});
const groups = ref([]);
const selectedChats = ref([]);

// 配置弹窗
const showDlg = ref(false);
const editId = ref(null);
const form = ref({
  name: '', provider: 'deepseek', base_url: '', api_key: '', model: '',
  temperature: 0.7, max_tokens: 1024, system_prompt: '', enabled: true, is_default: false,
});
const testing = ref(false);
const wbModels = ref([]);
const wbAccounts = ref([]);
const wbAccountId = ref(null);
const wbLoading = ref(false);
const testResult = ref(null);

// 日志
const logs = ref([]);
const logTotal = ref(0);
const logPage = ref(1);

async function loadAll() {
  loading.value = true;
  try {
    const [aiRes, setRes, grpRes] = await Promise.all([
      http.get('/admin/ai'),
      http.get('/admin/settings'),
      http.get('/admin/groups').catch(() => ({ data: { list: [] } })),
    ]);
    list.value = aiRes.data?.list || [];
    stats.value = aiRes.data?.stats || {};
    presets.value = aiRes.data?.presets || [];

    const s = setRes.data?.settings || {};
    for (const k of Object.keys(settings.value)) {
      if (s[k] !== undefined) settings.value[k] = String(s[k]);
    }
    groups.value = grpRes.data?.list || [];
    selectedChats.value = String(settings.value.ai_chat_ids || '').split(/[,\s]+/).filter(Boolean);
  } finally { loading.value = false; }
}

async function saveGlobal() {
  try {
    settings.value.ai_chat_ids = selectedChats.value.join(',');
    await http.put('/admin/settings', { ...settings.value });
    window.$message.success('AI 设置已保存');
  } catch (e) { window.$message.error(e.message); }
}

function onProviderChange(v) {
  const p = presets.value.find((x) => x.value === v);
  if (p) {
    form.value.base_url = p.base_url || '';
    form.value.model = p.model || '';
  }
  if (v === 'workbuddy') {
    loadWbModels(wbAccountId.value).then(() => {
      if (!wbAccountId.value && wbAccounts.value.length) {
        wbAccountId.value = wbAccounts.value[0].id;
      }
      if (wbAccountId.value) form.value.base_url = 'workbuddy://' + wbAccountId.value;
      if (wbModels.value.length && !form.value.model) form.value.model = wbModels.value[0].value;
    });
  }
}

async function loadWbModels(accountId = null) {
  wbLoading.value = true;
  try {
    const params = accountId ? { account_id: accountId } : {};
    const r = await http.get('/admin/wb/model-options', { params });
    wbModels.value = r.data?.options || [];
    wbAccounts.value = r.data?.accounts || [];
    if (!wbAccountId.value && r.data?.account?.id) {
      wbAccountId.value = r.data.account.id;
    }
  } catch { wbModels.value = []; } finally { wbLoading.value = false; }
}

/** 切换 WorkBuddy 账号：自动填入 base_url(token 指向) 并重新加载模型 */
async function onWbAccountChange(id) {
  wbAccountId.value = id;
  form.value.base_url = 'workbuddy://' + id;
  form.value.model = '';
  await loadWbModels(id);
  if (wbModels.value.length) form.value.model = wbModels.value[0].value;
}

function openCreate() {
  editId.value = null;
  form.value = {
    name: '', provider: 'deepseek', base_url: 'https://api.deepseek.com/v1', api_key: '',
    model: 'deepseek-chat', temperature: 0.7, max_tokens: 1024, system_prompt: '', enabled: true, is_default: false,
  };
  testResult.value = null;
  showDlg.value = true;
}

function openEdit(row) {
  editId.value = row.id;
  form.value = {
    name: row.name, provider: row.provider, base_url: row.base_url || '', api_key: '',
    model: row.model || '', temperature: row.temperature, max_tokens: row.max_tokens,
    system_prompt: row.system_prompt || '', enabled: !!row.enabled, is_default: !!row.is_default,
  };
  testResult.value = null;
  if (form.value.provider === 'workbuddy') {
    const m = String(form.value.base_url || '').match(/workbuddy:\/\/(\d+)/);
    if (m) wbAccountId.value = Number(m[1]);
    loadWbModels(wbAccountId.value);
  }
  showDlg.value = true;
}

async function testConfig() {
  testing.value = true;
  testResult.value = null;
  try {
    const payload = { ...form.value, id: editId.value || undefined };
    const r = await http.post('/admin/ai/test', payload);
    testResult.value = { ok: true, text: r.message || r.data?.text };
    window.$message.success('测试成功');
  } catch (e) {
    testResult.value = { ok: false, text: e.message };
    window.$message.error(e.message);
  } finally { testing.value = false; }
}

async function saveConfig() {
  if (!form.value.name.trim()) { window.$message.warning('请填写配置名称'); return; }
  // WorkBuddy：自动补全地址与占位 key（真实凭证在账号表里）
  if (form.value.provider === 'workbuddy') {
    if (!wbAccountId.value) { window.$message.warning('请选择 WorkBuddy 账号'); return; }
    form.value.base_url = 'workbuddy://' + wbAccountId.value;
    if (!form.value.api_key) form.value.api_key = 'workbuddy-managed';
  }
  try {
    await http.post('/admin/ai', { ...form.value, id: editId.value });
    window.$message.success('已保存');
    showDlg.value = false;
    loadAll();
  } catch (e) { window.$message.error(e.message); }
}

async function setDefault(row) {
  try {
    await http.post('/admin/ai', { ...row, id: row.id, api_key: '', is_default: true });
    window.$message.success('已设为默认');
    loadAll();
  } catch (e) { window.$message.error(e.message); }
}

async function removeConfig(row) {
  try {
    await http.delete(`/admin/ai/${row.id}`);
    window.$message.success('已删除');
    loadAll();
  } catch (e) { window.$message.error(e.message); }
}

async function loadLogs() {
  try {
    const r = await http.get('/admin/ai/logs', { params: { page: logPage.value, size: 20 } });
    logs.value = r.data?.list || [];
    logTotal.value = r.data?.total || 0;
  } catch (e) { /* ignore */ }
}

async function clearLogs() {
  try {
    await http.delete('/admin/ai/logs');
    window.$message.success('已清空');
    loadLogs();
  } catch (e) { window.$message.error(e.message); }
}

const configColumns = computed(() => [
  {
    title: '配置名称', key: 'name', minWidth: 140,
    render: (row) => h('div', { class: 'flex items-center gap-1.5' }, [
      h('span', { class: 'font-medium text-[13.5px]' }, row.name),
      row.is_default ? h(NTag, { type: 'success', size: 'tiny', bordered: false }, { default: () => '默认' }) : null,
    ]),
  },
  {
    title: '供应商', key: 'provider', width: 120,
    render: (row) => h(NTag, { size: 'small', bordered: false }, {
      default: () => presets.value.find((p) => p.value === row.provider)?.label || row.provider,
    }),
  },
  { title: '模型', key: 'model', minWidth: 140, ellipsis: { tooltip: true } },
  {
    title: 'Key', key: 'api_key', width: 110,
    render: (row) => h('code', { class: 'text-[11.5px]' }, row.api_key || '未配置'),
  },
  {
    title: '状态', key: 'enabled', width: 80,
    render: (row) => row.enabled
      ? h(NTag, { type: 'success', size: 'small', bordered: false }, { default: () => '启用' })
      : h(NTag, { size: 'small', bordered: false }, { default: () => '停用' }),
  },
  {
    title: '已用', key: 'used_count', width: 70,
    render: (row) => h('span', { class: 'text-[12px] tg-text-3' }, `${row.used_count || 0} 次`),
  },
  {
    title: '操作', key: 'ops', width: 210,
    render: (row) => h(NSpace, { size: 6, wrap: false }, {
      default: () => [
        row.is_default ? null : h(NButton, { size: 'tiny', quaternary: true, onClick: () => setDefault(row) }, { default: () => '设默认' }),
        h(NButton, { size: 'tiny', quaternary: true, onClick: () => openEdit(row) }, { default: () => '编辑' }),
        h(NPopconfirm, { onPositiveClick: () => removeConfig(row) }, {
          trigger: () => h(NButton, { size: 'tiny', quaternary: true, type: 'error' }, { default: () => '删除' }),
          default: () => '确定删除该配置？',
        }),
      ].filter(Boolean),
    }),
  },
]);

const logColumns = [
  { title: '时间', key: 'created_at', width: 150 },
  { title: '用户', key: 'tg_id', width: 110 },
  { title: '提问', key: 'prompt', minWidth: 200, ellipsis: { tooltip: true } },
  { title: '回复', key: 'reply', minWidth: 200, ellipsis: { tooltip: true } },
  { title: '模型', key: 'model', width: 130, ellipsis: true },
  {
    title: '状态', key: 'status', width: 80,
    render: (row) => row.status === 'ok'
      ? h(NTag, { type: 'success', size: 'tiny', bordered: false }, { default: () => '成功' })
      : h(NTag, { type: 'error', size: 'tiny', bordered: false }, { default: () => '失败' }),
  },
  { title: '耗时', key: 'latency_ms', width: 80, render: (row) => `${row.latency_ms || 0}ms` },
];

onMounted(async () => { await loadAll(); loadLogs(); });
</script>

<template>
  <div>
    <PageHeader title="AI 智能助手" desc="接入大模型，在指定群组 @机器人 即可智能回复" />

    <!-- 统计 -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
      <NCard :bordered="false" class="tg-card p-3">
        <div class="text-[11.5px] tg-text-3">总调用</div>
        <div class="text-[20px] font-semibold">{{ stats.total || 0 }}</div>
      </NCard>
      <NCard :bordered="false" class="tg-card p-3">
        <div class="text-[11.5px] tg-text-3">今日</div>
        <div class="text-[20px] font-semibold">{{ stats.today || 0 }}</div>
      </NCard>
      <NCard :bordered="false" class="tg-card p-3">
        <div class="text-[11.5px] tg-text-3">成功率</div>
        <div class="text-[20px] font-semibold tg-success">{{ stats.successRate || 0 }}%</div>
      </NCard>
      <NCard :bordered="false" class="tg-card p-3">
        <div class="text-[11.5px] tg-text-3">平均耗时</div>
        <div class="text-[20px] font-semibold">{{ stats.avgLatency || 0 }}ms</div>
      </NCard>
    </div>

    <NCard :bordered="false" class="tg-card">
      <NTabs v-model:value="tab" type="line" size="small">
        <!-- 生效范围 -->
        <NTabPane name="config" tab="生效范围"><div data-search-anchor="ai-scope">
          <NForm label-placement="left" label-width="150" class="max-w-[720px] pt-2">
            <NFormItem label="启用 AI 助手">
              <div class="flex items-center gap-3">
                <NSwitch :value="settings.ai_enabled === '1'" @update:value="(v) => { settings.ai_enabled = v ? '1' : '0'; saveGlobal(); }" />
                <span class="text-[12px] tg-text-3">关闭后所有 AI 回复停止</span>
              </div>
            </NFormItem>

            <NFormItem label="生效范围">
              <NRadioGroup :value="settings.ai_chat_scope" @update:value="(v) => { settings.ai_chat_scope = v; saveGlobal(); }">
                <NRadioButton value="whitelist">仅指定群组/频道</NRadioButton>
                <NRadioButton value="all">所有群组</NRadioButton>
              </NRadioGroup>
            </NFormItem>

            <NFormItem v-if="settings.ai_chat_scope === 'whitelist'" label="选择群组/频道">
              <div class="w-full">
                <NCheckboxGroup v-model:value="selectedChats" class="grid grid-cols-2 gap-1.5">
                  <NCheckbox v-for="g in groups" :key="g.chat_id" :value="g.chat_id">
                    <span class="text-[12.5px]">
                      {{ g.title || g.chat_id }}
                      <NTag size="tiny" :type="g.type === 'channel' ? 'info' : 'default'" :bordered="false">
                        {{ g.type === 'channel' ? '频道' : '群组' }}
                      </NTag>
                    </span>
                  </NCheckbox>
                </NCheckboxGroup>
                <NEmpty v-if="!groups.length" description="暂无已接入的群组，请先到「群组管理」接入" size="small" class="py-3" />
                <NButton size="small" type="primary" class="mt-3" @click="saveGlobal">保存选择</NButton>
              </div>
            </NFormItem>

            <NFormItem label="触发方式">
              <NRadioGroup :value="settings.ai_trigger" @update:value="(v) => { settings.ai_trigger = v; saveGlobal(); }">
                <NRadioButton value="mention">@机器人 触发</NRadioButton>
                <NRadioButton value="prefix">前缀触发</NRadioButton>
                <NRadioButton value="all">所有消息</NRadioButton>
              </NRadioGroup>
            </NFormItem>

            <NFormItem v-if="settings.ai_trigger === 'prefix'" label="触发前缀">
              <NInput :value="settings.ai_prefix" style="width: 160px" @update:value="(v) => (settings.ai_prefix = v)" @blur="saveGlobal" />
            </NFormItem>

            <NAlert type="info" :bordered="false" class="mt-2">
              <div class="text-[12.5px] leading-relaxed">
                <b>使用方法：</b>在上述选中的群组里发送
                <code>@机器人用户名 今天签到送多少流量</code><br>
                机器人会识别内容并回复。私聊机器人<b>不会</b>触发 AI（避免影响菜单功能）。
              </div>
            </NAlert>

            <NDivider />

            <NFormItem label="输入状态提示">
              <div class="flex items-center gap-2">
                <NSwitch :value="settings.ai_typing === '1'" @update:value="(v) => { settings.ai_typing = v ? '1' : '0'; saveGlobal(); }" />
                <span class="text-[12px] tg-text-3">AI 生成时显示「正在输入」</span>
              </div>
            </NFormItem>
            <NFormItem label="上下文轮数">
              <div class="flex items-center gap-2">
                <NInputNumber :value="Number(settings.ai_max_history)" :min="0" :max="50" style="width: 120px"
                              @update:value="(v) => { settings.ai_max_history = String(v ?? 10); saveGlobal(); }" />
                <span class="text-[12px] tg-text-3">记住最近几轮对话</span>
              </div>
            </NFormItem>
          </NForm>
        </div></NTabPane>

        <!-- 模型配置 -->
        <NTabPane name="models" tab="模型配置"><div data-search-anchor="ai-models">
          <div class="flex justify-end py-2">
            <NButton type="primary" size="small" @click="openCreate">
              <template #icon><NIcon><Icon icon="tabler:plus" /></NIcon></template>
              添加模型
            </NButton>
          </div>
          <NDataTable :columns="configColumns" :data="list" :loading="loading" :bordered="false" size="small" :row-key="(r) => r.id">
            <template #empty>
              <NEmpty description="还没有配置 AI 模型">
                <template #extra>
                  <NButton size="small" type="primary" @click="openCreate">添加第一个模型</NButton>
                </template>
              </NEmpty>
            </template>
          </NDataTable>
        </div></NTabPane>

        <!-- 调用日志 -->
        <NTabPane name="logs" tab="调用日志"><div data-search-anchor="ai-logs">
          <div class="flex justify-between items-center py-2">
            <span class="text-[12px] tg-text-3">共 {{ logTotal }} 条记录</span>
            <div class="flex gap-2">
              <NButton size="small" @click="loadLogs">刷新</NButton>
              <NPopconfirm @positive-click="clearLogs">
                <template #trigger><NButton size="small" type="error" quaternary>清空</NButton></template>
                确定清空所有 AI 调用日志？
              </NPopconfirm>
            </div>
          </div>
          <NDataTable :columns="logColumns" :data="logs" :bordered="false" size="small" :pagination="false" />
        </div></NTabPane>
      </NTabs>
    </NCard>

    <!-- 模型配置弹窗 -->
    <NModal v-model:show="showDlg" preset="card" :title="editId ? '编辑模型配置' : '添加模型配置'" style="max-width: 680px">
      <NForm label-placement="top">
        <div class="grid grid-cols-2 gap-3">
          <NFormItem label="配置名称" required>
            <NInput v-model:value="form.name" placeholder="例如：DeepSeek 主力" maxlength="64" />
          </NFormItem>
          <NFormItem label="供应商">
            <NSelect v-model:value="form.provider" :options="presets" @update:value="onProviderChange" />
          </NFormItem>
        </div>

        <!-- WorkBuddy：选择已登录账号，自动带入 -->
        <template v-if="form.provider === 'workbuddy'">
          <NFormItem label="WorkBuddy 账号" required>
            <NSelect
              :value="wbAccountId"
              :options="wbAccounts.map(a => ({ label: a.label, value: a.id }))"
              placeholder="选择已登录的 WorkBuddy 账号"
              @update:value="onWbAccountChange"
            >
              <template #empty>
                <div class="p-3 text-[12px] tg-text-3">
                  还没有登录 WorkBuddy 账号，
                  <a href="/admin/workbuddy" class="tg-brand">去登录 →</a>
                </div>
              </template>
            </NSelect>
          </NFormItem>
          <NAlert type="success" :bordered="false" class="mb-3">
            <div class="text-[12.5px]">
              ✅ 已自动关联该账号的登录凭证，无需填写 API Key。
              地址：<code>{{ form.base_url || '（选择账号后自动生成）' }}</code>
            </div>
          </NAlert>
        </template>

        <!-- 其他供应商：手动填写 -->
        <template v-else>
          <NFormItem label="API 地址">
            <NInput v-model:value="form.base_url" placeholder="https://api.deepseek.com/v1" />
          </NFormItem>

          <NFormItem label="API Key" :required="!editId">
            <NInput v-model:value="form.api_key" type="password" show-password-on="click"
                    :placeholder="editId ? '留空则不修改' : 'sk-...'" />
          </NFormItem>
        </template>

        <div class="grid grid-cols-3 gap-3">
          <NFormItem label="模型名称">
            <NSelect
              v-if="form.provider === 'workbuddy'"
              v-model:value="form.model"
              :options="wbModels"
              :loading="wbLoading"
              filterable
              placeholder="选择 WorkBuddy 模型"
            />
            <NInput v-else v-model:value="form.model" placeholder="deepseek-chat" />
          </NFormItem>
          <NFormItem label="温度">
            <NInputNumber v-model:value="form.temperature" :min="0" :max="2" :step="0.1" />
          </NFormItem>
          <NFormItem label="最大 Token">
            <NInputNumber v-model:value="form.max_tokens" :min="64" :max="8192" :step="64" />
          </NFormItem>
        </div>

        <NFormItem label="系统提示词（人设）">
          <NInput
            v-model:value="form.system_prompt" type="textarea" :rows="3"
            placeholder="例如：你是 XS Kernel 代理平台的客服助手，用简洁友好的中文回答问题。关于代理、流量、签到的问题可以结合平台功能回答。"
            maxlength="4000" show-count
          />
        </NFormItem>

        <div class="flex gap-6">
          <NFormItem label="启用">
            <NSwitch v-model:value="form.enabled" />
          </NFormItem>
          <NFormItem label="设为默认">
            <NSwitch v-model:value="form.is_default" />
          </NFormItem>
        </div>

        <NAlert v-if="testResult" :type="testResult.ok ? 'success' : 'error'" :bordered="false">
          <div class="text-[12.5px] break-all">{{ testResult.text }}</div>
        </NAlert>
      </NForm>
      <template #footer>
        <div class="flex justify-between">
          <NButton :loading="testing" @click="testConfig">测试连接</NButton>
          <div class="flex gap-2">
            <NButton @click="showDlg = false">取消</NButton>
            <NButton type="primary" @click="saveConfig">保存</NButton>
          </div>
        </div>
      </template>
    </NModal>
  </div>
</template>
