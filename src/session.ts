import EventEmitter from 'events';
import { ProtocolMapping } from 'devtools-protocol/types/protocol-mapping.d';
import { Debugger, WebContents } from 'electron';
import { ExecutionContext } from './executionContext';
import { Protocol } from 'devtools-protocol/types/protocol.d';
import { SuperJSON } from '.';

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
    #executionContexts: Map<Protocol.Runtime.ExecutionContextId, ExecutionContext> = new Map();

    #exposeFunctions: Map<string, {
        executionContextCreated: (context: ExecutionContext) => Promise<void>;
        bindingCalled: (event: Protocol.Runtime.BindingCalledEvent) => Promise<void>;
    }> = new Map();


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
                    const ctx = new ExecutionContext(this, event.context);
                    this.#executionContexts.set(event.context.id, ctx);
                    this.emit('executionContextCreated', ctx);
                    break;
                }
                case 'Runtime.executionContextDestroyed':
                    const event = params as Protocol.Runtime.ExecutionContextDestroyedEvent;
                    this.#executionContexts.delete(event.executionContextId);
                    break;
                case 'Runtime.executionContextsCleared':
                    this.#executionContexts.clear();
                    break;
            }
        });
    }

    /**
     *
     * @param eventName
     * @param listener
     * @returns
     */
    setExclusiveListener<K>(eventName: keyof Events | K, listener: K extends keyof Events ? Events[K] extends unknown[] ? (...args: Events[K]) => void : never : never): this {
        return this.removeAllListeners(eventName).on(eventName, listener);
    }

    /**
     * Sends a command to the browser's DevTools protocol.
     *
     * @param method - The method name of the command.
     * @param params - The parameters for the command.
     * @param options - Options for sending the command.
     * @throws If the debugger is not attached.
     */
    send<T extends keyof ProtocolMapping.Commands>(method: T, params?: ProtocolMapping.Commands[T]['paramsType'][0]): Promise<ProtocolMapping.Commands[T]['returnType']> {
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
    async exposeFunction<T, A extends unknown[]>(name: string, fn: (...args: A) => T, options?: ExposeFunctionOptions) {
        await this.send('Runtime.addBinding', { name: '_callback' });
        const attachFunction = (name: string, options?: ExposeFunctionOptions, executionContextId?: Protocol.Runtime.ExecutionContextId) => {

            window._executionContextId = executionContextId;

            // @ts-expect-error : window[name]
            window[name] = (...args: unknown[]) =>
                new Promise((resolve, reject) => {
                    try {
                        if (window._callSeq === undefined) {
                            window._callSeq = BigInt(0);
                        }
                        const callSequence = String(window._callSeq++);
                        window._callback(window.SuperJSON.stringify({ executionContextId, callSequence, name, args }));
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
                        } else {
                            resolve(undefined);
                        }
                    } catch (error) {
                        reject(error);
                    }
                });
        }

        this.webContents.evaluate(attachFunction, name, options);

        const executionContextCreated = async (context: ExecutionContext) => {
            try {
                await context.evaluate(attachFunction, name, options, context.id);
            } catch (error) {
                if ((error as Error).message !== 'Cannot find context with specified id') {
                    console.warn(error);
                }
            }
        };

        const bindingCalled = async (event: Protocol.Runtime.BindingCalledEvent) => {
            try {
                switch (event.name) {
                    case '_callback': {
                        const payload: { executionContextId?: Protocol.Runtime.ExecutionContextId, callSequence: string, name: string, args: A } = SuperJSON.parse(event.payload);
                        if (payload.name === name) {
                            if (payload.executionContextId === undefined) {
                                payload.executionContextId = event.executionContextId;
                            }
                            if (payload.executionContextId === undefined) {
                                console.error(`invalid context id : (payload: ${event.payload})`);
                                return;
                            }
                            if (!this.#executionContexts.has(payload.executionContextId)) {
                                console.warn(`context not found: (id: ${payload.executionContextId}, payload: ${event.payload})`);
                                this.#executionContexts.set(payload.executionContextId, new ExecutionContext(this, payload.executionContextId));
                            }
                            const context = this.#executionContexts.get(payload.executionContextId);
                            if (context === undefined) {
                                console.error(`invalid context : (payload, ${event.payload})`);
                                return;
                            }
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
                                if ((error as Error).message !== 'target closed while handling command' && (error as Error).message !== 'Cannot find context with specified id') {
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
                        }
                        break;
                    }
                }
            } catch (error) {
                if ((error as Error).message !== 'target closed while handling command' && (error as Error).message !== 'Cannot find context with specified id') {
                    console.warn(error);
                }
            }
        };

        this.#exposeFunctions.set(name, { executionContextCreated, bindingCalled });

        this.on('executionContextCreated', executionContextCreated);

        this.on('Runtime.bindingCalled', bindingCalled);

        this.webContents.on('destroyed', () => this.removeExposedFunction(name).catch(console.warn));
    }

    async removeExposedFunction(name: string) {
        const entry = this.#exposeFunctions.get(name);
        if (entry) {
            this.#exposeFunctions.delete(name);
            await this.#removeExposedFunction(name, entry);
        }
    }

    async #removeExposedFunction(
        name: string,
        entry: {
            executionContextCreated: (context: ExecutionContext) => Promise<void>;
            bindingCalled: (event: Protocol.Runtime.BindingCalledEvent) => Promise<void>;
        }) {
        this.off('executionContextCreated', entry.executionContextCreated);
        this.off('Runtime.bindingCalled', entry.bindingCalled);
        // @ts-expect-error : window[name]
        await Promise.all(Array.from(this.#executionContexts.values()).map(ctx => ctx.evaluate(name => delete window[name], name)));
    }
}
