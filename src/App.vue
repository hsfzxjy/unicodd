<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import PayloadEditor from './components/PayloadEditor.vue'
import TraceValue from './components/TraceValue.vue'
import Workbench from './components/Workbench.vue'
import type { createContentLoader, LevelEntry } from './lib/content'
import type { Span } from './lib/unicode'
import type { Engine, EngineError, Evaluation, Target } from './types'

const props = defineProps<{ content: ReturnType<typeof createContentLoader>; engine: Engine }>()
const levels = shallowRef<LevelEntry[]>([])
const targetId = ref('')
const target = shallowRef<Target>()
const catalogLoading = ref(true)
const catalogError = ref('')
const levelError = ref('')
const levelAttempt = ref(0)
const editors = new Map<string, InstanceType<typeof PayloadEditor>>()
const drafts = new Map<string, Map<string, string>>()
const draft = shallowRef<Record<string, string>>({})
const composing = ref<string[]>([])
const active = ref<string>()
const workbench = ref<InstanceType<typeof Workbench>>()
const result = shallowRef<Evaluation>()
const submitError = shallowRef<EngineError>()
const phase = ref<'pending' | 'evaluating' | 'complete' | 'error'>('pending')
const status = computed(() => {
  switch (phase.value) {
    case 'pending':
      return 'Pending'
    case 'evaluating':
      return 'Evaluating…'
    case 'complete':
      return result.value?.solved ? 'Passed' : 'Failed'
    case 'error':
      return 'Error'
  }
})
let revision = 0
let context: { id: string; span: Span } | undefined
let returnTo: HTMLElement | undefined
let applied = false

async function loadCatalog() {
  catalogLoading.value = true
  catalogError.value = ''
  try {
    levels.value = await props.content.manifest()
    targetId.value = levels.value.find((level) => level.available)?.id ?? ''
  } catch (error) {
    catalogError.value = error instanceof Error ? error.message : String(error)
  } finally {
    catalogLoading.value = false
  }
}

watch([targetId, levelAttempt], async ([id], _, onCleanup) => {
  let stale = false
  onCleanup(() => {
    stale = true
  })
  revision++
  target.value = undefined
  result.value = undefined
  levelError.value = ''
  submitError.value = undefined
  active.value = undefined
  composing.value = []
  phase.value = 'pending'
  const entry = levels.value.find((level) => level.id === id && level.available)
  if (!entry) return
  try {
    const loaded = await props.content.level(entry)
    if (stale) return
    const edits = drafts.get(id)
    draft.value = Object.fromEntries(
      loaded.program.inputs.map((input) => [
        input,
        edits?.get(input) ?? loaded.initialInputs[input],
      ]),
    )
    target.value = loaded
  } catch (error) {
    if (!stale) levelError.value = error instanceof Error ? error.message : String(error)
  }
})

void loadCatalog()

function setDraft(id: string, value: string) {
  if (!target.value || draft.value[id] === value) return
  draft.value = { ...draft.value, [id]: value }
  let edits = drafts.get(target.value.id)
  if (!edits) drafts.set(target.value.id, (edits = new Map()))
  edits.set(id, value)
  revision++
  result.value = undefined
  submitError.value = undefined
  phase.value = 'pending'
}

function setComposing(id: string, value: boolean) {
  composing.value = value
    ? [...new Set([...composing.value, id])]
    : composing.value.filter((item) => item !== id)
}

async function submit() {
  if (!target.value || composing.value.length || phase.value === 'evaluating') return
  const request = ++revision
  phase.value = 'evaluating'
  result.value = undefined
  submitError.value = undefined
  const response = await props.engine.evaluate(target.value.program, { ...draft.value }, true)
  if (request !== revision) return
  if (response.ok) result.value = response.value
  else submitError.value = response.error
  phase.value = response.ok ? 'complete' : 'error'
}

function openBench(id?: string, span?: Span, scalar?: string) {
  if (composing.value.length) return
  context = id !== undefined && span ? { id, span } : undefined
  returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
  applied = false
  workbench.value?.open(
    context && target.value
      ? {
          label: target.value.narrative.inputs[context.id],
          span: context.span,
        }
      : undefined,
    scalar,
  )
}

function globalWorkbench() {
  const id = active.value
  openBench(id, id === undefined ? undefined : editors.get(id)?.context())
}

function applyCharacter(scalar: string, mode: 'insert' | 'replace') {
  if (!context) return
  const { id, span } = context
  applied = true
  void nextTick(() =>
    editors
      .get(id)
      ?.apply(mode === 'insert' ? { start: span.start, end: span.start } : span, scalar),
  )
}

function closeBench() {
  if (!applied) returnTo?.focus()
  context = undefined
  returnTo = undefined
}
</script>

<template>
  <header class="app-header">
    <div class="header-inner">
      <span class="wordmark">unicodd<span aria-hidden="true">_</span></span>
      <label class="target-select">
        <span class="target-caption">Target</span>
        <select
          v-model="targetId"
          aria-label="Target"
          :disabled="!levels.some((level) => level.available)"
        >
          <option v-if="!targetId" value="">
            {{ catalogLoading ? 'Loading…' : 'No targets' }}
          </option>
          <option
            v-for="item in levels"
            :key="item.id"
            :value="item.id"
            :disabled="!item.available"
          >
            {{ item.label }}{{ item.available ? '' : ' (Unavailable)' }}
          </option>
        </select>
      </label>
      <button
        type="button"
        class="nav-workbench"
        aria-haspopup="dialog"
        :disabled="!!composing.length"
        @click="globalWorkbench"
      >
        Workbench
      </button>
    </div>
  </header>

  <main v-if="target" :key="target.id" class="shell">
    <header class="brief">
      <h1>
        <bdi>{{ target.narrative.title }}</bdi>
      </h1>
      <p class="meta">
        <code
          ><bdi>{{ target.narrative.system }}</bdi></code
        >
        · <bdi>{{ target.narrative.description }}</bdi>
      </p>
      <p class="objective" dir="auto">{{ target.narrative.objective }}</p>
      <ul v-if="target.narrative.introduction.length" class="terminal-lines mono">
        <li v-for="(line, index) in target.narrative.introduction" :key="index" dir="auto">
          {{ line }}
        </li>
      </ul>
      <details v-if="target.narrative.hints?.length" class="hints">
        <summary>{{ target.narrative.hints.length === 1 ? 'Hint' : 'Hints' }}</summary>
        <p v-for="(hint, index) in target.narrative.hints" :key="index" dir="auto">{{ hint }}</p>
      </details>
    </header>

    <div class="workspace">
      <form class="workspace-panel" aria-labelledby="payload-heading" @submit.prevent="submit">
        <h2 id="payload-heading" class="panel-heading">Payloads</h2>
        <div class="payloads">
          <PayloadEditor
            v-for="id in target.program.inputs"
            :key="id"
            :ref="
              (editor) =>
                editor
                  ? editors.set(id, editor as InstanceType<typeof PayloadEditor>)
                  : editors.delete(id)
            "
            :label="target.narrative.inputs[id]"
            :model-value="draft[id]"
            @update:model-value="setDraft(id, $event)"
            @active="active = id"
            @composition="setComposing(id, $event)"
            @workbench="(span, scalar) => openBench(id, span, scalar)"
          />
          <p v-if="!target.program.inputs.length" class="muted">
            This target has no editable inputs.
          </p>
        </div>
        <div class="submit-row toolbar">
          <button
            type="submit"
            class="primary"
            :disabled="!!composing.length || phase === 'evaluating'"
          >
            Submit
          </button>
        </div>
      </form>

      <section class="workspace-panel verification" aria-labelledby="verification-heading">
        <div class="panel-heading verification-head">
          <h2 id="verification-heading">Verification</h2>
          <span
            role="status"
            class="status"
            :class="phase === 'complete' ? (result?.solved ? 'pass' : 'fail') : phase"
          >
            {{ status }}
          </span>
        </div>
        <div v-if="submitError" class="diagnostic error" role="alert">
          <code
            >{{ submitError.code
            }}<template v-if="submitError.path">
              · <bdi>{{ submitError.path }}</bdi></template
            ></code
          >
          <p v-if="submitError.code === 'invalid_input' && submitError.offset !== undefined">
            This payload contains an unpaired surrogate. Open Code points to find and remove it.
          </p>
          <p v-else>{{ submitError.message }}</p>
        </div>
        <ul class="check-list">
          <li v-for="(check, index) in target.program.checks" :key="check.id" class="check-row">
            <div>
              <div class="check-label">
                <bdi>{{ target.narrative.checks[check.id].label }}</bdi>
              </div>
              <div class="check-values meta">
                <span
                  >Expected <code>{{ check.expected }}</code></span
                >
                <span v-if="result?.checks[index]"
                  >Actual <code>{{ result.checks[index].actual }}</code></span
                >
                <span v-if="check.required === false">Optional</span>
              </div>
              <p class="check-detail" dir="auto">
                {{ target.narrative.checks[check.id].detail }}
              </p>
            </div>
            <span
              v-if="result?.checks[index]"
              class="status"
              :class="result.checks[index].passed ? 'pass' : 'fail'"
            >
              {{ result.checks[index].passed ? '✓ PASS' : '× FAIL' }}
            </span>
            <span v-else class="meta" aria-hidden="true">—</span>
          </li>
        </ul>
        <p v-if="!target.program.checks.length" class="muted diagnostic">No verification checks.</p>
        <div aria-live="polite">
          <div v-if="result" class="system-output" :class="result.solved ? 'success-output' : ''">
            <p class="mono" dir="auto">
              {{ target.narrative.feedback[result.solved ? 'passed' : 'failed'] }}
            </p>
            <p v-if="result.solved && target.narrative.recovered" class="recovered mono" dir="auto">
              {{ target.narrative.recovered }}
            </p>
            <p v-if="result.solved && target.narrative.nextTarget" dir="auto">
              {{ target.narrative.nextTarget }}
            </p>
          </div>
        </div>
        <details v-if="result?.trace?.length" class="analysis">
          <summary>
            Analysis <span class="meta">{{ result.trace.length }} nodes</span>
          </summary>
          <ol>
            <li v-for="node in result.trace" :key="node.id" class="trace-row">
              <div class="trace-head">
                <code
                  ><bdi>{{ node.id }}</bdi></code
                >
                <span class="meta">{{ node.op }} · {{ node.result.type }}</span>
              </div>
              <p v-if="node.dependencies.length" class="meta">
                From <bdi>{{ node.dependencies.join(', ') }}</bdi>
              </p>
              <TraceValue :value="node.result" />
            </li>
          </ol>
          <p v-if="result.traceTruncated" class="diagnostic muted">
            Trace stopped at the output size limit.
          </p>
        </details>
      </section>
    </div>
  </main>

  <main v-else-if="catalogError || levelError" class="shell empty">
    <h1>{{ catalogError ? 'Could not load targets' : 'Could not load target' }}</h1>
    <p role="alert" class="error" dir="auto">{{ catalogError || levelError }}</p>
    <button type="button" @click="catalogError ? loadCatalog() : levelAttempt++">Retry</button>
  </main>

  <main v-else-if="catalogLoading || targetId" class="shell empty">
    <p role="status">{{ catalogLoading ? 'Loading targets…' : 'Loading target…' }}</p>
  </main>

  <main v-else class="shell empty">
    <h1>No puzzle loaded</h1>
    <p class="muted">
      Loaded targets appear in the selector. The Workbench is available on its own.
    </p>
  </main>

  <Workbench ref="workbench" :engine="engine" @apply="applyCharacter" @close="closeBench" />
</template>
