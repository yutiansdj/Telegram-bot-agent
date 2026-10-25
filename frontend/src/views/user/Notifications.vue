<script setup>
import { ref, onMounted, computed } from 'vue';
import { NButton, NIcon, NAlert, NEmpty, NTag, NSkeleton, NDivider } from 'naive-ui';
import { Icon } from '@iconify/vue';
import PageHeader from '@/components/common/PageHeader.vue';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { fmtDate } from '@/utils/format';

const auth = useAuthStore();
const loading = ref(true);
const list = ref([]);
const marquee = ref([]);
const readIds = ref(new Set());

const typeMap = { info: 'info', success: 'success', warning: 'warning', error: 'error' };
const levelLabel = { normal: '普通', important: '重要', urgent: '紧急' };
const levelType = { normal: 'default', important: 'warning', urgent: 'error' };

const unreadCount = computed(() => list.value.filter((n) => !readIds.value.has(n.id)).length);

async function load() {
  loading.value = true;
  try {
    const res = await api.notices();
    list.value = res.data.list || [];
    marquee.value = res.data.marquee || [];
    const stored = JSON.parse(localStorage.getItem('tgproxy_read_notices') || '[]');
    readIds.value = new Set(stored);
  } catch (e) { window.$message.error(e.message); }
  finally { loading.value = false; }
}

async function markAllRead() {
  const ids = list.value.map((n) => n.id);
  readIds.value = new Set(ids);
  localStorage.setItem('tgproxy_read_notices', JSON.stringify(ids));
  try { await api.markNoticeRead(ids); } catch { /* ignore */ }
  window.$message.success('已全部标记为已读');
}

onMounted(load);
</script>

<template>
  <div>
    <PageHeader
      title="消息通知" subtitle="平台公告、系统消息与重要提醒" icon="tabler:bell"
    >
      <template #actions>
        <NButton size="small" quaternary @click="load">
          <template #icon><NIcon size="15"><Icon icon="tabler:refresh" /></NIcon></template>
          刷新
        </NButton>
        <NButton size="small" type="primary" secondary :disabled="!unreadCount" @click="markAllRead">
          全部已读（{{ unreadCount }}）
        </NButton>
      </template>
    </PageHeader>

    <NAlert v-if="marquee.length" type="info" :bordered="false" class="mb-3" :show-icon="false">
      <div class="marquee-line">
        <NIcon size="16"><Icon icon="tabler:speakerphone" /></NIcon>
        <span class="marquee-text">{{ marquee.map((m) => m.text).join('　·　') }}</span>
      </div>
    </NAlert>

    <div class="tg-card">
      <NSkeleton v-if="loading" class="p-4" height="120px" :sharp="false" />
      <NEmpty v-else-if="!list.length" class="py-14" description="暂无通知" />
      <div v-else class="notice-list">
        <div v-for="n in list" :key="n.id" class="notice-item" :class="{ unread: !readIds.has(n.id) }">
          <div class="notice-dot" />
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-medium text-[14px]">{{ n.title }}</span>
              <NTag v-if="n.pinned" size="tiny" type="warning" :bordered="false">
                <NIcon size="10" class="mr-0.5"><Icon icon="tabler:pinned" /></NIcon>置顶
              </NTag>
              <NTag size="tiny" :type="levelType[n.level] || 'default'" :bordered="false">{{ levelLabel[n.level] || n.level }}</NTag>
            </div>
            <div v-if="n.content" class="notice-content">{{ n.content }}</div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="auth.info.announcement" class="tg-card p-4 mt-3">
      <div class="tg-section-title mb-2">平台公告</div>
      <div class="text-[13.5px] tg-text-2 whitespace-pre-wrap">{{ auth.info.announcement }}</div>
    </div>
  </div>
</template>

<style scoped>
.notice-list { display: flex; flex-direction: column; }
.notice-item {
  display: flex; gap: 10px; padding: 14px 16px;
  border-bottom: 1px solid var(--tg-border);
  transition: background .15s ease;
}
.notice-item:last-child { border-bottom: none; }
.notice-item:hover { background: var(--tg-surface-2); }
.notice-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--tg-border-strong); margin-top: 7px; flex-shrink: 0; }
.notice-item.unread .notice-dot { background: var(--tg-brand); box-shadow: 0 0 0 3px color-mix(in srgb, var(--tg-brand) 15%, transparent); }
.notice-content { font-size: 13px; color: var(--tg-text-2); margin-top: 5px; line-height: 1.75; white-space: pre-wrap; }
.marquee-line { display: flex; align-items: center; gap: 8px; overflow: hidden; }
.marquee-text {
  flex: 1; white-space: nowrap; overflow: hidden;
  animation: scroll-x 18s linear infinite;
}
@keyframes scroll-x {
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
}
</style>
