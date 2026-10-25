<script setup>
import { ref, watch, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import Sidebar from './Sidebar.vue';
import HeaderBar from './HeaderBar.vue';
import TabBar from './TabBar.vue';
import { useTabsStore } from '@/stores/tabs';
import { useAuthStore } from '@/stores/auth';
import { api } from '@/api';
import { Icon } from '@iconify/vue';
import { NIcon } from 'naive-ui';
import { ref as vref } from 'vue';

const route = useRoute();
const tabs = useTabsStore();
const drawerOpen = ref(false);
const auth = useAuthStore();
const marquee = vref([]);
const footer = computed(() => auth.info.site_footer || '');
const icp = computed(() => auth.info.icp || '');

onMounted(async () => {
  try {
    const res = await api.notices();
    marquee.value = res.data.marquee || [];
  } catch { /* ignore */ }
});

watch(() => route.fullPath, () => { drawerOpen.value = false; });
</script>

<template>
  <div class="app-shell">
    <!-- 桌面端侧边栏 -->
    <div class="hidden lg:flex">
      <Sidebar />
    </div>

    <!-- 移动端抽屉 -->
    <Transition name="mask">
      <div v-if="drawerOpen" class="drawer-mask lg:hidden" @click="drawerOpen = false" />
    </Transition>
    <div class="lg:hidden">
      <Sidebar :mobile-open="drawerOpen" @close="drawerOpen = false" />
    </div>

    <div class="main-col">
      <HeaderBar @open-drawer="drawerOpen = true" />
      <div v-if="marquee.length" class="marquee-bar">
        <NIcon size="15" class="marquee-ico"><Icon icon="tabler:speakerphone" /></NIcon>
        <div class="marquee-track">
          <span class="marquee-content">{{ marquee.map((m) => m.text).join('　·　') }}　·　</span>
        </div>
      </div>
      <TabBar />
      <main class="content">
        <RouterView v-slot="{ Component }">
          <KeepAlive :max="12">
            <component :is="Component" :key="tabs.refreshKey + '-' + route.path" />
          </KeepAlive>
        </RouterView>
      </main>
      <footer v-if="footer || icp" class="app-footer">
        <span v-if="footer">{{ footer }}</span>
        <span v-if="icp" class="icp">{{ icp }}</span>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
  background: var(--tg-bg);
}
.main-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
  padding: 20px;
}
.marquee-bar {
  display: flex; align-items: center; gap: 8px;
  height: 32px; padding: 0 14px;
  background: color-mix(in srgb, var(--tg-brand) 6%, var(--tg-surface));
  border-bottom: 1px solid var(--tg-border);
  font-size: 12.5px; color: var(--tg-text-2);
  overflow: hidden; flex-shrink: 0;
}
.marquee-ico { color: var(--tg-brand); flex-shrink: 0; }
.marquee-track { flex: 1; overflow: hidden; white-space: nowrap; }
.marquee-content { display: inline-block; padding-left: 100%; animation: marquee-scroll 22s linear infinite; }
@keyframes marquee-scroll { from { transform: translateX(0); } to { transform: translateX(-100%); } }
.app-footer {
  flex-shrink: 0; padding: 10px 16px;
  display: flex; justify-content: center; gap: 12px; flex-wrap: wrap;
  font-size: 12px; color: var(--tg-text-3);
  border-top: 1px solid var(--tg-border);
  background: var(--tg-surface);
}
.drawer-mask {
  position: fixed;
  inset: 0;
  background: rgba(16, 24, 40, 0.45);
  z-index: 45;
  backdrop-filter: blur(1px);
}
.mask-enter-active, .mask-leave-active { transition: opacity 0.2s ease; }
.mask-enter-from, .mask-leave-to { opacity: 0; }

@media (max-width: 767px) {
  .content { padding: 12px; }
}
</style>
