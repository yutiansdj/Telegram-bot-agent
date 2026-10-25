<script setup>
import { h, computed } from 'vue';
import { NMenu, NIcon } from 'naive-ui';
import { Icon } from '@iconify/vue';
import { useRouter, useRoute } from 'vue-router';

const props = defineProps({ items: { type: Array, required: true }, collapsed: Boolean });
const router = useRouter();
const route = useRoute();

const renderIcon = (icon) => () => h(NIcon, { size: 18 }, { default: () => h(Icon, { icon }) });

function toNative(items) {
  return items.map((it) => {
    if (it.type === 'group') return { ...it, key: it.key || `g-${it.label}` };
    return { ...it, icon: renderIcon(it.icon) };
  });
}

const options = computed(() => toNative(props.items));
const activeKey = computed(() => route.path);

function onSelect(key) {
  if (typeof key === 'string' && key.startsWith('/')) router.push(key);
}
</script>

<template>
  <NMenu
    :options="options"
    :value="activeKey"
    :collapsed="collapsed"
    :collapsed-width="48"
    :collapsed-icon-size="19"
    :indent="16"
    :root-indent="14"
    :group-header-style="{ fontSize: '11px', fontWeight: '600', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--tg-text-3)', paddingLeft: '14px', marginTop: '10px' }"
    @update:value="onSelect"
  />
</template>
