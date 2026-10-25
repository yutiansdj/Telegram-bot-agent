<script setup>
import { ref, onMounted, watch, computed } from 'vue';
import { NIcon, NButton, NInput, NSpin } from 'naive-ui';
import { Icon } from '@iconify/vue';
import http from '@/api';

const props = defineProps({
  scene: { type: String, default: 'login' },
  value: { type: Object, default: null },
});
const emit = defineEmits(['update:value']);

const loading = ref(false);
const cfg = ref(null);
const challenge = ref(null);
const answer = ref('');
const error = ref('');
const sliderX = ref(0);
const dragging = ref(false);
const trackRef = ref(null);

const required = computed(() => {
  if (!cfg.value?.enabled) return false;
  return !!cfg.value.points?.[props.scene];
});

const isThirdParty = computed(() => ['hcaptcha', 'turnstile', 'recaptcha'].includes(cfg.value?.provider));

async function loadConfig() {
  try {
    const res = await http.get('/captcha/config');
    cfg.value = res.data;
  } catch { cfg.value = { enabled: false }; }
}

async function refresh() {
  if (!required.value || isThirdParty.value) return;
  loading.value = true;
  error.value = '';
  answer.value = '';
  sliderX.value = 0;
  try {
    const res = await http.get('/captcha/challenge', { params: { scene: props.scene } });
    challenge.value = res.data;
    emit('update:value', { id: res.data.id, kind: res.data.kind, answer: '' });
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

watch(answer, (v) => {
  if (challenge.value) {
    emit('update:value', { id: challenge.value.id, kind: challenge.value.kind, answer: v });
  }
});

// ---- 滑块逻辑 ----
function startDrag(e) {
  if (!challenge.value) return;
  dragging.value = true;
  e.preventDefault();
  const move = (ev) => {
    if (!dragging.value || !trackRef.value) return;
    const clientX = ev.touches ? ev.touches[0].clientX : ev.clientX;
    const rect = trackRef.value.getBoundingClientRect();
    const max = rect.width - (challenge.value.gaps + 24);
    sliderX.value = Math.max(0, Math.min(max, clientX - rect.left - 12));
    emit('update:value', { id: challenge.value.id, kind: 'slider', sliderX: sliderX.value });
  };
  const up = () => {
    dragging.value = false;
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    window.removeEventListener('touchmove', move);
    window.removeEventListener('touchend', up);
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
  window.addEventListener('touchmove', move, { passive: false });
  window.addEventListener('touchend', up);
}

// ---- 第三方（预留渲染位） ----
const thirdPartyReady = ref(false);
const thirdPartyToken = ref('');
function onThirdPartyToken(token) {
  thirdPartyToken.value = token;
  emit('update:value', { token });
  thirdPartyReady.value = !!token;
}

onMounted(async () => {
  await loadConfig();
  if (required.value && !isThirdParty.value) await refresh();
});

/** 供父组件在提交时读取当前验证值（避免监听时序问题） */
function getValue() {
  if (!required.value) return null;
  if (isThirdParty.value) return thirdPartyToken.value ? { token: thirdPartyToken.value } : null;
  if (!challenge.value) return null;
  if (challenge.value.kind === 'slider') {
    return sliderX.value > 0 ? { id: challenge.value.id, kind: 'slider', sliderX: sliderX.value } : null;
  }
  if (!answer.value) return null;
  return { id: challenge.value.id, kind: challenge.value.kind, answer: answer.value };
}

defineExpose({ refresh, reset: refresh, getValue });
</script>

<template>
  <div v-if="required" class="captcha">
    <!-- 数学题 -->
    <template v-if="cfg.provider === 'math'">
      <div class="cap-row">
        <div class="cap-question">
          <NSpin :show="loading" size="small">
            <span class="q-text">{{ challenge?.question || '加载中…' }}</span>
          </NSpin>
        </div>
        <NInput v-model:value="answer" placeholder="结果" class="cap-input" :maxlength="4" @keydown.enter="$emit('submit')" />
        <NButton quaternary circle size="small" title="换一题" @click="refresh">
          <template #icon><NIcon size="15"><Icon icon="tabler:refresh" /></NIcon></template>
        </NButton>
      </div>
      <div class="cap-hint">请输入计算结果，验证你是否为真人</div>
    </template>

    <!-- 图形验证码 -->
    <template v-else-if="cfg.provider === 'image'">
      <div class="cap-row">
        <img :src="challenge?.image" class="cap-img" alt="验证码" title="点击刷新" @click="refresh" />
        <NInput v-model:value="answer" placeholder="输入图中字符" class="cap-input" :maxlength="8" />
        <NButton quaternary circle size="small" title="换一张" @click="refresh">
          <template #icon><NIcon size="15"><Icon icon="tabler:refresh" /></NIcon></template>
        </NButton>
      </div>
      <div class="cap-hint">看不清？点击图片刷新（不区分大小写）</div>
    </template>

    <!-- 滑块 -->
    <template v-else-if="cfg.provider === 'slider'">
      <div ref="trackRef" class="slider-track" :style="{ width: (challenge?.width || 280) + 'px' }">
        <div class="slider-fill" :style="{ width: (sliderX + 20) + 'px' }" />
        <div class="slider-target" :style="{ left: (challenge?.target || 0) + 'px', width: (challenge?.gaps || 36) + 'px' }" />
        <div class="slider-thumb" :class="{ dragging }" :style="{ left: sliderX + 'px' }" @mousedown="startDrag" @touchstart="startDrag">
          <NIcon size="14"><Icon icon="tabler:arrows-horizontal" /></NIcon>
        </div>
      </div>
      <div class="cap-hint">拖动滑块到缺口位置</div>
    </template>

    <!-- 第三方 -->
    <template v-else>
      <div class="third-party">
        <div v-if="!cfg.siteKeys?.[cfg.provider]" class="cap-hint text-red-500">
          管理员尚未配置 {{ cfg.provider }} 的站点密钥
        </div>
        <div v-else id="captcha-thirdparty" @captcha-token="onThirdPartyToken" />
      </div>
    </template>

    <div v-if="error" class="cap-error">{{ error }}</div>
  </div>
</template>

<style scoped>
.captcha { margin: 4px 0 6px; }
.cap-row { display: flex; align-items: center; gap: 8px; }
.cap-question {
  min-width: 108px; height: 34px;
  display: flex; align-items: center; justify-content: center;
  background: var(--tg-surface-2);
  border: 1px solid var(--tg-border);
  border-radius: 7px;
  padding: 0 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  font-variant-numeric: tabular-nums;
}
.q-text { font-size: 15px; }
.cap-input { flex: 1; }
.cap-img {
  height: 38px; width: 132px; border-radius: 7px;
  border: 1px solid var(--tg-border);
  cursor: pointer; flex-shrink: 0;
}
.cap-hint { font-size: 11.5px; color: var(--tg-text-3); margin-top: 4px; }
.cap-error { font-size: 12px; color: #dc2626; margin-top: 4px; }

.slider-track {
  position: relative; height: 38px; border-radius: 7px;
  background: var(--tg-surface-2);
  border: 1px solid var(--tg-border);
  overflow: hidden; user-select: none;
}
.slider-fill { position: absolute; left: 0; top: 0; bottom: 0; background: color-mix(in srgb, var(--tg-brand) 12%, transparent); }
.slider-target {
  position: absolute; top: 50%; transform: translateY(-50%);
  height: 22px; border-radius: 4px;
  background: color-mix(in srgb, var(--tg-brand) 18%, transparent);
  border: 1px dashed var(--tg-brand);
}
.slider-thumb {
  position: absolute; top: 3px; left: 0;
  width: 30px; height: 30px; border-radius: 6px;
  background: var(--tg-surface);
  border: 1px solid var(--tg-border-strong);
  box-shadow: 0 2px 6px rgba(16,24,40,.12);
  display: grid; place-items: center;
  cursor: grab; color: var(--tg-text-2); z-index: 2;
  touch-action: none;
}
.slider-thumb.dragging { cursor: grabbing; border-color: var(--tg-brand); color: var(--tg-brand); }
.third-party { min-height: 40px; }
</style>
