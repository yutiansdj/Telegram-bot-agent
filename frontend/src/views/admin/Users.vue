<script setup>
import { ref, onMounted, h, computed } from 'vue';
import {
  NButton, NIcon, NInput, NDataTable, NTag, NModal, NForm, NFormItem, NInputNumber,
  NSelect, NPopconfirm, NSwitch, NTooltip, NSpace,
} from 'naive-ui';
import { Icon } from '@iconify/vue';
import PageHeader from '@/components/common/PageHeader.vue';
import { api } from '@/api';
import { fmtBytes, fmtDate, fmtMB, fmtRelative } from '@/utils/format';

const loading = ref(true);
const list = ref([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const q = ref('');

const showEdit = ref(false);
const editing = ref(null);
const saving = ref(false);
const form = ref({ quota_mb: 0, status: 'active', role: 'user', email: '', note: '', password: '' });

const showCreate = ref(false);
const creating = ref(false);
const createForm = ref({ username: '', password: '', quota_mb: 10240, email: '', note: '' });

const showQuota = ref(false);
const quotaUser = ref(null);
const quotaMb = ref(10240);

async function load() {
  loading.value = true;
  try {
    const res = await api.adminUsers({ page: page.value, pageSize: pageSize.value, q: q.value });
    list.value = res.data.list;
    total.value = res.data.total;
  } catch (e) { window.$message.error(e.message); }
  finally { loading.value = false; }
}

function search() { page.value = 1; load(); }

function openEdit(row) {
  editing.value = row;
  form.value = {
    quota_mb: row.quota_mb, status: row.status, role: row.role,
    email: row.email || '', note: row.note || '', password: '',
  };
  showEdit.value = true;
}

async function saveEdit() {
  saving.value = true;
  try {
    const payload = { ...form.value };
    if (!payload.password) delete payload.password;
    await api.adminUpdateUser(editing.value.id, payload);
    window.$message.success('已保存');
    showEdit.value = false;
    await load();
  } catch (e) { window.$message.error(e.message); }
  finally { saving.value = false; }
}

async function toggleStatus(row) {
  try {
    await api.adminUpdateUser(row.id, { status: row.status === 'active' ? 'disabled' : 'active' });
    window.$message.success('状态已更新');
    await load();
  } catch (e) { window.$message.error(e.message); }
}

async function remove(row) {
  try {
    await api.adminDeleteUser(row.id);
    window.$message.success('已删除');
    await load();
  } catch (e) { window.$message.error(e.message); }
}

function openQuota(row) {
  quotaUser.value = row;
  quotaMb.value = 10240;
  showQuota.value = true;
}

async function grantQuota() {
  try {
    const res = await api.adminGrantQuota(quotaUser.value.id, quotaMb.value);
    window.$message.success(res.message);
    showQuota.value = false;
    await load();
  } catch (e) { window.$message.error(e.message); }
}

async function createUser() {
  creating.value = true;
  try {
    await api.adminCreateUser(createForm.value);
    window.$message.success('用户已创建');
    showCreate.value = false;
    createForm.value = { username: '', password: '', quota_mb: 10240, email: '', note: '' };
    await load();
  } catch (e) { window.$message.error(e.message); }
  finally { creating.value = false; }
}

const columns = [
  { title: 'ID', key: 'id', width: 64 },
  {
    title: '用户', key: 'username', minWidth: 150,
    render: (r) => h('div', { class: 'flex items-center gap-2' }, [
      h('div', { class: 'u-avatar' }, r.username.slice(0, 1).toUpperCase()),
      h('div', null, [
        h('div', { style: 'font-weight:500;font-size:13px;display:flex;align-items:center;gap:4px' }, [
          r.username,
          r.role === 'admin' ? h(NTag, { size: 'tiny', type: 'primary', bordered: false }, { default: () => '管理员' }) : null,
        ]),
        h('div', { style: 'font-size:11.5px;color:var(--tg-text-3)' }, r.email || '未绑定邮箱'),
      ]),
    ]),
  },
  {
    title: '状态', key: 'status', width: 84,
    render: (r) => h(NTag, { size: 'small', type: r.status === 'active' ? 'success' : 'error', bordered: false },
      { default: () => (r.status === 'active' ? '正常' : '禁用') }),
  },
  { title: '代理数', key: 'account_count', width: 80, align: 'center' },
  {
    title: '总额度', key: 'quota_mb', width: 100, align: 'right',
    render: (r) => h('span', { style: 'font-variant-numeric: tabular-nums' }, fmtMB(r.quota_mb)),
  },
  {
    title: '已用流量', key: 'used_bytes', width: 100, align: 'right',
    render: (r) => h('span', { style: 'font-variant-numeric: tabular-nums;color:var(--tg-text-2)' }, fmtBytes(r.used_bytes)),
  },
  { title: '最近登录', key: 'last_login_at', width: 110, render: (r) => fmtRelative(r.last_login_at) },
  {
    title: '操作', key: 'actions', width: 220, fixed: 'right',
    render: (r) => h(NSpace, { size: 4, wrap: false }, {
      default: () => [
        h(NButton, { size: 'tiny', secondary: true, type: 'primary', onClick: () => openQuota(r) }, { default: () => '分配流量' }),
        h(NButton, { size: 'tiny', secondary: true, onClick: () => openEdit(r) }, { default: () => '编辑' }),
        h(NButton, { size: 'tiny', secondary: true, onClick: () => toggleStatus(r) }, { default: () => (r.status === 'active' ? '禁用' : '启用') }),
        h(NPopconfirm, { onPositiveClick: () => remove(r) }, {
          trigger: () => h(NButton, { size: 'tiny', quaternary: true, type: 'error' }, { default: () => '删除' }),
          default: () => `确定删除用户「${r.username}」及其全部代理？`,
        }),
      ],
    }),
  },
];

onMounted(load);
</script>

<template>
  <div>
    <PageHeader title="用户管理" subtitle="管理平台注册用户、额度分配与账号状态" icon="tabler:users">
      <template #actions>
        <NInput v-model:value="q" placeholder="搜索用户名 / 邮箱" clearable size="small" style="width: 200px" @keyup.enter="search" @clear="search">
          <template #prefix><NIcon size="14"><Icon icon="tabler:search" /></NIcon></template>
        </NInput>
        <NButton size="small" quaternary @click="load">
          <template #icon><NIcon size="15"><Icon icon="tabler:refresh" /></NIcon></template>
        </NButton>
        <NButton type="primary" size="small" @click="showCreate = true">
          <template #icon><NIcon size="15"><Icon icon="tabler:user-plus" /></NIcon></template>
          新建用户
        </NButton>
      </template>
    </PageHeader>

    <div class="tg-card">
      <NDataTable
        :columns="columns"
        :data="list"
        :loading="loading"
        :bordered="false"
        size="small"
        :row-key="(r) => r.id"
        :scroll-x="960"
        :pagination="{
          page, pageSize, itemCount: total, pageSizes: [10, 20, 50],
          showSizePicker: true,
          prefix: ({ itemCount }) => `共 ${itemCount} 位用户`,
          onChange: (p) => { page = p; load(); },
          onUpdatePageSize: (s) => { pageSize = s; page = 1; load(); },
        }"
      />
    </div>

    <!-- 编辑用户 -->
    <NModal v-model:show="showEdit" preset="card" title="编辑用户" style="max-width: 460px" :bordered="false" size="small">
      <NForm label-placement="top">
        <NFormItem label="用户名">
          <NInput :value="editing?.username" disabled />
        </NFormItem>
        <NFormItem label="邮箱">
          <NInput v-model:value="form.email" placeholder="选填" />
        </NFormItem>
        <NFormItem label="总流量额度（MB，0 表示不限制）">
          <NInputNumber v-model:value="form.quota_mb" :min="0" :step="1024" class="!w-full" />
        </NFormItem>
        <div class="grid grid-cols-2 gap-3">
          <NFormItem label="账号状态">
            <NSelect v-model:value="form.status" :options="[{ label: '正常', value: 'active' }, { label: '禁用', value: 'disabled' }]" />
          </NFormItem>
          <NFormItem label="角色">
            <NSelect v-model:value="form.role" :options="[{ label: '普通用户', value: 'user' }, { label: '管理员', value: 'admin' }]" />
          </NFormItem>
        </div>
        <NFormItem label="重置密码（留空则不修改）">
          <NInput v-model:value="form.password" type="password" show-password-on="click" placeholder="至少 6 位" />
        </NFormItem>
        <NFormItem label="备注">
          <NInput v-model:value="form.note" placeholder="内部备注" />
        </NFormItem>
      </NForm>
      <template #footer>
        <div class="flex justify-end gap-2">
          <NButton size="small" @click="showEdit = false">取消</NButton>
          <NButton size="small" type="primary" :loading="saving" @click="saveEdit">保存</NButton>
        </div>
      </template>
    </NModal>

    <!-- 新建用户 -->
    <NModal v-model:show="showCreate" preset="card" title="新建用户" style="max-width: 460px" :bordered="false" size="small">
      <NForm label-placement="top">
        <NFormItem label="用户名">
          <NInput v-model:value="createForm.username" placeholder="3-32 位字母、数字、下划线" />
        </NFormItem>
        <NFormItem label="初始密码">
          <NInput v-model:value="createForm.password" type="password" show-password-on="click" placeholder="至少 6 位" />
        </NFormItem>
        <NFormItem label="初始额度（MB）">
          <NInputNumber v-model:value="createForm.quota_mb" :min="0" :step="1024" class="!w-full" />
        </NFormItem>
        <NFormItem label="邮箱">
          <NInput v-model:value="createForm.email" placeholder="选填" />
        </NFormItem>
      </NForm>
      <template #footer>
        <div class="flex justify-end gap-2">
          <NButton size="small" @click="showCreate = false">取消</NButton>
          <NButton size="small" type="primary" :loading="creating" @click="createUser">创建</NButton>
        </div>
      </template>
    </NModal>

    <!-- 分配流量 -->
    <NModal v-model:show="showQuota" preset="card" :title="`为用户「${quotaUser?.username || ''}」分配流量`" style="max-width: 400px" :bordered="false" size="small">
      <div class="text-xs tg-text-3 mb-3">
        当前总额度 {{ fmtMB(quotaUser?.quota_mb || 0) }}，已用 {{ fmtBytes(quotaUser?.used_bytes || 0) }}。
        填写正数增加额度，负数可扣减。
      </div>
      <NInputNumber v-model:value="quotaMb" :step="1024" class="!w-full" placeholder="分配流量（MB）" />
      <div class="flex flex-wrap gap-1.5 mt-2">
        <NTag v-for="p in [5120, 10240, 20480, 51200]" :key="p" size="small" :bordered="false" class="cursor-pointer" @click="quotaMb = p">
          {{ p / 1024 }} GB
        </NTag>
      </div>
      <template #footer>
        <div class="flex justify-end gap-2">
          <NButton size="small" @click="showQuota = false">取消</NButton>
          <NButton size="small" type="primary" @click="grantQuota">
            <template #icon><NIcon size="14"><Icon icon="tabler:database-plus" /></NIcon></template>
            确认分配
          </NButton>
        </div>
      </template>
    </NModal>
  </div>
</template>

<style>
.u-avatar {
  width: 28px; height: 28px; border-radius: 8px;
  display: grid; place-items: center;
  background: var(--tg-brand-soft); color: var(--tg-brand);
  font-size: 12px; font-weight: 600; flex-shrink: 0;
}
</style>
