<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Handle, MarkerType, Position, type Edge, type Node } from '@vue-flow/core';
import dagre from '@dagrejs/dagre';
import { executeGraph } from '../engine/execute';
import type { OperationGraph, OperationNode, OperationValue, ValueKind } from '../engine/types';
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

const valueKindLabels: Record<ValueKind, string> = {
  scalars: 'Unicode scalars',
  bytes: 'raw bytes',
  utf16: 'UTF-16 code units',
  count: 'numeric count',
  boolean: 'yes/no result',
};

function formatValue(value: OperationValue, unit?: string): string {
  switch (value.kind) {
    case 'scalars':
      return value.value.length
        ? Array.from(value.value, formatCodePoint).join('  ')
        : 'Empty scalar sequence';
    case 'bytes':
      return value.value.length
        ? Array.from(value.value, (byte) => formatHex(byte)).join(' ')
        : 'Empty byte sequence';
    case 'utf16':
      return value.value.length
        ? Array.from(value.value, (unit) => formatHex(unit, 4)).join(' ')
        : 'Empty code-unit sequence';
    case 'count':
      return unit ? `${value.value} ${unit}` : String(value.value);
    case 'boolean':
      return value.value ? 'Yes' : 'No';
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
        type: operation.outputKind,
        value: output ? formatValue(output, operation.outputUnit) : 'No output',
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
    ? operation.inputKinds.map((kind) => valueKindLabels[kind]).join(' + ')
    : 'Puzzle input';
}

function describeOutput(operation: OperationNode): string {
  const unit = operation.outputUnit ? ` · measured in ${operation.outputUnit}` : '';
  return `${valueKindLabels[operation.outputKind]}${unit}`;
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
        <p class="eyebrow">Live operation graph</p>
        <h2 id="graph-heading">{{ title }}</h2>
        <p class="supporting-copy graph-intro">
          {{ description }} Select a node to explain it. Drag the canvas to pan when needed.
        </p>
      </div>
      <span class="read-only-label">Read only</span>
    </div>

    <div v-if="error" class="graph-error" role="status">Graph paused: {{ error }}</div>
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
            aria-description="Select for an explanation of this operation."
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
          <p class="eyebrow">Step {{ selectedNodeData?.step }} · Operation explanation</p>
          <h3 id="operation-explanation-title">{{ selectedOperation.label }}</h3>
        </div>
        <button type="button" aria-label="Close operation explanation" @click="closeExplanation">
          ×
        </button>
        <p>{{ selectedOperation.explanation }}</p>
        <dl>
          <div>
            <dt>Input</dt>
            <dd>{{ describeInputs(selectedOperation) }}</dd>
          </div>
          <div>
            <dt>Output</dt>
            <dd>{{ describeOutput(selectedOperation) }}</dd>
          </div>
          <div>
            <dt>Current</dt>
            <dd>
              <code>{{ selectedNodeData?.value }}</code>
            </dd>
          </div>
        </dl>
      </aside>
    </div>
  </section>
</template>
