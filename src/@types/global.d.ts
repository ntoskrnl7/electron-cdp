type FrameId = import('../session').FrameId;
type SessionID = import('devtools-protocol').Protocol.Target.SessionID;

namespace globalThis {
    // eslint-disable-next-line no-var
    var $cdp: {
        /**
         * SuperJSON.
         */
        superJSON: SuperJSON;

        callback: {
            invoke?: (payload: string, sessionId?: SessionID, frameId?: FrameId) => void;

            /**
             * Callback invocation sequence.
             */
            sequence: bigint;

            /**
             * Property used internally by the exposeFunction method.
             */
            returnValues: { [key: string]: { name?: string, args?: unknown[], init?: true, value?: Awaited<unknown> } };

            /**
             * Property used internally by the exposeFunction method.
             */
            errors: { [key: string]: { name?: string, args?: unknown[], value?: Awaited<unknown> } };
        }
    };
}

type GlobalThis = typeof globalThis & {
    '$cdp.callback.invoke'?: (payload: string) => void;
};

interface Window {
    $cdp: {
        frameId?: Promise<FrameId>;
        frameIdResolve?: (id: FrameId) => void;
    };
}

interface InvokeMessage {
    type: 'window' | 'worker' | 'service-worker' | 'shared-worker';
    sessionId?: SessionID;
    frameId?: FrameId;
    payload: string;
}

interface Function {
    ['$mode']: 'Electron' | 'CDP';
}
