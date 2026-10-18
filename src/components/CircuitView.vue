<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Handle, MarkerType, Position, type Edge, type Node } from '@vue-flow/core';
import dagre from '@dagrejs/dagre';
import { executeGraph } from '../engine/execute';
import type { OperationGraph, OperationNode, OperationValue, ValueKind } from '../engine/types';
import { useI18n } from '../i18n';
import { formatCodePoint, formatHex } from '../unicode';

const props = defineProps<{
  graph: OperationGraph;
  sourceValues: Readonly<Record<string, OperationValue>>;
  error: string | null;
  title: string;
  description: string;
}>();

const nodeWidth = 214;
const nodeHeight = 102;
const selectedOperationId = ref<string | null>(null);
const { t } = useI18n();

const valueKindLabels = computed<Record<ValueKind, string>>(() => ({
  scalars: t('kind.scalars'),
  bytes: t('kind.bytes'),
  utf16: t('kind.utf16'),
  count: t('kind.count'),
  boolean: t('kind.boolean'),
}));

function formatValue(value: OperationValue, unit?: string): string {
  switch (value.kind) {
    case 'scalars':
      return value.value.length
        ? Array.from(value.value, formatCodePoint).join('  ')
        : t('circuit.emptyScalars');
    case 'bytes':
      return value.value.length
        ? Array.from(value.value, (byte) => formatHex(byte)).join(' ')
        : t('circuit.emptyBytes');
    case 'utf16':
      return value.value.length
        ? Array.from(value.value, (unit) => formatHex(unit, 4)).join(' ')
        : t('circuit.emptyUtf16');
    case 'count':
      return unit ? `${value.value} ${unit}` : String(value.value);
    case 'boolean':
      return value.value ? t('circuit.yes') : t('circuit.no');
  }
}

type Port = {
  id: string;
  top: string;
};

function assignAutoPorts(nodes: Node[], edges: Edge[]) {
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const centerY = (id: string) => {
    const node = byId.get(id)!;
    const height = nodeHeight;
    return node.position.y + height / 2;
  };

  function makePorts(connected: Edge[], neighbor: (edge: Edge) => string, prefix: string): Port[] {
    const sorted = [...connected].sort(
      (a, b) => centerY(neighbor(a)) - centerY(neighbor(b)) || a.id.localeCompare(b.id),
    );

    return sorted.map((edge, i) => ({
      id: `${prefix}-${edge.id}`,
      top: `${((i + 1) / (sorted.length + 1)) * 100}%`,
    }));
  }

  const resultNodes = nodes.map((node) => {
    const incoming = edges.filter((e) => e.target === node.id);
    const outgoing = edges.filter((e) => e.source === node.id);

    return {
      ...node,
      data: {
        ...node.data,
        inputPorts: makePorts(incoming, (e) => e.source, 'in'),
        outputPorts: makePorts(outgoing, (e) => e.target, 'out'),
      },
    };
  });

  const resultEdges = edges.map((edge) => ({
    ...edge,
    sourceHandle: `out-${edge.id}`,
    targetHandle: `in-${edge.id}`,
  }));

  return { nodes: resultNodes, edges: resultEdges };
}

const flow = computed(() => {
  if (props.error) return { nodes: [] as Node[], edges: [] as Edge[] };

  const trace = executeGraph(props.graph, props.sourceValues);
  const layout = new dagre.graphlib.Graph();
  layout.setDefaultEdgeLabel(() => ({}));
  layout.setGraph({ rankdir: 'LR', ranksep: 74, nodesep: 36, marginx: 8, marginy: 8 });

  for (const operation of props.graph.nodes) {
    layout.setNode(operation.id, { width: nodeWidth, height: nodeHeight });
  }
  for (const edge of props.graph.edges) layout.setEdge(edge.source, edge.target);
  dagre.layout(layout);

  const nodes: Node[] = props.graph.nodes.map((operation, index) => {
    const point = layout.node(operation.id);
    const output = trace.outputs.get(operation.id);
    return {
      id: operation.id,
      position: { x: point.x - nodeWidth / 2, y: point.y - nodeHeight / 2 },
      data: {
        id: operation.id,
        label: operation.label,
        explanation: operation.explanation,
        type: valueKindLabels.value[operation.outputKind],
        value: output ? formatValue(output, operation.outputUnit) : t('circuit.noOutput'),
        result: output?.kind === 'boolean' ? output.value : null,
        step: String(index + 1).padStart(2, '0'),
      },
      type: 'operation',
      draggable: false,
      selectable: false,
    };
  });

  const edges: Edge[] = props.graph.edges.map((edge) => ({
    ...edge,
    type: 'smoothstep',
    markerEnd: MarkerType.ArrowClosed,
    animated: false,
    selectable: true,
  }));

  const assigned = assignAutoPorts(nodes, edges);

  return { nodes: assigned.nodes, edges: assigned.edges };
});

const selectedOperation = computed(() =>
  props.graph.nodes.find((operation) => operation.id === selectedOperationId.value),
);

const selectedNodeData = computed(
  () => flow.value.nodes.find((node) => node.id === selectedOperationId.value)?.data,
);

watch(
  () => props.graph.nodes.map(({ id }) => id).join('|'),
  () => {
    selectedOperationId.value = null;
  },
);

function describeInputs(operation: OperationNode): string {
  return operation.inputKinds.length
    ? operation.inputKinds.map((kind) => valueKindLabels.value[kind]).join(' + ')
    : t('circuit.input');
}

function describeOutput(operation: OperationNode): string {
  const unit = operation.outputUnit
    ? ` · ${t('circuit.measuredIn', { unit: operation.outputUnit })}`
    : '';
  return `${valueKindLabels.value[operation.outputKind]}${unit}`;
}

function toggleExplanation(id: string): void {
  selectedOperationId.value = selectedOperationId.value === id ? null : id;
}

function closeExplanation(): void {
  selectedOperationId.value = null;
}
</script>

<template>
  <section class="panel graph-panel" aria-labelledby="graph-heading">
    <div class="panel-heading graph-heading-row">
      <div>
        <p class="eyebrow">{{ t('circuit.eyebrow') }}</p>
        <h2 id="graph-heading">{{ title }}</h2>
        <p class="supporting-copy graph-intro">{{ description }} {{ t('circuit.instructions') }}</p>
      </div>
      <span class="read-only-label">{{ t('circuit.readOnly') }}</span>
    </div>

    <div v-if="error" class="graph-error" role="status">
      {{ t('circuit.paused', { error }) }}
    </div>
    <div v-else class="flow-shell" @keydown.esc="closeExplanation">
      <VueFlow
        :nodes="flow.nodes"
        :edges="flow.edges"
        :nodes-draggable="false"
        :nodes-connectable="false"
        :elements-selectable="false"
        :zoom-on-double-click="false"
        :pan-on-drag="true"
        :min-zoom="0.4"
        :max-zoom="1.3"
        :default-viewport="{ x: 16, y: 16, zoom: 0.9 }"
      >
        <template #node-operation="{ data }">
          <div
            class="operation-node"
            :class="{
              'boolean-result': data.result !== null,
              passed: data.result === true,
              selected: selectedOperationId === data.id,
            }"
            role="button"
            tabindex="0"
            :aria-expanded="selectedOperationId === data.id"
            aria-controls="operation-explanation"
            :aria-description="t('circuit.selectDescription')"
            @click.stop="toggleExplanation(data.id)"
            @keydown.enter.prevent.stop="toggleExplanation(data.id)"
            @keydown.space.prevent.stop="toggleExplanation(data.id)"
          >
            <Handle
              v-for="port in data.inputPorts"
              :key="port.id"
              :id="port.id"
              type="target"
              :position="Position.Left"
              :style="{ top: port.top }"
            />

            <div class="operation-meta">
              <span>{{ data.step }}</span>
              <span>{{ data.type }}</span>
              <span class="operation-help" aria-hidden="true"></span>
            </div>
            <strong>{{ data.label }}</strong>
            <code>{{ data.value }}</code>
            <Handle
              v-for="port in data.outputPorts"
              :key="port.id"
              :id="port.id"
              type="source"
              :position="Position.Right"
              :style="{ top: port.top }"
            />
          </div>
        </template>
      </VueFlow>

      <aside
        v-if="selectedOperation"
        id="operation-explanation"
        class="operation-explanation"
        role="region"
        aria-labelledby="operation-explanation-title"
        aria-live="polite"
      >
        <div>
          <p class="eyebrow">
            {{ t('circuit.stepExplanation', { step: selectedNodeData?.step ?? '' }) }}
          </p>
          <h3 id="operation-explanation-title">{{ selectedOperation.label }}</h3>
        </div>
        <button type="button" :aria-label="t('circuit.close')" @click="closeExplanation">×</button>
        <p>{{ selectedOperation.explanation }}</p>
        <dl>
          <div>
            <dt>{{ t('circuit.inputs') }}</dt>
            <dd>{{ describeInputs(selectedOperation) }}</dd>
          </div>
          <div>
            <dt>{{ t('circuit.output') }}</dt>
            <dd>{{ describeOutput(selectedOperation) }}</dd>
          </div>
          <div>
            <dt>{{ t('circuit.currentValue') }}</dt>
            <dd>
              <code>{{ selectedNodeData?.value }}</code>
            </dd>
          </div>
        </dl>
      </aside>
    </div>
  </section>
</template>
