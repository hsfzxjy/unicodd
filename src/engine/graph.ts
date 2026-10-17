import type { OperationGraph, OperationValue } from './types';
import { utf8EncodeScalars } from '../unicode';

export const textMetricsGraph: OperationGraph = {
  nodes: [
    {
      id: 'input',
      label: 'Input text',
      inputKind: null,
      outputKind: 'scalars',
    },
    {
      id: 'utf8',
      label: 'UTF-8 encode',
      inputKind: 'scalars',
      outputKind: 'bytes',
      execute: (input): OperationValue => {
        if (input.kind !== 'scalars') throw new TypeError('UTF-8 encode requires scalars.');
        return { kind: 'bytes', value: utf8EncodeScalars(input.value) };
      },
    },
    {
      id: 'length',
      label: 'Byte length',
      inputKind: 'bytes',
      outputKind: 'count',
      execute: (input): OperationValue => {
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
