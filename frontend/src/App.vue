<script setup>
import { computed, watchEffect } from 'vue';
import {
  NConfigProvider, NMessageProvider, NDialogProvider, NNotificationProvider, NLoadingBarProvider,
  zhCN, dateZhCN, darkTheme,
} from 'naive-ui';
import { createDiscreteApi } from 'naive-ui/es/discrete/src/discrete';
import { useThemeStore } from '@/stores/theme';
import { useThemeOverrides } from '@/utils/theme';

const theme = useThemeStore();
const overrides = useThemeOverrides();

const naiveTheme = computed(() => (theme.dark ? darkTheme : null));

// 全局可用的离散 API（alert / message 不依赖 Provider 上下文）
const { message, dialog } = createDiscreteApi(['message', 'dialog'], {
  configProviderProps: computed(() => ({ theme: naiveTheme.value, themeOverrides: overrides })),
});
window.$message = message;
window.$dialog = dialog;
</script>

<template>
  <NConfigProvider
    :theme="naiveTheme"
    :theme-overrides="overrides"
    :locale="zhCN"
    :date-locale="dateZhCN"
    class="h-full"
  >
    <NLoadingBarProvider>
      <NMessageProvider :max="3">
        <NDialogProvider>
          <NNotificationProvider>
            <RouterView />
          </NNotificationProvider>
        </NDialogProvider>
      </NMessageProvider>
    </NLoadingBarProvider>
  </NConfigProvider>
</template>

<style>
#app { height: 100%; }
</style>
