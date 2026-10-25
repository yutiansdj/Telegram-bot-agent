<script setup>
import { computed, h } from 'vue';
import { NIcon, NProgress } from 'naive-ui';
import { Icon } from '@iconify/vue';
import { fmtBytes } from '@/utils/format';

const props = defineProps({
  label: { type: String, default: '' },
  value: { type: [String, Number], default: '' },
  icon: { type: String, default: 'tabler:activity' },
  tone: { type: String, default: 'brand' }, // brand | green | amber | red | violet
  hint: { type: String, default: '' },
  percent: { type: Number, default: null },
  loading: { type: Boolean, default: false },
});

const toneMap = {
  brand: { bg: 'var(--tg-brand-soft)', fg: 'var(--tg-brand)', bar: '#2450eb', icon: 'tabler:chart-pie' },
  green: { bg: 'rgba(22,163,74,0.10)', fg: '#16a34a', bar: '#16a34a' },
  amber: { bg: 'rgba(217,119,6,0.10)', fg: '#d97706', bar: '#d97706' },
  red: { bg: 'rgba(220,38,38,0.10)', fg: '#dc2626', bar: '#dc2626' },
  violet: { bg: 'rgba(124,58,237,0.10)', fg: '#7c3aed', bar: '#7c3aed' },
};
const t = computed(() => toneMap[props.tone] || toneMap.brand);
</script>

<template>
  <div class="stat-card tg-card">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="stat-label">{{ label }}</div>
        <div class="stat-value" :class="{ 'skeleton': loading }">
          <template v-if="!loading">{{ value }}</template>
        </div>
        <div v-if="hint" class="stat-hint">{{ hint }}</div>
      </div>
      <div class="stat-icon" :style="{ background: t.bg, color: t.fg }">
        <NIcon size="19"><Icon :icon="icon" /></NIcon>
      </div>
    </div>
    <div v-if="percent !== null" class="mt-3">
      <NProgress
        type="line"
        :percentage="Math.min(100, Math.max(0, Number(percent) || 0))"
        :show-indicator="false"
        :height="4"
        :color="t.bar"
        rail-color="var(--tg-border)"
      />
    </div>
  </div>
</template>

<style scoped>
.stat-card { padding: 16px; }
.stat-label { font-size: 12.5px; color: var(--tg-text-2); }
.stat-value { font-size: 24px; font-weight: 650; letter-spacing: -0.02em; margin-top: 2px; line-height: 1.3; min-height: 32px; }
.stat-value.skeleton { color: transparent; background: var(--tg-surface-2); border-radius: 6px; width: 90px; animation: pulse 1.4s ease infinite; }
.stat-hint { font-size: 12px; color: var(--tg-text-3); margin-top: 3px; }
.stat-icon {
  width: 36px; height: 36px;
  border-radius: 9px;
  display: grid; place-items: center;
  flex-shrink: 0;
}
@keyframes pulse { 0%,100% { opacity: .55; } 50% { opacity: 1; } }
</style>
