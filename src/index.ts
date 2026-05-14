import { Protocol } from 'devtools-protocol/types/protocol.d';
import { GenerateScriptOptions } from './utils';
export { Protocol } from 'devtools-protocol/types/protocol.d';
export { SuperJSON } from 'superjson';

/**
 * Options accepted by `Session.evaluate` and `ExecutionContext.evaluate`.
 *
 * Includes the supported CDP `Runtime.evaluate` options plus nested
 * script-generation options such as `script.initScript` and `script.timeout`.
 * The session used for script generation is managed internally.
 */
export type EvaluateOptions = Omit<Protocol.Runtime.EvaluateRequest, 'contextId' | 'uniqueContextId' | 'expression' | 'throwOnSideEffect' | 'awaitPromise' | 'replMode' | 'returnByValue' | 'generatePreview' | 'serializationOptions' | 'objectGroup'> & { script?: Omit<GenerateScriptOptions, 'session'> };

export * from './electron';
export * from './session';
export * from './executionContext';
export * from './utils';
