<script setup lang="ts">
import { computed } from 'vue';
import {
  MarkerType,
  type Edge,
  type Node,
  type NodeMouseEvent,
  type VueFlowStore,
} from '@vue-flow/core';
import dagre from '@dagrejs/dagre';
import type { ExplorerHistory } from '../explorer/history';
import { displaySequence, formatCodePoint } from '../unicode';

const props = defineProps<{
  history: ExplorerHistory;
}>();

const emit = defineEmits<{
  activate: [nodeId: string];
}>();

const nodeWidth = 112;
const nodeHeight = 66;

const flow = computed(() => {
  const layout = new dagre.graphlib.Graph();
  layout.setDefaultEdgeLabel(() => ({}));
  layout.setGraph({ rankdir: 'TB', ranksep: 54, nodesep: 42, marginx: 12, marginy: 12 });

  for (const node of props.history.nodes) {
    layout.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  }
  for (const edge of props.history.edges) layout.setEdge(edge.source, edge.target);
  dagre.layout(layout);

  const nodes: Node[] = props.history.nodes.map((node) => {
    const point = layout.node(node.id);
    return {
      id: node.id,
      position: { x: point.x - nodeWidth / 2, y: point.y - nodeHeight / 2 },
      data: {
        display: displaySequence(node.target),
        codePoints: Array.from(node.target, formatCodePoint).join(' · '),
        active: node.id === props.history.activeNodeId,
      },
      type: 'history',
      draggable: false,
      selectable: true,
    };
  });

  const edges: Edge[] = props.history.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    type: 'smoothstep',
    markerEnd: MarkerType.ArrowClosed,
    selectable: false,
  }));

  return { nodes, edges };
});

const renderKey = computed(
  () =>
    `${props.history.nodes.length}:${props.history.edges.length}:${props.history.activeNodeId ?? ''}`,
);

function activateNode({ node }: NodeMouseEvent): void {
  emit('activate', node.id);
}

function fitGraph(store: VueFlowStore): void {
  void store.fitView({ padding: '16px', maxZoom: 1.1 });
}
</script>

<template>
  <section class="explorer-section history-graph-section" aria-labelledby="history-graph-heading">
    <div class="section-heading history-graph-heading">
      <div>
        <h3 id="history-graph-heading">Exploration map</h3>
        <p>Choose any visited sequence, then explore again to create a branch.</p>
      </div>
      <span>
        {{ history.nodes.length }} node{{ history.nodes.length === 1 ? '' : 's' }} ·
        {{ history.edges.length }} link{{ history.edges.length === 1 ? '' : 's' }}
      </span>
    </div>
    <div class="history-flow-shell">
      <VueFlow
        :key="renderKey"
        :nodes="flow.nodes"
        :edges="flow.edges"
        :nodes-draggable="false"
        :nodes-connectable="false"
        :elements-selectable="true"
        :zoom-on-scroll="false"
        :zoom-on-double-click="false"
        :pan-on-drag="true"
        :min-zoom="0.45"
        :max-zoom="1.15"
        @node-click="activateNode"
        @pane-ready="fitGraph"
      >
        <template #node-history="{ data }">
          <button
            type="button"
            class="history-node nodrag nopan"
            :class="{ active: data.active }"
            :aria-current="data.active ? 'true' : undefined"
            :aria-label="`Explore ${data.codePoints}`"
          >
            <strong>{{ data.display }}</strong>
            <code>{{ data.codePoints }}</code>
          </button>
        </template>
      </VueFlow>
    </div>
  </section>
</template>
