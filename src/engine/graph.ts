import type { OperationGraph, OperationValue } from './types';
import { utf8EncodeScalars } from '../unicode';

export const textMetricsGraph: OperationGraph = {
  nodes: [
    {
      id: 'input',
      label: 'Input text',
      explanation: 'Supplies the entered text to the graph as Unicode scalar values.',
      inputKinds: [],
      outputKind: 'scalars',
    },
    {
      id: 'utf8',
      label: 'UTF-8 encode',
      explanation:
        'Encodes each Unicode scalar as its variable-length UTF-8 byte sequence without normalizing the text.',
      inputKinds: ['scalars'],
      outputKind: 'bytes',
      execute: ([input]): OperationValue => {
        if (input.kind !== 'scalars') throw new TypeError('UTF-8 encode requires scalars.');
        return { kind: 'bytes', value: utf8EncodeScalars(input.value) };
      },
    },
    {
      id: 'length',
      label: 'Byte length',
      explanation: 'Counts the raw bytes produced by UTF-8 encoding.',
      inputKinds: ['bytes'],
      outputKind: 'count',
      execute: ([input]): OperationValue => {
        if (input.kind !== 'bytes') throw new TypeError('Byte length requires raw bytes.');
        return { kind: 'count', value: input.value.length };
      },
    },
  ],
  edges: [
    { id: 'input-to-utf8', source: 'input', target: 'utf8' },
    { id: 'utf8-to-length', source: 'utf8', target: 'length' },
  ],
};
