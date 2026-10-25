<script setup>
import { computed, ref, watch, onMounted } from 'vue';
import QRCode from 'qrcode';

const props = defineProps({
  text: { type: String, required: true },
  size: { type: Number, default: 180 },
  caption: { type: String, default: '' },
  dark: { type: Boolean, default: false },
});

const canvas = ref(null);
const err = ref('');

function render() {
  if (!canvas.value || !props.text) return;
  try {
    QRCode.toCanvas(canvas.value, props.text, {
      width: props.size,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: props.dark ? { dark: '#e8eaee', light: '#16181d' } : { dark: '#1a1d23', light: '#ffffff' },
    }, (e) => { err.value = e ? e.message : ''; });
  } catch (e) {
    err.value = e.message;
  }
}

onMounted(render);
watch(() => [props.text, props.dark, props.size], render);
</script>

<template>
  <div class="inline-flex flex-col items-center gap-2">
    <canvas ref="canvas" :width="size" :height="size" class="qr-canvas" />
    <div v-if="caption" class="text-xs tg-text-3 text-center max-w-[220px] break-all">{{ caption }}</div>
    <div v-if="err" class="text-xs text-red-500">{{ err }}</div>
  </div>
</template>

<style scoped>
.qr-canvas { border-radius: 8px; display: block; }
</style>
