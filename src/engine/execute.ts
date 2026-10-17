import type { ExecutionTrace, OperationGraph, OperationValue } from './types';

export function executeGraph(
  graph: OperationGraph,
  sourceValues: Readonly<Record<string, OperationValue>>,
): ExecutionTrace {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const incoming = new Map(graph.nodes.map((node) => [node.id, [] as string[]]));
  const outgoing = new Map(graph.nodes.map((node) => [node.id, [] as string[]]));

  for (const edge of graph.edges) {
    if (!nodesById.has(edge.source) || !nodesById.has(edge.target)) {
      throw new Error(`Edge ${edge.id} references an unknown node.`);
    }
    incoming.get(edge.target)?.push(edge.source);
    outgoing.get(edge.source)?.push(edge.target);
  }

  const ready = graph.nodes
    .filter((node) => incoming.get(node.id)?.length === 0)
    .map(({ id }) => id);
  const outputs = new Map<string, OperationValue>();
  const order: string[] = [];

  while (ready.length > 0) {
    const nodeId = ready.shift();
    if (!nodeId) break;
    const node = nodesById.get(nodeId);
    if (!node) throw new Error(`Unknown node ${nodeId}.`);

    let output: OperationValue;
    if (node.inputKind === null) {
      const sourceValue = sourceValues[node.id];
      if (!sourceValue) throw new Error(`Missing value for source node ${node.id}.`);
      output = sourceValue;
    } else {
      const dependencies = incoming.get(node.id) ?? [];
      if (dependencies.length !== 1) {
        throw new Error(`Node ${node.id} requires exactly one input.`);
      }
      const input = outputs.get(dependencies[0]);
      if (!input || input.kind !== node.inputKind) {
        throw new TypeError(`Node ${node.id} expected ${node.inputKind} input.`);
      }
      if (!node.execute) throw new Error(`Node ${node.id} has no implementation.`);
      output = node.execute(input);
    }

    if (output.kind !== node.outputKind) {
      throw new TypeError(`Node ${node.id} produced ${output.kind}; expected ${node.outputKind}.`);
    }
    outputs.set(node.id, output);
    order.push(node.id);

    for (const target of outgoing.get(node.id) ?? []) {
      const dependencies = incoming.get(target) ?? [];
      if (dependencies.every((dependency) => outputs.has(dependency))) ready.push(target);
    }
  }

  if (order.length !== graph.nodes.length) {
    throw new Error('Operation graph contains a cycle or unreachable node.');
  }

  return { outputs, order };
}
