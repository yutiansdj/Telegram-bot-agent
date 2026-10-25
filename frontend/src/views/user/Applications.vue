<script setup>
import { ref, onMounted, h } from 'vue';
import { NButton, NIcon, NDataTable, NTag, NEmpty } from 'naive-ui';
import { Icon } from '@iconify/vue';
import { useRouter } from 'vue-router';
import PageHeader from '@/components/common/PageHeader.vue';
import { api } from '@/api';
import { fmtDate, fmtMB, statusMeta } from '@/utils/format';

const router = useRouter();
const loading = ref(true);
const list = ref([]);
const total = ref(0);
const page = ref(1);
const pageSize = 10;

const statusMetaMap = { pending: { t: 'warning', d: '待审核' }, approved: { t: 'success', d: '已通过' }, rejected: { t: 'error', d: '已拒绝' } };
const pill = (s) => {
  const m = statusMetaMap[s] || { t: 'default', d: s };
  return h(NTag, { size: 'small', type: m.t, bordered: false }, { default: () => m.d });
};

const columns = [
  { title: 'ID', key: 'id', width: 64 },
  { title: '申请流量', key: 'amount_mb', width: 100, render: (r) => fmtMB(r.amount_mb) },
  { title: '发放对象', key: 'target', ellipsis: { tooltip: true }, render: (r) => (r.account_id ? `代理 #${r.account_id}${r.node_name ? ' · ' + r.node_name : ''}` : '账户总额度') },
  { title: '理由', key: 'reason', ellipsis: { tooltip: true }, render: (r) => r.reason || h('span', { class: 'tg-text-3' }, '—') },
  { title: '状态', key: 'status', width: 92, render: (r) => pill(r.status) },
  { title: '管理备注', key: 'admin_note', ellipsis: { tooltip: true }, render: (r) => r.admin_note || h('span', { class: 'tg-text-3' }, '—') },
  { title: '提交时间', key: 'created_at', width: 140, render: (r) => fmtDate(r.created_at) },
  { title: '处理时间', key: 'reviewed_at', width: 140, render: (r) => (r.reviewed_at ? fmtDate(r.reviewed_at) : h('span', { class: 'tg-text-3' }, '—')) },
];

async function load() {
  loading.value = true;
  try {
    const res = await api.myTickets({ page: page.value, pageSize });
    list.value = res.data.list;
    total.value = res.data.total;
  } catch (e) { window.$message.error(e.message); }
  finally { loading.value = false; }
}

function onPage(p) { page.value = p; load(); }

onMounted(load);
</script>

<template>
  <div>
    <PageHeader title="申请记录" subtitle="查看你提交的流量申请及审核结果" icon="tabler:clipboard-list">
      <template #actions>
        <NButton type="primary" size="small" @click="router.push('/tickets')">
          <template #icon><NIcon size="15"><Icon icon="tabler:plus" /></NIcon></template>
          新申请
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
        :scroll-x="900"
        :pagination="{
          page: page, pageSize, itemCount: total, showSizePicker: false,
          prefix: ({ itemCount }) => `共 ${itemCount} 条`,
          onChange: onPage,
        }"
      />
    </div>
  </div>
</template>
