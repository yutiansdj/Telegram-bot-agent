<script setup>
import { ref, onMounted, computed, watch } from 'vue';
import {
  NButton, NIcon, NInput, NTag, NAlert, NPopconfirm, NSpin, NEmpty,
} from 'naive-ui';
import { Icon } from '@iconify/vue';
import PageHeader from '@/components/common/PageHeader.vue';
import { api } from '@/api';

const loading = ref(true);
const saving = ref(false);
const list = ref([]);
const activeKey = ref('register');
const subject = ref('');
const body = ref('');
const preview = ref(null);
const previewing = ref(false);
const themeColor = ref('#2450eb');
const bodyRef = ref(null);
const device = ref('desktop');
const testTo = ref('');
const sending = ref(false);

const active = computed(() => list.value.find((t) => t.key === activeKey.value));
const vars = computed(() => Object.entries(active.value?.vars || {}).map(([k, v]) => ({ key: k, label: v })));
const isCustomized = computed(() => {
  const t = active.value;
  return !!(t && (subject.value !== t.defaultSubject || body.value !== t.defaultBody));
});

async function load(keepTab = false) {
  loading.value = true;
  try {
    const res = await api.adminMailTemplates();
    list.value = res.data.list;
    themeColor.value = res.data.themeColor;
    if (!keepTab || !list.value.find((t) => t.key === activeKey.value)) activeKey.value = list.value[0]?.key || 'register';
    pick(activeKey.value);
  } catch (e) { window.$message.error(e.message); }
  finally { loading.value = false; }
}

function pick(key) {
  activeKey.value = key;
  const t = list.value.find((x) => x.key === key);
  if (!t) return;
  subject.value = t.subject;
  body.value = t.body;
  doPreview();
}

let timer = null;
function schedulePreview() {
  clearTimeout(timer);
  timer = setTimeout(doPreview, 400);
}

async function doPreview() {
  previewing.value = true;
  try {
    const res = await api.adminPreviewMail({ key: activeKey.value, subject: subject.value, body: body.value });
    preview.value = res.data;
  } catch (e) { preview.value = { html: `<div style="padding:20px;color:#dc2626">${e.message}</div>` }; }
  finally { previewing.value = false; }
}

function varToken(k) {
  return String.fromCharCode(123, 123) + k + String.fromCharCode(125, 125);
}

function insertVar(v) {
  const token = varToken(v);
  const el = bodyRef.value?.textareaElRef || bodyRef.value?.$el?.querySelector('textarea');
  if (el && typeof el.selectionStart === 'number') {
    const s = el.selectionStart, e = el.selectionEnd;
    body.value = body.value.slice(0, s) + token + body.value.slice(e);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + token.length, s + token.length); });
  } else {
    body.value += token;
  }
  schedulePreview();
}

async function save() {
  saving.value = true;
  try {
    await api.adminSaveTemplate({ key: activeKey.value, subject: subject.value, body: body.value });
    window.$message.success('模板已保存');
    await load(true);
  } catch (e) { window.$message.error(e.message); }
  finally { saving.value = false; }
}

async function resetTpl() {
  try {
    const res = await api.adminResetTemplate(activeKey.value);
    subject.value = res.data.subject;
    body.value = res.data.body;
    window.$message.success('已恢复默认模板');
    await doPreview();
    await load(true);
  } catch (e) { window.$message.error(e.message); }
}

async function sendTest() {
  if (!testTo.value) { window.$message.warning('请填写测试收件邮箱'); return; }
  sending.value = true;
  try {
    await api.adminSmtpTest({ to: testTo.value });
    window.$message.success('测试邮件已发送');
  } catch (e) { window.$message.error('发送失败：' + e.message); }
  finally { sending.value = false; }
}

watch([body, subject], schedulePreview);
onMounted(load);
</script>

<template>
  <div>
    <PageHeader title="邮件模板" subtitle="自定义各类通知邮件的标题与正文，支持变量与实时预览" icon="tabler:template">
      <template #actions>
        <NPopconfirm @positive-click="resetTpl">
          <template #trigger>
            <NButton size="small" quaternary :disabled="!active">恢复默认</NButton>
          </template>
          确定将当前模板恢复为默认内容？
        </NPopconfirm>
        <NButton type="primary" size="small" :loading="saving" @click="save">保存模板</NButton>
      </template>
    </PageHeader>

    <NSpin :show="loading">
      <div class="grid grid-cols-1 xl:grid-cols-[200px_1fr_1fr] gap-3 items-start">
        <!-- 模板列表 -->
        <div class="tg-card p-2">
          <div class="text-xs tg-text-3 px-2 py-1.5">邮件类型</div>
          <button
            v-for="t in list" :key="t.key"
            class="tpl-btn" :class="{ active: activeKey === t.key }"
            @click="pick(t.key)"
          >
            <NIcon size="15"><Icon icon="tabler:mail" /></NIcon>
            <span class="flex-1 text-left">{{ t.name }}</span>
            <NTag v-if="t.customized" size="tiny" type="success" :bordered="false">自定义</NTag>
          </button>
        </div>

        <!-- 编辑区 -->
        <div class="flex flex-col gap-3">
          <div class="tg-card p-4">
            <div class="tg-section-title mb-3">邮件标题</div>
            <NInput v-model:value="subject" placeholder="邮件标题，支持变量" :maxlength="200" />
            <div class="tg-section-title mt-4 mb-2">正文内容</div>
            <div class="flex flex-wrap gap-1.5 mb-2">
              <span class="text-xs tg-text-3 self-center mr-1">插入变量：</span>
              <NTag
                v-for="v in vars" :key="v.key" size="small" :bordered="false"
                class="cursor-pointer" @click="insertVar(v.key)"
              >
                {{ v.label }} <code class="ml-1 opacity-60" v-text="varToken(v.key)" />
              </NTag>
            </div>
            <NInput
              ref="bodyRef"
              v-model:value="body"
              type="textarea"
              :autosize="{ minRows: 12, maxRows: 22 }"
              placeholder="支持 HTML 标签与变量占位符"
              class="tpl-editor"
            />
            <div class="flex items-center justify-between mt-2">
              <span class="text-xs tg-text-3">支持 HTML 标签（p / b / a）与占位变量</span>
              <NButton size="tiny" text type="primary" @click="doPreview">
                <template #icon><NIcon size="13"><Icon icon="tabler:eye" /></NIcon></template>
                刷新预览
              </NButton>
            </div>
          </div>

          <div class="tg-card p-4">
            <div class="tg-section-title mb-2">发送测试邮件</div>
            <div class="flex gap-2">
              <NInput v-model:value="testTo" placeholder="收件邮箱" class="flex-1" />
              <NButton :loading="sending" @click="sendTest">发送当前模板</NButton>
            </div>
            <div class="text-xs tg-text-3 mt-1.5">使用「系统配置 → 邮件设置」中已配置的通道发送。</div>
          </div>
        </div>

        <!-- 预览 -->
        <div class="tg-card p-3 sticky top-0">
          <div class="flex items-center justify-between mb-2">
            <div class="tg-section-title">实时预览</div>
            <div class="flex gap-1">
              <NButton size="tiny" :type="device === 'desktop' ? 'primary' : 'default'" quaternary @click="device = 'desktop'">
                <template #icon><NIcon size="14"><Icon icon="tabler:device-desktop" /></NIcon></template>
              </NButton>
              <NButton size="tiny" :type="device === 'mobile' ? 'primary' : 'default'" quaternary @click="device = 'mobile'">
                <template #icon><NIcon size="14"><Icon icon="tabler:device-mobile" /></NIcon></template>
              </NButton>
            </div>
          </div>
          <div class="subject-preview">
            <span class="tg-text-3">标题：</span>{{ preview?.subject || '-' }}
          </div>
          <div class="preview-frame" :class="device">
            <iframe v-if="preview?.html" :srcdoc="preview.html" sandbox="" class="preview-iframe" />
            <NEmpty v-else size="small" description="暂无预览" class="py-10" />
          </div>
          <div class="text-xs tg-text-3 mt-2 leading-relaxed">
            预览使用示例数据：{{ Object.entries(preview?.vars || {}).slice(0, 3).map(([k, v]) => k + '=' + v).join('，') }}
          </div>
        </div>
      </div>
    </NSpin>
  </div>
</template>

<style scoped>
.tpl-btn {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 9px 10px; border-radius: 7px; border: none; background: transparent;
  color: var(--tg-text-2); font-size: 13px; cursor: pointer; transition: all .15s ease;
}
.tpl-btn:hover { background: var(--tg-surface-2); color: var(--tg-text); }
.tpl-btn.active { background: var(--tg-brand-soft); color: var(--tg-brand); font-weight: 500; }
.tpl-editor :deep(textarea) { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12.5px; line-height: 1.7; }
.subject-preview {
  font-size: 12.5px; padding: 7px 10px; border-radius: 7px;
  background: var(--tg-surface-2); border: 1px solid var(--tg-border);
  margin-bottom: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.preview-frame {
  border: 1px solid var(--tg-border); border-radius: 9px; overflow: hidden;
  background: #f5f6f8; transition: max-width .2s ease; margin: 0 auto;
}
.preview-frame.desktop { max-width: 100%; }
.preview-frame.mobile { max-width: 340px; }
.preview-iframe { width: 100%; height: 460px; border: none; display: block; }
.sticky { position: sticky; top: 0; }
</style>
