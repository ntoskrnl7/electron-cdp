import { Protocol } from 'devtools-protocol/types/protocol.d';
export { Protocol } from 'devtools-protocol/types/protocol.d';
export { SuperJSON } from 'superjson';

export type EvaluateOptions = Omit<Protocol.Runtime.EvaluateRequest, 'contextId' | 'uniqueContextId' | 'expression' | 'throwOnSideEffect' | 'awaitPromise' | 'replMode' | 'returnByValue' | 'generatePreview' | 'serializationOptions' | 'objectGroup'>;

export * from './electron';
export * from './session';
export * from './executionContext';
export * from './utils';