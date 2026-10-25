<script setup>
import { ref, computed, onMounted, h } from 'vue';
import {
  NButton, NIcon, NTag, NProgress, NSkeleton, NEmpty, NAlert, NDataTable, NGrid, NGi,
} from 'naive-ui';
import { Icon } from '@iconify/vue';
import { useRouter } from 'vue-router';
import PageHeader from '@/components/common/PageHeader.vue';
import StatCard from '@/components/common/StatCard.vue';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { fmtBytes, fmtMB, fmtRelative, statusMeta } from '@/utils/format';
import Sparkline from '@/components/common/Sparkline.vue';

const auth = useAuthStore();
const router = useRouter();
const loading = ref(true);
const data = ref(null);

const usedMB = computed(() => (data.value ? data.value.used_bytes / 1048576 : 0));
const usagePct = computed(() => (data.value?.quota_mb ? Math.min(100, (usedMB.value / data.value.quota_mb) * 100) : 0));
const remainPct = computed(() => (data.value?.quota_mb ? Math.min(100, (data.value.remaining_mb / data.value.quota_mb) * 100) : 0));

const series = computed(() => (data.value?.series || []).map((s) => s.total));

const recentColumns = [
  { title: '名称', key: 'name', ellipsis: { tooltip: true } },
  {
    title: '状态', key: 'state', width: 92,
    render: (r) => h(NTag, { size: 'small', type: statusMeta[r.state]?.type || 'default', bordered: false },
      { default: () => statusMeta[r.state]?.text || r.state }),
  },
  {
    title: '已用', key: 'used_bytes', width: 100, align: 'right',
    render: (r) => h('span', { style: 'font-variant-numeric: tabular-nums' }, fmtBytes(r.used_bytes)),
  },
  {
    title: '额度', key: 'quota_mb', width: 90, align: 'right',
    render: (r) => h('span', { class: 'tg-text-2' }, fmtMB(r.quota_mb)),
  },
];

async function load() {
  loading.value = true;
  try {
    const res = await api.dashboard();
    data.value = res.data;
  } catch (e) {
    window.$message.error(e.message);
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div>
    <PageHeader
      :title="`你好，${auth.displayName}`"
      subtitle="这里是你所有 Telegram 代理的实时概况"
      icon="tabler:layout-dashboard"
    >
      <template #actions>
        <NButton size="small" quaternary @click="load">
          <template #icon><NIcon size="15"><Icon icon="tabler:refresh" /></NIcon></template>
          刷新
        </NButton>
        <NButton type="primary" size="small" @click="router.push('/accounts')">
          <template #icon><NIcon size="15"><Icon icon="tabler:plus" /></NIcon></template>
          申请代理
        </NButton>
      </template>
    </PageHeader>

    <NAlert v-if="auth.info.announcement" type="info" :bordered="false" class="mb-4" :show-icon="true">
      {{ auth.info.announcement }}
    </NAlert>

    <NGrid :x-gap="12" :y-gap="12" cols="1 s:2 m:4" responsive="screen">
      <NGi>
        <StatCard
          label="剩余流量"
          :value="data ? fmtMB(data.remaining_mb) : ''"
          icon="tabler:database"
          tone="brand"
          :hint="data ? `总额度 ${fmtMB(data.quota_mb)} · 已用 ${fmtBytes(data.used_bytes)}` : ''"
          :percent="data ? usagePct : null"
          :loading="loading"
        />
      </NGi>
      <NGi>
        <StatCard
          label="我的代理"
          :value="data ? `${data.running} / ${data.accounts}` : ''"
          icon="tabler:affiliate"
          tone="green"
          :hint="data ? `运行中 ${data.running} 个 · 共 ${data.accounts} 个` : ''"
          :loading="loading"
        />
      </NGi>
      <NGi>
        <StatCard
          label="今日消耗"
          :value="data ? fmtBytes(data.today_bytes) : ''"
          icon="tabler:arrows-exchange"
          tone="violet"
          hint="近 30 秒内实时采集"
          :loading="loading"
        />
      </NGi>
      <NGi>
        <StatCard
          label="待审核申请"
          :value="data ? data.pending_tickets : ''"
          icon="tabler:ticket"
          tone="amber"
          :hint="data?.pending_tickets ? '有申请正在等待管理员处理' : '暂无待处理申请'"
          :loading="loading"
        />
      </NGi>
    </NGrid>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-3 mt-3">
      <!-- 近 14 天趋势 -->
      <div class="tg-card p-4 lg:col-span-2">
        <div class="flex items-center justify-between mb-1">
          <div>
            <div class="tg-section-title">近 14 天流量趋势</div>
            <div class="text-xs tg-text-3 mt-0.5">每日上下行合计</div>
          </div>
          <NButton text type="primary" size="small" @click="router.push('/traffic')">
            详细统计 <NIcon size="13" class="ml-0.5"><Icon icon="tabler:chevron-right" /></NIcon>
          </NButton>
        </div>
        <div class="h-[180px] mt-2">
          <Sparkline v-if="!loading && data" :data="data.series" />
          <NSkeleton v-else height="160px" :sharp="false" />
        </div>
      </div>

      <!-- 额度使用 -->
      <div class="tg-card p-4">
        <div class="tg-section-title mb-3">总量额度使用</div>
        <div class="flex items-baseline gap-1.5">
          <span class="text-[28px] font-semibold tracking-tight" style="font-variant-numeric: tabular-nums">
            {{ data ? usagePct.toFixed(1) : '-' }}
          </span>
          <span class="tg-text-3 text-sm">%</span>
        </div>
        <div class="text-xs tg-text-3 mt-1">
          {{ data ? `${fmtBytes(data.used_bytes)} / ${fmtMB(data.quota_mb)}` : '' }}
        </div>
        <NProgress
          type="line"
          :percentage="usagePct"
          :show-indicator="false"
          :height="8"
          color="#2450eb"
          rail-color="var(--tg-border)"
          class="!mt-4"
        />
        <div class="mt-4 pt-3 border-t tg-divider flex items-center justify-between text-xs">
          <span class="tg-text-3">剩余可用</span>
          <span class="font-medium">{{ data ? fmtMB(data.remaining_mb) : '-' }}</span>
        </div>
        <NButton v-if="data && usagePct > 80" type="warning" size="small" block class="!mt-3" @click="router.push('/tickets')">
          流量不足，立即申请
        </NButton>
        <NButton v-else size="small" block class="!mt-3" tertiary @click="router.push('/tickets')">
          申请更多流量
        </NButton>
      </div>
    </div>

    <!-- 最近代理 -->
    <div class="tg-card mt-3">
      <div class="flex items-center justify-between px-4 py-3 border-b tg-divider">
        <div class="tg-section-title">最近的代理</div>
        <NButton text type="primary" size="small" @click="router.push('/accounts')">全部管理</NButton>
      </div>
      <NSkeleton v-if="loading" class="p-4" height="120px" :sharp="false" />
      <NEmpty v-else-if="!data?.recent?.length" class="py-8" description="还没有代理，去创建你的第一个吧">
        <template #extra>
          <NButton type="primary" size="small" @click="router.push('/accounts')">立即申请</NButton>
        </template>
      </NEmpty>
      <NDataTable
        v-else
        :columns="recentColumns"
        :data="data.recent"
        :bordered="false"
        size="small"
        :row-key="(r) => r.id"
      />
    </div>
  </div>
</template>
