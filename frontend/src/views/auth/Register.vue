<script setup>
import { reactive, ref, computed, onMounted } from 'vue';
import { NForm, NFormItem, NInput, NButton, NIcon, NAlert, NDivider, NCheckbox } from 'naive-ui';
import { Icon } from '@iconify/vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import Captcha from '@/components/common/Captcha.vue';
import { api } from '@/api';

const auth = useAuthStore();
const router = useRouter();
const formRef = ref(null);
const loading = ref(false);
const emailReq = ref(false);
const emailTicket = ref('');
const codeSent = ref(false);
const codeInput = ref('');
const sendingCode = ref(false);
const cooldown = ref(0);
const verifying = ref(false);
const emailVerified = ref(false);
const errorMsg = ref('');
const captcha = ref(null);
const captchaRef = ref(null);

const form = reactive({ username: '', password: '', confirm: '', email: '', agree: false });

async function loadEmailStatus() {
  try {
    const res = await api.emailStatus();
    emailReq.value = res.data.required;
  } catch { /* ignore */ }
}

function startCooldown(sec = 60) {
  cooldown.value = sec;
  const t = setInterval(() => { cooldown.value--; if (cooldown.value <= 0) clearInterval(t); }, 1000);
}

async function sendCode() {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(form.email.trim())) { window.$message.warning('请先填写有效邮箱'); return; }
  sendingCode.value = true;
  try {
    const res = await api.sendEmailCode(form.email.trim());
    window.$message.success(res.message);
    codeSent.value = true;
    startCooldown(60);
  } catch (e) { window.$message.error(e.message); }
  finally { sendingCode.value = false; }
}

async function verifyEmail() {
  if (!codeInput.value.trim()) { window.$message.warning('请输入验证码'); return; }
  verifying.value = true;
  try {
    const res = await api.verifyEmailCode(form.email.trim(), codeInput.value.trim());
    emailTicket.value = res.data.ticket;
    emailVerified.value = true;
    window.$message.success('邮箱验证成功');
  } catch (e) { window.$message.error(e.message); }
  finally { verifying.value = false; }
}

const rules = {
  username: [
    { required: true, message: '请输入用户名', trigger: ['input', 'blur'] },
    { pattern: /^[a-zA-Z0-9_.-]{3,32}$/, message: '3-32 位字母、数字、下划线', trigger: ['input', 'blur'] },
  ],
  password: [
    { required: true, message: '请输入密码', trigger: ['input', 'blur'] },
    { min: 6, message: '密码至少 6 位', trigger: ['input', 'blur'] },
  ],
  confirm: [
    { required: true, message: '请再次输入密码', trigger: ['input', 'blur'] },
    {
      validator: (_r, v) => v === form.password || new Error('两次输入的密码不一致'),
      trigger: ['input', 'blur'],
    },
  ],
};

const canRegister = computed(() => auth.info.register_enabled);

async function submit() {
  if (!form.agree) { window.$message.warning('请先阅读并同意使用条款'); return; }
  try { await formRef.value?.validate(); } catch { return; }
  loading.value = true;
  errorMsg.value = '';
  try {
    await auth.register({ username: form.username.trim(), password: form.password, email: form.email.trim(), emailTicket: emailTicket.value, captcha: captchaRef.value?.getValue() || captcha.value });
    window.$message.success('注册成功，已自动登录');
    router.replace('/dashboard');
  } catch (e) {
    errorMsg.value = e.message;
    captchaRef.value?.refresh();
  } finally {
    loading.value = false;
  }
}
onMounted(loadEmailStatus);
</script>

<template>
  <div class="reg-wrap">
    <div class="reg-card tg-card">
      <div class="flex items-center gap-2.5 mb-6">
        <div class="logo">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
            <path d="M20.6 4.1 3.4 10.9c-.7.3-.7 1.3.1 1.5l4.3 1.3 1.6 5.1c.2.6 1 .8 1.4.3l2.4-2.6 4.4 3.2c.5.4 1.3.1 1.5-.6l3.2-13c.2-.8-.6-1.5-1.3-1.2Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
          </svg>
        </div>
        <div>
          <div class="font-semibold leading-tight">{{ auth.info.site_name || 'TG 代理申请平台' }}</div>
          <div class="text-xs tg-text-3">创建账号，免费获取 MTProto 代理</div>
        </div>
      </div>

      <NAlert v-if="!canRegister" type="warning" :bordered="false" class="mb-4">
        当前平台已暂停开放注册，请联系 {{ auth.info.support_contact || '管理员' }} 开通账号。
      </NAlert>
      <NAlert v-if="errorMsg" type="error" :bordered="false" class="mb-4" closable @close="errorMsg = ''">{{ errorMsg }}</NAlert>

      <NForm ref="formRef" :model="form" :rules="rules" label-placement="top" @keydown.enter.prevent="submit">
        <NFormItem label="用户名" path="username">
          <NInput v-model:value="form.username" placeholder="3-32 位字母、数字、下划线" :maxlength="32" />
        </NFormItem>
        <NFormItem label="密码" path="password">
          <NInput v-model:value="form.password" type="password" show-password-on="click" placeholder="至少 6 位" />
        </NFormItem>
        <NFormItem label="确认密码" path="confirm">
          <NInput v-model:value="form.confirm" type="password" show-password-on="click" placeholder="再次输入密码" />
        </NFormItem>
        <NFormItem :label="emailReq ? '邮箱（必填并验证）' : '邮箱（选填）'" path="email">
          <div class="w-full">
            <div class="flex gap-2">
              <NInput v-model:value="form.email" placeholder="用于接收验证码与流量提醒" :disabled="emailVerified" />
              <NButton v-if="emailReq && !emailVerified" :loading="sendingCode" :disabled="cooldown > 0" @click="sendCode" style="width: 110px">
                {{ cooldown > 0 ? cooldown + 's' : (codeSent ? '重发' : '发送验证码') }}
              </NButton>
            </div>
            <div v-if="emailReq && codeSent && !emailVerified" class="flex gap-2 mt-2">
              <NInput v-model:value="codeInput" placeholder="输入邮箱验证码" :maxlength="10" @keyup.enter="verifyEmail" />
              <NButton type="primary" secondary :loading="verifying" @click="verifyEmail" style="width: 110px">验证</NButton>
            </div>
            <div v-if="emailVerified" class="text-xs text-green-600 mt-1 flex items-center gap-1">
              <NIcon size="13"><Icon icon="tabler:circle-check" /></NIcon> 邮箱已验证
            </div>
          </div>
        </NFormItem>
        <Captcha ref="captchaRef" v-model="captcha" scene="register" class="!mb-3" />
        <NCheckbox v-model:checked="form.agree" size="small" class="!mb-4">
          <span class="text-xs tg-text-2">我已阅读并同意平台使用条款，承诺不用于任何违法违规用途</span>
        </NCheckbox>
        <NButton type="primary" block size="large" :loading="loading" :disabled="!canRegister" @click="submit">
          注册并登录
        </NButton>
      </NForm>

      <NDivider class="!my-5" />
      <div class="text-center">
        <span class="text-xs tg-text-3">已有账号？</span>
        <NButton text type="primary" size="small" class="!ml-1" @click="router.push('/login')">返回登录</NButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.reg-wrap {
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 16px;
  background: var(--tg-bg);
}
.reg-card { width: 100%; max-width: 420px; padding: 28px 24px; }
.logo {
  width: 36px; height: 36px; border-radius: 10px;
  display: grid; place-items: center;
  background: linear-gradient(140deg, #3b6df6, #1d3cd8);
  color: #fff;
}
</style>
