import EventEmitter from 'events';
import ProtocolMapping from 'devtools-protocol/types/protocol-mapping';
import { BrowserWindow, Debugger, WebContents } from 'electron';
import { ExecutionContext } from './executionContext';
import Protocol from 'devtools-protocol';

/**
 * Options for sending commands.
 */
export declare interface CommandOptions {
    timeout: number;
}

/**
 * Type mapping for events.
 */
export declare type Events = {
    [Property in keyof ProtocolMapping.Events]: ProtocolMapping.Events[Property];
} & {
    'executionContextCreated': [ExecutionContext];
};

/**
 * Options for exposing a function.
 */
export interface ExposeFunctionOptions {
    withReturnValue?: boolean;
}

/**
 * Represents a session for interacting with the browser's DevTools protocol.
 */
export class Session extends EventEmitter<Events> {

    readonly webContents: WebContents;
    #debugger: Debugger;

    /**
     * Creates a new Session instance.
     * 
     * @param window - The web contents associated with this session.
     */
    constructor(webContents: WebContents) {
        super();
        this.webContents = webContents;
        this.#debugger = webContents.debugger;
        this.#debugger.on('message', (_, method, params) => {
            this.emit(method as keyof ProtocolMapping.Events, params);
            switch (method) {
                case 'Runtime.executionContextCreated': {
                    const event = params as Protocol.Runtime.ExecutionContextCreatedEvent;
                    this.emit('executionContextCreated', new ExecutionContext(this, event.context));
                    break;
                }
            }
        });
    }

    /**
     * Sends a command to the browser's DevTools protocol.
     * 
     * @param method - The method name of the command.
     * @param params - The parameters for the command.
     * @param options - Options for sending the command.
     * @returns A promise that resolves with the result of the command.
     * @throws If the debugger is not attached.
     */
    send<T extends keyof ProtocolMapping.Commands>(method: T, params?: ProtocolMapping.Commands[T]['paramsType'][0], options?: CommandOptions): Promise<ProtocolMapping.Commands[T]['returnType']> {
        if (!this.#debugger.isAttached()) {
            throw new Error('not attached');
        }
        return this.#debugger.sendCommand(method, params);
    }

    /**
     * Attaches the debugger to the browser window.
     * 
     * @param protocolVersion - The protocol version to use.
     */
    attach(protocolVersion?: string) {
        if (!this.#debugger.isAttached()) {
            this.#debugger.attach(protocolVersion);
        }
    }

    /**
     * Detaches the debugger from the browser window.
     */
    detach() {
        this.#debugger.detach();
    }

    /**
     * Exposes a function to the browser's global context.
     * 
     * @param name - The name under which the function will be exposed.
     * @param fn - The function to expose.
     * @param options - Options for exposing the function.
     */
    async exposeFunction<T, A extends any[]>(name: string, fn: (...args: A) => T, options?: ExposeFunctionOptions) {
        await this.send('Runtime.addBinding', { name: '_callback' });
        const attachFunction = (name: string, options?: ExposeFunctionOptions, executionContextId?: Protocol.Runtime.ExecutionContextId) => {
            window[name] = (...args: any[]) =>
                new Promise((resolve, reject) => {
                    try {
                        const topWindow = window.top ? window.top : window;
                        if (topWindow._callSeq === undefined) {
                            topWindow._callSeq = BigInt(0);
                        }
                        const callSequence = String(topWindow._callSeq++);
                        window._callback(JSON.stringify({ executionContextId, callSequence, name, args }));
                        if (options?.withReturnValue) {
                            const h = setInterval(() => {
                                try {
                                    if (topWindow._retrunValues && callSequence in topWindow._retrunValues) {
                                        resolve(topWindow._retrunValues[callSequence]);
                                        delete topWindow._retrunValues[callSequence];
                                        clearInterval(h);
                                    }
                                } catch (error) {
                                    reject(error);
                                }
                            });
                        }
                    } catch (error) {
                        reject(error);
                    }
                });
        }

        this.webContents.evaluate(attachFunction, name, options);
        this.on('executionContextCreated', async (context) => {
            try {
                await context.evaluate(attachFunction, name, options, context.id);
            } catch (error) {
                if ((error as Error).message !== 'uniqueContextId not found') {
                    console.warn(error);
                }
            }
        });

        this.on('Runtime.bindingCalled', async (event) => {
            try {
                switch (event.name) {
                    case '_callback': {
                        const payload: { executionContextId?: Protocol.Runtime.ExecutionContextId, callSequence: string, name: string, args: A } = JSON.parse(event.payload);
                        if (payload.name === name) {
                            const ret = await fn(...payload.args);
                            if (options?.withReturnValue) {
                                const context = payload.executionContextId ? new ExecutionContext(this, payload.executionContextId) : new ExecutionContext(this, event.executionContextId);
                                await context.evaluate((id, seq, ret) => {
                                    const topWindow = window.top ? window.top : window;
                                    topWindow._executionContextId = id;
                                    if (topWindow._retrunValues === undefined) {
                                        topWindow._retrunValues = {};
                                    }
                                    topWindow._retrunValues[seq] = ret;
                                }, event.executionContextId, payload.callSequence, ret);
                            }
                        }
                        break;
                    }
                }
            } catch (error) {
                if ((error as Error).message !== 'target closed while handling command') {
                    console.warn(error);
                }
            }
        });
    }
}
