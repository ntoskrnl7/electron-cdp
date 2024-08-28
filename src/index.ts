import { Protocol } from 'devtools-protocol/types/protocol.d';
export { Protocol };

import SuperJSON from './superJSON';
export { SuperJSON };

export interface EvaluateOptions {
    userGesture?: boolean | undefined,
    timeout?: number | undefined
}

export * from './electron';
export * from './session';
export * from './executionContext';