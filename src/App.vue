<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import PayloadEditor from './components/PayloadEditor.vue'
import TraceValue from './components/TraceValue.vue'
import Workbench from './components/Workbench.vue'
import type { Span } from './lib/unicode'
import type { Engine, EngineError, Evaluation, Target } from './types'

const props = defineProps<{ targets: readonly Target[]; engine: Engine }>()
const targetId = ref(props.targets[0]?.id ?? '')
const target = computed(() => props.targets.find(item => item.id === targetId.value))
const editors = new Map<string, InstanceType<typeof PayloadEditor>>()
const drafts = new Map<string, Record<string, string>>()
const draft = ref<Record<string, string>>(Object.create(null))
const composing = ref<string[]>([])
const active = ref<string>()
const workbench = ref<InstanceType<typeof Workbench>>()
const result = shallowRef<Evaluation>()
const validationError = shallowRef<EngineError>()
const submitError = shallowRef<EngineError>()
const phase = ref<'validating' | 'pending' | 'evaluating' | 'complete' | 'error'>('pending')
const status = computed(() => {
  switch (phase.value) {
    case 'validating': return 'Checking definition…'
    case 'pending': return 'Pending'
    case 'evaluating': return 'Evaluating…'
    case 'complete': return result.value?.solved ? 'Passed' : 'Failed'
    case 'error': return 'Error'
  }
})
let revision = 0
let context: { id: string; span: Span } | undefined
let returnTo: HTMLElement | undefined
let applied = false

watch(target, async (selected, _, onCleanup) => {
  let stale = false
  onCleanup(() => { stale = true })
  revision++
  result.value = undefined
  validationError.value = undefined
  submitError.value = undefined
  active.value = undefined
  composing.value = []
  phase.value = 'pending'
  if (!selected) return
  let values = drafts.get(selected.id)
  if (!values) {
    values = Object.assign(Object.create(null), Object.fromEntries(
      selected.program.inputs.map(id => [id, payloadMeta(selected, id)?.initial ?? '']),
    )) as Record<string, string>
    drafts.set(selected.id, values)
  }
  draft.value = values
  phase.value = 'validating'
  const response = await props.engine.validate(selected.program)
  if (stale) return
  if (!response.ok) validationError.value = response.error
  phase.value = response.ok ? 'pending' : 'error'
}, { immediate: true })

function payloadMeta(selected: Target, id: string) {
  return selected.payloads && Object.hasOwn(selected.payloads, id) ? selected.payloads[id] : undefined
}

function checkMeta(id: string) {
  const checks = target.value?.checks
  return checks && Object.hasOwn(checks, id) ? checks[id] : undefined
}

function setDraft(id: string, value: string) {
  if (draft.value[id] === value) return
  draft.value[id] = value
  revision++
  result.value = undefined
  submitError.value = undefined
  if (phase.value !== 'validating') phase.value = validationError.value ? 'error' : 'pending'
}

function setComposing(id: string, value: boolean) {
  composing.value = value ? [...new Set([...composing.value, id])] : composing.value.filter(item => item !== id)
}

async function submit() {
  if (!target.value || validationError.value || composing.value.length ||
    phase.value === 'validating' || phase.value === 'evaluating') return
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
  workbench.value?.open(context && target.value ? {
    label: payloadMeta(target.value, context.id)?.label ?? context.id,
    span: context.span,
  } : undefined, scalar)
}

function globalWorkbench() {
  const id = active.value
  openBench(id, id === undefined ? undefined : editors.get(id)?.context())
}

function applyCharacter(scalar: string, mode: 'insert' | 'replace') {
  if (!context) return
  const { id, span } = context
  applied = true
  void nextTick(() => editors.get(id)?.apply(
    mode === 'insert' ? { start: span.start, end: span.start } : span, scalar,
  ))
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
        <select v-model="targetId" aria-label="Target" :disabled="!targets.length">
          <option v-if="!targets.length" value="">No targets</option>
          <option v-for="item in targets" :key="item.id" :value="item.id">{{ item.title }}</option>
        </select>
      </label>
      <button type="button" class="nav-workbench" :disabled="!!composing.length" @click="globalWorkbench">Workbench</button>
    </div>
  </header>

  <main v-if="target" :key="target.id" class="shell">
    <header class="brief">
      <h1><bdi>{{ target.title }}</bdi></h1>
      <p v-if="target.description" class="meta"><bdi>{{ target.description }}</bdi></p>
      <p class="objective" dir="auto">{{ target.objective }}</p>
    </header>

    <div class="workspace">
      <form class="workspace-panel" aria-labelledby="payload-heading" @submit.prevent="submit">
        <h2 id="payload-heading" class="panel-heading">Payloads</h2>
        <div class="payloads">
          <PayloadEditor
            v-for="id in target.program.inputs" :key="id"
            :ref="editor => editor ? editors.set(id, editor as InstanceType<typeof PayloadEditor>) : editors.delete(id)"
            :label="payloadMeta(target, id)?.label ?? id" :model-value="draft[id] ?? ''"
            @update:model-value="setDraft(id, $event)" @active="active = id"
            @composition="setComposing(id, $event)"
            @workbench="(span, scalar) => openBench(id, span, scalar)"
          />
          <p v-if="!target.program.inputs.length" class="muted">This target has no editable inputs.</p>
        </div>
        <div class="submit-row toolbar">
          <button type="submit" class="primary"
            :disabled="!!validationError || !!composing.length || phase === 'validating' || phase === 'evaluating'"
          >Submit</button>
        </div>
      </form>

      <section class="workspace-panel verification" aria-labelledby="verification-heading">
        <div class="panel-heading verification-head">
          <h2 id="verification-heading">Verification</h2>
          <span role="status" class="status" :class="phase === 'complete' ? (result?.solved ? 'pass' : 'fail') : phase">
            {{ status }}
          </span>
        </div>
        <div v-if="validationError || submitError" class="diagnostic error" role="alert">
          <template v-for="diagnostic in [validationError ?? submitError!]" :key="diagnostic.code">
            <code>{{ diagnostic.code }}<template v-if="diagnostic.path"> · <bdi>{{ diagnostic.path }}</bdi></template></code>
            <p>{{ diagnostic.message }}</p>
          </template>
        </div>
        <ul class="check-list">
          <li v-for="(check, index) in target.program.checks" :key="index" class="check-row">
            <div>
              <div class="check-label"><bdi>{{ checkMeta(check.id)?.label ?? check.id }}</bdi></div>
              <div class="check-values meta">
                <span>Expected <code>{{ check.expected }}</code></span>
                <span v-if="result?.checks[index]">Actual <code>{{ result.checks[index].actual }}</code></span>
                <span v-if="check.required === false">Optional</span>
              </div>
              <p v-if="checkMeta(check.id)?.detail" class="check-detail" dir="auto">{{ checkMeta(check.id)?.detail }}</p>
            </div>
            <span v-if="result?.checks[index]" class="status" :class="result.checks[index].passed ? 'pass' : 'fail'">
              {{ result.checks[index].passed ? '✓ PASS' : '× FAIL' }}
            </span>
            <span v-else class="meta" aria-hidden="true">—</span>
          </li>
        </ul>
        <p v-if="!target.program.checks.length" class="muted diagnostic">No verification checks.</p>
        <details v-if="result?.trace?.length" class="analysis">
          <summary>Analysis <span class="meta">{{ result.trace.length }} nodes</span></summary>
          <ol>
            <li v-for="node in result.trace" :key="node.id" class="trace-row">
              <div class="trace-head">
                <code><bdi>{{ node.id }}</bdi></code>
                <span class="meta">{{ node.op }} · {{ node.result.type }}</span>
              </div>
              <p v-if="node.dependencies.length" class="meta">From <bdi>{{ node.dependencies.join(', ') }}</bdi></p>
              <TraceValue :value="node.result" />
            </li>
          </ol>
        </details>
        <p v-if="result && target.output?.[result.solved ? 'passed' : 'failed']" class="system-output mono" dir="auto">
          {{ target.output[result.solved ? 'passed' : 'failed'] }}
        </p>
      </section>
    </div>
  </main>

  <main v-else class="shell empty">
    <h1>No puzzle loaded</h1>
    <p class="muted">Loaded targets appear in the selector. You can still inspect characters in the Workbench.</p>
    <button type="button" @click="globalWorkbench">Open Workbench</button>
  </main>

  <Workbench ref="workbench" :engine="engine" @apply="applyCharacter" @close="closeBench" />
</template>
