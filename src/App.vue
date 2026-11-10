<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import PayloadEditor from './components/PayloadEditor.vue'
import Terminal, { type Entry } from './components/Terminal.vue'
import { actionCommand } from './lib/commands'
import type { createContentLoader, ScenarioEntry } from './lib/content'
import { createRuntime, type Action, type Link, type Session } from './lib/runtime'
import type { Scenario } from './lib/scenario'
import { copyText, decodeUnicodeEscapes } from './lib/unicode'
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
const narrowViewport = matchMedia('(max-width: 830px)')
const narrow = ref(narrowViewport.matches)
const sessionExpanded = ref(false)
const application = ref<HTMLElement>()
const terminal = ref<InstanceType<typeof Terminal>>()
const editor = ref<InstanceType<typeof PayloadEditor>>()
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
const canInsertPayload = computed(() => Boolean(session.value?.editing) && !composing.value)
const canReplace = computed(() => {
  const span = editor.value?.context()
  return canInsertPayload.value && Boolean(span && span.end > span.start)
})

const viewport = window.visualViewport
function updateLayout() {
  narrow.value = narrowViewport.matches
}
function fitViewport() {
  if (viewport?.scale === 1 && viewport.height < document.documentElement.clientHeight)
    application.value?.style.setProperty('--app-height', `${viewport.height}px`)
  else application.value?.style.removeProperty('--app-height')
}
onMounted(() => {
  fitViewport()
  narrowViewport.addEventListener('change', updateLayout)
  viewport?.addEventListener('resize', fitViewport)
})
onUnmounted(() => {
  narrowViewport.removeEventListener('change', updateLayout)
  viewport?.removeEventListener('resize', fitViewport)
})

const shortcuts = computed((): Link[] => {
  if (!session.value) return []
  const actions: Link[] = [{ label: 'Hosts', action: { type: 'hosts' } }]
  if (scenario.value?.inbox) actions.push({ label: 'Mail', action: { type: 'mail' } })
  if (session.value.host) {
    actions.push({ label: 'Files', action: { type: 'ls' } })
    if (runtime?.canLogin && !session.value.editing)
      actions.push({ label: 'Login', action: { type: 'login' } })
    if (session.value.identity !== session.value.host.guest)
      actions.push({ label: 'Logout', action: { type: 'logout' } })
  }
  actions.push(
    { label: 'Inspect', action: { type: 'inspect' } },
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
  sessionExpanded.value = false
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

function submitAlias() {
  if (composing.value) return
  const decoded = decodeUnicodeEscapes(alias.value)
  return dispatch(
    'error' in decoded
      ? { type: 'invalid', message: decoded.error }
      : { type: 'login', alias: decoded.text },
  )
}

function echoText(value: string) {
  return value.length <= 512 ? value : value.slice(0, 512) + '…'
}

async function dispatch(action: Action, command?: string) {
  const active = runtime
  if (
    !active ||
    busy.value ||
    (composing.value && (action.type === 'login' || action.type === 'editPayload'))
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
    if (runtime !== active || scenarioId.value !== id) return
    if (response.transfer?.type === 'copy') {
      try {
        await copyText(response.transfer.text)
        response.output = [{ kind: 'message', text: 'Copied.' }]
      } catch {
        response.output = [{ kind: 'error', text: 'Clipboard unavailable.' }]
      }
    } else if (response.transfer?.type === 'insertCommand') {
      terminal.value?.insertCommand(response.transfer.text)
    } else if (response.transfer?.type === 'editPayload') {
      const { mode, text } = response.transfer
      const span = editor.value?.context()
      if (span && !composing.value && (mode === 'insert' || span.start < span.end)) {
        editor.value?.apply(
          mode === 'insert' ? { start: span.start, end: span.start } : span,
          text,
          false,
        )
      }
    }
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
        connected: Boolean(before.host),
        output: response.output ?? [],
      },
    ]
  }
  if (response.inspectPrompt) terminal.value?.promptInspection()
  const readable = response.output?.find((row) => row.kind === 'inspection' || row.kind === 'mail')
  if (readable) {
    await nextTick()
    if (runtime === active) terminal.value?.revealOutput(readable.kind, command === undefined)
  }
  if (response.edit) {
    if (narrow.value) sessionExpanded.value = false
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
</script>

<template>
  <div ref="application" class="application">
    <main v-if="scenario && session" :key="scenario.id" class="workspace">
      <Teleport to="#terminal-context" :disabled="!narrow" defer>
        <aside
          v-show="!narrow || sessionExpanded || session.editing"
          class="context-frame"
          aria-label="Session context"
        >
          <div v-show="!narrow || sessionExpanded" id="session-details">
            <div class="frame-title">
              <h2>Session</h2>
              <button
                type="button"
                class="reset"
                :disabled="busy"
                @click="dispatch({ type: 'reset' })"
              >
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
          </div>
          <form
            v-if="login"
            v-show="session.editing"
            :key="session.host?.id"
            class="alias-editor"
            aria-label="Login editor"
            @submit.prevent="submitAlias"
          >
            <PayloadEditor
              ref="editor"
              :label="login.label"
              :model-value="alias"
              @update:model-value="setDraft"
              @composition="composing = $event"
              @inspect="dispatch({ type: 'inspect', character: $event })"
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
      </Teleport>

      <Terminal
        ref="terminal"
        :transcript="transcript"
        :prompt="prompt"
        :connected="Boolean(session.host)"
        :shortcuts="shortcuts"
        :suggestions="suggestions"
        :busy="busy"
        :can-insert-payload="canInsertPayload"
        :can-replace="canReplace"
        @action="dispatch"
      >
        <template #scenario>
          <h1 v-if="catalog.length === 1" class="terminal-scenario">
            <bdi>{{ scenario.title }}</bdi>
          </h1>
          <select v-else v-model="scenarioId" class="terminal-scenario" aria-label="Scenario">
            <option
              v-for="entry in catalog"
              :key="entry.id"
              :value="entry.id"
              :disabled="!entry.available"
            >
              {{ entry.label }}
            </option>
          </select>
        </template>
        <template #title-actions>
          <button
            v-if="narrow"
            type="button"
            aria-controls="session-details"
            :aria-expanded="sessionExpanded"
            @click="sessionExpanded = !sessionExpanded"
          >
            Session
          </button>
        </template>
      </Terminal>
    </main>
    <main v-else class="startup">
      <template v-if="loadingError">
        <h1>Could not load scenario content</h1>
        <p role="alert" class="error" dir="auto">{{ loadingError }}</p>
        <button type="button" @click="scenarioId ? attempt++ : loadCatalog()">Retry</button>
        <select v-if="catalog.length > 1" v-model="scenarioId" aria-label="Scenario">
          <option
            v-for="entry in catalog"
            :key="entry.id"
            :value="entry.id"
            :disabled="!entry.available"
          >
            {{ entry.label }}
          </option>
        </select>
      </template>
      <p v-else-if="catalogLoading || scenarioId" role="status">Loading scenario…</p>
      <p v-else>No scenario is available.</p>
    </main>
  </div>
</template>
