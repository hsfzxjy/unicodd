import { unicodeScalarArraysEqual } from '../unicode';
import type { RelationshipKind } from './discoveryTypes';

export type ExplorationRelationKind =
  | 'selection'
  | 'scalar'
  | 'canonical-decomposition'
  | 'compatibility-decomposition'
  | 'search'
  | RelationshipKind;

export interface ExplorationRelation {
  kind: ExplorationRelationKind;
  label: string;
}

export interface ExplorerHistoryNode {
  id: string;
  target: Uint32Array;
}

export interface ExplorerHistoryEdge extends ExplorationRelation {
  id: string;
  source: string;
  target: string;
}

export interface ExplorerHistory {
  nodes: ExplorerHistoryNode[];
  edges: ExplorerHistoryEdge[];
  activeNodeId: string | null;
}

export function createExplorerHistory(): ExplorerHistory {
  return { nodes: [], edges: [], activeNodeId: null };
}

export function addExploration(
  history: ExplorerHistory,
  target: Uint32Array,
  relation: ExplorationRelation,
): ExplorerHistory {
  if (target.length === 0) return history;
  const current = history.nodes.find(({ id }) => id === history.activeNodeId);
  if (current && unicodeScalarArraysEqual(current.target, target)) return history;

  const targetId = nodeId(target);
  const existingTarget = history.nodes.find(({ id }) => id === targetId);
  const nodes = existingTarget
    ? history.nodes
    : [...history.nodes, { id: targetId, target: target.slice() }];

  if (!current) return { nodes, edges: history.edges, activeNodeId: targetId };

  const edgeId = `${current.id}:${targetId}:${relation.kind}:${relation.label}`;
  const edges = history.edges.some(({ id }) => id === edgeId)
    ? history.edges
    : [
        ...history.edges,
        {
          id: edgeId,
          source: current.id,
          target: targetId,
          kind: relation.kind,
          label: relation.label,
        },
      ];

  return { nodes, edges, activeNodeId: targetId };
}

export function activateExploration(history: ExplorerHistory, nodeId: string): ExplorerHistory {
  if (history.activeNodeId === nodeId || !history.nodes.some(({ id }) => id === nodeId)) {
    return history;
  }
  return { ...history, activeNodeId: nodeId };
}

function nodeId(target: Uint32Array): string {
  return `sequence-${Array.from(target, (scalar) => scalar.toString(16)).join('-')}`;
}
