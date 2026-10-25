import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';
import './styles/main.css';
import './utils/icons';
import { useThemeStore } from './stores/theme';
import { useAuthStore } from './stores/auth';

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);

// 主题需在挂载前应用，避免闪烁
useThemeStore(pinia).init();

app.use(router);
app.mount('#app');

const auth = useAuthStore(pinia);
auth.fetchPublicInfo();
