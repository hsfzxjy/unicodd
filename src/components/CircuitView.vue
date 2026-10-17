<script setup lang="ts">
import { computed } from 'vue';
import { MarkerType, type Edge, type Node } from '@vue-flow/core';
import dagre from '@dagrejs/dagre';
import { executeGraph } from '../engine/execute';
import { textMetricsGraph } from '../engine/graph';
import type { OperationValue } from '../engine/types';
import { formatCodePoint, formatHex } from '../unicode';

const props = defineProps<{
  scalars: Uint32Array;
  error: string | null;
}>();

const nodeWidth = 214;
const nodeHeight = 102;

function formatValue(value: OperationValue): string {
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
      return `${value.value} byte${value.value === 1 ? '' : 's'}`;
  }
}

const flow = computed(() => {
  if (props.error) return { nodes: [] as Node[], edges: [] as Edge[] };

  const trace = executeGraph(textMetricsGraph, {
    input: { kind: 'scalars', value: props.scalars },
  });
  const layout = new dagre.graphlib.Graph();
  layout.setDefaultEdgeLabel(() => ({}));
  layout.setGraph({ rankdir: 'LR', ranksep: 74, nodesep: 36, marginx: 8, marginy: 8 });

  for (const operation of textMetricsGraph.nodes) {
    layout.setNode(operation.id, { width: nodeWidth, height: nodeHeight });
  }
  for (const edge of textMetricsGraph.edges) layout.setEdge(edge.source, edge.target);
  dagre.layout(layout);

  const nodes: Node[] = textMetricsGraph.nodes.map((operation, index) => {
    const point = layout.node(operation.id);
    const output = trace.outputs.get(operation.id);
    return {
      id: operation.id,
      position: { x: point.x - nodeWidth / 2, y: point.y - nodeHeight / 2 },
      data: {
        label: operation.label,
        type: operation.outputKind,
        value: output ? formatValue(output) : 'No output',
        step: String(index + 1).padStart(2, '0'),
      },
      type: 'operation',
      draggable: false,
      selectable: false,
    };
  });

  const edges: Edge[] = textMetricsGraph.edges.map((edge) => ({
    ...edge,
    type: 'smoothstep',
    markerEnd: MarkerType.ArrowClosed,
    animated: false,
    selectable: false,
  }));

  return { nodes, edges };
});
</script>

<template>
  <section class="panel graph-panel" aria-labelledby="graph-heading">
    <div class="panel-heading graph-heading-row">
      <div>
        <p class="eyebrow">Live operation graph</p>
        <h2 id="graph-heading">Follow the representation.</h2>
      </div>
      <span class="read-only-label">Read only</span>
    </div>
    <p class="supporting-copy graph-intro">
      The pipeline executes on every edit. Each connection carries one explicit value type.
    </p>

    <div v-if="error" class="graph-error" role="status">Graph paused: {{ error }}</div>
    <div v-else class="flow-shell">
      <VueFlow
        :nodes="flow.nodes"
        :edges="flow.edges"
        :nodes-draggable="false"
        :nodes-connectable="false"
        :elements-selectable="false"
        :zoom-on-double-click="false"
        :pan-on-drag="false"
        :min-zoom="0.4"
        :max-zoom="1.3"
        fit-view-on-init
      >
        <template #node-operation="{ data }">
          <article class="operation-node">
            <div class="operation-meta">
              <span>{{ data.step }}</span>
              <span>{{ data.type }}</span>
            </div>
            <strong>{{ data.label }}</strong>
            <code>{{ data.value }}</code>
          </article>
        </template>
      </VueFlow>
    </div>
  </section>
</template>
