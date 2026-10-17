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
    if (node.inputKinds.length === 0) {
      const sourceValue = sourceValues[node.id];
      if (!sourceValue) throw new Error(`Missing value for source node ${node.id}.`);
      output = sourceValue;
    } else {
      const dependencies = incoming.get(node.id) ?? [];
      if (dependencies.length !== node.inputKinds.length) {
        throw new Error(
          `Node ${node.id} declares ${node.inputKinds.length} inputs but has ${dependencies.length}.`,
        );
      }
      const inputs = dependencies.map((dependency, index) => {
        const input = outputs.get(dependency);
        const expectedKind = node.inputKinds[index];
        if (!input || input.kind !== expectedKind) {
          throw new TypeError(`Node ${node.id} input ${index + 1} expected ${expectedKind}.`);
        }
        return input;
      });
      if (!node.execute) throw new Error(`Node ${node.id} has no implementation.`);
      output = node.execute(inputs);
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
