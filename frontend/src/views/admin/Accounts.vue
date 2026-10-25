<script setup>
import { ref, onMounted, h } from 'vue';
import {
  NButton, NIcon, NInput, NDataTable, NTag, NModal, NForm, NFormItem, NInputNumber,
  NSelect, NPopconfirm, NSpace, NDropdown, NProgress, NTooltip,
} from 'naive-ui';
import { Icon } from '@iconify/vue';
import PageHeader from '@/components/common/PageHeader.vue';
import CopyButton from '@/components/common/CopyButton.vue';
import QrCode from '@/components/common/QrCode.vue';
import { api } from '@/api';
import { useThemeStore } from '@/stores/theme';
import { fmtBytes, fmtDate, fmtMB, fmtRelative, statusMeta } from '@/utils/format';

const theme = useThemeStore();
const loading = ref(true);
const list = ref([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const q = ref('');
const statusFilter = ref('');
const nodes = ref([]);
const users = ref([]);

const showCreate = ref(false);
const creating = ref(false);
const createForm = ref({ user_id: null, node_id: null, name: '', port: null, quota_mb: 10240, expires_days: null, remark: '' });

const showEdit = ref(false);
const editing = ref(null);
const saving = ref(false);
const editForm = ref({ name: '', port: 0, quota_mb: 0, status: 'active', expires_at: null, remark: '', reset_usage: false });

const showLink = ref(false);
const current = ref(null);

async function load() {
  loading.value = true;
  try {
    const res = await api.adminAccounts({ page: page.value, pageSize: pageSize.value, q: q.value, status: statusFilter.value });
    list.value = res.data.list;
    total.value = res.data.total;
  } catch (e) { window.$message.error(e.message); }
  finally { loading.value = false; }
}

async function loadMeta() {
  try {
    const [n, u] = await Promise.all([api.adminNodes(), api.adminUsers({ page: 1, pageSize: 200 })]);
    nodes.value = n.data.list;
    users.value = u.data.list;
  } catch { /* ignore */ }
}

function search() { page.value = 1; load(); }

async function action(row, act) {
  try {
    const res = await api.adminAccountAction(row.id, act);
    if (act === 'test') {
      if (res.data.local && res.data.remote) window.$message.success(`连通正常（${res.data.remoteMs}ms）`);
      else window.$message.warning('检测失败：本地未监听或公网不可达');
    } else {
      window.$message.success(res.message);
    }
    await load();
  } catch (e) { window.$message.error(e.message); }
}

async function toggle(row) {
  try {
    const res = await api.adminToggleAccount(row.id);
    window.$message.success(res.message);
    await load();
  } catch (e) { window.$message.error(e.message); }
}

async function rotate(row) {
  try {
    const res = await api.adminRotateAccount(row.id);
    window.$message.success(res.message);
    await load();
  } catch (e) { window.$message.error(e.message); }
}

async function remove(row) {
  try {
    await api.adminDeleteAccount(row.id);
    window.$message.success('已删除');
    await load();
  } catch (e) { window.$message.error(e.message); }
}

function openEdit(row) {
  editing.value = row;
  editForm.value = {
    name: row.name, port: row.port, quota_mb: row.quota_mb, status: row.status,
    expires_at: row.expires_at, remark: row.remark, reset_usage: false,
  };
  showEdit.value = true;
}

async function saveEdit() {
  saving.value = true;
  try {
    const payload = { ...editForm.value };
    if (!payload.reset_usage) delete payload.reset_usage;
    await api.adminUpdateAccount(editing.value.id, payload);
    window.$message.success('已保存并生效');
    showEdit.value = false;
    await load();
  } catch (e) { window.$message.error(e.message); }
  finally { saving.value = false; }
}

async function createAccount() {
  creating.value = true;
  try {
    const payload = { ...createForm.value };
    if (!payload.port) delete payload.port;
    if (!payload.expires_days) delete payload.expires_days;
    await api.adminCreateAccount(payload);
    window.$message.success('代理已创建');
    showCreate.value = false;
    createForm.value = { user_id: null, node_id: null, name: '', port: null, quota_mb: 10240, expires_days: null, remark: '' };
    await load();
  } catch (e) { window.$message.error(e.message); }
  finally { creating.value = false; }
}

function openCreate() {
  createForm.value = {
    user_id: null, node_id: nodes.value[0]?.id || null, name: '', port: null, quota_mb: 10240, expires_days: null, remark: '',
  };
  showCreate.value = true;
}

const columns = [
  { title: 'ID', key: 'id', width: 60 },
  {
    title: '代理', key: 'name', minWidth: 170,
    render: (r) => h('div', null, [
      h('div', { style: 'font-weight:500;font-size:13px' }, r.name),
      h('div', { style: 'font-size:11.5px;color:var(--tg-text-3)' }, `${r.owner || ''} · ${r.node_name}`),
    ]),
  },
  { title: '端口', key: 'port', width: 80, render: (r) => h('span', { class: 'font-mono', style: 'font-size:12px' }, r.port) },
  {
    title: '状态', key: 'state', width: 92,
    render: (r) => h(NTag, { size: 'small', type: statusMeta[r.state]?.type || 'default', bordered: false },
      { default: () => statusMeta[r.state]?.text || r.state }),
  },
  {
    title: '流量用量', key: 'used_bytes', width: 180,
    render: (r) => h('div', { style: 'min-width:140px' }, [
      h('div', { style: 'font-size:11.5px;display:flex;justify-content:space-between;color:var(--tg-text-2);margin-bottom:2px' }, [
        h('span', fmtBytes(r.used_bytes)),
        h('span', `/ ${fmtMB(r.quota_mb)}`),
      ]),
      h(NProgress, {
        type: 'line', percentage: r.usage_pct, showIndicator: false, height: 5, railColor: 'var(--tg-border)',
        color: r.usage_pct > 90 ? '#dc2626' : r.usage_pct > 70 ? '#d97706' : '#2450eb',
      }),
    ]),
  },
  {
    title: '最近使用', key: 'last_used_at', width: 100,
    render: (r) => h('span', { style: 'color:var(--tg-text-3);font-size:12px' }, fmtRelative(r.last_used_at)),
  },
  {
    title: '操作', key: 'actions', width: 250, fixed: 'right',
    render: (r) => h(NSpace, { size: 4, wrap: false }, {
      default: () => [
        h(NButton, { size: 'tiny', secondary: true, type: 'primary', onClick: () => { current.value = r; showLink.value = true; } }, { default: () => '链接' }),
        h(NDropdown, {
          trigger: 'click',
          options: [
            { label: '重启进程', key: 'restart' },
            { label: '启动', key: 'start' },
            { label: '停止', key: 'stop' },
            { label: '连通检测', key: 'test' },
            { type: 'divider', key: 'd' },
            { label: '重置密钥', key: 'rotate' },
          ],
          onSelect: (k) => (k === 'rotate' ? rotate(r) : action(r, k)),
        }, {
          default: () => h(NButton, { size: 'tiny', quaternary: true }, { default: () => '更多' }),
        }),
        h(NButton, { size: 'tiny', secondary: true, onClick: () => openEdit(r) }, { default: () => '编辑' }),
        h(NPopconfirm, { onPositiveClick: () => remove(r) }, {
          trigger: () => h(NButton, { size: 'tiny', quaternary: true, type: 'error' }, { default: () => '删除' }),
          default: () => `确定删除代理「${r.name}」？`,
        }),
      ],
    }),
  },
];

onMounted(async () => { await loadMeta(); await load(); });
</script>

<template>
  <div>
    <PageHeader title="代理管理" subtitle="全平台代理账号的流量、端口、进程与密钥统一管理" icon="tabler:affiliate">
      <template #actions>
        <NInput v-model:value="q" placeholder="搜索名称/用户/端口" clearable size="small" style="width: 180px" @keyup.enter="search" @clear="search" />
        <NSelect
          v-model:value="statusFilter" size="small" style="width: 110px"
          :options="[{ label: '全部状态', value: '' }, { label: '运行中', value: 'running' }, { label: '已停用', value: 'disabled' }]"
          @update:value="search"
        />
        <NButton size="small" quaternary @click="load">
          <template #icon><NIcon size="15"><Icon icon="tabler:refresh" /></NIcon></template>
        </NButton>
        <NButton type="primary" size="small" @click="openCreate">
          <template #icon><NIcon size="15"><Icon icon="tabler:plus" /></NIcon></template>
          新建代理
        </NButton>
      </template>
    </PageHeader>

    <div class="tg-card">
      <NDataTable
        :columns="columns" :data="list" :loading="loading" :bordered="false" size="small"
        :row-key="(r) => r.id" :scroll-x="1060"
        :pagination="{
          page, pageSize, itemCount: total, showSizePicker: true, pageSizes: [10, 20, 50],
          prefix: ({ itemCount }) => `共 ${itemCount} 个代理`,
          onChange: (p) => { page = p; load(); },
          onUpdatePageSize: (s) => { pageSize = s; page = 1; load(); },
        }"
      />
    </div>

    <!-- 链接 -->
    <NModal v-model:show="showLink" preset="card" :title="`代理链接 · ${current?.name || ''}`" style="max-width: 520px" :bordered="false" size="small">
      <div v-if="current" class="grid grid-cols-1 sm:grid-cols-[170px_1fr] gap-4">
        <div class="flex flex-col items-center gap-1.5 p-3 rounded-lg" style="background: var(--tg-surface-2); border: 1px solid var(--tg-border)">
          <QrCode :text="current.links.tme" :size="150" :dark="theme.dark" />
        </div>
        <div class="min-w-0 flex flex-col gap-2">
          <div>
            <div class="text-[11.5px] tg-text-3 flex items-center justify-between">
              <span>t.me 链接</span>
              <span class="text-[10.5px]">标准格式最通用</span>
            </div>
            <div class="flex items-center gap-1.5 mt-1">
              <code class="tg-code flex-1 truncate border tg-divider rounded px-2 py-1 bg-[var(--tg-surface-2)]">{{ current.links.tme }}</code>
              <CopyButton :text="current.links.tme" label="复制" />
            </div>
          </div>
          <div>
            <div class="text-[11.5px] tg-text-3">兼容格式</div>
            <div class="flex flex-col gap-1 mt-1">
              <div v-for="(v, k) in current.links.variants" :key="k" class="flex items-center gap-1.5">
                <span class="text-[10.5px] tg-text-3 w-[86px] flex-shrink-0">{{ v.label }}</span>
                <code class="tg-code flex-1 truncate border tg-divider rounded px-2 py-0.5 bg-[var(--tg-surface-2)] text-[11px]">{{ v.tme.split('secret=')[1] }}</code>
                <CopyButton :text="v.tme.split('secret=')[1]" />
              </div>
            </div>
          </div>
          <div>
            <div class="text-[11.5px] tg-text-3">服务器 / 端口</div>
            <div class="text-[13px] font-medium mt-0.5">{{ current.links.ip }} : {{ current.port }}</div>
          </div>
          <div>
            <div class="text-[11.5px] tg-text-3">密钥</div>
            <div class="flex items-center gap-1.5 mt-1">
              <code class="tg-code flex-1 truncate border tg-divider rounded px-2 py-1 bg-[var(--tg-surface-2)]">{{ current.links.secret }}</code>
              <CopyButton :text="current.links.secret" label="复制" />
            </div>
          </div>
        </div>
      </div>
    </NModal>

    <!-- 新建 -->
    <NModal v-model:show="showCreate" preset="card" title="新建代理" style="max-width: 480px" :bordered="false" size="small">
      <NForm label-placement="top">
        <NFormItem label="所属用户">
          <NSelect
            v-model:value="createForm.user_id" filterable
            :options="users.map((u) => ({ label: `${u.username}${u.role === 'admin' ? '（管理员）' : ''}`, value: u.id }))"
            placeholder="选择用户"
          />
        </NFormItem>
        <div class="grid grid-cols-2 gap-3">
          <NFormItem label="节点">
            <NSelect v-model:value="createForm.node_id" :options="nodes.map((n) => ({ label: n.name, value: n.id }))" />
          </NFormItem>
          <NFormItem label="端口（留空自动分配）">
            <NInputNumber v-model:value="createForm.port" :min="1024" :max="65535" class="!w-full" placeholder="自动" />
          </NFormItem>
        </div>
        <NFormItem label="名称">
          <NInput v-model:value="createForm.name" placeholder="选填" />
        </NFormItem>
        <div class="grid grid-cols-2 gap-3">
          <NFormItem label="流量额度（MB）">
            <NInputNumber v-model:value="createForm.quota_mb" :min="0" :step="1024" class="!w-full" />
          </NFormItem>
          <NFormItem label="有效期（天，留空永久）">
            <NInputNumber v-model:value="createForm.expires_days" :min="1" class="!w-full" placeholder="永久" />
          </NFormItem>
        </div>
      </NForm>
      <template #footer>
        <div class="flex justify-end gap-2">
          <NButton size="small" @click="showCreate = false">取消</NButton>
          <NButton size="small" type="primary" :loading="creating" @click="createAccount">创建并启动</NButton>
        </div>
      </template>
    </NModal>

    <!-- 编辑 -->
    <NModal v-model:show="showEdit" preset="card" :title="`编辑代理 · ${editing?.name || ''}`" style="max-width: 480px" :bordered="false" size="small">
      <NForm label-placement="top">
        <div class="grid grid-cols-2 gap-3">
          <NFormItem label="名称">
            <NInput v-model:value="editForm.name" />
          </NFormItem>
          <NFormItem label="端口">
            <NInputNumber v-model:value="editForm.port" :min="1024" :max="65535" class="!w-full" />
          </NFormItem>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <NFormItem label="流量额度（MB，0 不限制）">
            <NInputNumber v-model:value="editForm.quota_mb" :min="0" :step="1024" class="!w-full" />
          </NFormItem>
          <NFormItem label="状态">
            <NSelect v-model:value="editForm.status" :options="[{ label: '启用', value: 'active' }, { label: '停用', value: 'disabled' }]" />
          </NFormItem>
        </div>
        <NFormItem label="到期时间（留空永久）">
          <NInput v-model:value="editForm.expires_at" placeholder="YYYY-MM-DD HH:mm:ss" />
        </NFormItem>
        <NFormItem label="备注">
          <NInput v-model:value="editForm.remark" />
        </NFormItem>
        <div class="flex items-center gap-2">
          <NSwitch v-model:value="editForm.reset_usage" size="small" />
          <span class="text-[13px]">同时清零已用流量与历史统计</span>
        </div>
      </NForm>
      <template #footer>
        <div class="flex justify-end gap-2">
          <NButton size="small" @click="showEdit = false">取消</NButton>
          <NButton size="small" type="primary" :loading="saving" @click="saveEdit">保存</NButton>
        </div>
      </template>
    </NModal>
  </div>
</template>
