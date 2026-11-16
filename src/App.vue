<script setup lang="ts">
import {
  Check,
  ChevronDown,
  CircleDashed,
  Flag,
  ListChecks,
  Monitor,
  RotateCcw,
  Target,
  Terminal as TerminalIcon,
} from '@lucide/vue'
import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  shallowRef,
  watch,
  type Component,
} from 'vue'
import Terminal from './components/Terminal.vue'
import logicRevision, { previousRevision } from 'virtual:unicodd-logic-revision'
import { createCampaign, type DirectEntry } from './lib/campaign'
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
const busy = ref(false)
const sessionExpanded = ref(false)
const sessionSection = ref('session')
const shortViewport = ref(false)
const application = ref<HTMLElement>()
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
function fitViewport() {
  const layoutHeight = document.documentElement.clientHeight
  const height = viewport?.scale === 1 ? viewport.height : layoutHeight
  shortViewport.value = height <= 540
  if (height < layoutHeight) application.value?.style.setProperty('--app-height', `${height}px`)
  else application.value?.style.removeProperty('--app-height')
}
onMounted(() => {
  fitViewport()
  if (viewport) viewport.addEventListener('resize', fitViewport)
  else window.addEventListener('resize', fitViewport)
  window.addEventListener('pagehide', saveOnExit)
})
onUnmounted(() => {
  window.clearTimeout(saveTimer)
  window.removeEventListener('pagehide', saveOnExit)
  runtime = undefined
  if (viewport) viewport.removeEventListener('resize', fitViewport)
  else window.removeEventListener('resize', fitViewport)
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
interface StatusControl {
  key: string
  name: string
  label?: string
  detail: string
  icon: Component
  reached: boolean
}
const hostChecks = computed<StatusControl[]>(() =>
  (hostStatus.value ?? []).flatMap(({ label, value, reached }, index) =>
    reached === undefined
      ? []
      : [
          {
            key: 'host-' + index,
            name: `Host: ${label}: ${value}`,
            label,
            detail: `${label}: ${value}`,
            icon: reached ? Check : CircleDashed,
            reached,
          },
        ],
  ),
)
const titleStatus = computed<StatusControl[]>(() => {
  const active = session.value
  if (!active) return []
  const role = permissionLabel.value
  const location = active.host ? '@' + active.host.id : 'Local console'
  return [
    {
      key: 'session',
      name: `Session: ${location} ${role}`,
      detail: `${active.host ? 'Connected to ' + active.host.id : 'Local console'}. Signed in as ${active.identity.user}. Permissions: ${role}.`,
      icon: active.host ? TerminalIcon : Monitor,
      reached: Boolean(active.host && active.identity.role !== active.host.guest.role),
    },
    {
      key: 'goal',
      name: 'Goal: ' + goalStatus.value,
      detail: 'Goal: ' + goalStatus.value,
      icon: active.completed ? Check : caseComplete.value ? RotateCcw : Target,
      reached: caseComplete.value,
    },
    ...hostChecks.value,
  ]
})
const hostCheckCount = computed(
  () => `${hostChecks.value.filter(({ reached }) => reached).length}/${hostChecks.value.length}`,
)
const hostCheckDetails = computed(() => hostChecks.value.map(({ detail }) => detail).join('\n'))
const changedStatus = shallowRef(new Set<string>())
const statusAnnouncement = ref('')
watch([titleStatus, campaignFinished], ([current, finished], [previous, wasFinished]) => {
  if (!transcriptLive.value) {
    changedStatus.value = new Set()
    statusAnnouncement.value = ''
    return
  }
  const changed = current.filter(
    (item) => previous.find(({ key }) => key === item.key)?.detail !== item.detail,
  )
  const campaignCompleted = finished && !wasFinished
  if (changed.length || campaignCompleted) {
    changedStatus.value = new Set([
      ...changed.map(({ key }) => key),
      ...(campaignCompleted ? ['campaign'] : []),
    ])
    statusAnnouncement.value = [
      ...changed.map(({ detail }) => detail),
      ...(campaignCompleted ? ['All available scenarios complete'] : []),
    ].join(' ')
  }
})

const sessionPanel = ref<HTMLElement>()

function toggleSession(section = 'session') {
  sessionExpanded.value =
    !sessionExpanded.value || (section !== 'session' && section !== sessionSection.value)
  sessionSection.value = section
  scheduleSave()
  if (sessionExpanded.value) {
    requestAnimationFrame(() => {
      if (!sessionExpanded.value || section !== sessionSection.value) return
      const panel = sessionPanel.value
      const scroll = panel?.parentElement
      if (!panel || !scroll) return
      const target =
        section === 'campaign' ||
        section.startsWith('host-') ||
        (section === 'session' && shortViewport.value)
          ? panel.querySelector<HTMLElement>(`[data-status-key="${section}"]`)
          : null
      scroll.scrollTop = target
        ? target.getBoundingClientRect().top - panel.getBoundingClientRect().top - 6
        : 0
    })
  }
}
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
    const definitions = [catalog.value, scenarios.value]
    revision = await historyRevision(logicRevision, definitions)
    let storage: Storage | undefined
    try {
      if (!direct) storage = window.localStorage
    } catch {
      // Continue without persistence if the browser blocks storage.
    }
    campaign = createCampaign(scenarios.value, storage, direct)
    await campaign.verifyDossier(props.engine)
    campaign.invalidateHistory(
      revision,
      previousRevision && (await historyRevision(previousRevision, definitions)),
    )
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
  transcriptLive.value = false
  busy.value = true
  loadingError.value = ''
  const saved = campaign.level(id)
  const historyMatches = saved?.revision === revision
  const active = createRuntime(loaded, props.engine, campaign, saved?.runtime)
  runtime = active
  initialComposer.value = saved?.composer
  sessionExpanded.value = saved?.sessionExpanded === true
  sessionSection.value = 'session'
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
    sessionExpanded.value = false
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
    :class="{ 'session-expanded': sessionExpanded, 'short-viewport': shortViewport }"
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
        :new-hosts="newHosts"
        :unread-mail="unreadMail"
        :initial-composer="initialComposer"
        :context="scenarioId + '/' + contextVersion"
        :execute="dispatch"
        @action="dispatch"
        @change="scheduleSave"
      >
        <template #scenario>
          <h1 v-if="destinations.length === 1 && !debugSelector" class="terminal-scenario">
            <button
              type="button"
              aria-controls="session-details"
              :aria-expanded="sessionExpanded"
              @click="toggleSession()"
            >
              <bdi>{{ scenario.title }}</bdi>
            </button>
          </h1>
          <select
            v-else
            :value="scenarioId"
            class="terminal-scenario"
            :aria-label="debugSelector?.label ?? 'Case'"
            :disabled="busy"
            @change="
              dispatch({
                type: 'scenario',
                id: ($event.target as HTMLSelectElement).value,
                scope: 'local',
              })
            "
          >
            <option v-for="entry in destinations" :key="entry.id" :value="entry.id">
              {{ entry.label + (debugSelector?.optionSuffix ?? '') }}
            </option>
          </select>
        </template>
        <template #campaign-status>
          <button
            v-if="campaignFinished"
            type="button"
            class="icon-button campaign-status"
            :class="{
              'status-changing': changedStatus.has('campaign'),
              'status-selected': sessionExpanded && sessionSection === 'campaign',
            }"
            aria-label="All available scenarios complete"
            title="All available scenarios complete"
            aria-controls="session-details"
            :aria-expanded="sessionExpanded"
            @click="toggleSession('campaign')"
          >
            <Flag class="status-mark" aria-hidden="true" />
          </button>
        </template>
        <template #session-status>
          <div
            class="session-context-bar"
            :class="{ 'grouped-host-status': hostChecks.length > 1 }"
            role="group"
            aria-label="Session status"
          >
            <button
              v-for="item in titleStatus"
              :key="item.key"
              type="button"
              :class="{
                'session-location': item.key === 'session',
                'host-status-item': item.key.startsWith('host-'),
                'goal-status': item.key === 'goal',
                'status-reached': item.reached,
                'status-changing': changedStatus.has(item.key),
                'status-selected': sessionExpanded && sessionSection === item.key,
              }"
              :aria-label="item.name"
              :aria-description="item.key === 'goal' ? scenario.objective.text : undefined"
              :title="
                item.key === 'goal' ? `${item.detail}\n${scenario.objective.text}` : item.detail
              "
              aria-controls="session-details"
              :aria-expanded="sessionExpanded"
              @click="toggleSession(item.key)"
            >
              <component
                :is="item.icon"
                :key="item.detail"
                class="status-mark"
                aria-hidden="true"
              />
              <span v-if="item.key === 'session'" class="context-label">
                <bdi>{{ session.host ? '@' + session.host.id : 'Local console' }}</bdi
                >{{ ' ' }}
                <bdi class="context-value">{{ permissionLabel }}</bdi>
              </span>
              <span v-else-if="item.key === 'goal'" class="context-label">
                <span class="goal-label">Goal</span>{{ ' ' }}
                <span v-if="caseComplete" class="context-value">{{ goalStatus }}</span>
                <template v-else>
                  <span class="goal-stage context-value">{{ goalStatus }}</span>
                  <bdi class="goal-preview" dir="auto">{{ scenario.objective.text }}</bdi>
                </template>
              </span>
              <bdi v-else-if="item.label" class="check-label">{{ item.label }}</bdi>
              <span v-if="item.label" class="check-short-label">Host</span>
              <ChevronDown
                v-if="item.key === 'session' || item.key === 'goal'"
                class="disclosure-icon"
                aria-hidden="true"
              />
            </button>
            <button
              v-if="hostChecks.length > 1"
              type="button"
              class="host-status-summary"
              :class="{
                'status-selected': sessionExpanded && sessionSection.startsWith('host-'),
                'status-changing': hostChecks.some(({ key }) => changedStatus.has(key)),
              }"
              aria-label="Host status"
              :title="hostCheckDetails"
              aria-controls="session-details"
              :aria-expanded="sessionExpanded"
              @click="toggleSession('host-summary')"
            >
              <ListChecks :key="hostCheckDetails" class="status-mark" aria-hidden="true" />
              <span class="status-count" aria-hidden="true">{{ hostCheckCount }}</span>
            </button>
          </div>
          <p class="milestone-announcement" role="status" dir="auto">{{ statusAnnouncement }}</p>
        </template>
        <template #session-details>
          <aside
            v-show="sessionExpanded"
            id="session-details"
            ref="sessionPanel"
            class="session-layer"
            aria-label="Session context"
          >
            <div class="objective">
              <div class="objective-heading">
                <h2>Goal</h2>
                <span :class="{ 'objective-done': caseComplete }">{{ goalStatus }}</span>
              </div>
              <p dir="auto">{{ scenario.objective.text }}</p>
              <p v-if="caseComplete && !session.completed" class="muted">
                This case still counts as complete. You can replay its goal in this session.
              </p>
              <p v-if="campaignFinished" class="objective-done" data-status-key="campaign">
                All available scenarios complete
              </p>
            </div>
            <div class="session-identity" data-status-key="session">
              <dl class="session-details">
                <div>
                  <dt>Location</dt>
                  <dd>
                    <bdi>{{ session.host?.id ?? 'Local console' }}</bdi>
                  </dd>
                </div>
                <div>
                  <dt>Signed in as</dt>
                  <dd>
                    <bdi>{{ session.identity.user }}</bdi>
                  </dd>
                </div>
                <div v-if="session.identity.user !== permissionLabel">
                  <dt>Permissions</dt>
                  <dd>
                    <bdi>{{ permissionLabel }}</bdi>
                  </dd>
                </div>
              </dl>
              <button
                type="button"
                class="restart-session"
                title="Clears this session’s transcript and drafts. Campaign progress and mail stay saved."
                :disabled="busy"
                @click="dispatch({ type: 'reset' })"
              >
                Restart session
              </button>
            </div>
            <dl
              v-if="hostStatus?.length"
              class="session-details host-details"
              data-status-key="host-summary"
            >
              <div
                v-for="({ label, value, description }, index) in hostStatus"
                :key="index"
                :data-status-key="'host-' + index"
                :class="{ 'status-explained': description }"
              >
                <dt>
                  <bdi>{{ label }}</bdi>
                </dt>
                <dd>
                  <bdi>{{ value }}</bdi>
                  <span v-if="description" class="host-status-description" dir="auto">{{
                    description
                  }}</span>
                </dd>
              </div>
            </dl>
          </aside>
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
