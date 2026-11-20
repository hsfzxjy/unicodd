<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import FirstRun from './components/FirstRun.vue'
import Terminal from './components/Terminal.vue'
import TerminalSession from './components/TerminalSession.vue'
import TerminalTitle from './components/TerminalTitle.vue'
import { useVisibleViewport } from './composables/useVisibleViewport'
import logicRevision, { previousRevision } from 'virtual:unicodd-logic-revision'
import { campaignKey, createCampaign, type DirectEntry } from './lib/campaign'
import { actionCommand, puzzleAction } from './lib/commands'
import type { createContentLoader, ScenarioEntry } from './lib/content'
import { createRuntime, type Action, type Link, type Session } from './lib/runtime'
import { type Scenario } from './lib/scenario'
import { copyText } from './lib/unicode'
import {
  historyRevision,
  entryContext,
  replayJournal,
  scrollbackLimit,
  type Checkpoint,
  type ComposerSave,
  type Entry,
  type JournalFrame,
  type TerminalPanel,
} from './lib/workspace'
import type { Engine } from './types'

const props = defineProps<{ content: ReturnType<typeof createContentLoader>; engine: Engine }>()
const devQuery = import.meta.env.DEV ? new URLSearchParams(location.search) : undefined
const debugSelector =
  import.meta.env.DEV && devQuery?.get('debug') === '1'
    ? { label: 'Debug level', optionSuffix: ' · Debug' }
    : undefined
const requestedScenario = devQuery?.get('scenario') ?? undefined
const direct: DirectEntry | undefined = debugSelector
  ? { debug: true, initial: requestedScenario }
  : requestedScenario
const catalog = shallowRef<ScenarioEntry[]>([])
const scenarios = shallowRef<Scenario[]>([])
let campaign: ReturnType<typeof createCampaign> | undefined
const destinations = computed(() =>
  session.value ? catalog.value.filter(({ id }) => campaign?.selectable(id)) : [],
)
const campaignFinished = computed(() => Boolean(session.value && campaign?.finished))
const caseComplete = computed(
  () =>
    session.value?.completed ||
    Boolean(session.value && scenario.value && campaign?.completed(scenario.value.id)),
)
const scenarioId = ref('')
const scenario = shallowRef<Scenario>()
const session = shallowRef<Session>()
const catalogLoading = ref(true)
const loadingError = ref('')
const attempt = ref(0)
const opening = ref(false)
const onboardingKey = 'unicodd.onboarding.v1'
const relayId = '001-the-relay'
const requestId = 'favor'
let storage: Storage | undefined
let readOpeningRequest = false
const busy = ref(false)
const openPanel = ref<TerminalPanel>()
const application = ref<HTMLElement>()
const shortViewport = useVisibleViewport(application)
const terminal = ref<InstanceType<typeof Terminal>>()
const contextVersion = ref(0)
const transcript = shallowRef<Entry[]>([])
const transcriptLive = ref(false)
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
    sessionExpanded: openPanel.value !== undefined,
    sessionPanel: openPanel.value,
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

onMounted(() => {
  window.addEventListener('pagehide', saveOnExit)
})
onUnmounted(() => {
  window.clearTimeout(saveTimer)
  window.removeEventListener('pagehide', saveOnExit)
  runtime = undefined
})

const shortcuts = computed((): Link[] => {
  if (!session.value) return []
  const actions: Link[] = []
  if (session.value.host) {
    actions.push({ label: 'Files', action: { type: 'ls' } })
    for (const operation of runtime?.operations ?? [])
      if (!('quick' in operation) || operation.quick)
        actions.push({ label: operation.actionLabel, action: puzzleAction(operation.command) })
    actions.push({ label: 'Return to the local console', action: { type: 'logout' } })
  } else {
    actions.push({ label: 'Local host directory', action: { type: 'hosts' } })
    if (campaign?.hasInbox) actions.push({ label: 'Local inbox', action: { type: 'mail' } })
  }
  if (catalog.value.length > 1)
    actions.push({ label: 'Local campaign', action: { type: 'campaign', scope: 'local' } })
  actions.push(
    { label: 'Inspect', action: { type: 'inspect' } },
    { label: 'Help', action: { type: 'help' } },
    { label: 'Clear', action: { type: 'clear' } },
  )
  return actions
})

const suggestions = computed(() => (session.value ? (runtime?.suggestions() ?? []) : []))
const hostStatus = computed(() => (session.value ? runtime?.hostStatus : undefined))
const permissionLabel = computed(() => session.value?.identity.role.replaceAll('-', ' ') ?? '')
const goalStatus = computed(() =>
  session.value?.completed ? 'Complete' : caseComplete.value ? 'Completed earlier' : 'In progress',
)
function togglePanel(panel: TerminalPanel) {
  openPanel.value = openPanel.value === panel ? undefined : panel
  scheduleSave()
}

function closePanelWithEscape(event: KeyboardEvent) {
  const panel = openPanel.value
  if (!panel || event.defaultPrevented || event.isComposing || event.keyCode === 229) return
  event.preventDefault()
  togglePanel(panel)
  const header = event.currentTarget as HTMLElement
  header.querySelector<HTMLButtonElement>(`[data-panel="${panel}"]`)?.focus()
}

const newHosts = computed(() => (session.value ? (runtime?.newHosts ?? 0) : 0))
const unreadMail = computed(() => {
  const active = session.value
  if (active && campaign?.hasInbox)
    return active.deliveredMail.filter((id) => !active.readMail.includes(id)).length
})

function needsOpening() {
  const first = scenarios.value.find(
    ({ available, initiallyDiscovered }) => available && initiallyDiscovered,
  )
  if (direct !== undefined || first?.id !== relayId || !first.inbox?.initial.includes(requestId))
    return false
  try {
    return (
      storage?.getItem(campaignKey) == null &&
      storage?.getItem('unicodd.objective.' + relayId) !== 'true' &&
      storage?.getItem(onboardingKey) !== 'seen'
    )
  } catch {
    // A storage object can be present while access to its keys is blocked.
    storage = undefined
    return true
  }
}

async function startCampaign() {
  const definitions = [catalog.value, scenarios.value]
  campaign = createCampaign(scenarios.value, storage, direct)
  await campaign.verifyDossier(props.engine)
  campaign.invalidateHistory(
    revision,
    previousRevision && (await historyRevision(previousRevision, definitions)),
  )
  scenarioId.value = campaign.current
}

async function enterFromOpening() {
  if (!opening.value) return
  opening.value = false
  catalogLoading.value = true
  readOpeningRequest = needsOpening()
  try {
    await startCampaign()
  } catch (error) {
    readOpeningRequest = false
    loadingError.value = error instanceof Error ? error.message : String(error)
  } finally {
    catalogLoading.value = false
  }
}

async function loadCatalog() {
  catalogLoading.value = true
  loadingError.value = ''
  try {
    catalog.value = await props.content.manifest()
    scenarios.value = await props.content.campaign(catalog.value)
    revision = await historyRevision(logicRevision, [catalog.value, scenarios.value])
    try {
      if (direct === undefined) storage = window.localStorage
    } catch {
      // Continue without persistence if the browser blocks storage.
    }
    opening.value = needsOpening()
    if (!opening.value) await startCampaign()
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
  transcriptLive.value = false
  busy.value = true
  loadingError.value = ''
  const saved = campaign.level(id)
  const historyMatches = saved?.revision === revision
  const active = createRuntime(loaded, props.engine, campaign, saved?.runtime)
  runtime = active
  initialComposer.value = saved?.composer
  const savedPanel = saved?.sessionPanel
  openPanel.value =
    saved?.sessionExpanded === true
      ? savedPanel === 'goal' || savedPanel === 'progress'
        ? savedPanel
        : 'session'
      : undefined
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
        direct,
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
  transcriptLive.value = true
  saveLevel()
  if (readOpeningRequest) {
    readOpeningRequest = false
    const response = await dispatch({ type: 'mail', id: requestId, scope: 'local' })
    if (runtime !== active) return
    if (response?.output?.some(({ kind }) => kind === 'mail')) {
      try {
        storage?.setItem(onboardingKey, 'seen')
      } catch {
        // The request is still readable when persistence is unavailable.
      }
    } else {
      terminal.value?.focusTranscript()
    }
  }
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
      terminal.value?.restoreView()
      saveLevel(command !== undefined)
    } else if (response.enter === undefined && (echo || response.output)) {
      const output = response.output ?? []
      const entry: Entry = {
        id: sequence++,
        echo,
        ...entryContext(action, before.host?.id),
        output,
        freshProgress: output.some((row) => 'progress' in row && Boolean(row.progress)),
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
    openPanel.value = undefined
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
  <div
    ref="application"
    class="application"
    :class="{ 'session-expanded': openPanel, 'short-viewport': shortViewport }"
  >
    <main v-if="scenario && session" :key="scenario.id + '/' + attempt" class="workspace">
      <Terminal
        ref="terminal"
        :transcript="transcript"
        :live="transcriptLive"
        :prompt="prompt"
        :connected="Boolean(session.host)"
        :shortcuts="shortcuts"
        :suggestions="suggestions"
        :busy="busy"
        :operations="operations"
        :activity="session"
        :initial-composer="initialComposer"
        :context="scenarioId + '/' + contextVersion"
        :execute="dispatch"
        @action="dispatch"
        @change="scheduleSave"
      >
        <template #title="{ following, unseenProgress, openTitleList, showLatest }">
          <header class="terminal-header" @keydown.esc="closePanelWithEscape">
            <TerminalTitle
              :scenario-id="scenarioId"
              :scenario-title="scenario.title"
              :destinations="destinations"
              :debug-selector="debugSelector"
              :session="session"
              :host-status="hostStatus"
              :permission-label="permissionLabel"
              :goal-status="goalStatus"
              :case-complete="caseComplete"
              :campaign-finished="campaignFinished"
              :transcript-live="transcriptLive"
              :open-panel="openPanel"
              :busy="busy"
              :new-hosts="newHosts"
              :unread-mail="unreadMail"
              :following="following"
              :unseen-progress="unseenProgress"
              @scenario="dispatch({ type: 'scenario', id: $event, scope: 'local' })"
              @panel="togglePanel"
              @list="openTitleList"
              @latest="showLatest"
            />
            <TerminalSession
              :open-panel="openPanel"
              :session="session"
              :host-status="hostStatus"
              :permission-label="permissionLabel"
              :objective="scenario.objective.text"
              :goal-status="goalStatus"
              :case-complete="caseComplete"
              :campaign-finished="campaignFinished"
              :busy="busy"
              @restart="dispatch({ type: 'reset' })"
            />
          </header>
        </template>
      </Terminal>
    </main>
    <main v-else class="startup" :class="{ 'startup-opening': opening }">
      <FirstRun v-if="opening" @read-request="enterFromOpening" />
      <template v-else-if="loadingError">
        <h1>Could not load scenario content</h1>
        <p role="alert" class="error" dir="auto">{{ loadingError }}</p>
        <button type="button" @click="loadCatalog()">Retry</button>
      </template>
      <p v-else-if="catalogLoading || scenarioId" role="status">Loading scenario…</p>
      <p v-else>No scenario is available.</p>
    </main>
  </div>
</template>

<style scoped>
.application {
  display: grid;
  height: var(--app-height, 100dvh);
}
.workspace {
  min-height: 0;
  padding: var(--space-2) var(--space-3);
  display: grid;
  grid-template-columns: minmax(0, 1fr);
}
.terminal-header {
  position: relative;
}
.startup {
  padding: 16px;
}
.startup p {
  margin-block: 6px 10px;
}
.startup-opening {
  min-block-size: 0;
  overflow-y: auto;
  padding: var(--space-2) var(--space-3);
}
@media (max-width: 830px) {
  .workspace,
  .startup-opening {
    padding: var(--space-1);
  }
}
@media (max-width: 600px) {
  .workspace,
  .startup-opening {
    padding: 0;
  }
}
</style>
