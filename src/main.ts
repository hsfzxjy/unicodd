import { createApp } from 'vue';
import { VueFlow } from '@vue-flow/core';
import '@vue-flow/core/dist/style.css';
import '@vue-flow/core/dist/theme-default.css';

import App from './App.vue';
import './styles.css';

createApp(App).component('VueFlow', VueFlow).mount('#app');
