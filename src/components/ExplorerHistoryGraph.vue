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
import { useI18n } from '../i18n';
import { displaySequence, formatCodePoint } from '../unicode';

const props = defineProps<{
  history: ExplorerHistory;
}>();

const emit = defineEmits<{
  activate: [nodeId: string];
}>();
const { locale, t } = useI18n();

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
    label: locale.value === 'zh-CN' ? historyRelationLabel(edge.kind) : edge.label,
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

function historyRelationLabel(kind: ExplorerHistory['edges'][number]['kind']): string {
  const labels: Record<typeof kind, string> = {
    selection: '从字符串选择',
    scalar: '标量分量',
    'canonical-decomposition': 'NFD 分量',
    'compatibility-decomposition': 'NFKD 分量',
    search: '搜索结果',
    canonical: '规范关系',
    compatibility: '兼容关系',
    uppercase: '大写',
    lowercase: '小写',
    titlecase: '标题大小写',
    'case-fold': '大小写折叠',
    confusable: '视觉易混淆',
  };
  return labels[kind];
}
</script>

<template>
  <section class="explorer-section history-graph-section" aria-labelledby="history-graph-heading">
    <div class="section-heading history-graph-heading">
      <div>
        <h3 id="history-graph-heading">{{ t('history.title') }}</h3>
        <p>{{ t('history.description') }}</p>
      </div>
      <span>
        {{
          t('history.counts', {
            nodes: history.nodes.length,
            nodeSuffix: history.nodes.length === 1 ? '' : 's',
            links: history.edges.length,
            linkSuffix: history.edges.length === 1 ? '' : 's',
          })
        }}
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
          >
            <span class="visually-hidden">{{ t('history.explore') }} </span>
            <strong>{{ data.display }}</strong>
            <code>{{ data.codePoints }}</code>
          </button>
        </template>
      </VueFlow>
    </div>
  </section>
</template>
