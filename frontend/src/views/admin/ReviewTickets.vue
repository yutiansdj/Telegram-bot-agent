<script setup>
import { ref, onMounted, h, computed } from 'vue';
import {
  NButton, NIcon, NDataTable, NTag, NModal, NInput, NInputNumber, NSpace, NRadioGroup, NRadioButton,
  NAlert, NTabs, NTabPane,
} from 'naive-ui';
import { Icon } from '@iconify/vue';
import PageHeader from '@/components/common/PageHeader.vue';
import { api } from '@/api';
import { fmtDate, fmtMB } from '@/utils/format';

const loading = ref(true);
const list = ref([]);
const total = ref(0);
const pending = ref(0);
const page = ref(1);
const pageSize = ref(20);
const status = ref('pending');
const checkedKeys = ref([]);

const showReview = ref(false);
const current = ref(null);
const reviewForm = ref({ action: 'approve', amount_mb: 0, admin_note: '' });
const submitting = ref(false);

const statusMap = { pending: { t: 'warning', d: '待审核' }, approved: { t: 'success', d: '已通过' }, rejected: { t: 'error', d: '已拒绝' } };

async function load() {
  loading.value = true;
  try {
    const res = await api.adminTickets({ page: page.value, pageSize: pageSize.value, status: status.value });
    list.value = res.data.list;
    total.value = res.data.total;
    pending.value = res.data.pending;
    checkedKeys.value = [];
  } catch (e) { window.$message.error(e.message); }
  finally { loading.value = false; }
}

function setStatus(v) { status.value = v; page.value = 1; load(); }

function openReview(row, action = 'approve') {
  current.value = row;
  reviewForm.value = { action, amount_mb: row.amount_mb, admin_note: '' };
  showReview.value = true;
}

async function submitReview() {
  submitting.value = true;
  try {
    const res = await api.adminReviewTicket(current.value.id, reviewForm.value);
    window.$message.success(res.message);
    showReview.value = false;
    await load();
  } catch (e) { window.$message.error(e.message); }
  finally { submitting.value = false; }
}

async function batch(action) {
  if (!checkedKeys.value.length) { window.$message.warning('请先选择申请'); return; }
  window.$dialog.warning({
    title: action === 'approve' ? '批量通过' : '批量拒绝',
    content: `确定要${action === 'approve' ? '通过' : '拒绝'}选中的 ${checkedKeys.value.length} 条申请吗？`,
    positiveText: '确定',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        const res = await api.adminBatchTicket({ ids: checkedKeys.value, action });
        window.$message.success(res.message);
        await load();
      } catch (e) { window.$message.error(e.message); }
    },
  });
}

const columns = computed(() => [
  { type: 'selection', disabled: (r) => r.status !== 'pending' },
  { title: 'ID', key: 'id', width: 64 },
  { title: '用户', key: 'username', width: 110, render: (r) => h('span', { style: 'font-weight:500' }, r.username) },
  { title: '申请流量', key: 'amount_mb', width: 100, render: (r) => fmtMB(r.amount_mb) },
  {
    title: '发放对象', key: 'target', width: 130,
    render: (r) => (r.account_id ? `代理 #${r.account_id}` : '账户总额度'),
  },
  { title: '理由', key: 'reason', ellipsis: { tooltip: true }, render: (r) => r.reason || h('span', { class: 'tg-text-3' }, '—') },
  { title: '状态', key: 'status', width: 88, render: (r) => {
    const m = statusMap[r.status] || { t: 'default', d: r.status };
    return h(NTag, { size: 'small', type: m.t, bordered: false }, { default: () => m.d });
  } },
  { title: '提交时间', key: 'created_at', width: 140, render: (r) => fmtDate(r.created_at) },
  { title: '备注', key: 'admin_note', ellipsis: { tooltip: true }, render: (r) => r.admin_note || h('span', { class: 'tg-text-3' }, '—') },
  {
    title: '操作', key: 'actions', width: 150, fixed: 'right',
    render: (r) => (r.status !== 'pending'
      ? h('span', { class: 'tg-text-3', style: 'font-size:12px' }, fmtDate(r.reviewed_at))
      : h(NSpace, { size: 4, wrap: false }, {
        default: () => [
          h(NButton, { size: 'tiny', type: 'primary', secondary: true, onClick: () => openReview(r, 'approve') }, { default: () => '通过' }),
          h(NButton, { size: 'tiny', type: 'error', secondary: true, onClick: () => openReview(r, 'reject') }, { default: () => '拒绝' }),
        ],
      })),
  },
]);

onMounted(load);
</script>

<template>
  <div>
    <PageHeader title="申请审核" subtitle="审核用户提交的流量申请，通过后额度自动发放" icon="tabler:ticket">
      <template #actions>
        <NButton size="small" quaternary @click="load">
          <template #icon><NIcon size="15"><Icon icon="tabler:refresh" /></NIcon></template>
          刷新
        </NButton>
        <NButton v-if="status === 'pending'" size="small" type="primary" secondary :disabled="!checkedKeys.length" @click="batch('approve')">
          批量通过
        </NButton>
        <NButton v-if="status === 'pending'" size="small" type="error" secondary :disabled="!checkedKeys.length" @click="batch('reject')">
          批量拒绝
        </NButton>
      </template>
    </PageHeader>

    <NAlert v-if="pending > 0" type="warning" :bordered="false" class="mb-3" :show-icon="true">
      当前有 <b>{{ pending }}</b> 条流量申请等待审核。
    </NAlert>

    <div class="mb-3">
      <NRadioGroup :value="status" size="small" @update:value="setStatus">
        <NRadioButton value="pending">待审核{{ pending ? ' (' + pending + ')' : '' }}</NRadioButton>
        <NRadioButton value="approved">已通过</NRadioButton>
        <NRadioButton value="rejected">已拒绝</NRadioButton>
      </NRadioGroup>
    </div>

    <div class="tg-card">
      <NDataTable
        v-model:checked-row-keys="checkedKeys"
        :columns="columns" :data="list" :loading="loading" :bordered="false" size="small"
        :row-key="(r) => r.id" :scroll-x="1100"
        :pagination="{
          page, pageSize, itemCount: total, showSizePicker: false,
          prefix: ({ itemCount }) => `共 ${itemCount} 条`,
          onChange: (p) => { page = p; load(); },
        }"
      />
    </div>

    <NModal v-model:show="showReview" preset="card" :title="reviewForm.action === 'approve' ? '通过申请' : '拒绝申请'" style="max-width: 420px" :bordered="false" size="small">
      <div v-if="current" class="text-[13px] tg-text-2 mb-3 space-y-1">
        <div>用户：<b class="tg-text-1">{{ current.username }}</b></div>
        <div>申请流量：<b class="tg-text-1">{{ fmtMB(current.amount_mb) }}</b></div>
        <div>理由：{{ current.reason || '—' }}</div>
      </div>
      <NInputNumber
        v-if="reviewForm.action === 'approve'"
        v-model:value="reviewForm.amount_mb"
        :min="1" :step="1024" class="!w-full mb-2"
      >
        <template #prefix>实际发放（MB）</template>
      </NInputNumber>
      <NInput
        v-model:value="reviewForm.admin_note" type="textarea" :autosize="{ minRows: 2 }"
        :placeholder="reviewForm.action === 'approve' ? '备注（选填）' : '拒绝原因（选填，用户可见）'"
      />
      <template #footer>
        <div class="flex justify-end gap-2">
          <NButton size="small" @click="showReview = false">取消</NButton>
          <NButton size="small" :type="reviewForm.action === 'approve' ? 'primary' : 'error'" :loading="submitting" @click="submitReview">
            确认{{ reviewForm.action === 'approve' ? '通过' : '拒绝' }}
          </NButton>
        </div>
      </template>
    </NModal>
  </div>
</template>
