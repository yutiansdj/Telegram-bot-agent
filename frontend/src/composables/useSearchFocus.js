import { watch, nextTick, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

/**
 * 响应全局搜索的深链接：
 *   ?tab=xxx&focus=anchorId
 * - 自动切换到指定 Tab
 * - 自动滚动并高亮指定的 [data-search-anchor] 元素
 *
 * @param {Ref<string>} tabRef 页面当前的 tab 值
 */
export function useSearchFocus(tabRef) {
  const route = useRoute();
  const router = useRouter();
  const highlightSeq = ref(0);

  function findEl(anchor) {
    return document.querySelector(`[data-search-anchor="${anchor}"]`);
  }

  function doHighlight(anchor, tries = 0) {
    nextTick(() => {
      const el = findEl(anchor);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.remove('search-hit');
        void el.offsetWidth;
        el.classList.add('search-hit');
        const seq = ++highlightSeq.value;
        setTimeout(() => {
          if (seq === highlightSeq.value) el.classList.remove('search-hit');
        }, 2400);
        return;
      }
      if (tries < 25) setTimeout(() => doHighlight(anchor, tries + 1), 180);
    });
  }

  function apply() {
    const { focus, tab } = route.query;
    if (tab && tabRef && tabRef.value !== tab) {
      tabRef.value = String(tab);
      // 切 Tab 后等渲染
      setTimeout(() => { if (focus) doHighlight(String(focus)); }, 350);
    } else if (focus) {
      setTimeout(() => doHighlight(String(focus)), 250);
    }
  }

  // 立即执行一次（组件挂载时）+ 监听 query 变化
  if (route.query.focus || route.query.tab) {
    setTimeout(() => apply(), 120);
  }
  watch(
    () => [route.query.focus, route.query.tab],
    () => { if (route.query.focus || route.query.tab) apply(); },
    { immediate: false },
  );

  return { doHighlight };
}
