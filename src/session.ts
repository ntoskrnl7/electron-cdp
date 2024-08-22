import EventEmitter from 'events';
import ProtocolMapping from 'devtools-protocol/types/protocol-mapping';
import { Debugger, WebContents } from 'electron';
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
    withReturnValue?: boolean | { timeout: number, delay: number };
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

            window._executionContextId = executionContextId;

            // @ts-ignore
            window[name] = (...args: any[]) =>
                new Promise((resolve, reject) => {
                    try {
                        if (window._callSeq === undefined) {
                            window._callSeq = BigInt(0);
                        }
                        const callSequence = String(window._callSeq++);
                        window._callback(JSON.stringify({ executionContextId, callSequence, name, args }));
                        if (options?.withReturnValue) {
                            const h = setInterval(() => {
                                try {
                                    if (window._returnValues && callSequence in window._returnValues) {
                                        resolve(window._returnValues[callSequence]);
                                        delete window._returnValues[callSequence];
                                        clearInterval(h);
                                    }
                                    if (window._returnErrors && callSequence in window._returnErrors) {
                                        reject(window._returnErrors[callSequence]);
                                        delete window._returnErrors[callSequence];
                                        clearInterval(h);
                                    }
                                } catch (error) {
                                    reject(error);
                                }
                            }, typeof options.withReturnValue === 'object' ? options.withReturnValue.delay : 1);
                            if (typeof options.withReturnValue === 'object') {
                                setTimeout(() => clearInterval(h), options.withReturnValue.timeout);
                            }
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
                if ((error as Error).message !== 'Cannot find context with specified id') {
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
                            const context = payload.executionContextId ? new ExecutionContext(this, payload.executionContextId) : new ExecutionContext(this, event.executionContextId);
                            try {
                                const ret = await fn(...payload.args);
                                if (options?.withReturnValue) {
                                    await context.evaluate((id, seq, ret) => {
                                        if (window._executionContextId === undefined) {
                                            window._executionContextId = id;
                                        } else {
                                            console.assert(window._executionContextId == id, `window._executionContextId:${window._executionContextId} !== id:${id}`);
                                        }
                                        if (window._returnValues === undefined) {
                                            window._returnValues = {};
                                        }
                                        window._returnValues[seq] = ret;
                                    }, event.executionContextId, payload.callSequence, ret);
                                }
                            } catch (error) {
                                console.log(error);
                                if (options?.withReturnValue) {
                                    await context.evaluate((id, seq, error) => {
                                        if (window._executionContextId === undefined) {
                                            window._executionContextId = id;
                                        } else {
                                            console.assert(window._executionContextId == id, `window._executionContextId:${window._executionContextId} !== id:${id}`);
                                        }
                                        if (window._returnErrors === undefined) {
                                            window._returnErrors = {};
                                        }
                                        window._returnErrors[seq] = error;
                                    }, event.executionContextId, payload.callSequence, error);
                                }
                            }
                        }
                        break;
                    }
                }
            } catch (error) {
                if ((error as Error).message !== 'target closed while handling command' && (error as Error).message !== 'Cannot find context with specified id') {
                    console.warn(error);
                }
            }
        });
    }
}
