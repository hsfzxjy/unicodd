import { createApp } from 'vue'
import App from './App.vue'
import { createContentLoader } from './lib/content'
import { engine } from './lib/engine'
import './styles.css'

const content = createContentLoader(async (path) => {
  const response = await fetch(`${import.meta.env.BASE_URL}content/${path}`, { cache: 'no-cache' })
  if (!response.ok) throw new Error(`HTTP ${response.status} while loading content.`)
  return response.arrayBuffer()
}, engine)

createApp(App, { content, engine }).mount('#app')
