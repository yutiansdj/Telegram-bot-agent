<script setup>
import { ref, onMounted, computed } from 'vue';
import {
  NButton, NIcon, NInputNumber, NInput, NSelect, NCard, NAlert, NTag, NFormItem, NForm,
} from 'naive-ui';
import { Icon } from '@iconify/vue';
import { useRouter } from 'vue-router';
import PageHeader from '@/components/common/PageHeader.vue';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { fmtBytes, fmtMB } from '@/utils/format';

const auth = useAuthStore();
const router = useRouter();
const loading = ref(true);
const submitting = ref(false);
const accounts = ref([]);
const quotaMb = ref(0);
const used = ref(0);
const form = ref({ amount_mb: 10240, reason: '', account_id: null, target: 'user' });

const presets = [5120, 10240, 20480, 51200, 102400];

const usedPct = computed(() => (quotaMb.value ? Math.min(100, (used.value / 1024 / 1024 / quotaMb.value) * 100) : 0));

async function load() {
  loading.value = true;
  try {
    const res = await api.myAccounts();
    accounts.value = res.data.list;
    quotaMb.value = res.data.quota_mb;
    used.value = accounts.value.reduce((s, a) => s + a.used_bytes, 0);
  } catch (e) { window.$message.error(e.message); }
  finally { loading.value = false; }
}

async function submit() {
  if (!form.value.amount_mb || form.value.amount_mb <= 0) { window.$message.warning('请填写申请流量'); return; }
  submitting.value = true;
  try {
    const payload = { amount_mb: form.value.amount_mb, reason: form.value.reason };
    if (form.value.target === 'account' && form.value.account_id) payload.account_id = form.value.account_id;
    const res = await api.createTicket(payload);
    window.$message.success(res.message);
    form.value.reason = '';
    router.push('/applications');
  } catch (e) { window.$message.error(e.message); }
  finally { submitting.value = false; }
}

onMounted(load);
</script>

<template>
  <div>
    <PageHeader title="流量申请" subtitle="免费申请更多代理流量，提交后由管理员审核发放" icon="tabler:ticket" />

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-3">
      <div class="lg:col-span-2">
        <div class="tg-card p-5">
          <div class="tg-section-title mb-4">填写申请信息</div>
          <NForm label-placement="top">
            <NFormItem label="申请额度（MB）">
              <div class="w-full">
                <NInputNumber v-model:value="form.amount_mb" :min="1" :max="1048576" :step="1024" placeholder="请输入申请流量" class="!w-full" />
                <div class="flex flex-wrap gap-1.5 mt-2">
                  <NTag
                    v-for="p in presets" :key="p"
                    size="small" :bordered="false"
                    :type="form.amount_mb === p ? 'primary' : 'default'"
                    class="cursor-pointer"
                    @click="form.amount_mb = p"
                  >
                    {{ p >= 1024 ? `${p / 1024} GB` : `${p} MB` }}
                  </NTag>
                </div>
              </div>
            </NFormItem>

            <NFormItem label="发放方式">
              <div class="flex gap-2 w-full">
                <div class="opt" :class="{ on: form.target === 'user' }" @click="form.target = 'user'">
                  <NIcon size="18"><Icon icon="tabler:user" /></NIcon>
                  <div>
                    <div class="font-medium text-[13px]">发放到账户总额度</div>
                    <div class="text-xs tg-text-3">所有代理共享该额度</div>
                  </div>
                </div>
                <div class="opt" :class="{ on: form.target === 'account' }" @click="form.target = 'account'">
                  <NIcon size="18"><Icon icon="tabler:affiliate" /></NIcon>
                  <div>
                    <div class="font-medium text-[13px]">发放到指定代理</div>
                    <div class="text-xs tg-text-3">仅增加该代理的额度</div>
                  </div>
                </div>
              </div>
            </NFormItem>

            <NFormItem v-if="form.target === 'account'" label="选择代理">
              <NSelect
                v-model:value="form.account_id"
                :options="accounts.map((a) => ({ label: `${a.name}（端口 ${a.port}）`, value: a.id }))"
                placeholder="请选择代理"
              />
            </NFormItem>

            <NFormItem label="申请理由（选填）">
              <NInput
                v-model:value="form.reason"
                type="textarea"
                :autosize="{ minRows: 3, maxRows: 6 }"
                :maxlength="500"
                show-count
                placeholder="例如：日常使用、团队共享等"
              />
            </NFormItem>
          </NForm>

          <NButton type="primary" :loading="submitting" @click="submit">
            <template #icon><NIcon size="16"><Icon icon="tabler:send" /></NIcon></template>
            提交申请
          </NButton>
        </div>
      </div>

      <div class="flex flex-col gap-3">
        <div class="tg-card p-4">
          <div class="tg-section-title mb-3">当前额度</div>
          <div class="flex items-baseline gap-1">
            <span class="text-[26px] font-semibold">{{ fmtMB(quotaMb) }}</span>
            <span class="text-xs tg-text-3">总额度</span>
          </div>
          <div class="text-xs tg-text-3 mt-1">已用 {{ fmtBytes(used) }}（{{ usedPct.toFixed(1) }}%）</div>
          <div class="mt-3 h-1.5 rounded-full overflow-hidden" style="background: var(--tg-border)">
            <div class="h-full rounded-full transition-all" :style="{ width: usedPct + '%', background: '#2450eb' }" />
          </div>
        </div>

        <div class="tg-card p-4">
          <div class="tg-section-title mb-2">申请须知</div>
          <ul class="notice">
            <li>每位用户最多同时保留 3 条待审核申请</li>
            <li>审核通过后流量立即到账并自动生效</li>
            <li>请合理使用，恶意刷量将被封禁账号</li>
            <li>有疑问可联系平台客服 {{ auth.info.support_contact || '管理员' }}</li>
          </ul>
          <NButton size="small" block tertiary class="!mt-3" @click="router.push('/applications')">
            查看我的申请记录
          </NButton>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.opt {
  flex: 1;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--tg-border);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s ease;
  color: var(--tg-text-2);
}
.opt.on { border-color: #2450eb; background: var(--tg-brand-soft); color: var(--tg-brand); }
.opt.on .tg-text-3 { color: var(--tg-brand); opacity: 0.75; }
.notice { margin: 0; padding-left: 16px; font-size: 12.5px; color: var(--tg-text-2); line-height: 1.9; }
</style>
