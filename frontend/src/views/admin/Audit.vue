<script setup>
import { ref, onMounted, h } from 'vue';
import { NButton, NIcon, NInput, NDataTable, NTag, NTabs, NTabPane, NEmpty } from 'naive-ui';
import { Icon } from '@iconify/vue';
import PageHeader from '@/components/common/PageHeader.vue';
import { api } from '@/api';
import { fmtDate, fmtRelative } from '@/utils/format';

const loading = ref(true);
const tab = ref('audit');
const audit = ref({ list: [], total: 0 });
const logins = ref({ list: [], total: 0 });
const page = ref(1);
const pageSize = 20;
const q = ref('');

async function loadAudit() {
  loading.value = true;
  try {
    const res = await api.adminAudit({ page: page.value, pageSize, q: q.value });
    audit.value = res.data;
  } catch (e) { window.$message.error(e.message); }
  finally { loading.value = false; }
}

async function loadLogins() {
  loading.value = true;
  try {
    const res = await api.adminLoginLogs({ page: page.value, pageSize });
    logins.value = res.data;
  } catch (e) { window.$message.error(e.message); }
  finally { loading.value = false; }
}

function load() {
  page.value = 1;
  if (tab.value === 'audit') loadAudit(); else loadLogins();
}

function onTab(v) { tab.value = v; page.value = 1; v === 'audit' ? loadAudit() : loadLogins(); }

const auditColumns = [
  { title: '时间', key: 'created_at', width: 150, render: (r) => fmtDate(r.created_at) },
  { title: '操作人', key: 'username', width: 110, render: (r) => r.username ? h('span', { style: 'font-weight:500' }, r.username) : h(NTag, { size: 'small', bordered: false }, { default: () => 'system' }) },
  { title: '动作', key: 'action', width: 130, render: (r) => h(NTag, { size: 'small', type: /删除|拒绝|停用/.test(r.action) ? 'error' : /创建|通过|分配/.test(r.action) ? 'success' : 'default', bordered: false }, { default: () => r.action }) },
  { title: '对象', key: 'target', width: 130, render: (r) => r.target || '—' },
  { title: '详情', key: 'detail', ellipsis: { tooltip: true }, render: (r) => r.detail || '—' },
  { title: 'IP', key: 'ip', width: 130, render: (r) => h('span', { class: 'font-mono', style: 'font-size:12px;color:var(--tg-text-2)' }, r.ip || '—') },
];

const loginColumns = [
  { title: '时间', key: 'created_at', width: 150, render: (r) => fmtDate(r.created_at) },
  { title: '用户名', key: 'username', width: 130 },
  {
    title: '结果', key: 'success', width: 90,
    render: (r) => h(NTag, { size: 'small', type: r.success ? 'success' : 'error', bordered: false },
      { default: () => (r.success ? '成功' : '失败') }),
  },
  { title: '说明', key: 'message', width: 120 },
  { title: 'IP', key: 'ip', width: 140, render: (r) => h('span', { class: 'font-mono', style: 'font-size:12px' }, r.ip || '—') },
  { title: '客户端', key: 'ua', ellipsis: { tooltip: true }, render: (r) => h('span', { style: 'font-size:12px;color:var(--tg-text-3)' }, r.ua || '—') },
];

onMounted(loadAudit);
</script>

<template>
  <div>
    <PageHeader title="审计日志" subtitle="记录所有关键操作与登录行为，便于安全追溯" icon="tabler:shield-check">
      <template #actions>
        <NInput v-if="tab === 'audit'" v-model:value="q" placeholder="搜索动作/用户/详情" clearable size="small" style="width: 200px" @keyup.enter="load" @clear="load" />
        <NButton size="small" quaternary @click="load">
          <template #icon><NIcon size="15"><Icon icon="tabler:refresh" /></NIcon></template>
          刷新
        </NButton>
      </template>
    </PageHeader>

    <div class="tg-card">
      <NTabs :value="tab" type="line" size="small" class="px-4 pt-2" @update:value="onTab">
        <NTabPane name="audit" :tab="`操作日志${audit.total ? ' (' + audit.total + ')' : ''}`">
          <div class="pb-3 -mx-4">
            <NDataTable
              :columns="auditColumns" :data="audit.list" :loading="loading" :bordered="false" size="small"
              :row-key="(r) => r.id" :scroll-x="900"
              :pagination="{ page, pageSize, itemCount: audit.total, showSizePicker: false, prefix: ({ itemCount }) => `共 ${itemCount} 条`, onChange: (p) => { page = p; loadAudit(); } }"
            />
          </div>
        </NTabPane>
        <NTabPane name="login" :tab="`登录记录${logins.total ? ' (' + logins.total + ')' : ''}`">
          <div class="pb-3 -mx-4">
            <NDataTable
              :columns="loginColumns" :data="logins.list" :loading="loading" :bordered="false" size="small"
              :row-key="(r) => r.id" :scroll-x="900"
              :pagination="{ page, pageSize, itemCount: logins.total, showSizePicker: false, prefix: ({ itemCount }) => `共 ${itemCount} 条`, onChange: (p) => { page = p; loadLogins(); } }"
            />
          </div>
        </NTabPane>
      </NTabs>
    </div>
  </div>
</template>
