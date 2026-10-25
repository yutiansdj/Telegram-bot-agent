<script setup>
import { ref } from 'vue';
import { NIcon, NTabs, NTabPane, NCollapse, NCollapseItem, NTag } from 'naive-ui';
import { Icon } from '@iconify/vue';
import PageHeader from '@/components/common/PageHeader.vue';
import CopyButton from '@/components/common/CopyButton.vue';

const steps = [
  { t: '登录并申请代理', d: '进入「我的代理」页面，点击右上角「新建代理」，选择节点后系统会自动分配独立端口与密钥并立即上线。' },
  { t: '导入 Telegram', d: '点击代理卡片上的二维码图标，用 Telegram 扫描二维码即可自动连接；或点击「t.me 分享链接」在手机上一键打开。' },
  { t: '验证连接', d: '在 Telegram 中进入 设置 → 数据与存储 → 代理，确认该代理处于「已连接」状态，即可开始使用。' },
  { t: '查看流量', d: '平台每 30 秒采集一次代理流量，在「流量统计」中可以看到每日明细与各代理用量。' },
];
</script>

<template>
  <div>
    <PageHeader title="使用教程" subtitle="三步完成 Telegram 代理配置，全平台通用" icon="tabler:book" />

    <div class="tg-card p-5">
      <div class="step-list">
        <div v-for="(s, i) in steps" :key="i" class="step">
          <div class="step-no">{{ i + 1 }}</div>
          <div class="min-w-0">
            <div class="step-title">{{ s.t }}</div>
            <div class="step-desc">{{ s.d }}</div>
          </div>
        </div>
      </div>
    </div>

    <div class="tg-card mt-3 p-1">
      <NTabs type="line" animated size="small" class="px-3 pt-2">
        <NTabPane name="qr" tab="扫码导入">
          <div class="p-4 text-[13.5px] leading-7 tg-text-2">
            <p>1. 打开「我的代理」→ 点击卡片右上角二维码按钮；</p>
            <p>2. 在 Telegram 客户端依次进入 <b class="tg-text-1">设置 → 数据与存储 → 代理设置 → 添加代理 → 使用二维码</b>；</p>
            <p>3. 扫描二维码后，点击「连接」即可。</p>
            <p class="tg-text-3 text-xs mt-2">提示：Telegram 桌面版可直接在代理列表中点击「添加代理」后扫描。</p>
          </div>
        </NTabPane>
        <NTabPane name="link" tab="链接导入">
          <div class="p-4 text-[13.5px] leading-7 tg-text-2">
            <p>1. 复制形如下方的代理链接：</p>
            <div class="my-2 flex items-center gap-2">
              <code class="tg-code flex-1 border tg-divider rounded-md px-2 py-1.5 bg-[var(--tg-surface-2)] truncate">
                https://t.me/proxy?server=代理地址&port=端口&secret=密钥
              </code>
              <CopyButton text="https://t.me/proxy?server=代理地址&port=端口&secret=密钥" label="复制" />
            </div>
            <p>2. 在手机 Telegram 内点击该链接，会自动弹窗询问是否连接，点击「连接代理」；</p>
            <p>3. 若未自动弹出，请在浏览器中打开后选择「用 Telegram 打开」。</p>
          </div>
        </NTabPane>
        <NTabPane name="manual" tab="手动填写">
          <div class="p-4 text-[13.5px] leading-7 tg-text-2">
            <p>在 Telegram <b class="tg-text-1">设置 → 数据与存储 → 代理设置 → 添加代理</b> 中手动填写：</p>
            <ul class="list-disc pl-5 mt-1">
              <li>代理类型：<b class="tg-text-1">MTProto</b></li>
              <li>服务器：代理详情页中的「服务器」</li>
              <li>端口：代理详情页中的「端口」</li>
              <li>密钥：代理详情页中的「密钥（Secret）」</li>
            </ul>
          </div>
        </NTabPane>
        <NTabPane name="faq" tab="常见问题">
          <div class="p-2">
            <NCollapse accordion>
              <NCollapseItem title="代理显示已连接，但消息收不到怎么办？" name="1">
                <div class="tg-text-2 text-[13px]">请先在「我的代理」中点击「检测」，确认节点连通正常；再检查手机网络是否限制了境外流量。若仍有问题请联系管理员。
                </div>
              </NCollapseItem>
              <NCollapseItem title="流量用完了会怎样？" name="2">
                <div class="tg-text-2 text-[13px]">流量用尽后代理会自动停止，无法继续连接。你可以提交「流量申请」，审核通过后额度自动到账，若代理处于停止状态请等待自动恢复或联系管理员重启。
                </div>
              </NCollapseItem>
              <NCollapseItem title="可以同时使用多个代理吗？" name="3">
                <div class="tg-text-2 text-[13px]">可以。每个代理都有独立端口与密钥，互不影响，你可以在 Telegram 的代理列表中添加多个。
                </div>
              </NCollapseItem>
              <NCollapseItem title="重置密钥后需要做什么？" name="4">
                <div class="tg-text-2 text-[13px]">旧的代理链接会立即失效，需要在 Telegram 中删除旧代理并重新导入新链接。
                </div>
              </NCollapseItem>
              <NCollapseItem title="账号安全提示" name="5">
                <div class="tg-text-2 text-[13px]">请勿将代理链接分享给他人，避免流量被他人消耗导致超额停用。密码请定期更换。
                </div>
              </NCollapseItem>
            </NCollapse>
          </div>
        </NTabPane>
      </NTabs>
    </div>
  </div>
</template>

<style scoped>
.step-list { display: flex; flex-direction: column; gap: 16px; }
.step { display: flex; gap: 12px; align-items: flex-start; }
.step-no {
  width: 26px; height: 26px; border-radius: 50%;
  display: grid; place-items: center;
  background: var(--tg-brand-soft); color: var(--tg-brand);
  font-weight: 600; font-size: 13px; flex-shrink: 0;
}
.step-title { font-weight: 600; font-size: 14px; }
.step-desc { font-size: 13px; color: var(--tg-text-2); margin-top: 2px; line-height: 1.75; }
</style>
