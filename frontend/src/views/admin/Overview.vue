<script setup>
import { ref, onMounted, h, computed } from 'vue';
import {
  NButton, NIcon, NTag, NDataTable, NGrid, NGi, NTooltip, NSkeleton,
} from 'naive-ui';
import { Icon } from '@iconify/vue';
import { useRouter } from 'vue-router';
import PageHeader from '@/components/common/PageHeader.vue';
import StatCard from '@/components/common/StatCard.vue';
import Sparkline from '@/components/common/Sparkline.vue';
import { api } from '@/api';
import { fmtBytes, fmtUptime, fmtRelative } from '@/utils/format';

const router = useRouter();
const loading = ref(true);
const d = ref(null);
const now = ref(Date.now());
setInterval(() => { now.value = Date.now(); }, 30000);

async function load(silent = false) {
  if (!silent) loading.value = true;
  try {
    const res = await api.adminDashboard();
    d.value = res.data;
  } catch (e) { window.$message.error(e.message); }
  finally { loading.value = false; }
}

const topColumns = [
  { title: '用户', key: 'username', ellipsis: { tooltip: true } },
  {
    title: '流量用量', key: 'used', width: 120, align: 'right',
    render: (r) => h('span', { style: 'font-variant-numeric: tabular-nums' }, fmtBytes(r.used)),
  },
];
const auditColumns = [
  { title: '操作人', key: 'username', width: 90, render: (r) => r.username || 'system' },
  { title: '动作', key: 'action', ellipsis: { tooltip: true } },
  { title: '详情', key: 'detail', ellipsis: { tooltip: true }, render: (r) => r.detail || '-' },
  { title: '时间', key: 'created_at', width: 110, render: (r) => fmtRelative(r.created_at) },
];

const trafficToday = computed(() => d.value?.traffic.today || 0);

onMounted(load);
</script>

<template>
  <div>
    <PageHeader title="运维总览" subtitle="平台全局运行状态、用户与代理规模概览" icon="tabler:gauge">
      <template #actions>
        <NButton size="small" quaternary @click="load(true)">
          <template #icon><NIcon size="15"><Icon icon="tabler:refresh" /></NIcon></template>
          刷新
        </NButton>
        <NButton type="primary" size="small" @click="router.push('/admin/accounts')">
          <template #icon><NIcon size="15"><Icon icon="tabler:affiliate" /></NIcon></template>
          管理代理
        </NButton>
      </template>
    </PageHeader>

    <NGrid :x-gap="12" :y-gap="12" cols="1 s:2 m:4" responsive="screen">
      <NGi>
        <StatCard
          label="注册用户" :value="d ? d.users.total : ''" icon="tabler:users" tone="brand"
          :hint="d ? `近 7 天新增 ${d.users.new7} · 正常 ${d.users.active}` : ''" :loading="loading"
        />
      </NGi>
      <NGi>
        <StatCard
          label="代理账号" :value="d ? d.accounts.running + ' / ' + d.accounts.total : ''" icon="tabler:affiliate" tone="green"
          :hint="d ? '运行中 ' + d.accounts.running + ' · 总计 ' + d.accounts.total : ''" :loading="loading"
        />
      </NGi>
      <NGi>
        <StatCard
          label="今日流量" :value="d ? fmtBytes(trafficToday) : ''" icon="tabler:arrows-exchange" tone="violet"
          :hint="d ? `累计消耗 ${fmtBytes(d.traffic.total)}` : ''" :loading="loading"
        />
      </NGi>
      <NGi>
        <StatCard
          label="待审核申请" :value="d ? d.pendingTickets : ''" icon="tabler:ticket" tone="amber"
          :hint="d?.pendingTickets ? '需要尽快处理' : '暂无待处理'" :loading="loading"
        />
      </NGi>
    </NGrid>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-3 mt-3">
      <div class="tg-card p-4 lg:col-span-2">
        <div class="flex items-center justify-between">
          <div class="tg-section-title">全站 14 天流量趋势</div>
          <NTag size="small" :type="d?.core?.telegram ? 'success' : 'error'" :bordered="false">
            <NIcon size="12" class="mr-1 align-[-1px]"><Icon icon="tabler:point-filled" /></NIcon>
            Telegram DC {{ d?.core?.telegram ? '可达' : '不可达' }}
          </NTag>
        </div>
        <div class="h-[200px] mt-3">
          <Sparkline v-if="d" :data="d.series" :height="200" :loading="loading" />
          <NSkeleton v-else height="200px" :sharp="false" />
        </div>
      </div>

      <div class="tg-card p-4">
        <div class="tg-section-title mb-3">节点状态</div>
        <NSkeleton v-if="loading" height="120px" :sharp="false" />
        <div v-else class="node-list">
          <div v-for="n in d?.nodes" :key="n.id" class="node-row">
            <div class="min-w-0">
              <div class="text-[13px] font-medium truncate">{{ n.name }}</div>
              <div class="text-xs tg-text-3 truncate">{{ n.ip }}</div>
            </div>
            <NTag size="small" :type="n.status === 'online' ? 'success' : 'error'" :bordered="false">
              {{ n.status === 'online' ? '在线' : '离线' }}
            </NTag>
          </div>
          <div v-if="!d?.nodes?.length" class="text-xs tg-text-3 py-4 text-center">暂无节点</div>
        </div>
        <div class="mt-3 pt-3 border-t tg-divider flex items-center justify-between text-xs">
          <span class="tg-text-3">mtg 内核</span>
          <span class="font-mono">v{{ d?.core.mtgVersion }}</span>
        </div>
        <div class="flex items-center justify-between text-xs mt-1.5">
          <span class="tg-text-3">DC 延迟</span>
          <span class="font-mono">{{ d?.core.latency ?? '-' }} ms</span>
        </div>
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-3">
      <div class="tg-card">
        <div class="flex items-center justify-between px-4 py-3 border-b tg-divider">
          <div class="tg-section-title">流量 Top 用户</div>
          <NButton text type="primary" size="small" @click="router.push('/admin/users')">管理用户</NButton>
        </div>
        <NDataTable :columns="topColumns" :data="d?.topUsers || []" :bordered="false" size="small" :loading="loading" />
      </div>

      <div class="tg-card">
        <div class="flex items-center justify-between px-4 py-3 border-b tg-divider">
          <div class="tg-section-title">最近操作</div>
          <NButton text type="primary" size="small" @click="router.push('/admin/audit')">全部日志</NButton>
        </div>
        <NDataTable :columns="auditColumns" :data="d?.recentAudit || []" :bordered="false" size="small" :loading="loading" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.node-list { display: flex; flex-direction: column; }
.node-row {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 8px 0; border-bottom: 1px dashed var(--tg-border);
}
.node-row:last-child { border-bottom: none; }
</style>
