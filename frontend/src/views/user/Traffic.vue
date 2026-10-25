<script setup>
import { ref, computed, onMounted, h } from 'vue';
import { NButton, NIcon, NRadioGroup, NRadioButton, NDataTable, NProgress, NAlert } from 'naive-ui';
import { Icon } from '@iconify/vue';
import PageHeader from '@/components/common/PageHeader.vue';
import Sparkline from '@/components/common/Sparkline.vue';
import StatCard from '@/components/common/StatCard.vue';
import { api } from '@/api';
import { fmtBytes, fmtMB } from '@/utils/format';

const loading = ref(true);
const days = ref(7);
const series = ref([]);
const byAccount = ref([]);

const sums = computed(() => {
  const up = series.value.reduce((s, x) => s + x.up, 0);
  const down = series.value.reduce((s, x) => s + x.down, 0);
  const peak = Math.max(...series.value.map((x) => x.total), 0);
  return { up, down, total: up + down, peak };
});

const columns = [
  { title: '代理名称', key: 'name', ellipsis: { tooltip: true } },
  { title: '端口', key: 'port', width: 84 },
  {
    title: '已用 / 额度', key: 'used_bytes', width: 190,
    render: (r) => {
      const pct = r.quota_mb > 0 ? Math.min(100, (r.used_bytes / 1024 / 1024 / r.quota_mb) * 100) : 0;
      return h('div', { style: 'min-width:150px' }, [
        h('div', { style: 'font-size:12px;display:flex;justify-content:space-between;margin-bottom:2px', class: 'tg-text-2' }, [
          h('span', fmtBytes(r.used_bytes)),
          h('span', `/ ${fmtMB(r.quota_mb)}`),
        ]),
        h(NProgress, {
          type: 'line', percentage: pct, showIndicator: false, height: 5, railColor: 'var(--tg-border)',
          color: pct > 90 ? '#dc2626' : pct > 70 ? '#d97706' : '#2450eb',
        }),
      ]);
    },
  },
];

async function load() {
  loading.value = true;
  try {
    const res = await api.myTraffic(days.value);
    series.value = res.data.series;
    byAccount.value = res.data.byAccount;
  } catch (e) { window.$message.error(e.message); }
  finally { loading.value = false; }
}

function setDays(v) { days.value = v; load(); }

onMounted(load);
</script>

<template>
  <div>
    <PageHeader title="流量统计" subtitle="按天查看流量消耗明细与各代理用量" icon="tabler:chart-area-line">
      <template #actions>
        <NButton size="small" quaternary @click="load">
          <template #icon><NIcon size="15"><Icon icon="tabler:refresh" /></NIcon></template>
          刷新
        </NButton>
      </template>
    </PageHeader>

    <div class="flex items-center gap-2 mb-3">
      <NRadioGroup :value="days" size="small" @update:value="setDays">
        <NRadioButton :value="7">近 7 天</NRadioButton>
        <NRadioButton :value="14">近 14 天</NRadioButton>
        <NRadioButton :value="30">近 30 天</NRadioButton>
      </NRadioGroup>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <StatCard label="本期总流量" :value="fmtBytes(sums.total)" icon="tabler:sum" tone="brand" :loading="loading" />
      <StatCard label="上行 / 下行" :value="`${fmtBytes(sums.up)} / ${fmtBytes(sums.down)}`" icon="tabler:arrows-exchange" tone="violet" :loading="loading" />
      <StatCard label="单日峰值" :value="fmtBytes(sums.peak)" icon="tabler:trending-up" tone="amber" :loading="loading" />
    </div>

    <div class="tg-card p-4 mt-3">
      <div class="tg-section-title mb-3">每日流量趋势</div>
      <Sparkline :data="series" :height="220" :loading="loading" />
    </div>

    <div class="tg-card mt-3">
      <div class="px-4 py-3 border-b tg-divider tg-section-title">各代理用量</div>
      <NDataTable
        :columns="columns"
        :data="byAccount"
        :loading="loading"
        :bordered="false"
        size="small"
        :row-key="(r) => r.id"
        :scroll-x="520"
      />
    </div>

    <NAlert type="info" :bordered="false" class="mt-3" :show-icon="true">
      流量数据每 30 秒采集一次并汇总为日统计；跨天后的首笔用量可能计入新的一天。若数据与实际不符请联系管理员。
    </NAlert>
  </div>
</template>
