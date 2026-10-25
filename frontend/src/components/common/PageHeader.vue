<script setup>
import { NIcon } from 'naive-ui';
import { Icon } from '@iconify/vue';

defineProps({
  title: { type: String, default: '' },
  subtitle: { type: String, default: '' },
  icon: { type: String, default: '' },
});
</script>

<template>
  <div class="page-head">
    <div class="flex items-center gap-3 min-w-0">
      <div v-if="icon" class="head-icon">
        <NIcon size="20"><Icon :icon="icon" /></NIcon>
      </div>
      <div class="min-w-0">
        <h1 class="tg-page-title truncate">{{ title }}</h1>
        <p v-if="subtitle" class="tg-text-2 text-[13px] mt-0.5 truncate">{{ subtitle }}</p>
      </div>
    </div>
    <div class="flex items-center gap-2 flex-shrink-0">
      <slot name="actions" />
    </div>
  </div>
</template>

<style scoped>
.page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.head-icon {
  width: 38px; height: 38px;
  border-radius: 10px;
  display: grid; place-items: center;
  background: var(--tg-brand-soft);
  color: var(--tg-brand);
  flex-shrink: 0;
}
</style>
