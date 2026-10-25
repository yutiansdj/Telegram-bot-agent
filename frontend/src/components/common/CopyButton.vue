<script setup>
import { NIcon, NTooltip } from 'naive-ui';
import { Icon } from '@iconify/vue';
import { ref } from 'vue';
import { copyText } from '@/utils/format';

const props = defineProps({
  text: { type: String, default: '' },
  label: { type: String, default: '' },
  size: { type: String, default: 'small' },
  block: { type: Boolean, default: false },
});
const copied = ref(false);

async function doCopy() {
  const ok = await copyText(props.text);
  if (ok) {
    copied.value = true;
    window.$message?.success('已复制到剪贴板');
    setTimeout(() => { copied.value = false; }, 1500);
  } else {
    window.$message?.error('复制失败，请手动选择复制');
  }
}
</script>

<template>
  <button class="copy-btn" :class="{ block }" @click="doCopy">
    <slot>
      <NIcon size="14"><Icon :icon="copied ? 'tabler:check' : 'tabler:copy'" /></NIcon>
      <span v-if="label">{{ copied ? '已复制' : label }}</span>
    </slot>
  </button>
</template>

<style scoped>
.copy-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  padding: 3px 8px;
  border-radius: 6px;
  border: 1px solid var(--tg-border);
  background: var(--tg-surface);
  color: var(--tg-text-2);
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}
.copy-btn:hover { border-color: var(--tg-brand); color: var(--tg-brand); background: var(--tg-brand-soft); }
.copy-btn.block { width: 100%; justify-content: center; padding: 7px 8px; }
</style>
