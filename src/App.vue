<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import Terminal, { type Entry } from './components/Terminal.vue'
import { createCampaign } from './lib/campaign'
import { actionCommand, puzzleAction } from './lib/commands'
import type { createContentLoader, ScenarioEntry } from './lib/content'
import { createRuntime, type Action, type Link, type Session } from './lib/runtime'
import { type Scenario } from './lib/scenario'
import { copyText } from './lib/unicode'
import type { Engine } from './types'

const props = defineProps<{ content: ReturnType<typeof createContentLoader>; engine: Engine }>()
const catalog = shallowRef<ScenarioEntry[]>([])
const scenarios = shallowRef<Scenario[]>([])
let campaign: ReturnType<typeof createCampaign> | undefined
const destinations = computed(() =>
  session.value ? catalog.value.filter(({ id }) => campaign?.selectable(id)) : [],
)
const campaignFinished = computed(() => Boolean(session.value && campaign?.finished))
const scenarioId = ref('')
const scenario = shallowRef<Scenario>()
const session = shallowRef<Session>()
const catalogLoading = ref(true)
const loadingError = ref('')
const attempt = ref(0)
const busy = ref(false)
const narrowViewport = matchMedia('(max-width: 830px)')
const narrow = ref(narrowViewport.matches)
const sessionExpanded = ref(false)
const application = ref<HTMLElement>()
const terminal = ref<InstanceType<typeof Terminal>>()
const contextVersion = ref(0)
const transcript = shallowRef<Entry[]>([])
const prompt = computed(() => session.value?.host?.id ?? 'local')
const operations = computed(() => {
  const host = session.value?.host
  return [...(host?.operations ?? []), ...(host?.recovery ?? [])]
})
let runtime: ReturnType<typeof createRuntime> | undefined
let sequence = 0

const viewport = window.visualViewport
function updateLayout() {
  narrow.value = narrowViewport.matches
}
function fitViewport() {
  const layoutHeight = document.documentElement.clientHeight
  const height = viewport?.scale === 1 ? viewport.height : layoutHeight
  application.value?.classList.toggle('short-viewport', height <= 540)
  if (height < layoutHeight) application.value?.style.setProperty('--app-height', `${height}px`)
  else application.value?.style.removeProperty('--app-height')
}
onMounted(() => {
  fitViewport()
  narrowViewport.addEventListener('change', updateLayout)
  if (viewport) viewport.addEventListener('resize', fitViewport)
  else window.addEventListener('resize', fitViewport)
})
onUnmounted(() => {
  runtime = undefined
  narrowViewport.removeEventListener('change', updateLayout)
  if (viewport) viewport.removeEventListener('resize', fitViewport)
  else window.removeEventListener('resize', fitViewport)
})

const shortcuts = computed((): Link[] => {
  if (!session.value) return []
  const actions: Link[] = [{ label: 'Hosts', action: { type: 'hosts' } }]
  if (campaign?.hasInbox) actions.push({ label: 'Mail', action: { type: 'mail' } })
  if (session.value.host) {
    actions.push({ label: 'Files', action: { type: 'ls' } })
    for (const operation of runtime?.operations ?? [])
      if (!('quick' in operation) || operation.quick)
        actions.push({ label: operation.actionLabel, action: puzzleAction(operation.command) })
    if (session.value.identity !== session.value.host.guest)
      actions.push({ label: 'Logout', action: { type: 'logout' } })
  }
  if (catalog.value.length > 1) actions.push({ label: 'Campaign', action: { type: 'campaign' } })
  actions.push(
    { label: 'Inspect', action: { type: 'inspect' } },
    { label: 'Help', action: { type: 'help' } },
    { label: 'Clear', action: { type: 'clear' } },
  )
  return actions
})

const suggestions = computed(() => (session.value ? (runtime?.suggestions() ?? []) : []))
const newHosts = computed(() => (session.value ? (runtime?.newHosts ?? 0) : 0))
const unreadMail = computed(() => {
  const active = session.value
  if (active && campaign?.hasInbox)
    return active.deliveredMail.filter((id) => !active.readMail.includes(id)).length
})

async function loadCatalog() {
  catalogLoading.value = true
  loadingError.value = ''
  try {
    catalog.value = await props.content.manifest()
    scenarios.value = await props.content.campaign(catalog.value)
    const direct = import.meta.env.DEV
      ? (new URLSearchParams(location.search).get('scenario') ?? undefined)
      : undefined
    let storage: Storage | undefined
    try {
      if (!direct) storage = window.localStorage
    } catch {
      // Continue without persistence if the browser blocks storage.
    }
    campaign = createCampaign(scenarios.value, storage, direct)
    scenarioId.value = campaign.current
  } catch (error) {
    loadingError.value = error instanceof Error ? error.message : String(error)
  } finally {
    catalogLoading.value = false
  }
}

watch([scenarioId, attempt], ([id]) => {
  const loaded = scenarios.value.find((item) => item.id === id)
  if (!loaded || !campaign?.enter(id)) return
  sessionExpanded.value = false
  busy.value = false
  loadingError.value = ''
  runtime = createRuntime(loaded, props.engine, campaign)
  scenario.value = loaded
  session.value = runtime.state
  contextVersion.value++
  transcript.value = [{ id: sequence++, output: runtime.welcome() }]
  void nextTick(() => terminal.value?.scrollToEnd())
})
void loadCatalog()

async function dispatch(action: Action, command?: string) {
  const active = runtime
  if (!active || busy.value) return
  if (
    action.type === 'resetCampaign' &&
    !window.confirm('Clear campaign progress and all local mail?')
  )
    return
  const id = scenarioId.value
  const before = active.state
  const from = prompt.value
  const isCurrent = () => runtime === active && scenarioId.value === id
  let delayed = false
  let focusBeforePause: Element | null = null
  busy.value = true
  let response
  try {
    response = await active.dispatch(action)
    if (!isCurrent()) return
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
      terminal.value?.applyText(response.transfer.mode, response.transfer.text)
    }
    if (!isCurrent()) return
    const echo = response.compose ? undefined : (command ?? actionCommand(action))
    if (response.clear) {
      transcript.value = response.output ? [{ id: sequence++, output: response.output }] : []
      terminal.value?.scrollToEnd()
    } else if (response.enter === undefined && (echo || response.output)) {
      const output = response.output ?? []
      const entry: Entry = {
        id: sequence++,
        echo,
        prompt: from,
        connected: Boolean(before.host),
        output,
      }
      const history = transcript.value.slice(-79)
      const pauses = matchMedia('(prefers-reduced-motion: reduce)').matches
        ? []
        : (scenario.value?.outputTiming?.[action.type] ?? [])
      for (const { afterRows, minMs, maxMs } of pauses) {
        if (afterRows >= output.length) break
        const ms = minMs + Math.floor(Math.random() * (maxMs - minMs + 1))
        if (!ms) continue
        if (!delayed) focusBeforePause = document.activeElement
        delayed = true
        transcript.value = [
          ...history,
          { ...entry, output: output.slice(0, afterRows), waiting: true },
        ]
        await new Promise<void>((resolve) => window.setTimeout(resolve, ms))
        if (!isCurrent()) return
      }
      transcript.value = [...history, entry]
    }
  } finally {
    if (runtime === active) busy.value = false
  }
  if (!isCurrent()) return
  if (response.enter !== undefined) {
    if (response.enter !== scenarioId.value) scenarioId.value = response.enter
    else if (action.type === 'resetCampaign') attempt.value++
    if (response.enter !== id || action.type === 'resetCampaign') {
      await nextTick()
      terminal.value?.focusTranscript()
    }
    return response
  }
  session.value = active.state
  if (
    !response.output?.some((row) => row.kind === 'error') &&
    (before.host !== active.state.host ||
      action.type === 'reset' ||
      action.type === 'logout' ||
      action.type === 'connect')
  )
    contextVersion.value++
  if (response.compose) {
    if (narrow.value) sessionExpanded.value = false
    await nextTick()
    if (runtime === active) await terminal.value?.selectCommand(response.compose)
  }
  const readable = response.output?.find(
    (row) =>
      row.kind === 'inspection' ||
      row.kind === 'mail' ||
      row.kind === 'file' ||
      row.kind === 'report',
  )
  if (readable) {
    await nextTick()
    if (isCurrent())
      terminal.value?.revealOutput(
        readable.kind,
        command === undefined &&
          (!delayed ||
            document.activeElement === focusBeforePause ||
            document.activeElement === document.body),
        delayed,
      )
  }
  return response
}
</script>

<template>
  <div ref="application" class="application">
    <main v-if="scenario && session" :key="scenario.id" class="workspace">
      <Teleport to="#terminal-context" :disabled="!narrow" defer>
        <aside
          v-show="!narrow || sessionExpanded"
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
                <div v-for="{ label, value, after } in session.host?.status" :key="label">
                  <dt>
                    <bdi>{{ label }}</bdi>
                  </dt>
                  <dd>
                    <bdi>{{
                      after && session.flags.includes(after.flag) ? after.value : value
                    }}</bdi>
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
                <p v-if="campaignFinished" class="objective-done">Campaign complete</p>
              </div>
            </div>
          </div>
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
        :operations="operations"
        :activity="session"
        :new-hosts="newHosts"
        :unread-mail="unreadMail"
        :context="scenarioId + '/' + contextVersion"
        :execute="dispatch"
        @action="dispatch"
      >
        <template #scenario>
          <h1 v-if="destinations.length === 1" class="terminal-scenario">
            <bdi>{{ scenario.title }}</bdi>
          </h1>
          <select
            v-else
            :value="scenarioId"
            class="terminal-scenario"
            aria-label="Scenario"
            :disabled="busy"
            @change="dispatch({ type: 'scenario', id: ($event.target as HTMLSelectElement).value })"
          >
            <option v-for="entry in destinations" :key="entry.id" :value="entry.id">
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
        <button type="button" @click="loadCatalog()">Retry</button>
      </template>
      <p v-else-if="catalogLoading || scenarioId" role="status">Loading scenario…</p>
      <p v-else>No scenario is available.</p>
    </main>
  </div>
</template>
