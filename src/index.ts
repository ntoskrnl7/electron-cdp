import { Protocol } from 'devtools-protocol';
export { Protocol };

export interface EvaluateOptions {
    userGesture?: boolean | undefined,
    timeout?: number | undefined
};

export * from './electron';
export * from './session';
export * from './executionContext';