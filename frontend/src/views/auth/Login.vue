<script setup>
import { reactive, ref, onMounted, computed } from 'vue';
import {
  NForm, NFormItem, NInput, NButton, NCheckbox, NIcon, NDivider, NAlert,
} from 'naive-ui';
import { Icon } from '@iconify/vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useThemeStore } from '@/stores/theme';
import Captcha from '@/components/common/Captcha.vue';

const auth = useAuthStore();
const theme = useThemeStore();
const route = useRoute();
const router = useRouter();

const formRef = ref(null);
const loading = ref(false);
const errorMsg = ref('');
const captcha = ref(null);
const captchaRef = ref(null);

const form = reactive({
  username: localStorage.getItem('tgproxy_last_user') || '',
  password: '',
  remember: true,
});

const rules = {
  username: { required: true, message: '请输入用户名', trigger: ['input', 'blur'] },
  password: { required: true, message: '请输入密码', trigger: ['input', 'blur'] },
};

const brandName = computed(() => auth.info.site_name || 'TG 代理申请平台');

async function submit() {
  try {
    await formRef.value?.validate();
  } catch { return; }
  loading.value = true;
  errorMsg.value = '';
  try {
    const user = await auth.login({ username: form.username.trim(), password: form.password, captcha: captchaRef.value?.getValue() || captcha.value });
    if (form.remember) localStorage.setItem('tgproxy_last_user', form.username.trim());
    window.$message.success(`欢迎回来，${user.username}`);
    const redirect = route.query.redirect ? decodeURIComponent(route.query.redirect) : '/dashboard';
    router.replace(redirect);
  } catch (e) {
    errorMsg.value = e.message;
    captchaRef.value?.refresh();
  } finally {
    loading.value = false;
  }
}

onMounted(() => { auth.fetchPublicInfo(); });
</script>

<template>
  <div class="auth-page" :class="{ centered: auth.info.ui_login_style === 'center' }">
    <!-- 左侧品牌区（桌面端） -->
    <div
      v-if="auth.info.ui_login_style !== 'center'"
      class="auth-hero"
      :style="auth.info.ui_login_bg ? { backgroundImage: `linear-gradient(145deg, rgba(27,58,184,0.88), rgba(59,109,246,0.75)), url(${auth.info.ui_login_bg})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}"
    >
      <div class="hero-inner">
        <div class="flex items-center gap-3">
          <div class="hero-logo">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none">
              <path d="M20.6 4.1 3.4 10.9c-.7.3-.7 1.3.1 1.5l4.3 1.3 1.6 5.1c.2.6 1 .8 1.4.3l2.4-2.6 4.4 3.2c.5.4 1.3.1 1.5-.6l3.2-13c.2-.8-.6-1.5-1.3-1.2Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
              <path d="m8 13.7 8.5-6.3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
            </svg>
          </div>
          <div class="text-white">
            <div class="text-lg font-semibold leading-tight">MTProto Proxy</div>
            <div class="text-xs text-white/70 tracking-wider">TG 免费代理申请平台</div>
          </div>
        </div>

        <h2 class="hero-slogan">
          自助申请 <span class="text-white">Telegram 代理</span><br />
          流量分配 · 实时监控 · 安全管理
        </h2>
        <p class="hero-desc">
          一键生成专属 MTProto 代理链接，扫码或点击即可导入 Telegram。
          后台可对每位用户、每个代理独立管控流量额度、有效期与在线状态。
        </p>

        <div class="hero-points">
          <div class="hero-point">
            <NIcon size="16"><Icon icon="tabler:bolt" /></NIcon>
            <span>独立端口与密钥，互不干扰</span>
          </div>
          <div class="hero-point">
            <NIcon size="16"><Icon icon="tabler:chart-bar" /></NIcon>
            <span>每 30 秒采集一次流量用量</span>
          </div>
          <div class="hero-point">
            <NIcon size="16"><Icon icon="tabler:shield-check" /></NIcon>
            <span>超额自动停用，杜绝滥用</span>
          </div>
        </div>
      </div>
      <div class="hero-grid" />
    </div>

    <!-- 右侧表单区 -->
    <div class="auth-panel">
      <div class="auth-topbar">
        <NButton quaternary circle @click="theme.toggleDark()">
          <template #icon><NIcon size="18"><Icon :icon="theme.dark ? 'tabler:sun' : 'tabler:moon'" /></NIcon></template>
        </NButton>
      </div>

      <div class="auth-card">
        <div class="lg:hidden flex items-center gap-2.5 mb-6">
          <div class="hero-logo small">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
              <path d="M20.6 4.1 3.4 10.9c-.7.3-.7 1.3.1 1.5l4.3 1.3 1.6 5.1c.2.6 1 .8 1.4.3l2.4-2.6 4.4 3.2c.5.4 1.3.1 1.5-.6l3.2-13c.2-.8-.6-1.5-1.3-1.2Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
            </svg>
          </div>
          <div>
            <div class="font-semibold leading-tight">{{ brandName }}</div>
            <div class="text-xs tg-text-3">MTProto Proxy</div>
          </div>
        </div>

        <h1 class="text-[26px] font-semibold tracking-tight">登录</h1>
        <p class="tg-text-2 text-[13.5px] mt-1 mb-6">使用你的账号登录，管理专属代理与流量</p>

        <NAlert v-if="errorMsg" type="error" :bordered="false" class="mb-4" closable @close="errorMsg = ''">
          {{ errorMsg }}
        </NAlert>

        <NForm ref="formRef" :model="form" :rules="rules" label-placement="top" size="large" @keydown.enter.prevent="submit">
          <NFormItem label="用户名" path="username">
            <NInput v-model:value="form.username" placeholder="请输入用户名" autocomplete="username">
              <template #prefix><NIcon size="16" class="tg-text-3"><Icon icon="tabler:user" /></NIcon></template>
            </NInput>
          </NFormItem>
          <NFormItem label="密码" path="password">
            <NInput
              v-model:value="form.password"
              type="password"
              show-password-on="click"
              placeholder="请输入密码"
              autocomplete="current-password"
            >
              <template #prefix><NIcon size="16" class="tg-text-3"><Icon icon="tabler:lock" /></NIcon></template>
            </NInput>
          </NFormItem>
          <Captcha ref="captchaRef" v-model="captcha" scene="login" />
          <div class="flex items-center justify-between mb-4 -mt-1">
            <NCheckbox v-model:checked="form.remember" size="small">记住用户名</NCheckbox>
            <span class="text-xs tg-text-3">忘记密码请联系 {{ auth.info.support_contact || '管理员' }}</span>
          </div>
          <NButton type="primary" block size="large" :loading="loading" attr-type="submit" @click="submit">
            登录
          </NButton>
        </NForm>

        <template v-if="auth.info.register_enabled">
          <NDivider class="!my-5"><span class="text-xs tg-text-3">还没有账号？</span></NDivider>
          <NButton block tertiary size="large" @click="router.push('/register')">
            注册新账号
          </NButton>
        </template>

        <p class="text-center text-xs tg-text-3 mt-8">
          {{ auth.info.site_desc || '免费 Telegram MTProto 代理申请与自助管理平台' }}
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.auth-page {
  display: flex;
  min-height: 100vh;
  min-height: 100dvh;
  background: var(--tg-surface);
}
.auth-hero {
  flex: 1.05;
  position: relative;
  overflow: hidden;
  background: linear-gradient(145deg, #1b3ab8 0%, #2450eb 45%, #3b6df6 100%);
  padding: 48px;
  display: flex;
  align-items: center;
}
@media (max-width: 1023px) { .auth-hero { display: none; } }
.hero-grid {
  position: absolute;
  inset: 0;
  background-image: linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px);
  background-size: 44px 44px;
  mask-image: radial-gradient(circle at 30% 30%, #000 0%, transparent 75%);
  -webkit-mask-image: radial-gradient(circle at 30% 30%, #000 0%, transparent 75%);
}
.hero-inner { position: relative; z-index: 1; max-width: 480px; }
.hero-logo {
  width: 44px; height: 44px;
  border-radius: 12px;
  display: grid; place-items: center;
  background: rgba(255,255,255,0.14);
  border: 1px solid rgba(255,255,255,0.22);
  color: #fff;
}
.hero-logo.small { width: 36px; height: 36px; border-radius: 10px; background: linear-gradient(140deg, #3b6df6, #1d3cd8); border: none; }
.hero-slogan { font-size: 32px; line-height: 1.3; font-weight: 600; color: rgba(255,255,255,0.82); margin: 40px 0 16px; letter-spacing: -0.02em; }
.hero-desc { color: rgba(255,255,255,0.72); font-size: 14px; line-height: 1.75; max-width: 420px; }
.hero-points { display: flex; flex-direction: column; gap: 10px; margin-top: 32px; }
.hero-point {
  display: flex; align-items: center; gap: 9px;
  color: rgba(255,255,255,0.86); font-size: 13px;
}
.hero-point :deep(svg) { color: #a9c4ff; }

.auth-page.centered { background: var(--tg-bg); align-items: center; justify-content: center; }
.auth-page.centered .auth-panel { flex: none; background: transparent; }
.auth-page.centered .auth-card {
  background: var(--tg-surface);
  border: 1px solid var(--tg-border);
  border-radius: 14px;
  box-shadow: 0 12px 40px rgba(16, 24, 40, 0.08);
}
.auth-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  position: relative;
  background: var(--tg-surface);
}
.auth-topbar { position: absolute; top: 14px; right: 14px; z-index: 2; }
.auth-card {
  margin: auto;
  width: 100%;
  max-width: 400px;
  padding: 32px 24px;
}
@media (max-width: 1023px) {
  .auth-panel { padding: 24px 0; }
  .auth-card { padding: 24px 20px; }
}
</style>
