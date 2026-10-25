<script setup>
/**
 * 全局深度搜索（后台）
 * 搜索范围：页面、设置项、功能入口、快捷操作
 * 支持键盘导航：↑↓ 选择 / Enter 跳转 / Esc 关闭 / Ctrl+K 唤起
 */
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { NIcon, NInput } from 'naive-ui';
import { Icon } from '@iconify/vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { SEARCH_INDEX } from '@/utils/searchIndex';

const router = useRouter();
const auth = useAuthStore();

const show = ref(false);
const q = ref('');
const active = ref(0);
const inputRef = ref(null);
const listRef = ref(null);

const visibleIndex = computed(() =>
  SEARCH_INDEX.filter((it) => !it.admin || auth.isAdmin),
);

const results = computed(() => {
  const kw = q.value.trim().toLowerCase();
  if (!kw) {
    // 无关键词时显示常用页面
    return visibleIndex.value.filter((i) => i.type === 'page').slice(0, 8);
  }
  const terms = kw.split(/\s+/);
  return visibleIndex.value
    .map((it) => {
      const title = it.title.toLowerCase();
      const desc = (it.desc || '').toLowerCase();
      const tags = (it.tags || []).join(' ').toLowerCase();
      let score = 0;
      const multi = terms.length > 1;
      // 短词（如 "ai"）严格匹配词边界，避免污染搜索结果
      const short = kw.length <= 3;
      for (const t of terms) {
        if (title === t) score += 800;
        else if (title.startsWith(t)) score += 400;
        else if (short && new RegExp(`(^|[^a-z])${t}([^a-z]|$)`, 'i').test(title)) score += 300;
        else if (title.includes(t)) score += short ? 60 : 120;
        // 标签：短词做精确词匹配，长词做包含
        const tagHit = short
          ? new RegExp(`(^|[,\s])${t}([,\s]|$)`, 'i').test(tags)
          : tags.includes(t);
        if (tagHit) score += multi ? 80 : (short ? 70 : 45);
        if (desc.includes(t)) score += multi ? 40 : (short ? 5 : 15);
        if (it.path.toLowerCase().includes(t)) score += short ? 3 : 10;
      }
      // 多词查询：整句出现在标题中的额外加权
      if (multi && title.includes(kw)) score += 300;
      return { ...it, score };
    })
    .filter((i) => i.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 14);
});

/** 保持评分顺序，仅在类型变化时插入分组标题 */
const displayList = computed(() => {
  const list = [];
  let lastType = null;
  for (const r of results.value) {
    if (r.type !== lastType) {
      list.push({ __header: true, type: r.type, count: results.value.filter(x => x.type === r.type).length });
      lastType = r.type;
    }
    list.push(r);
  }
  return list;
});

const flat = computed(() => results.value);

const typeLabel = { page: '页面', setting: '设置项', action: '操作' };
const typeIcon = { page: 'tabler:file', setting: 'tabler:adjustments', action: 'tabler:bolt' };

function open() {
  show.value = true;
  q.value = '';
  active.value = 0;
  nextTick(() => inputRef.value?.focus());
}

function close() {
  show.value = false;
}

/** 通过 URL query 传递定位信息，由目标页面自行处理（切 Tab + 定位） */
function choose(item) {
  if (!item) return;
  close();
  const query = {};
  if (item.anchor) query.focus = item.anchor;
  if (item.tab) query.tab = item.tab;
  router.push({ path: item.path, query }).then(() => {
    if (item.anchor) waitAndHighlight(item.anchor, item.tab);
  });
}

/** 等待目标元素出现（最多等待 4 秒），然后滚动并高亮 */
function waitAndHighlight(anchor, tab, tries = 0) {
  nextTick(() => {
    const el = document.querySelector(`[data-search-anchor="${anchor}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.remove('search-hit');
      void el.offsetWidth; // 强制重排，重启动画
      el.classList.add('search-hit');
      setTimeout(() => el.classList.remove('search-hit'), 2400);
      return;
    }
    if (tries < 20) setTimeout(() => waitAndHighlight(anchor, tab, tries + 1), 200);
  });
}

function move(dir) {
  const n = flat.value.length;
  if (!n) return;
  active.value = (active.value + dir + n) % n;
  nextTick(() => {
    const el = listRef.value?.querySelector('.is-active');
    el?.scrollIntoView({ block: 'nearest' });
  });
}

function onKey(e) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    show.value ? close() : open();
    return;
  }
  if (!show.value) return;
  if (e.key === 'Escape') { close(); return; }
  if (e.key === 'ArrowDown') { e.preventDefault(); move(1); return; }
  if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); return; }
  if (e.key === 'Enter') { e.preventDefault(); choose(flat.value[active.value]); }
}

watch(q, () => { active.value = 0; });

onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));

defineExpose({ open });
</script>

<template>
  <!-- 触发按钮 -->
  <button class="search-trigger hide-mobile" title="搜索（Ctrl+K）" @click="open">
    <NIcon size="16"><Icon icon="tabler:search" /></NIcon>
    <span class="st-text">搜索页面、设置…</span>
    <kbd class="st-kbd">Ctrl K</kbd>
  </button>
  <button class="search-trigger mini" title="搜索" @click="open">
    <NIcon size="18"><Icon icon="tabler:search" /></NIcon>
  </button>

  <!-- 搜索面板 -->
  <Teleport to="body">
    <Transition name="spop">
      <div v-if="show" class="search-mask" @click.self="close">
        <div class="search-panel" role="dialog" aria-label="全局搜索">
          <div class="sp-head">
            <NIcon size="18" class="sp-icon"><Icon icon="tabler:search" /></NIcon>
            <input
              ref="inputRef"
              v-model="q"
              class="sp-input"
              placeholder="搜索页面、设置项、功能…（支持中文/拼音首字母）"
              autocomplete="off"
            />
            <kbd class="sp-esc">Esc</kbd>
          </div>

          <div ref="listRef" class="sp-body">
            <template v-if="!q.trim()">
              <div class="sp-group-title">常用页面</div>
            </template>

            <template v-for="(item, idx) in displayList" :key="item.__header ? 'h-' + item.type + idx : item.path + item.title + idx">
              <div v-if="item.__header" class="sp-group-title">
                {{ typeLabel[item.type] }} <span class="cnt">{{ item.count }}</span>
              </div>
              <button
                v-else
                class="sp-item"
                :class="{ 'is-active': flat[active] === item }"
                @mouseenter="active = flat.indexOf(item)"
                @click="choose(item)"
              >
                <span class="sp-ico" :class="'t-' + item.type">
                  <NIcon size="15"><Icon :icon="item.icon || typeIcon[item.type]" /></NIcon>
                </span>
                <span class="flex-1 min-w-0">
                  <span class="sp-title">{{ item.title }}</span>
                  <span v-if="item.desc" class="sp-desc">{{ item.desc }}</span>
                </span>
                <span v-if="item.anchor" class="sp-badge">设置项</span>
                <span v-if="active === idx" class="sp-hint">↵</span>
              </button>
            </template>

            <div v-if="!results.length" class="sp-empty">
              <NIcon size="32" class="tg-text-3"><Icon icon="tabler:search-off" /></NIcon>
              <div class="sp-empty-text">没有找到「{{ q }}」相关内容</div>
              <div class="sp-empty-hint">试试搜索：机器人、邮件、验证码、代理、备份、用户…</div>
            </div>
          </div>

          <div class="sp-foot">
            <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
            <span><kbd>↵</kbd> 打开</span>
            <span><kbd>Esc</kbd> 关闭</span>
            <span class="flex-1" />
            <span>深度搜索 · 共 {{ visibleIndex.length }} 项</span>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.search-trigger {
  display: flex; align-items: center; gap: 7px;
  height: 32px; padding: 0 10px;
  border-radius: 7px;
  border: 1px solid var(--tg-border);
  background: var(--tg-surface-2);
  color: var(--tg-text-3);
  font-size: 12.5px;
  cursor: pointer;
  transition: all .15s ease;
  max-width: 240px;
}
.search-trigger:hover { border-color: var(--tg-border-strong); color: var(--tg-text-2); background: var(--tg-surface); }
.search-trigger.mini { display: none; width: 32px; padding: 0; justify-content: center; }
@media (max-width: 767px) {
  .search-trigger { display: none; }
  .search-trigger.mini { display: flex; }
}
.st-text { flex: 1; text-align: left; white-space: nowrap; overflow: hidden; }
.st-kbd {
  font-size: 10px; padding: 1px 4px; border-radius: 4px;
  border: 1px solid var(--tg-border); background: var(--tg-surface);
  color: var(--tg-text-3); font-family: inherit;
}

.search-mask {
  position: fixed; inset: 0; z-index: 3000;
  background: rgba(16, 24, 40, 0.35);
  backdrop-filter: blur(2px);
  display: flex; align-items: flex-start; justify-content: center;
  padding-top: 12vh;
}
.search-panel {
  width: min(620px, calc(100vw - 32px));
  max-height: 68vh;
  background: var(--tg-surface);
  border: 1px solid var(--tg-border);
  border-radius: 12px;
  box-shadow: 0 24px 64px rgba(16, 24, 40, 0.22);
  display: flex; flex-direction: column;
  overflow: hidden;
}
html.dark .search-panel { box-shadow: 0 24px 64px rgba(0,0,0,.6); }

.sp-head {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--tg-border);
}
.sp-icon { color: var(--tg-text-3); flex-shrink: 0; }
.sp-input {
  flex: 1; border: none; outline: none; background: transparent;
  font-size: 14.5px; color: var(--tg-text); font-family: inherit;
}
.sp-input::placeholder { color: var(--tg-text-3); }
.sp-esc {
  font-size: 10.5px; padding: 2px 6px; border-radius: 4px;
  border: 1px solid var(--tg-border); color: var(--tg-text-3); font-family: inherit;
}

.sp-body { flex: 1; overflow-y: auto; padding: 6px; }
.sp-group-title {
  font-size: 11px; font-weight: 600; color: var(--tg-text-3);
  text-transform: uppercase; letter-spacing: .05em;
  padding: 8px 10px 4px;
}
.sp-group-title .cnt { font-weight: 400; opacity: .7; }

.sp-item {
  display: flex; align-items: center; gap: 10px;
  width: 100%; padding: 8px 10px; border: none; background: transparent;
  border-radius: 8px; cursor: pointer; text-align: left;
  color: var(--tg-text);
}
.sp-item.is-active { background: var(--tg-brand-soft); }
.sp-ico {
  width: 26px; height: 26px; border-radius: 7px; flex-shrink: 0;
  display: grid; place-items: center;
}
.sp-ico.t-page { background: rgba(36,80,235,.1); color: #2450eb; }
.sp-ico.t-setting { background: rgba(217,119,6,.1); color: #d97706; }
.sp-ico.t-action { background: rgba(124,58,237,.1); color: #7c3aed; }
.sp-title { display: block; font-size: 13.5px; font-weight: 500; }
.sp-desc {
  display: block; font-size: 11.5px; color: var(--tg-text-3);
  margin-top: 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.sp-badge {
  font-size: 10px; padding: 1px 6px; border-radius: 4px;
  background: var(--tg-surface-2); border: 1px solid var(--tg-border);
  color: var(--tg-text-3); flex-shrink: 0;
}
.sp-hint {
  font-size: 11px; color: var(--tg-text-3); flex-shrink: 0;
  padding: 1px 5px; border-radius: 4px;
  border: 1px solid var(--tg-border); background: var(--tg-surface-2);
}
.sp-arrow { color: var(--tg-text-3); flex-shrink: 0; opacity: 0; transition: opacity .12s; }
.sp-item.is-active .sp-arrow { opacity: 1; }

.sp-empty {
  display: flex; flex-direction: column; align-items: center;
  padding: 40px 20px; gap: 6px;
}
.sp-empty-text { font-size: 13.5px; color: var(--tg-text-2); margin-top: 4px; }
.sp-empty-hint { font-size: 12px; color: var(--tg-text-3); }

.sp-foot {
  display: flex; align-items: center; gap: 12px;
  padding: 8px 14px; border-top: 1px solid var(--tg-border);
  font-size: 11.5px; color: var(--tg-text-3);
  background: var(--tg-surface-2);
}
.sp-foot kbd {
  font-family: inherit; font-size: 10px; padding: 1px 4px;
  border: 1px solid var(--tg-border); border-radius: 3px;
  background: var(--tg-surface); margin-right: 2px;
}

.spop-enter-active, .spop-leave-active { transition: opacity .16s ease; }
.spop-enter-from, .spop-leave-to { opacity: 0; }
.spop-enter-active .search-panel { animation: sp-in .18s cubic-bezier(.16,1,.3,1); }
@keyframes sp-in { from { transform: translateY(-8px) scale(.98); opacity: .6; } to { transform: none; opacity: 1; } }
</style>
