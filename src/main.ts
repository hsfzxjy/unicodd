import { createApp } from 'vue'
import App from './App.vue'
import { targets } from './data/targets'
import { engine } from './lib/engine'
import './styles.css'

async function start() {
  const catalog = import.meta.env.DEV && new URLSearchParams(location.search).has('fixtures')
    ? (await import('../tests/fixtures/targets')).fixtures
    : targets
  createApp(App, { targets: catalog, engine }).mount('#app')
}

void start()
