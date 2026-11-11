<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import Terminal from './components/Terminal.vue'
import logicRevision from 'virtual:unicodd-logic-revision'
import { createCampaign } from './lib/campaign'
import { actionCommand, puzzleAction } from './lib/commands'
import type { createContentLoader, ScenarioEntry } from './lib/content'
import { createRuntime, type Action, type Link, type Session } from './lib/runtime'
import { type Scenario } from './lib/scenario'
import { copyText } from './lib/unicode'
import {
  historyRevision,
  replayJournal,
  scrollbackLimit,
  type Checkpoint,
  type ComposerSave,
  type Entry,
  type JournalFrame,
} from './lib/workspace'
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
const initialComposer = shallowRef<ComposerSave>()
let revision = ''
let baseline: Checkpoint
let frames: JournalFrame[] = []
let includeWelcome = true
let checkpointNext = false
let sequence = 1
let workspaceReady = false
let saveTimer: number | undefined

function checkpoint(active: NonNullable<typeof runtime>): Checkpoint {
  return { runtime: active.snapshot(), campaign: campaign!.snapshot() }
}

function saveLevel(submitted = false) {
  window.clearTimeout(saveTimer)
  saveTimer = undefined
  if (!workspaceReady || !runtime || !scenario.value || !campaign) return
  campaign.saveLevel(scenario.value.id, {
    version: 1,
    revision,
    runtime: runtime.snapshot(),
    composer: terminal.value?.saveComposer(submitted),
    journal: {
      start: includeWelcome ? baseline : (frames[0]?.before ?? baseline),
      welcome: includeWelcome,
      commands: frames.map(({ record }, index) =>
        index === 0 && !includeWelcome ? { ...record, checkpoint: undefined } : record,
      ),
    },
    terminal: terminal.value?.saveView(),
    sessionExpanded: sessionExpanded.value,
  })
}

function scheduleSave() {
  if (!workspaceReady) return
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    if (!busy.value) saveLevel()
  }, 180)
}

function saveOnExit() {
  if (!busy.value) saveLevel()
}

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
  window.addEventListener('pagehide', saveOnExit)
})
onUnmounted(() => {
  window.clearTimeout(saveTimer)
  window.removeEventListener('pagehide', saveOnExit)
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
    revision = await historyRevision(logicRevision, [catalog.value, scenarios.value])
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
    campaign.invalidateHistory(revision)
    scenarioId.value = campaign.current
  } catch (error) {
    loadingError.value = error instanceof Error ? error.message : String(error)
  } finally {
    catalogLoading.value = false
  }
}

watch([scenarioId, attempt], async ([id]) => {
  const loaded = scenarios.value.find((item) => item.id === id)
  if (!loaded || !campaign?.enter(id)) return
  window.clearTimeout(saveTimer)
  workspaceReady = false
  busy.value = true
  loadingError.value = ''
  const saved = campaign.level(id)
  const historyMatches = saved?.revision === revision
  const active = createRuntime(loaded, props.engine, campaign, saved?.runtime)
  runtime = active
  initialComposer.value = saved?.composer
  sessionExpanded.value = saved?.sessionExpanded === true
  scenario.value = loaded
  session.value = active.state
  contextVersion.value++
  baseline = checkpoint(active)
  frames = []
  includeWelcome = true
  checkpointNext = false
  sequence = 1
  transcript.value = [{ id: 0, output: active.welcome() }]
  let restored = false
  if (historyMatches && saved?.journal) {
    try {
      const replay = await replayJournal(
        saved.journal,
        loaded,
        scenarios.value,
        props.engine,
        campaign.direct(id),
      )
      if (runtime !== active) return
      baseline = saved.journal.start
      frames = replay.frames
      includeWelcome = saved.journal.welcome
      checkpointNext = true
      sequence = (frames.at(-1)?.record.id ?? 0) + 1
      transcript.value = replay.entries
      restored = true
    } catch {
      // A malformed history can be discarded independently of the level state.
    }
  }
  await nextTick()
  if (runtime !== active) return
  terminal.value?.restoreView(restored ? saved?.terminal : undefined)
  await nextTick()
  if (runtime !== active) return
  busy.value = false
  workspaceReady = true
  saveLevel()
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
  if (saveTimer !== undefined && action.type !== 'resetCampaign') saveLevel()
  const id = scenarioId.value
  const before = active.state
  const beforeCommand = checkpoint(active)
  const from = prompt.value
  const isCurrent = () => runtime === active && scenarioId.value === id
  let delayed = false
  let focusBeforePause: Element | null = null
  busy.value = true
  let response
  let clipboard: boolean | undefined
  try {
    response = await active.dispatch(action)
    if (!isCurrent()) return
    if (response.transfer?.type === 'copy') {
      try {
        await copyText(response.transfer.text)
        clipboard = true
        response.output = [{ kind: 'message', text: 'Copied.' }]
      } catch {
        clipboard = false
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
      frames = []
      includeWelcome = Boolean(response.output)
      baseline = checkpoint(active)
      checkpointNext = false
      sequence = 1
      if (action.type === 'reset') terminal.value?.resetComposer()
      transcript.value = response.output ? [{ id: 0, output: response.output }] : []
      terminal.value?.scrollToEnd()
      saveLevel(command !== undefined)
    } else if (response.enter === undefined && (echo || response.output)) {
      const output = response.output ?? []
      const entry: Entry = {
        id: sequence++,
        echo,
        prompt: from,
        connected: Boolean(before.host),
        output,
      }
      frames = [
        ...frames.slice(1 - scrollbackLimit),
        {
          before: beforeCommand,
          record: {
            id: entry.id,
            action: clipboard === undefined ? action : { type: 'clipboard', ok: clipboard },
            echo: echo === actionCommand(action) ? undefined : echo,
            checkpoint: checkpointNext ? beforeCommand : undefined,
            transientOutput: response.transient ? output : undefined,
          },
        },
      ]
      checkpointNext = false
      if (frames.length === scrollbackLimit) includeWelcome = false
      const history = transcript.value.slice(1 - scrollbackLimit)
      saveLevel(command !== undefined && !output.some((row) => row.kind === 'error'))
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
    if (action.type !== 'resetCampaign' && response.enter !== id) saveLevel(command !== undefined)
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
  scheduleSave()
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
    <main v-if="scenario && session" :key="scenario.id + '/' + attempt" class="workspace">
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
                <p v-if="campaignFinished" class="objective-done">
                  All available scenarios complete
                </p>
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
        :initial-composer="initialComposer"
        :context="scenarioId + '/' + contextVersion"
        :execute="dispatch"
        @action="dispatch"
        @change="scheduleSave"
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
