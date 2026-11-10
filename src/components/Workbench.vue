<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { describe, inspect, lookup, type Span } from '../lib/unicode'
import { forms, type Engine, type Normalization, type Result } from '../types'

const props = defineProps<{ engine: Engine }>()
const emit = defineEmits<{ apply: [string, 'insert' | 'replace']; close: [] }>()
const dialog = ref<HTMLDialogElement>()
const search = ref<HTMLInputElement>()
const query = ref('')
const invalid = ref(false)
const current = ref('')
const context = ref<{ label: string; span: Span }>()
const history = ref<string[]>([])
const results = ref<{ form: Normalization; result: Result<string> }[]>([])
const loading = ref(false)
const point = computed(() => current.value ? describe(current.value) : undefined)
const recent = ref(readList('recent'))
const favorites = ref(readList('favorites'))
const saved = computed(() => favorites.value.includes(current.value))

function readList(key: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem('unicodd.' + key) ?? '[]')
    return Array.isArray(value)
      ? [...new Set(value.filter((item): item is string => typeof item === 'string' && lookup(item) === item))].slice(0, 32)
      : []
  } catch {
    return []
  }
}

function storeList(key: string, values: string[]) {
  try { localStorage.setItem('unicodd.' + key, JSON.stringify(values)) } catch { /* Session state still works. */ }
}

function visit(scalar: string, push = true) {
  if (push && current.value && current.value !== scalar) history.value = [...history.value, current.value].slice(-32)
  current.value = scalar
  query.value = describe(scalar).notation
  invalid.value = false
  recent.value = [scalar, ...recent.value.filter(item => item !== scalar)].slice(0, 12)
  storeList('recent', recent.value)
}

function find() {
  const scalar = lookup(query.value)
  invalid.value = scalar === undefined
  if (scalar !== undefined) visit(scalar)
}

function back() {
  const scalar = history.value.pop()
  if (scalar) visit(scalar, false)
}

function favorite() {
  favorites.value = saved.value
    ? favorites.value.filter(item => item !== current.value)
    : [current.value, ...favorites.value].slice(0, 32)
  storeList('favorites', favorites.value)
}

watch(current, async (scalar, _, onCleanup) => {
  let stale = false
  onCleanup(() => { stale = true })
  results.value = []
  loading.value = Boolean(scalar)
  if (!scalar) return
  const normalized = await Promise.all(forms.map(async form => ({ form, result: await props.engine.normalize(scalar, form) })))
  if (stale) return
  results.value = normalized
  loading.value = false
})

function open(edit?: { label: string; span: Span }, scalar?: string) {
  context.value = edit
  if (scalar) visit(scalar)
  dialog.value?.showModal()
  void nextTick(() => {
    // Leave touch users in control of when to open the software keyboard.
    if (matchMedia('(pointer: fine)').matches) search.value?.select()
  })
}

function apply(mode: 'insert' | 'replace') {
  emit('apply', current.value, mode)
  dialog.value?.close()
}

defineExpose({ open })
</script>

<template>
  <dialog ref="dialog" class="workbench" aria-labelledby="workbench-title" @close="emit('close')">
    <header class="bench-head">
      <h2 id="workbench-title">Unicode Workbench</h2>
      <button type="button" autofocus @click="dialog?.close()">Close</button>
    </header>
    <div class="bench-body">
      <form class="lookup" @submit.prevent="find">
        <label for="unicode-lookup">Character or hex code point</label>
        <div class="toolbar lookup-controls">
          <input
            id="unicode-lookup" ref="search" v-model="query" placeholder="U+00E9"
            dir="auto" spellcheck="false" autocomplete="off" autocapitalize="off" enterkeyhint="search"
            :aria-invalid="invalid || undefined" :aria-describedby="invalid ? 'lookup-error' : undefined"
            @input="invalid = false"
          >
          <button type="submit" class="primary">Look up</button>
          <button type="button" :disabled="!history.length" @click="back">Back</button>
        </div>
        <p v-if="invalid" id="lookup-error" class="error" role="alert">Enter one Unicode scalar or a hex code such as U+00E9.</p>
      </form>

      <template v-if="point">
        <div class="character">
          <bdi class="character-glyph">{{ point.glyph }}</bdi>
          <code>{{ point.notation }}</code>
          <button type="button" :aria-pressed="saved" @click="favorite">{{ saved ? 'Favorited' : 'Favorite' }}</button>
        </div>
        <section aria-labelledby="normalization-heading" class="bench-section">
          <h3 id="normalization-heading">Normalization</h3>
          <p v-if="loading" class="muted" role="status">Normalizing…</p>
          <template v-else-if="results.length">
            <p v-if="!results[0].result.ok" class="error" role="alert">{{ results[0].result.error.message }}</p>
            <div v-for="{ form, result } in results" v-else :key="form" class="normalization-row">
              <code>{{ form }}</code>
              <template v-if="result.ok">
                <bdi class="normalized-text">{{ result.value }}</bdi>
                <div class="toolbar">
                  <button
                    v-for="item in inspect(result.value)" :key="item.start" type="button" class="related"
                    :aria-label="`${form}: inspect ${item.notation}, ${item.glyph}`" @click="visit(item.scalar)"
                  >{{ item.notation }}</button>
                </div>
              </template>
              <p v-else class="error">{{ result.error.message }}</p>
            </div>
          </template>
        </section>
      </template>

      <section v-for="[label, list] in [['Recent', recent], ['Favorites', favorites]] as const" :key="label" class="bench-section">
        <h3>{{ label }}</h3>
        <div v-if="list.length" class="toolbar reuse">
          <button
            v-for="item in list" :key="item" type="button" class="point"
            :aria-label="`Inspect ${describe(item).notation}, ${describe(item).glyph}`" @click="visit(item)"
          ><bdi>{{ describe(item).glyph }}</bdi><code>{{ describe(item).notation }}</code></button>
        </div>
        <p v-else class="muted">{{ label === 'Recent' ? 'No recent characters.' : 'No favorites yet.' }}</p>
      </section>
    </div>
    <footer v-if="context" class="bench-footer">
      <p class="meta"><bdi>{{ context.label }}</bdi> · {{ context.span.start === context.span.end
        ? `caret at UTF-16 ${context.span.start}` : `UTF-16 ${context.span.start}–${context.span.end}` }}</p>
      <div class="toolbar">
        <button type="button" class="primary" :disabled="!point" @click="apply('insert')">Insert</button>
        <button type="button" :disabled="!point || context.span.start === context.span.end" @click="apply('replace')">Replace</button>
      </div>
    </footer>
  </dialog>
</template>
