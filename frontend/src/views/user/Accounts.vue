<script setup>
import { ref, computed, onMounted, h } from 'vue';
import {
  NButton, NIcon, NTag, NModal, NInput, NSelect, NForm, NFormItem, NEmpty, NSkeleton,
  NProgress, NDropdown,
} from 'naive-ui';
import { Icon } from '@iconify/vue';
import { useRouter } from 'vue-router';
import PageHeader from '@/components/common/PageHeader.vue';
import CopyButton from '@/components/common/CopyButton.vue';
import QrCode from '@/components/common/QrCode.vue';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { useThemeStore } from '@/stores/theme';
import { fmtBytes, fmtMB, fmtRelative, statusMeta, fmtDate } from '@/utils/format';

const auth = useAuthStore();
const theme = useThemeStore();
const router = useRouter();

const loading = ref(true);
const list = ref([]);
const quotaMb = ref(0);
const nodes = ref([]);
const maxAccounts = ref(3);

const showCreate = ref(false);
const creating = ref(false);
const createForm = ref({ name: '', node_id: null });
const createRef = ref(null);

const detail = ref(null);
const showDetail = ref(false);
const linkVariant = ref('standard');
const currentLinkTme = computed(() => {
  const v = detail.value?.links?.variants;
  return v ? (v[linkVariant.value] || v.standard).tme : '';
});
const detailTab = ref('link');
const testing = ref(null);
const testResult = ref({});

const usedBytes = computed(() => list.value.reduce((s, a) => s + a.used_bytes, 0));
const totalQuota = computed(() => list.value.reduce((s, a) => s + a.quota_mb, 0));
const runningCount = computed(() => list.value.filter((a) => a.state === 'running').length);

async function load() {
  loading.value = true;
  try {
    const [accRes, nodeRes] = await Promise.all([api.myAccounts(), api.nodes()]);
    list.value = accRes.data.list;
    quotaMb.value = accRes.data.quota_mb;
    nodes.value = nodeRes.data.list;
    if (!createForm.value.node_id && nodes.value.length) createForm.value.node_id = nodes.value[0].id;
  } catch (e) {
    window.$message.error(e.message);
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  if (nodes.value.length === 0) {
    window.$message.warning('当前暂无可用节点，请稍后再试');
    return;
  }
  createForm.value = { name: `代理-${list.value.length + 1}`, node_id: nodes.value[0].id };
  showCreate.value = true;
}

async function submitCreate() {
  creating.value = true;
  try {
    const res = await api.createAccount({ name: createForm.value.name, node_id: createForm.value.node_id });
    showCreate.value = false;
    window.$message.success(res.message);
    detail.value = res.data;
    showDetail.value = true;
    await load();
  } catch (e) {
    window.$message.error(e.message);
  } finally {
    creating.value = false;
  }
}

async function toggle(acc) {
  try {
    const res = await api.toggleAccount(acc.id);
    window.$message.success(res.message);
    await load();
    if (detail.value?.id === acc.id) detail.value = res.data;
  } catch (e) { window.$message.error(e.message); }
}

async function rotate(acc) {
  window.$dialog.warning({
    title: '重置密钥',
    content: '重置后原代理链接立即失效，需要在 Telegram 中重新导入新链接。确定继续？',
    positiveText: '重置',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        const res = await api.rotateAccount(acc.id);
        window.$message.success(res.message);
        await load();
        if (detail.value?.id === acc.id) detail.value = res.data;
      } catch (e) { window.$message.error(e.message); }
    },
  });
}

async function remove(acc) {
  window.$dialog.error({
    title: '删除代理',
    content: `确定删除「${acc.name}」吗？删除后不可恢复，流量统计一并清除。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await api.deleteAccount(acc.id);
        window.$message.success('已删除');
        if (detail.value?.id === acc.id) { detail.value = null; showDetail.value = false; }
        await load();
      } catch (e) { window.$message.error(e.message); }
    },
  });
}

async function test(acc) {
  testing.value = acc.id;
  try {
    const res = await api.testAccount(acc.id);
    testResult.value = { [acc.id]: res.data };
    if (res.data.local && res.data.remote) window.$message.success(`节点连通正常（${res.data.remoteMs}ms）`);
    else window.$message.warning('检测未通过，请稍后重试或联系管理员');
  } catch (e) { window.$message.error(e.message); }
  finally { testing.value = null; }
}

function openDetail(acc) {
  detail.value = acc;
  showDetail.value = true;
}

function copyAllLinks(acc) {
  const l = acc.links;
  const text = [
    `代理名称：${acc.name}`,
    `服务器：${l.ip}`,
    `端口：${l.port}`,
    `密钥：${l.secret}`,
    `t.me 链接：${l.tme}`,
    `tg 链接：${l.tg}`,
  ].join('\n');
  navigator.clipboard?.writeText(text).then(
    () => window.$message.success('代理信息已复制'),
    () => window.$message.error('复制失败'),
  );
}

function stateTag(acc) {
  const meta = statusMeta[acc.state] || { text: acc.state, type: 'default' };
  return h(NTag, { size: 'small', type: meta.type, bordered: false }, { default: () => meta.text });
}

onMounted(load);
</script>

<template>
  <div>
    <PageHeader title="我的代理" subtitle="管理你的专属 MTProto 代理，扫码或点击链接即可导入 Telegram" icon="tabler:affiliate">
      <template #actions>
        <NButton size="small" quaternary @click="load">
          <template #icon><NIcon size="15"><Icon icon="tabler:refresh" /></NIcon></template>
          刷新
        </NButton>
        <NButton type="primary" size="small" @click="openCreate">
          <template #icon><NIcon size="15"><Icon icon="tabler:plus" /></NIcon></template>
          新建代理
        </NButton>
      </template>
    </PageHeader>

    <!-- 汇总条 -->
    <div class="tg-card summary">
      <div class="sum-item">
        <div class="sum-label">代理总数</div>
        <div class="sum-value">{{ list.length }} <small>个</small></div>
      </div>
      <div class="sum-sep" />
      <div class="sum-item">
        <div class="sum-label">运行中</div>
        <div class="sum-value text-green-600">{{ runningCount }} <small>个</small></div>
      </div>
      <div class="sum-sep" />
      <div class="sum-item">
        <div class="sum-label">已用流量</div>
        <div class="sum-value">{{ fmtBytes(usedBytes) }}</div>
      </div>
      <div class="sum-sep" />
      <div class="sum-item">
        <div class="sum-label">分配额度</div>
        <div class="sum-value">{{ fmtMB(totalQuota) }}</div>
      </div>
      <div class="sum-sep" />
      <div class="sum-item">
        <div class="sum-label">账户总额度</div>
        <div class="sum-value">{{ fmtMB(quotaMb) }}</div>
      </div>
    </div>

    <!-- 骨架 -->
    <div v-if="loading" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 mt-3">
      <div v-for="i in 3" :key="i" class="tg-card p-4">
        <NSkeleton text width="40%" />
        <NSkeleton text class="mt-3" />
        <NSkeleton height="70px" class="mt-3" :sharp="false" />
      </div>
    </div>

    <NEmpty v-else-if="!list.length" class="py-16" description="你还没有任何代理">
      <template #icon><NIcon size="48" class="tg-text-3"><Icon icon="tabler:affiliate" /></NIcon></template>
      <template #extra>
        <NButton type="primary" @click="openCreate">申请第一个代理</NButton>
      </template>
    </NEmpty>

    <div v-else class="acct-grid mt-3">
      <div v-for="acc in list" :key="acc.id" class="tg-card tg-card-hover acct-card">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <span class="acct-name truncate">{{ acc.name }}</span>
              <component :is="() => stateTag(acc)" />
            </div>
            <div class="text-xs tg-text-3 mt-1 truncate">
              {{ acc.node_name }} · {{ acc.links?.ip }}:{{ acc.port }}
            </div>
          </div>
          <NButton size="tiny" quaternary circle @click="openDetail(acc)">
            <template #icon><NIcon size="16"><Icon icon="tabler:qrcode" /></NIcon></template>
          </NButton>
        </div>

        <div class="mt-3">
          <div class="flex items-center justify-between text-xs mb-1">
            <span class="tg-text-2">流量使用</span>
            <span class="tg-text-2" style="font-variant-numeric: tabular-nums">
              {{ fmtBytes(acc.used_bytes) }} / {{ fmtMB(acc.quota_mb) }}
            </span>
          </div>
          <NProgress
            type="line" :percentage="acc.usage_pct" :show-indicator="false" :height="6"
            :color="acc.usage_pct > 90 ? '#dc2626' : acc.usage_pct > 70 ? '#d97706' : '#2450eb'"
            rail-color="var(--tg-border)"
          />
        </div>

        <div class="flex items-center justify-between mt-3 pt-3 border-t tg-divider text-xs tg-text-3">
          <span><NIcon size="13" class="align-[-2px]"><Icon icon="tabler:clock" /></NIcon> {{ fmtRelative(acc.last_used_at) }}使用</span>
          <span v-if="testResult[acc.id]" :class="testResult[acc.id].remote ? 'text-green-600' : 'text-red-500'">
            {{ testResult[acc.id].remote ? `连通 ${testResult[acc.id].remoteMs}ms` : '连接失败' }}
          </span>
        </div>

        <div class="acct-actions">
          <NButton size="tiny" secondary type="primary" @click="openDetail(acc)">
            <template #icon><NIcon size="14"><Icon icon="tabler:link" /></NIcon></template>
            链接
          </NButton>
          <NButton size="tiny" secondary :loading="testing === acc.id" @click="test(acc)">
            <template #icon><NIcon size="14"><Icon icon="tabler:plug-connected" /></NIcon></template>
            检测
          </NButton>
          <NButton size="tiny" secondary @click="toggle(acc)">
            <template #icon><NIcon size="14"><Icon :icon="acc.status === 'active' ? 'tabler:player-pause' : 'tabler:player-play'" /></NIcon></template>
            {{ acc.status === 'active' ? '停用' : '启用' }}
          </NButton>
          <NDropdown
            trigger="click"
            :options="[
              { label: '重置密钥', key: 'rotate' },
              { label: '申请流量', key: 'ticket' },
              { label: '删除代理', key: 'delete' },
            ]"
            @select="(k) => k === 'rotate' ? rotate(acc) : k === 'delete' ? remove(acc) : router.push('/tickets')"
          >
            <NButton size="tiny" quaternary>
              <template #icon><NIcon size="15"><Icon icon="tabler:dots" /></NIcon></template>
            </NButton>
          </NDropdown>
        </div>
      </div>
    </div>

    <!-- 创建代理 -->
    <NModal v-model:show="showCreate" preset="card" title="新建代理" style="max-width: 460px" :bordered="false" size="small">
      <NForm label-placement="top">
        <NFormItem label="代理名称">
          <NInput v-model:value="createForm.name" placeholder="例如：手机代理" :maxlength="60" />
        </NFormItem>
        <NFormItem label="选择节点">
          <NSelect
            v-model:value="createForm.node_id"
            :options="nodes.map((n) => ({ label: `${n.name}（${n.ip}）`, value: n.id }))"
            placeholder="选择节点"
          />
        </NFormItem>
        <div class="text-xs tg-text-3 bg-[var(--tg-surface-2)] rounded-md p-3 border tg-divider">
          创建后将自动分配独立端口与密钥并立即上线。默认额度取系统设置的「默认分配额度」，超出请提交流量申请。
        </div>
      </NForm>
      <template #footer>
        <div class="flex justify-end gap-2">
          <NButton size="small" @click="showCreate = false">取消</NButton>
          <NButton size="small" type="primary" :loading="creating" @click="submitCreate">创建</NButton>
        </div>
      </template>
    </NModal>

    <!-- 代理详情 -->
    <NModal v-model:show="showDetail" preset="card" style="max-width: 620px" :bordered="false" size="small">
      <template #header>
        <div class="flex items-center gap-2">
          <span>{{ detail?.name }}</span>
          <component v-if="detail" :is="() => stateTag(detail)" />
        </div>
      </template>

      <template v-if="detail">
        <div class="grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-4 items-start">
          <div class="flex flex-col items-center gap-2 qr-box">
            <QrCode :text="detail.links.tme" :size="176" :dark="theme.dark" />
            <div class="text-[11px] tg-text-3 text-center">用 Telegram 扫描二维码<br />自动识别并连接代理</div>
          </div>
          <div class="min-w-0">
            <div class="field">
              <div class="field-label">t.me 分享链接</div>
              <div class="field-val">
                <span class="tg-code truncate">{{ currentLinkTme }}</span>
                <CopyButton :text="currentLinkTme" />
              </div>
            </div>
            <div class="field">
              <div class="field-label">tg:// 深度链接</div>
              <div class="field-val">
                <span class="tg-code truncate">{{ detail.links.tg }}</span>
                <CopyButton :text="detail.links.tg" />
              </div>
            </div>
            <div class="grid grid-cols-3 gap-2 mt-1">
              <div class="mini">
                <div class="field-label">服务器</div>
                <div class="mini-val">{{ detail.links.ip }}</div>
              </div>
              <div class="mini">
                <div class="field-label">端口</div>
                <div class="mini-val">{{ detail.port }}</div>
              </div>
              <div class="mini">
                <div class="field-label">协议</div>
                <div class="mini-val">MTProto</div>
              </div>
            </div>
            <div class="field mt-2">
              <div class="field-label flex items-center justify-between">
                <span>链接格式</span>
                <span class="text-[10.5px] tg-text-3">连不上时请换一种试试</span>
              </div>
              <div class="flex flex-wrap gap-1.5 mb-2">
                <NTag
                  v-for="(v, k) in detail.links.variants" :key="k"
                  size="small" :bordered="false"
                  :type="linkVariant === k ? 'primary' : 'default'"
                  class="cursor-pointer" @click="linkVariant = k"
                >
                  {{ v.label }}
                </NTag>
              </div>
              <div class="field-val">
                <span class="tg-code truncate">{{ currentLinkTme }}</span>
                <CopyButton :text="currentLinkTme" />
              </div>
              <div class="field-val mt-1.5">
                <span class="tg-code truncate">secret: {{ detail.links.variants[linkVariant].tme.split('secret=')[1] }}</span>
                <CopyButton :text="detail.links.variants[linkVariant].tme.split('secret=')[1]" />
              </div>
            </div>
          </div>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4 pt-4 border-t tg-divider">
          <div class="mini"><div class="field-label">已用流量</div><div class="mini-val">{{ fmtBytes(detail.used_bytes) }}</div></div>
          <div class="mini"><div class="field-label">流量额度</div><div class="mini-val">{{ fmtMB(detail.quota_mb) }}</div></div>
          <div class="mini"><div class="field-label">创建时间</div><div class="mini-val">{{ fmtDate(detail.created_at, false) }}</div></div>
          <div class="mini"><div class="field-label">最近使用</div><div class="mini-val">{{ fmtRelative(detail.last_used_at) }}</div></div>
        </div>

        <div class="flex flex-wrap gap-2 mt-4">
          <NButton size="small" type="primary" tag="a" :href="currentLinkTme" target="_blank">
            <template #icon><NIcon size="15"><Icon icon="tabler:brand-telegram" /></NIcon></template>
            一键导入 Telegram
          </NButton>
          <NButton size="small" @click="test(detail)" :loading="testing === detail.id">检测连通</NButton>
          <NButton size="small" @click="copyAllLinks(detail)">复制全部信息</NButton>
          <NButton size="small" quaternary @click="rotate(detail)">重置密钥</NButton>
        </div>
      </template>
    </NModal>
  </div>
</template>

<style scoped>
.summary {
  display: flex;
  align-items: center;
  padding: 14px 18px;
  gap: 8px;
  flex-wrap: wrap;
}
.sum-item { min-width: 92px; }
.sum-label { font-size: 12px; color: var(--tg-text-3); }
.sum-value { font-size: 17px; font-weight: 600; letter-spacing: -0.01em; }
.sum-value small { font-size: 11px; font-weight: 400; color: var(--tg-text-3); }
.sum-sep { width: 1px; height: 26px; background: var(--tg-border); margin: 0 10px; }
@media (max-width: 767px) { .sum-sep { display: none; } .sum-item { flex: 1 0 40%; } }

.acct-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }
@media (max-width: 480px) { .acct-grid { grid-template-columns: 1fr; } }
.acct-card { padding: 14px; display: flex; flex-direction: column; }
.acct-name { font-size: 14.5px; font-weight: 600; }
.acct-actions { display: flex; align-items: center; gap: 6px; margin-top: 10px; flex-wrap: wrap; }

.qr-box { padding: 12px; background: var(--tg-surface-2); border: 1px solid var(--tg-border); border-radius: 10px; }
.field { margin-bottom: 8px; }
.field-label { font-size: 11.5px; color: var(--tg-text-3); margin-bottom: 3px; }
.field-val {
  display: flex; align-items: center; gap: 6px;
  border: 1px solid var(--tg-border);
  background: var(--tg-surface-2);
  border-radius: 7px;
  padding: 5px 8px;
  min-width: 0;
}
.field-val .tg-code { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mini { background: var(--tg-surface-2); border: 1px solid var(--tg-border); border-radius: 7px; padding: 6px 8px; min-width: 0; }
.mini-val { font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
