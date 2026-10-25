<script setup>
import { ref, onMounted, computed, shallowRef } from 'vue';
import {
  NButton, NIcon, NInput, NSelect, NSwitch, NRadioGroup, NRadio, NAlert, NSpin, NTag,
} from 'naive-ui';
import { Icon } from '@iconify/vue';
import PageHeader from '@/components/common/PageHeader.vue';
import { api } from '@/api';
import { useSearchFocus } from '@/composables/useSearchFocus';

const loading = ref(true);
const saving = ref(false);
const s = ref({});
const status = ref(null);
const demo = shallowRef(null);
const demoLoading = ref(false);
const demoAnswer = ref('');
const demoResult = ref('');

const providers = [
  { label: '算术题（最轻量，推荐）', value: 'math' },
  { label: '图形验证码（干扰线 + 噪点）', value: 'image' },
  { label: '拖动滑块', value: 'slider' },
  { label: 'hCaptcha（需密钥）', value: 'hcaptcha' },
  { label: 'Cloudflare Turnstile（需密钥）', value: 'turnstile' },
  { label: 'Google reCAPTCHA（需密钥）', value: 'recaptcha' },
];

const selfHosted = computed(() => ['math', 'image', 'slider'].includes(s.value.captcha_provider));
const needThirdPartyKey = computed(() => ['hcaptcha', 'turnstile', 'recaptcha'].includes(s.value.captcha_provider));

function toggle(k) { s.value[k] = s.value[k] === '1' ? '0' : '1'; }

async function load() {
  loading.value = true;
  try {
    const [res, st] = await Promise.all([api.adminSettings(), api.captchaStatus()]);
    s.value = { ...res.data.settings };
    status.value = st.data;
    await loadDemo();
  } catch (e) { window.$message.error(e.message); }
  finally { loading.value = false; }
}

/** 用当前表单配置实时生成一个示例挑战 */
async function loadDemo() {
  demoLoading.value = true;
  demoAnswer.value = '';
  demoResult.value = '';
  try {
    // 先临时保存当前配置（预览需要服务端按当前 provider 生成）
    await api.adminSaveSettings({
      captcha_enabled: s.value.captcha_enabled,
      captcha_provider: s.value.captcha_provider,
      captcha_difficulty: s.value.captcha_difficulty,
    });
    const res = await api.captchaChallenge('login');
    demo.value = res.data;
  } catch (e) { demoResult.value = e.message; }
  finally { demoLoading.value = false; }
}

async function save() {
  saving.value = true;
  try {
    await api.adminSaveSettings(s.value);
    window.$message.success('人机验证设置已保存');
    await load();
  } catch (e) { window.$message.error(e.message); }
  finally { saving.value = false; }
}

useSearchFocus(null);
onMounted(load);
</script>

<template>
  <div>
    <PageHeader title="人机验证" subtitle="防刷注册与暴力破解的图形验证，支持多种验证方式" icon="tabler:shield-lock">
      <template #actions>
        <NButton size="small" quaternary @click="load">重置</NButton>
        <NButton type="primary" size="small" :loading="saving" @click="save">保存设置</NButton>
      </template>
    </PageHeader>

    <NSpin :show="loading">
      <div class="grid grid-cols-1 xl:grid-cols-[1fr_400px] gap-3 items-start">
        <div class="flex flex-col gap-3">
          <div class="tg-card p-5">
            <div class="flex items-center justify-between mb-4">
              <div class="tg-section-title">
                <NIcon size="16" class="mr-1 align-[-3px]"><Icon icon="tabler:toggle-right" /></NIcon>
                总开关与验证方式
              </div>
              <div class="flex items-center gap-2">
                <span class="text-xs tg-text-3">启用验证码</span>
                <NSwitch :value="s.captcha_enabled === '1'" size="small" @update:value="toggle('captcha_enabled')" />
              </div>
            </div>
            <div data-search-anchor="captcha-provider" class="row">
              <div>
                <div class="row-title">验证方式</div>
                <div class="row-desc">自建方式无需任何第三方服务</div>
              </div>
              <NSelect
                :value="s.captcha_provider" :options="providers" style="width: 260px" size="small"
                @update:value="(v) => { s.captcha_provider = v; loadDemo(); }"
              />
            </div>
            <div class="row">
              <div>
                <div class="row-title">难度</div>
                <div class="row-desc">影响题目范围、验证码长度与滑块容差</div>
              </div>
              <NRadioGroup
                :value="s.captcha_difficulty" size="small"
                @update:value="(v) => { s.captcha_difficulty = v; loadDemo(); }"
              >
                <NRadio value="1">简单</NRadio>
                <NRadio value="2">普通</NRadio>
                <NRadio value="3">困难</NRadio>
              </NRadioGroup>
            </div>
            <NAlert v-if="selfHosted" type="success" :bordered="false" class="mt-3">
              当前使用<b>自建验证码</b>，完全离线生成与校验，无需注册任何第三方服务。
            </NAlert>
            <NAlert v-else-if="needThirdPartyKey" type="warning" :bordered="false" class="mt-3">
              使用第三方验证需要填写下方的 Site Key 与 Secret Key，否则用户将无法完成验证。
            </NAlert>
          </div>

          <div class="tg-card p-5">
            <div class="tg-section-title mb-4">
              <NIcon size="16" class="mr-1 align-[-3px]"><Icon icon="tabler:shield-check" /></NIcon>
              验证场景
            </div>
            <div class="row">
              <div>
                <div class="row-title">登录</div>
                <div class="row-desc">防止暴力破解密码</div>
              </div>
              <NSwitch :value="s.captcha_login === '1'" size="small" @update:value="toggle('captcha_login')" />
            </div>
            <div class="row">
              <div>
                <div class="row-title">注册</div>
                <div class="row-desc">防止批量注册与垃圾账号</div>
              </div>
              <NSwitch :value="s.captcha_register === '1'" size="small" @update:value="toggle('captcha_register')" />
            </div>
            <div class="row">
              <div>
                <div class="row-title">提交流量申请</div>
                <div class="row-desc">防止恶意刷申请</div>
              </div>
              <NSwitch :value="s.captcha_ticket === '1'" size="small" @update:value="toggle('captcha_ticket')" />
            </div>
            <NAlert type="info" :bordered="false" class="mt-3">
              提示：管理员登录也会受验证码约束；若忘记配置导致无法登录，可直接在服务器执行
              <code class="tg-code">sqlite3 /opt/tgproxy/backend/data/app.db "update settings set value='0' where key='captcha_enabled'"</code>
              关闭验证码。
            </NAlert>
          </div>

          <div v-if="needThirdPartyKey" class="tg-card p-5">
            <div class="tg-section-title mb-4">
              <NIcon size="16" class="mr-1 align-[-3px]"><Icon icon="tabler:key" /></NIcon>
              第三方密钥
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div class="key-field">
                <div class="text-xs tg-text-3 mb-1">hCaptcha Site Key</div>
                <NInput v-model:value="s.captcha_hcaptcha_site" size="small" placeholder="10000000-ffff-ffff-ffff-000000000001" />
                <div class="text-xs tg-text-3 mt-1">Secret Key</div>
                <NInput v-model:value="s.captcha_hcaptcha_secret" size="small" type="password" show-password-on="click" placeholder="0x..." />
              </div>
              <div class="key-field">
                <div class="text-xs tg-text-3 mb-1">Turnstile Site Key</div>
                <NInput v-model:value="s.captcha_turnstile_site" size="small" placeholder="0x4AAAAAAA..." />
                <div class="text-xs tg-text-3 mt-1">Secret Key</div>
                <NInput v-model:value="s.captcha_turnstile_secret" size="small" type="password" show-password-on="click" />
              </div>
              <div class="key-field">
                <div class="text-xs tg-text-3 mb-1">reCAPTCHA v2 Site Key</div>
                <NInput v-model:value="s.captcha_recaptcha_site" size="small" placeholder="6Lc..." />
                <div class="text-xs tg-text-3 mt-1">Secret Key</div>
                <NInput v-model:value="s.captcha_recaptcha_secret" size="small" type="password" show-password-on="click" />
              </div>
            </div>
          </div>
        </div>

        <!-- 实时预览 -->
        <div class="tg-card p-4">
          <div class="flex items-center justify-between mb-3">
            <div class="tg-section-title">效果预览</div>
            <NButton size="tiny" quaternary :loading="demoLoading" @click="loadDemo">
              <template #icon><NIcon size="14"><Icon icon="tabler:refresh" /></NIcon></template>
              刷新
            </NButton>
          </div>
          <div v-if="demoLoading" class="py-8 text-center text-xs tg-text-3">生成中…</div>
          <div v-else-if="demo" class="demo-box">
            <template v-if="demo.kind === 'math'">
              <div class="demo-q">{{ demo.question }}</div>
            </template>
            <template v-else-if="demo.kind === 'image'">
              <img :src="demo.image" alt="验证码" class="demo-img" />
            </template>
            <template v-else-if="demo.kind === 'slider'">
              <div class="demo-slider">
                <div class="demo-gap" :style="{ left: demo.target + 'px', width: demo.gaps + 'px' }" />
                <div class="demo-thumb"><NIcon size="13"><Icon icon="tabler:arrows-horizontal" /></NIcon></div>
              </div>
              <div class="text-xs tg-text-3 mt-2 text-center">拖动到虚线缺口处（容差 ±{{ demo.gaps > 44 ? 14 : demo.gaps > 30 ? 10 : 7 }}px）</div>
            </template>
            <template v-else>
              <div class="text-xs tg-text-3">第三方组件：{{ demo.kind }}（需在密钥配置后由前端渲染）</div>
            </template>
            <NTag v-if="demo.kind !== 'slider'" size="small" :bordered="false" class="mt-3">
              有效期 {{ demo.expires_in }} 秒
            </NTag>
          </div>
          <div class="text-xs tg-text-3 mt-3 leading-relaxed">
            预览会使用当前选中的验证方式与难度实时生成，保存后对真实登录/注册生效。
          </div>
          <div class="mt-3 pt-3 border-t tg-divider">
            <div class="text-xs tg-text-3">今日已签发验证挑战</div>
            <div class="text-lg font-semibold">{{ status?.today ?? 0 }}</div>
          </div>
        </div>
      </div>
    </NSpin>
  </div>
</template>

<style scoped>
.row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 0; border-bottom: 1px dashed var(--tg-border); }
.row:last-child { border-bottom: none; }
.row-title { font-size: 13.5px; font-weight: 500; }
.row-desc { font-size: 12px; color: var(--tg-text-3); margin-top: 1px; }
.key-field { background: var(--tg-surface-2); border: 1px solid var(--tg-border); border-radius: 8px; padding: 10px; }
.demo-box { display: flex; flex-direction: column; align-items: center; padding: 16px 8px; background: var(--tg-surface-2); border: 1px solid var(--tg-border); border-radius: 9px; }
.demo-q { font-size: 22px; font-weight: 600; letter-spacing: .06em; font-variant-numeric: tabular-nums; }
.demo-img { width: 132px; height: 44px; border-radius: 6px; }
.demo-slider { position: relative; width: 280px; height: 40px; border-radius: 8px; background: var(--tg-surface); border: 1px solid var(--tg-border); }
.demo-gap { position: absolute; top: 50%; transform: translateY(-50%); height: 22px; border-radius: 4px; background: color-mix(in srgb, var(--tg-brand) 18%, transparent); border: 1px dashed var(--tg-brand); }
.demo-thumb { position: absolute; left: 4px; top: 4px; width: 30px; height: 30px; border-radius: 6px; background: var(--tg-surface-2); border: 1px solid var(--tg-border-strong); display: grid; place-items: center; color: var(--tg-text-2); }
</style>
