<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import PayloadEditor from './components/PayloadEditor.vue'
import Terminal, { type Entry } from './components/Terminal.vue'
import Workbench from './components/Workbench.vue'
import { actionCommand } from './lib/commands'
import type { createContentLoader, ScenarioEntry } from './lib/content'
import { createRuntime, type Action, type Link, type Session } from './lib/runtime'
import type { Scenario } from './lib/scenario'
import type { Span } from './lib/unicode'
import type { Engine } from './types'

const props = defineProps<{ content: ReturnType<typeof createContentLoader>; engine: Engine }>()
const catalog = shallowRef<ScenarioEntry[]>([])
const scenarioId = ref('')
const scenario = shallowRef<Scenario>()
const session = shallowRef<Session>()
const catalogLoading = ref(true)
const loadingError = ref('')
const attempt = ref(0)
const busy = ref(false)
const composing = ref(false)
const application = ref<HTMLElement>()
const terminal = ref<InstanceType<typeof Terminal>>()
const editor = ref<InstanceType<typeof PayloadEditor>>()
const bench = ref<InstanceType<typeof Workbench>>()
const loginSubmit = ref<HTMLButtonElement>()
const alias = ref('')
const drafts = new Map<string, string>()
const transcript = shallowRef<Entry[]>([])
const prompt = computed(() => session.value?.host?.id ?? 'local')
const login = computed(() => session.value?.host?.login)
const draftKey = () => JSON.stringify([scenarioId.value, session.value?.host?.id])
const storageKey = (id: string) => 'unicodd.objective.' + id
let runtime: ReturnType<typeof createRuntime> | undefined
let sequence = 0
let context: Span | undefined
let returnTo: HTMLElement | undefined
let applied = false

const viewport = window.visualViewport
function fitViewport() {
  if (viewport?.scale === 1 && viewport.height < document.documentElement.clientHeight)
    application.value?.style.setProperty('--app-height', `${viewport.height}px`)
  else application.value?.style.removeProperty('--app-height')
}
onMounted(() => {
  fitViewport()
  viewport?.addEventListener('resize', fitViewport)
})
onUnmounted(() => viewport?.removeEventListener('resize', fitViewport))

const shortcuts = computed((): Link[] => {
  if (!session.value) return []
  const actions: Link[] = [{ label: 'Hosts', action: { type: 'hosts' } }]
  if (session.value.host) {
    actions.push({ label: 'Files', action: { type: 'ls' } })
    if (runtime?.canLogin && !session.value.editing)
      actions.push({ label: 'Login', action: { type: 'login' } })
    if (session.value.identity !== session.value.host.guest)
      actions.push({ label: 'Logout', action: { type: 'logout' } })
  }
  actions.push(
    { label: 'Help', action: { type: 'help' } },
    { label: 'Clear', action: { type: 'clear' } },
  )
  return actions
})

const suggestions = computed(() => (session.value ? (runtime?.suggestions() ?? []) : []))

function savedCompletion(id: string) {
  try {
    return localStorage.getItem(storageKey(id)) === 'true'
  } catch {
    return false
  }
}

function storeCompletion(id: string, completed: boolean) {
  try {
    if (completed) localStorage.setItem(storageKey(id), 'true')
    else localStorage.removeItem(storageKey(id))
  } catch {
    // The active session is sufficient if storage is unavailable.
  }
}

async function loadCatalog() {
  catalogLoading.value = true
  loadingError.value = ''
  try {
    catalog.value = await props.content.manifest()
    scenarioId.value = catalog.value.find((item) => item.available)?.id ?? ''
  } catch (error) {
    loadingError.value = error instanceof Error ? error.message : String(error)
  } finally {
    catalogLoading.value = false
  }
}

watch([scenarioId, attempt], async ([id], _, onCleanup) => {
  let stale = false
  onCleanup(() => {
    stale = true
  })
  runtime = undefined
  session.value = undefined
  scenario.value = undefined
  busy.value = false
  composing.value = false
  loadingError.value = ''
  const entry = catalog.value.find((item) => item.id === id && item.available)
  if (!entry) return
  try {
    const loaded = await props.content.scenario(entry)
    if (stale) return
    runtime = createRuntime(loaded, props.engine, savedCompletion(id))
    scenario.value = loaded
    session.value = runtime.state
    alias.value = drafts.get(draftKey()) ?? login.value?.initial ?? ''
    transcript.value = [{ id: sequence++, output: runtime.welcome() }]
  } catch (error) {
    if (!stale) loadingError.value = error instanceof Error ? error.message : String(error)
  }
})
void loadCatalog()

function setDraft(value: string) {
  alias.value = value
  drafts.set(draftKey(), value)
}

function echoText(value: string) {
  return value.length <= 512 ? value : value.slice(0, 512) + '…'
}

async function dispatch(action: Action, command?: string) {
  const active = runtime
  if (
    !active ||
    busy.value ||
    (composing.value && (action.type === 'login' || action.type === 'inspect'))
  )
    return
  const id = scenarioId.value
  const before = active.state
  const from = prompt.value
  const editorFocused = Boolean(document.activeElement?.closest('.alias-editor'))
  busy.value = true
  let response
  try {
    response = await active.dispatch(action)
  } finally {
    if (runtime === active) busy.value = false
  }
  if (runtime !== active || scenarioId.value !== id) return
  session.value = active.state
  if (!active.state.editing) composing.value = false
  if (action.type === 'reset') {
    for (const host of scenario.value?.hosts ?? [])
      drafts.delete(JSON.stringify([scenarioId.value, host.id]))
  }
  if (before.host !== active.state.host || action.type === 'reset') {
    alias.value = drafts.get(draftKey()) ?? login.value?.initial ?? ''
  }
  if (before.completed !== active.state.completed || action.type === 'reset')
    storeCompletion(id, active.state.completed)

  const echo = command ?? actionCommand(action)
  if (response.clear) {
    transcript.value = response.output ? [{ id: sequence++, output: response.output }] : []
    terminal.value?.scrollToEnd()
  } else if (echo || response.output) {
    transcript.value = [
      ...transcript.value.slice(-79),
      {
        id: sequence++,
        echo: echo === undefined ? undefined : echoText(echo),
        prompt: from,
        output: response.output ?? [],
      },
    ]
  }
  if (response.inspect !== undefined) openBench(undefined, response.inspect)
  if (response.edit) {
    await nextTick()
    if (runtime !== active) return
    if (matchMedia('(pointer: fine)').matches) {
      const span = editor.value?.context()
      if (span) editor.value?.focusAt(span)
    } else {
      loginSubmit.value?.focus({ preventScroll: true })
    }
  } else if (editorFocused && before.editing && !active.state.editing) {
    await nextTick()
    if (runtime === active)
      terminal.value?.focusAction(action.type === 'closeEditor' ? 'login' : 'ls')
  }
}

function openBench(span?: Span, scalar?: string) {
  if (composing.value) return
  context = session.value?.editing ? (span ?? editor.value?.context()) : undefined
  returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
  applied = false
  bench.value?.open(
    context && login.value ? { label: login.value.label, span: context } : undefined,
    scalar,
  )
}

function applyCharacter(text: string, mode: 'insert' | 'replace') {
  const span = context
  if (!span) return
  applied = true
  void nextTick(() =>
    editor.value?.apply(mode === 'insert' ? { start: span.start, end: span.start } : span, text),
  )
}

function closeBench() {
  if (!applied) returnTo?.focus({ preventScroll: true })
  context = undefined
  returnTo = undefined
}
</script>

<template>
  <div ref="application" class="application">
    <header class="app-header">
      <span class="wordmark">unicodd<span aria-hidden="true">_</span></span>
      <h1 v-if="scenario && catalog.length === 1">
        <bdi>{{ scenario.title }}</bdi>
      </h1>
      <select v-else-if="catalog.length" v-model="scenarioId" aria-label="Scenario">
        <option
          v-for="entry in catalog"
          :key="entry.id"
          :value="entry.id"
          :disabled="!entry.available"
        >
          {{ entry.label }}
        </option>
      </select>
      <button
        type="button"
        class="nav-workbench"
        aria-haspopup="dialog"
        :disabled="composing"
        @click="openBench()"
      >
        Workbench
      </button>
    </header>

    <main v-if="scenario && session" :key="scenario.id" class="workspace">
      <aside class="context-frame" aria-label="Session context">
        <div class="frame-title">
          <h2>Session</h2>
          <button type="button" class="reset" :disabled="busy" @click="dispatch({ type: 'reset' })">
            Reset session
          </button>
        </div>
        <div class="session-context" aria-live="polite">
          <dl class="session-details">
            <div>
              <dt>Host</dt>
              <dd>
                <bdi>{{ prompt }}</bdi>
              </dd>
            </div>
            <div>
              <dt>User</dt>
              <dd>
                <bdi>{{ session.identity.user }}</bdi>
              </dd>
            </div>
            <div>
              <dt>Access</dt>
              <dd>
                <bdi>{{ session.identity.role }}</bdi>
              </dd>
            </div>
          </dl>
          <div class="objective">
            <div class="objective-heading">
              <h3>Objective</h3>
              <span :class="{ 'objective-done': session.completed }">{{
                session.completed ? 'Complete' : 'Open'
              }}</span>
            </div>
            <p dir="auto">{{ scenario.objective.text }}</p>
          </div>
        </div>
        <form
          v-if="login"
          v-show="session.editing"
          :key="session.host?.id"
          class="alias-editor"
          aria-label="Login editor"
          @submit.prevent="dispatch({ type: 'login', alias })"
        >
          <PayloadEditor
            ref="editor"
            :label="login.label"
            :model-value="alias"
            @update:model-value="setDraft"
            @composition="composing = $event"
            @workbench="openBench"
          />
          <div class="toolbar alias-actions">
            <button
              type="button"
              :disabled="busy || composing"
              @click="dispatch({ type: 'closeEditor' })"
            >
              Hide editor
            </button>
            <button ref="loginSubmit" class="primary" type="submit" :disabled="busy || composing">
              {{ busy ? 'Authenticating…' : 'Submit login' }}
            </button>
          </div>
        </form>
      </aside>

      <Terminal
        ref="terminal"
        :transcript="transcript"
        :prompt="prompt"
        :shortcuts="shortcuts"
        :suggestions="suggestions"
        :busy="busy"
        @action="dispatch"
      />
    </main>
    <main v-else class="startup">
      <template v-if="loadingError">
        <h1>Could not load scenario content</h1>
        <p role="alert" class="error" dir="auto">{{ loadingError }}</p>
        <button type="button" @click="scenarioId ? attempt++ : loadCatalog()">Retry</button>
      </template>
      <p v-else-if="catalogLoading || scenarioId" role="status">Loading scenario…</p>
      <p v-else>No scenario is available.</p>
    </main>
  </div>

  <Workbench ref="bench" :engine="engine" @apply="applyCharacter" @close="closeBench" />
</template>
