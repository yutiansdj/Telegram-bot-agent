<script setup>
import { ref, onMounted, computed, h } from 'vue';
import {
  NCard, NButton, NDataTable, NModal, NForm, NFormItem, NInput, NSwitch, NSpace,
  NTag, NIcon, NPopconfirm, NEmpty, NAlert, NDivider,
  NRadioGroup, NRadio, NDrawer, NDrawerContent, NDescriptions,
  NDescriptionsItem, NRadioButton,
} from 'naive-ui';
import { Icon } from '@iconify/vue';
import http from '@/api';
import PageHeader from '@/components/common/PageHeader.vue';

const list = ref([]);
const loading = ref(false);
const busy = ref('');

// ---------------- 添加/编辑 ----------------
const showDlg = ref(false);
const mode = ref('create');
const form = ref({ id: null, name: '', token: '', ai_enabled: true, enabled: true, ai_persona: '', welcome: '', mode: 'polling', webhook_url: '', webhook_secret: '' });
const verifying = ref(false);
const verified = ref(null);

// ---------------- 详情抽屉 ----------------
const showDrawer = ref(false);
const current = ref(null);
const cmds = ref({ private: [], group: [], admins: [] });
const cmdScope = ref('private');

async function load() {
  loading.value = true;
  try {
    const r = await http.get('/admin/bots');
    list.value = r.data?.list || [];
  } finally { loading.value = false; }
}

function openCreate() {
  mode.value = 'create';
  form.value = { id: null, name: '', token: '', ai_enabled: true, enabled: true, ai_persona: '', welcome: '', mode: 'polling', webhook_url: '', webhook_secret: '' };
  verified.value = null;
  showDlg.value = true;
}

function openEdit(row) {
  mode.value = 'edit';
  form.value = {
    id: row.id, name: row.name, token: '', ai_enabled: row.ai_enabled, enabled: row.enabled,
    ai_persona: row.ai_persona || '', welcome: row.welcome || '', mode: row.mode || 'polling',
    webhook_url: row.webhook_url || '', webhook_secret: row.webhook_secret || '',
  };
  verified.value = null;
  showDlg.value = true;
}

async function verifyToken() {
  if (!form.value.token.trim()) { window.$message.warning('请先填写 Token'); return; }
  verifying.value = true;
  verified.value = null;
  try {
    const r = await http.post('/admin/bots/verify', { token: form.value.token.trim() });
    verified.value = r.data;
    if (!form.value.name) form.value.name = r.data.name || r.data.username;
    window.$message.success(`Token 有效：@${r.data.username}`);
  } catch (e) {
    window.$message.error(e.message || 'Token 无效');
  } finally { verifying.value = false; }
}

async function save(andStart = false) {
  if (!form.value.name.trim()) { window.$message.warning('请填写名称'); return; }
  if (mode.value === 'create' && !form.value.token.trim()) { window.$message.warning('请填写 Token'); return; }
  busy.value = 'save';
  try {
    let bid = form.value.id;
    if (mode.value === 'create') {
      const r = await http.post('/admin/bots', { name: form.value.name, token: form.value.token.trim() });
      bid = r.data?.id;
      window.$message.success(r.message || '已添加');
    } else {
      await http.put(`/admin/bots/${bid}`, form.value);
      window.$message.success('已保存');
    }
    showDlg.value = false;
    await load();
    if (andStart && bid) {
      const row = list.value.find((x) => x.id === bid) || { id: bid, name: form.value.name };
      await doAction(row, 'start');
    }
  } catch (e) {
    window.$message.error(e.message);
  } finally { busy.value = ''; }
}

async function doAction(row, act) {
  busy.value = act + row.id;
  try {
    const r = await http.post(`/admin/bots/${row.id}/${act}`);
    window.$message.success(r.message || '操作完成');
    await load();
    if (current.value?.id === row.id) current.value = list.value.find((x) => x.id === row.id) || current.value;
  } catch (e) {
    window.$message.error(e.message);
  } finally { busy.value = ''; }
}

async function remove(row) {
  try {
    await http.delete(`/admin/bots/${row.id}`);
    window.$message.success('已删除');
    load();
  } catch (e) { window.$message.error(e.message); }
}

async function toggle(row, field, val) {
  try {
    await http.put(`/admin/bots/${row.id}`, { [field]: val });
    await load();
  } catch (e) { window.$message.error(e.message); }
}

// ---------------- 详情：命令配置 ----------------
async function openDetail(row) {
  current.value = row;
  showDrawer.value = true;
  cmdScope.value = 'private';
  try {
    const r = await http.get('/admin/bot/commands/menu');
    const d = r.data || {};
    cmds.value = { private: d.private || [], group: d.group || [], admins: d.admins || [] };
  } catch { /* ignore */ }
}

const currentCmdList = computed({
  get: () => cmds.value[cmdScope.value] || [],
  set: (v) => { cmds.value[cmdScope.value] = v; },
});

async function syncCommands() {
  busy.value = 'menu';
  try {
    await http.post('/admin/bot/commands/menu', cmds.value);
    window.$message.success('命令已同步到 Telegram');
  } catch (e) { window.$message.error(e.message); } finally { busy.value = ''; }
}

const statusTag = (row) => row?.status === 'running'
  ? h(NTag, { type: 'success', size: 'small', bordered: false }, { default: () => '运行中' })
  : h(NTag, { type: 'default', size: 'small', bordered: false }, { default: () => '已停止' });

const columns = computed(() => [
  {
    title: '机器人', key: 'name', minWidth: 190,
    render: (row) => h('div', { class: 'flex items-center gap-2 cursor-pointer', onClick: () => openDetail(row) }, [
      h('div', { class: 'bot-avatar' }, (row.display_name || row.name || '?').slice(0, 1)),
      h('div', { class: 'min-w-0 flex-1' }, [
        h('div', { class: 'flex items-center gap-1.5' }, [
          h('span', { class: 'font-medium text-[13.5px]' }, row.name),
          row.is_primary ? h(NTag, { type: 'info', size: 'tiny', bordered: false }, { default: () => '主' }) : null,
        ]),
        h('div', { class: 'text-[11.5px] tg-text-3' }, row.username ? '@' + row.username : '未连接'),
      ]),
    ]),
  },
  { title: '状态', key: 'status', width: 88, render: statusTag },
  {
    title: 'Token', key: 'token', width: 150,
    render: (row) => h('code', { class: 'text-[11px] tg-text-3' }, row.token || '—'),
  },
  {
    title: 'AI', key: 'ai_enabled', width: 66,
    render: (row) => h(NSwitch, { value: row.ai_enabled, size: 'small', onUpdateValue: (v) => toggle(row, 'ai_enabled', v) }),
  },
  {
    title: '启用', key: 'enabled', width: 66,
    render: (row) => h(NSwitch, { value: row.enabled, size: 'small', onUpdateValue: (v) => toggle(row, 'enabled', v) }),
  },
  {
    title: '最近错误', key: 'last_error', minWidth: 130, ellipsis: { tooltip: true },
    render: (row) => row.last_error
      ? h('span', { class: 'text-[12px] tg-danger' }, row.last_error)
      : h('span', { class: 'tg-text-3 text-[12px]' }, '—'),
  },
  {
    title: '操作', key: 'ops', width: 230,
    render: (row) => h(NSpace, { size: 4, wrap: false }, {
      default: () => [
        row.status === 'running'
          ? h(NButton, { size: 'tiny', quaternary: true, type: 'warning', loading: busy.value === 'stop' + row.id, onClick: () => doAction(row, 'stop') }, { default: () => '停止' })
          : h(NButton, { size: 'tiny', quaternary: true, type: 'primary', loading: busy.value === 'start' + row.id, onClick: () => doAction(row, 'start') }, { default: () => '启动' }),
        h(NButton, { size: 'tiny', quaternary: true, onClick: () => doAction(row, 'restart') }, { default: () => '重启' }),
        h(NButton, { size: 'tiny', quaternary: true, onClick: () => openEdit(row) }, { default: () => '编辑' }),
        row.is_primary ? null : h(NPopconfirm, { onPositiveClick: () => remove(row) }, {
          trigger: () => h(NButton, { size: 'tiny', quaternary: true, type: 'error' }, { default: () => '删除' }),
          default: () => '确定删除该机器人？',
        }),
      ].filter(Boolean),
    }),
  },
]);

onMounted(load);
</script>

<template>
  <div>
    <PageHeader title="多机器人" desc="添加 Telegram 机器人，填 Token 后点击启动即可运行">
      <template #extra>
        <NButton type="primary" size="small" @click="openCreate">
          <template #icon><NIcon><Icon icon="tabler:plus" /></NIcon></template>
          添加机器人
        </NButton>
      </template>
    </PageHeader>

    <NAlert type="info" :bordered="false" class="mb-3">
      <div class="text-[12.5px] leading-relaxed">
        <b>怎么获取 Token：</b>在 Telegram 搜索
        <a href="https://t.me/BotFather" target="_blank" class="tg-brand">@BotFather</a>
        → 发送 <code>/newbot</code> → 设置名称和用户名 → 复制返回的 Token。
        粘贴到下方「添加机器人」，点「保存并启动」即可运行。
      </div>
    </NAlert>

    <NCard :bordered="false" class="tg-card">
      <div class="flex justify-end mb-2">
        <NButton type="primary" size="small" @click="openCreate">
          <template #icon><NIcon><Icon icon="tabler:plus" /></NIcon></template>
          添加机器人
        </NButton>
      </div>
      <NDataTable
        :columns="columns" :data="list" :loading="loading"
        :bordered="false" size="small" :row-key="(r) => r.id"
      >
        <template #empty>
          <NEmpty description="还没有添加机器人">
            <template #extra>
              <NButton size="small" type="primary" @click="openCreate">添加第一个机器人</NButton>
            </template>
          </NEmpty>
        </template>
      </NDataTable>
    </NCard>

    <!-- 添加/编辑 -->
    <NModal v-model:show="showDlg" preset="card" :title="mode === 'create' ? '添加机器人' : '编辑机器人'" style="max-width: 660px">
      <NForm label-placement="top">
        <NFormItem label="Bot Token" :required="mode === 'create'">
          <div class="w-full">
            <div class="flex gap-2">
              <NInput v-model:value="form.token" type="password" show-password-on="click"
                      :placeholder="mode === 'create' ? '123456789:AAH...  （从 @BotFather 获取）' : '留空则不修改 Token'" />
              <NButton :loading="verifying" @click="verifyToken">验证</NButton>
            </div>
            <div v-if="verified" class="mt-1.5 text-[12px] tg-success">
              ✅ Token 有效：@{{ verified.username }}（ID: {{ verified.id }}）
            </div>
          </div>
        </NFormItem>

        <NFormItem label="名称" required>
          <NInput v-model:value="form.name" placeholder="例如：客服助手" maxlength="64" />
        </NFormItem>

        <div class="grid grid-cols-2 gap-3">
          <NFormItem label="启用机器人">
            <NSwitch v-model:value="form.enabled" />
          </NFormItem>
          <NFormItem label="启用 AI 回复">
            <NSwitch v-model:value="form.ai_enabled" />
          </NFormItem>
        </div>

        <NFormItem label="运行模式">
          <NRadioGroup v-model:value="form.mode">
            <NRadio value="polling">长轮询（推荐）</NRadio>
            <NRadio value="webhook">Webhook</NRadio>
          </NRadioGroup>
        </NFormItem>
        <div v-if="form.mode === 'webhook'" class="grid grid-cols-1 gap-2 mb-3">
          <NInput v-model:value="form.webhook_url" placeholder="https://你的域名/api/bot/webhook/机器人ID" />
          <NInput v-model:value="form.webhook_secret" placeholder="Webhook 校验密钥（可选）" />
        </div>

        <NDivider class="!my-2" />

        <NFormItem label="AI 人设（可选，覆盖全局提示词）">
          <NInput v-model:value="form.ai_persona" type="textarea" :rows="3"
                  placeholder="你是 TG 代理平台的客服，用简洁友好的中文回答用户问题。"
                  maxlength="4000" show-count />
        </NFormItem>
        <NFormItem label="欢迎语（可选）">
          <NInput v-model:value="form.welcome" type="textarea" :rows="2" placeholder="/start 时的欢迎语" maxlength="1000" />
        </NFormItem>
      </NForm>
      <template #footer>
        <div class="flex justify-end gap-2">
          <NButton @click="showDlg = false">取消</NButton>
          <NButton :loading="busy === 'save'" @click="save(false)">仅保存</NButton>
          <NButton type="primary" :loading="busy === 'save'" @click="save(true)">保存并启动</NButton>
        </div>
      </template>
    </NModal>

    <!-- 详情抽屉 -->
    <NDrawer v-model:show="showDrawer" :width="620" placement="right">
      <NDrawerContent :title="current?.name || '机器人详情'" closable>
        <template v-if="current">
          <NDescriptions :column="2" label-placement="left" size="small" bordered>
            <NDescriptionsItem label="用户名">@{{ current.username || '—' }}</NDescriptionsItem>
            <NDescriptionsItem label="状态">
              <component :is="statusTag(current)" />
            </NDescriptionsItem>
            <NDescriptionsItem label="Token"><code class="text-[12px]">{{ current.token || '—' }}</code></NDescriptionsItem>
            <NDescriptionsItem label="主机器人">{{ current.is_primary ? '是' : '否' }}</NDescriptionsItem>
          </NDescriptions>

          <div class="flex gap-2 mt-3">
            <NButton v-if="current.status !== 'running'" type="primary" size="small" @click="doAction(current, 'start')">启动</NButton>
            <NButton v-else size="small" type="warning" @click="doAction(current, 'stop')">停止</NButton>
            <NButton size="small" @click="doAction(current, 'restart')">重启</NButton>
            <NButton size="small" @click="openEdit(current)">编辑</NButton>
          </div>

          <div v-if="current.last_error" class="mt-3 text-[12px] tg-danger">
            最近错误：{{ current.last_error }}
          </div>

          <NDivider>命令菜单</NDivider>
          <div class="text-[12px] tg-text-3 mb-2">配置后在对应场景输入「/」会弹出提示</div>
          <NRadioGroup v-model:value="cmdScope" size="small" class="mb-2">
            <NRadioButton value="private">私聊（{{ cmds.private.length }}）</NRadioButton>
            <NRadioButton value="group">群组（{{ cmds.group.length }}）</NRadioButton>
            <NRadioButton value="admins">管理员（{{ cmds.admins.length }}）</NRadioButton>
          </NRadioGroup>
          <div v-for="(c, i) in currentCmdList" :key="i" class="flex gap-1.5 mb-1.5">
            <NInput v-model:value="c.command" size="small" placeholder="命令" style="width: 110px" />
            <NInput v-model:value="c.description" size="small" placeholder="说明" />
            <NButton size="tiny" quaternary type="error" @click="currentCmdList.splice(i, 1)">
              <template #icon><NIcon size="13"><Icon icon="tabler:trash" /></NIcon></template>
            </NButton>
          </div>
          <div class="flex gap-2 mt-2">
            <NButton size="tiny" @click="currentCmdList.push({ command: '', description: '' })">添加</NButton>
            <NButton size="tiny" type="primary" secondary :loading="busy === 'menu'" @click="syncCommands">同步到 Telegram</NButton>
          </div>
        </template>
      </NDrawerContent>
    </NDrawer>
  </div>
</template>

<style scoped>
.bot-avatar {
  width: 30px; height: 30px; min-width: 30px; border-radius: 8px; flex-shrink: 0;
  display: grid; place-items: center;
  background: var(--tg-brand-soft); color: var(--tg-brand);
  font-weight: 600; font-size: 13px;
}
</style>
