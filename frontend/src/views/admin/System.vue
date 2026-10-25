<script setup>
import { ref, onMounted, computed } from 'vue';
import { NButton, NIcon, NProgress, NTag, NSpin } from 'naive-ui';
import { Icon } from '@iconify/vue';
import PageHeader from '@/components/common/PageHeader.vue';
import { api } from '@/api';
import { fmtBytes, fmtUptime, fmtDate, fmtRelative } from '@/utils/format';

const loading = ref(true);
const sys = ref(null);
const dash = ref(null);
const err = ref('');

async function load() {
  loading.value = true;
  err.value = '';
  try {
    const [a, b] = await Promise.all([api.adminSystem(), api.adminDashboard()]);
    sys.value = a.data;
    dash.value = b.data;
  } catch (e) { err.value = e.message; }
  finally { loading.value = false; }
}

const memPct = computed(() => (sys.value ? ((sys.value.memory.total - sys.value.memory.free) / sys.value.memory.total) * 100 : 0));
const diskPct = computed(() => (sys.value ? ((sys.value.disk.total - sys.value.disk.free) / sys.value.disk.total) * 100 : 0));

onMounted(load);
</script>

<template>
  <div>
    <PageHeader title="运行状态" subtitle="平台服务与服务器资源实时监控" icon="tabler:activity">
      <template #actions>
        <NButton size="small" quaternary :loading="loading" @click="load">
          <template #icon><NIcon size="15"><Icon icon="tabler:refresh" /></NIcon></template>
          刷新
        </NButton>
      </template>
    </PageHeader>

    <div v-if="err" class="tg-card p-4 text-red-500 text-sm">{{ err }}</div>

    <NSpin v-else :show="loading">
      <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        <!-- 服务 -->
        <div class="tg-card p-4">
          <div class="card-title"><NIcon size="15"><Icon icon="tabler:cpu" /></NIcon> 服务状态</div>
          <div class="kv"><span>API 服务</span><NTag size="small" type="success" :bordered="false">运行中</NTag></div>
          <div class="kv"><span>代理进程</span><b>{{ sys?.running ?? 0 }} 个</b></div>
          <div class="kv"><span>运行时长</span><b>{{ sys ? fmtUptime(sys.uptime) : '-' }}</b></div>
          <div class="kv"><span>Node 版本</span><b class="font-mono">{{ sys?.node }}</b></div>
          <div class="kv"><span>平台版本</span><b class="font-mono">v{{ sys?.version }}</b></div>
        </div>

        <!-- CPU -->
        <div class="tg-card p-4">
          <div class="card-title"><NIcon size="15"><Icon icon="tabler:chart-line" /></NIcon> CPU 负载</div>
          <div class="big">{{ sys?.cpu.load1?.toFixed(2) ?? '-' }}</div>
          <div class="tg-text-3 text-xs">1 分钟平均负载 · {{ sys?.cpu.cores || 4 }} 核</div>
          <div class="mt-3">
            <NProgress type="line" :percentage="Math.min(100, (sys?.cpu.load1 || 0) / (sys?.cpu.cores || 4) * 100)" :show-indicator="false" :height="6" color="#2450eb" rail-color="var(--tg-border)" />
          </div>
          <div class="kv mt-2"><span>5 分钟</span><b>{{ sys?.cpu.load5?.toFixed(2) ?? '-' }}</b></div>
        </div>

        <!-- 内存 -->
        <div class="tg-card p-4">
          <div class="card-title"><NIcon size="15"><Icon icon="tabler:database" /></NIcon> 内存</div>
          <div class="big">{{ fmtBytes(sys?.memory.total - (sys?.memory.free || 0)) }}</div>
          <div class="tg-text-3 text-xs">共 {{ fmtBytes(sys?.memory.total || 0) }}</div>
          <div class="mt-3">
            <NProgress type="line" :percentage="memPct" :show-indicator="false" :height="6" color="#7c3aed" rail-color="var(--tg-border)" />
          </div>
          <div class="kv mt-2"><span>可用</span><b>{{ fmtBytes(sys?.memory.free || 0) }}</b></div>
        </div>

        <!-- 磁盘 -->
        <div class="tg-card p-4">
          <div class="card-title"><NIcon size="15"><Icon icon="tabler:server-2" /></NIcon> 磁盘</div>
          <div class="big">{{ fmtBytes(sys?.disk.total - (sys?.disk.free || 0)) }}</div>
          <div class="tg-text-3 text-xs">共 {{ fmtBytes(sys?.disk.total || 0) }}</div>
          <div class="mt-3">
            <NProgress type="line" :percentage="diskPct" :show-indicator="false" :height="6" color="#d97706" rail-color="var(--tg-border)" />
          </div>
          <div class="kv mt-2"><span>可用</span><b>{{ fmtBytes(sys?.disk.free || 0) }}</b></div>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-3">
        <div class="tg-card p-5">
          <div class="card-title"><NIcon size="15"><Icon icon="tabler:activity" /></NIcon> Telegram 连通性</div>
          <div class="flex items-center gap-3 mt-3">
            <div class="w-12 h-12 rounded-xl grid place-items-center" :style="{ background: dash?.core.telegram ? 'rgba(22,163,74,.1)' : 'rgba(220,38,38,.1)' }">
              <NIcon size="24" :color="dash?.core.telegram ? '#16a34a' : '#dc2626'">
                <Icon :icon="dash?.core.telegram ? 'tabler:check' : 'tabler:x'" />
              </NIcon>
            </div>
            <div>
              <div class="text-base font-semibold">{{ dash?.core.telegram ? '正常' : '不可达' }}</div>
              <div class="text-xs tg-text-3">到 Telegram DC 的 TCP 延迟 {{ dash?.core.latency ?? '-' }} ms</div>
            </div>
          </div>
          <div class="mt-4 pt-4 border-t tg-divider grid grid-cols-2 gap-3">
            <div>
              <div class="text-xs tg-text-3">mtg 内核</div>
              <div class="font-mono text-sm">v{{ dash?.core.mtgVersion || '2.2.8' }}</div>
            </div>
            <div>
              <div class="text-xs tg-text-3">运行实例</div>
              <div class="text-sm font-medium">{{ dash?.accounts.running || 0 }} / {{ dash?.accounts.total || 0 }}</div>
            </div>
          </div>
        </div>

        <div class="tg-card p-5">
          <div class="card-title"><NIcon size="15"><Icon icon="tabler:shield-lock" /></NIcon> 最近登录</div>
          <div class="login-list">
            <div v-for="l in dash?.recentLogins || []" :key="l.id" class="login-row">
              <div class="min-w-0">
                <div class="text-[13px] font-medium truncate">{{ l.username }}</div>
                <div class="text-[11.5px] tg-text-3">{{ l.ip || '-' }} · {{ fmtRelative(l.created_at) }}</div>
              </div>
              <NTag size="small" :type="l.success ? 'success' : 'error'" :bordered="false">
                {{ l.success ? '成功' : l.message }}
              </NTag>
            </div>
            <div v-if="!dash?.recentLogins?.length" class="text-xs tg-text-3 py-4 text-center">暂无登录记录</div>
          </div>
        </div>
      </div>
    </NSpin>
  </div>
</template>

<style scoped>
.card-title {
  display: flex; align-items: center; gap: 6px;
  font-size: 13.5px; font-weight: 600; margin-bottom: 10px;
  color: var(--tg-text-2);
}
.big { font-size: 22px; font-weight: 650; letter-spacing: -0.02em; }
.kv {
  display: flex; align-items: center; justify-content: space-between;
  padding: 4px 0; font-size: 12.5px; color: var(--tg-text-2);
}
.kv b { color: var(--tg-text); font-weight: 500; }
.login-list { display: flex; flex-direction: column; max-height: 220px; overflow-y: auto; }
.login-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 0; border-bottom: 1px dashed var(--tg-border); }
.login-row:last-child { border-bottom: none; }
</style>
