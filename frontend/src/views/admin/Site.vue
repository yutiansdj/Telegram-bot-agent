<script setup>
import { ref, onMounted, computed } from 'vue';
import {
  NButton, NIcon, NInput, NSwitch, NForm, NFormItem, NAlert, NUpload, NTooltip,
} from 'naive-ui';
import { Icon } from '@iconify/vue';
import PageHeader from '@/components/common/PageHeader.vue';
import { api } from '@/api';
import { useSearchFocus } from '@/composables/useSearchFocus';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const loading = ref(true);
const saving = ref(false);
const s = ref({});
const uploading = ref({ logo: false, favicon: false, loginbg: false });
const logoInput = ref(null);
const faviconInput = ref(null);
const loginbgInput = ref(null);

function toggle(name) { s.value[name] = s.value[name] === '1' ? '0' : '1'; }

async function load() {
  loading.value = true;
  try {
    const res = await api.adminSettings();
    s.value = { ...res.data.settings };
  } catch (e) { window.$message.error(e.message); }
  finally { loading.value = false; }
}

async function save() {
  saving.value = true;
  try {
    await api.adminSaveSettings(s.value);
    window.$message.success('站点设置已保存');
    auth.fetchPublicInfo();
  } catch (e) { window.$message.error(e.message); }
  finally { saving.value = false; }
}

function pick(kind) {
  const m = { logo: logoInput, favicon: faviconInput, loginbg: loginbgInput };
  m[kind].value?.click();
}

async function onFile(kind, ev) {
  const file = ev.target.files?.[0];
  ev.target.value = '';
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { window.$message.error('图片不能超过 2MB'); return; }
  if (!/^image\//.test(file.type) && !/\.(ico|svg)$/i.test(file.name)) {
    window.$message.error('请选择图片文件'); return;
  }
  uploading.value[kind] = true;
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
    const res = await api.adminUploadAsset({ kind, data: dataUrl });
    if (kind === 'logo') s.value.site_logo = res.data.url;
    else if (kind === 'favicon') s.value.site_favicon = res.data.url;
    else s.value.ui_login_bg = res.data.url;
    // 保存到设置
    const key = kind === 'logo' ? 'site_logo' : kind === 'favicon' ? 'site_favicon' : 'ui_login_bg';
    await api.adminSaveSettings({ [key]: res.data.url });
    auth.fetchPublicInfo();
    window.$message.success('已上传并生效');
  } catch (e) { window.$message.error(e.message); }
  finally { uploading.value[kind] = false; }
}

async function resetAsset(kind) {
  try {
    await api.adminDeleteAsset(kind);
    const key = kind === 'logo' ? 'site_logo' : kind === 'favicon' ? 'site_favicon' : 'ui_login_bg';
    s.value[key] = '';
    window.$message.success('已恢复默认');
    auth.fetchPublicInfo();
  } catch (e) { window.$message.error(e.message); }
}

const faviconUrl = computed(() => s.value.site_favicon || s.value.site_logo || '/favicon.svg');

useSearchFocus(null);
onMounted(load);
</script>

<template>
  <div>
    <PageHeader title="站点设置" subtitle="站点名称、Logo、图标、页脚与公告等基础信息" icon="tabler:world">
      <template #actions>
        <NButton size="small" quaternary @click="load">重置</NButton>
        <NButton type="primary" size="small" :loading="saving" @click="save">保存设置</NButton>
      </template>
    </PageHeader>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
      <!-- 基础信息 -->
      <div class="tg-card p-5">
        <div class="tg-section-title mb-4">
          <NIcon size="16" class="mr-1 align-[-3px]"><Icon icon="tabler:info-circle" /></NIcon>
          基础信息
        </div>
        <NForm label-placement="top">
          <NFormItem label="站点名称">
            <NInput v-model:value="s.site_name" placeholder="显示在侧边栏、登录页与邮件中" />
          </NFormItem>
          <NFormItem label="站点描述">
            <NInput v-model:value="s.site_desc" type="textarea" :autosize="{ minRows: 2 }" />
          </NFormItem>
          <NFormItem label="关键词（SEO）">
            <NInput v-model:value="s.site_keywords" placeholder="TG代理,MTProto,免费代理" />
          </NFormItem>
          <NFormItem label="页脚版权信息">
            <NInput v-model:value="s.site_footer" placeholder="例如：© 2026 TG 代理平台 · 保留所有权利" />
          </NFormItem>
          <div class="grid grid-cols-2 gap-3">
            <NFormItem label="ICP 备案号">
              <NInput v-model:value="s.icp" placeholder="选填" />
            </NFormItem>
            <NFormItem label="客服 TG">
              <NInput v-model:value="s.support_contact" placeholder="@username" />
            </NFormItem>
          </div>
          <NFormItem label="客服邮箱">
            <NInput v-model:value="s.support_email" placeholder="用于用户联系" />
          </NFormItem>
        </NForm>
      </div>

      <!-- 品牌图标 -->
      <div class="tg-card p-5">
        <div class="tg-section-title mb-4">
          <NIcon size="16" class="mr-1 align-[-3px]"><Icon icon="tabler:photo" /></NIcon>
          品牌图标
        </div>

        <!-- Logo -->
        <div class="asset-row" data-search-anchor="site-logo">
          <div class="asset-preview logo-preview">
            <img v-if="s.site_logo" :src="s.site_logo" alt="logo" />
            <NIcon v-else size="22" class="tg-text-3"><Icon icon="tabler:photo-off" /></NIcon>
          </div>
          <div class="flex-1 min-w-0">
            <div class="text-[13.5px] font-medium">站点 Logo</div>
            <div class="text-xs tg-text-3">显示在侧边栏顶部，建议 1:1 方形，≤2MB</div>
          </div>
          <div class="flex gap-1.5 flex-shrink-0">
            <NButton size="tiny" :loading="uploading.logo" @click="pick('logo')">上传</NButton>
            <NButton v-if="s.site_logo" size="tiny" quaternary type="error" @click="resetAsset('logo')">移除</NButton>
          </div>
          <input ref="logoInput" type="file" accept="image/*" class="hidden" @change="onFile('logo', $event)" />
        </div>

        <!-- Favicon -->
        <div class="asset-row" data-search-anchor="site-favicon">
          <div class="asset-preview">
            <img :src="faviconUrl" alt="favicon" />
          </div>
          <div class="flex-1 min-w-0">
            <div class="text-[13.5px] font-medium">网站图标（Favicon）</div>
            <div class="text-xs tg-text-3">浏览器标签页图标，PNG / SVG / ICO</div>
          </div>
          <div class="flex gap-1.5 flex-shrink-0">
            <NButton size="tiny" :loading="uploading.favicon" @click="pick('favicon')">上传</NButton>
            <NButton v-if="s.site_favicon" size="tiny" quaternary type="error" @click="resetAsset('favicon')">移除</NButton>
          </div>
          <input ref="faviconInput" type="file" accept="image/*,.ico" class="hidden" @change="onFile('favicon', $event)" />
        </div>

        <!-- 登录背景 -->
        <div class="asset-row" data-search-anchor="site-loginbg">
          <div class="asset-preview wide">
            <img v-if="s.ui_login_bg" :src="s.ui_login_bg" alt="login bg" />
            <NIcon v-else size="20" class="tg-text-3"><Icon icon="tabler:wallpaper" /></NIcon>
          </div>
          <div class="flex-1 min-w-0">
            <div class="text-[13.5px] font-medium">登录页背景图</div>
            <div class="text-xs tg-text-3">显示在登录页左侧品牌区</div>
          </div>
          <div class="flex gap-1.5 flex-shrink-0">
            <NButton size="tiny" :loading="uploading.loginbg" @click="pick('loginbg')">上传</NButton>
            <NButton v-if="s.ui_login_bg" size="tiny" quaternary type="error" @click="resetAsset('loginbg')">移除</NButton>
          </div>
          <input ref="loginbgInput" type="file" accept="image/*" class="hidden" @change="onFile('loginbg', $event)" />
        </div>

        <NAlert type="info" :bordered="false" class="mt-4">
          图片上传后会立即生效并保存。支持 PNG / JPG / SVG / WEBP / ICO，单张不超过 2MB。
        </NAlert>
      </div>

      <!-- 全站公告 -->
      <div class="tg-card p-5 lg:col-span-2">
        <div class="flex items-center justify-between mb-4">
          <div class="tg-section-title">
            <NIcon size="16" class="mr-1 align-[-3px]"><Icon icon="tabler:speakerphone" /></NIcon>
            全站公告条
          </div>
          <NButton size="tiny" text type="primary" tag="a" href="/admin/notices">
            管理多条公告 <NIcon size="12"><Icon icon="tabler:chevron-right" /></NIcon>
          </NButton>
        </div>
        <NInput
          v-model:value="s.announcement" type="textarea" :autosize="{ minRows: 2, maxRows: 4 }"
          placeholder="显示在用户仪表盘顶部的公告文字，留空则不显示"
        />
        <div class="flex items-center justify-between mt-3 pt-3 border-t tg-divider">
          <div>
            <div class="text-[13.5px] font-medium">在登录页展示站点统计</div>
            <div class="text-xs tg-text-3">显示注册用户数与节点数</div>
          </div>
          <NSwitch :value="s.show_public_status === '1'" size="small" @update:value="toggle('show_public_status')" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.asset-row {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 0; border-bottom: 1px dashed var(--tg-border);
}
.asset-row:last-of-type { border-bottom: none; }
.asset-preview {
  width: 44px; height: 44px; border-radius: 10px;
  border: 1px solid var(--tg-border);
  background: var(--tg-surface-2);
  display: grid; place-items: center; overflow: hidden; flex-shrink: 0;
}
.asset-preview.wide { width: 68px; }
.asset-preview.logo-preview { background: linear-gradient(140deg, #3b6df6, #1d3cd8); }
.asset-preview img { width: 100%; height: 100%; object-fit: contain; }
.asset-preview.logo-preview img { object-fit: cover; }
.hidden { display: none; }
</style>
