import EventEmitter from 'events';
import { Protocol } from 'devtools-protocol/types/protocol.d';
import { ProtocolMapping } from 'devtools-protocol/types/protocol-mapping.d';
import { Debugger, WebContents } from 'electron';
import { EvaluateOptions, SuperJSON, ExecutionContext } from '.';

import { readFileSync } from 'fs';
import { registerTypes } from './superJSON';

const SuperJSONScript = readFileSync(require.resolve('./window.SuperJSON')).toString();

function convertToFunction(code: string) {
    const trimmedCode = code.trim();
    const isArrowFunction = /^\s*\(.*\)\s*=>\s*{/.test(trimmedCode);
    if (isArrowFunction) {
        return code;
    }
    if (/^\s*function\s*\w*\s*\(.*\)\s*{/.test(trimmedCode)) {
        return code;
    }
    return `function ${trimmedCode}`;
}

declare global {
    interface Window {
        /**
         * SuperJSON.
         */
        SuperJSON: SuperJSON;

        /**
         * Callback invocation sequence.
         */
        _callSeq?: bigint;

        /**
         * Execution context identifier.
         */
        _executionContextId?: Protocol.Runtime.ExecutionContextId;

        /**
         * Method used internally by the exposeFunction method.
         */
        _callback(payload: string): void;

        /**
         * Property used internally by the exposeFunction method.
         */
        _returnValues?: { [key: string]: Awaited<unknown> };

        /**
         * Property used internally by the exposeFunction method.
         */
        _returnErrors?: { [key: string]: Awaited<unknown> };
    }
}

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
    'execution-context-created': [ExecutionContext];
};

/**
 * Options for exposing a function.
 */
export interface ExposeFunctionOptions {
    withReturnValue?: boolean | { timeout: number, delay: number };
}

export type CustomizeSuperJSONFunction = (superJSON: SuperJSON) => void;

/**
 * Represents a session for interacting with the browser's DevTools protocol.
 */
export class Session extends EventEmitter<Events> {

    #superJSON: SuperJSON;
    #customizeSuperJSON: CustomizeSuperJSONFunction = () => { };

    readonly webContents: WebContents;
    readonly #debugger: Debugger;
    readonly #executionContexts: Map<Protocol.Runtime.ExecutionContextId, ExecutionContext> = new Map();

    readonly #exposeFunctions: Map<string, {
        executionContextCreated: (context: ExecutionContext) => Promise<void>;
        bindingCalled: (event: Protocol.Runtime.BindingCalledEvent) => Promise<void>;
    }> = new Map();

    /**
     * Retrieves the list of execution contexts.
     *
     * @returns A list of the current execution contexts.
     */
    get executionContexts() {
        return this.#executionContexts;
    }

    /**
     * Evaluates the provided function with the given arguments in the context of the current page.
     *
     * @param fn - The function to be evaluated.
     * @param args - The arguments to pass to the function.
     * @returns A promise that resolves with the result of the function.
     */
    evaluate<T, A extends unknown[]>(fn: (...args: A) => T, ...args: A): Promise<T>;

    /**
     * Evaluates the provided function with additional options and the given arguments in the context of the current page.
     *
     * @param options Additional options to customize the evaluation.
     * @param fn - The function to be evaluated.
     * @param args - The arguments to pass to the function.
     * @returns A promise that resolves with the result of the function.
     */
    evaluate<T, A extends unknown[]>(options: EvaluateOptions, fn: (...args: A) => T, ...args: A): Promise<T>;

    /**
     * Exposes a function to the browser's global context under the specified name.
     *
     * @param name - The name under which the function will be exposed.
     * @param fn - The function to expose.
     * @param options - Optional settings for exposing the function.
     * @returns A promise that resolves when the function is successfully exposed.
     */
    async evaluate<R, F extends (...args: ARGS) => R, ARG_0, ARGS_OTHER extends unknown[], ARGS extends [ARG_0, ...ARGS_OTHER]>(
        fnOrOptions: F | EvaluateOptions,
        fnOrArg0?: ARG_0 | F,
        ...args: ARGS_OTHER | ARGS
    ): Promise<R> {
        const ctx = new ExecutionContext(this);
        if (typeof fnOrOptions === 'function') {
            return ctx.evaluate(fnOrOptions, ...[fnOrArg0, ...args] as ARGS);
        } else if (typeof fnOrOptions !== 'function' && typeof fnOrArg0 === 'function') {
            return ctx.evaluate(fnOrOptions, fnOrArg0 as F, ...args as ARGS);
        }
        throw new Error('invalid parameter');
    }

    /**
     * Creates a new Session instance.
     *
     * @param window - The web contents associated with this session.
     */
    constructor(webContents: WebContents) {
        super();
        this.#superJSON = new SuperJSON();
        this.webContents = webContents;
        this.#debugger = webContents.debugger;
        this.#debugger.on('message', (_, method, params) => {
            this.emit(method as keyof ProtocolMapping.Events, params);
            switch (method) {
                case 'Runtime.executionContextCreated': {
                    const event = params as Protocol.Runtime.ExecutionContextCreatedEvent;
                    const ctx = new ExecutionContext(this, event.context);
                    this.#executionContexts.set(event.context.id, ctx);
                    this.emit('execution-context-created', ctx);
                    break;
                }
                case 'Runtime.executionContextDestroyed':
                    this.#executionContexts.delete((params as Protocol.Runtime.ExecutionContextDestroyedEvent).executionContextId);
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
     * Ensures that the SuperJSON library is loaded and available
     * for use within the web contents context.
     *
     * This method checks if SuperJSON is already loaded by inspecting
     * the `hasSuperJSON` flag on the web contents. If it is not loaded,
     * the method loads SuperJSON by evaluating a script in the browser context.
     *
     * Once SuperJSON is loaded, it sets up a listener to ensure that
     * SuperJSON is reloaded in any newly created execution contexts.
     *
     * @param customizeSuperJSON An optional callback function to customize the SuperJSON instance before it is set up.
     * This function receives the SuperJSON instance and can perform any required modifications.
     *
     * @returns A promise that resolves when SuperJSON has been successfully loaded.
     *
     * @throws Any errors that occur during the execution of the script
     * will be logged to the console.
     */
    async enableSuperJSON(customizeSuperJSON?: CustomizeSuperJSONFunction) {
        if (this.webContents.hasSuperJSON) {
            if (customizeSuperJSON) {
                this.configureSuperJSON(customizeSuperJSON);
            }
            return;
        }

        if (customizeSuperJSON) {
            this.customizeSuperJSON = customizeSuperJSON;
        }

        const buildParams = () => ({
            expression: `${SuperJSONScript}; (${convertToFunction(this.#customizeSuperJSON.toString())})(SuperJSON.default); window.SuperJSON = SuperJSON.default;`,
            throwOnSideEffect: false,
            awaitPromise: true,
            replMode: false,
            returnByValue: false,
            generatePreview: false,
            silent: true,
            includeCommandLineAPI: false
        });

        await this.send('Runtime.evaluate', buildParams()).catch(console.error);

        this.on('Runtime.executionContextCreated', event =>
            this.send('Runtime.evaluate', { ...buildParams(), contextId: event.context.id, }).catch(console.error));

        this.webContents.hasSuperJSON = true;
    }

    /**
     * Gets the current SuperJSON instance.
     *
     * This getter method returns the instance of SuperJSON that is
     * currently being used. The SuperJSON instance is customized
     * using the provided callback function via the `customizeSuperJSON` setter.
     *
     * @returns The current SuperJSON instance.
     */
    get superJSON() {
        return this.#superJSON;
    }

    /**
     * Gets the current custom SuperJSON script.
     *
     * @returns The custom SuperJSON script as a string.
     */
    get customizeSuperJSON() {
        return this.#customizeSuperJSON;
    }

    /**
     * Sets the custom SuperJSON script.
     *
     * This setter method allows you to provide a callback function
     * that customizes the SuperJSON instance. The provided function
     * will be converted to a string and stored for later use when
     * configuring SuperJSON in various contexts.
     *
     * @param customizeSuperJSON - A callback function to customize the SuperJSON instance.
     * The function receives the SuperJSON instance and can perform any required modifications.
     */
    set customizeSuperJSON(customizeSuperJSON: CustomizeSuperJSONFunction) {
        if (this.#customizeSuperJSON === customizeSuperJSON) {
            return;
        }
        this.#customizeSuperJSON = customizeSuperJSON;
        this.#superJSON = new SuperJSON();
        registerTypes(this.#superJSON);
        this.#customizeSuperJSON(this.#superJSON);
    }

    /**
     * Configures the SuperJSON instance with a custom script.
     *
     * This method accepts a callback function that customizes the SuperJSON
     * instance before it is set up in the browser context. The custom script
     * is then evaluated in all execution contexts to ensure SuperJSON is
     * properly configured.
     *
     * If SuperJSON is not already enabled, it will be enabled using the provided callback.
     * This ensures that SuperJSON is properly loaded and configured in the current and future contexts.
     *
     * This function is meant to be used only in the mode where SuperJSON is preloaded.
     *
     * @param customizeSuperJSON - A callback function to customize the SuperJSON instance.
     * The function receives the SuperJSON instance and can perform any required modifications.
     *
     * @returns A promise that resolves when the SuperJSON configuration has been successfully evaluated.
     * @throws Any errors that occur during the execution of the script will be logged to the console.
     */
    async configureSuperJSON(customizeSuperJSON: CustomizeSuperJSONFunction) {
        if (!this.webContents.hasSuperJSON) {
            return this.enableSuperJSON(customizeSuperJSON);
        }

        this.customizeSuperJSON = customizeSuperJSON;

        await this.send('Runtime.evaluate', {
            expression: `(${convertToFunction(this.#customizeSuperJSON.toString())})(window.SuperJSON);`,
            throwOnSideEffect: false,
            awaitPromise: true,
            replMode: false,
            returnByValue: false,
            generatePreview: false,
            silent: true,
            includeCommandLineAPI: false,
        });

        for (const [contextId] of this.#executionContexts) {
            await this.send('Runtime.evaluate', {
                contextId,
                expression: `(${convertToFunction(this.#customizeSuperJSON.toString())})(window.SuperJSON);`,
                throwOnSideEffect: false,
                awaitPromise: true,
                replMode: false,
                returnByValue: false,
                generatePreview: false,
                silent: true,
                includeCommandLineAPI: false,
            });
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
    async exposeFunction<T, A extends unknown[]>(name: string, fn: (...args: A) => Promise<T> | T, options?: ExposeFunctionOptions) {
        await this.send('Runtime.addBinding', { name: '_callback' });
        const attachFunction = (name: string, options?: ExposeFunctionOptions, executionContextId?: Protocol.Runtime.ExecutionContextId) => {

            window._executionContextId = executionContextId;

            // @ts-expect-error : window[name]
            window[name] = (...args: unknown[]) => {
                if (window._callSeq === undefined) {
                    window._callSeq = BigInt(0);
                }
                const callSequence = `${window._callSeq++}-${Math.random()}`;
                window._callback(window.SuperJSON.stringify({ executionContextId, callSequence, name, args }));
                if (options === undefined) {
                    return;
                }
                if (options.withReturnValue === undefined) {
                    return;
                }
                const { promise, resolve, reject } = Promise.withResolvers();
                const h = setInterval(() => {
                    try {
                        if (window._returnValues && callSequence in window._returnValues) {
                            resolve(window._returnValues[callSequence]);
                            delete window._returnValues[callSequence];
                            clearInterval(h);
                        }
                        if (window._returnErrors && callSequence in window._returnErrors) {
                            reject(window._returnErrors[callSequence] as Error);
                            delete window._returnErrors[callSequence];
                            clearInterval(h);
                        }
                    } catch (error) {
                        reject(error as Error);
                    }
                }, typeof options.withReturnValue === 'object' ? options.withReturnValue.delay : 1);
                if (typeof options.withReturnValue === 'object') {
                    setTimeout(clearInterval.bind(h), options.withReturnValue.timeout);
                }
                return promise;
            };

        }

        const executionContextCreated = async (context: ExecutionContext) => {
            try {
                await context.evaluate(attachFunction, name, options, context.id);
            } catch (error) {
                if ((error as Error).message !== 'Cannot find context with specified id') {
                    console.warn(error);
                }
            }
        };

        type Payload = { executionContextId?: Protocol.Runtime.ExecutionContextId, callSequence: string, name: string, args: A };

        const processBindingCall = async (executionContextId: number, payload: Payload) => {
            if (payload.executionContextId === undefined) {
                payload.executionContextId = executionContextId;
            }
            if (payload.executionContextId === undefined) {
                console.error(`invalid context id : (payload: ${JSON.stringify(payload)})`);
                return;
            }
            if (!this.#executionContexts.has(payload.executionContextId)) {
                console.warn(`context not found: (id: ${payload.executionContextId}, payload: ${JSON.stringify(payload)})`);
                this.#executionContexts.set(payload.executionContextId, new ExecutionContext(this, payload.executionContextId));
            }
            const context = this.#executionContexts.get(payload.executionContextId);
            if (context === undefined) {
                console.error(`invalid context : (payload, ${JSON.stringify(payload)})`);
                return;
            }
            try {
                const ret = await fn(...payload.args);
                if (options?.withReturnValue) {
                    await context.evaluate((id, seq, ret) => {
                        if (window._executionContextId === undefined) {
                            window._executionContextId = id;
                        } else {
                            console.assert(window._executionContextId === id, `window._executionContextId:${window._executionContextId} !== id:${id}`);
                        }
                        if (window._returnValues === undefined) {
                            window._returnValues = {};
                        }
                        window._returnValues[seq] = ret;
                    }, executionContextId, payload.callSequence, ret);
                }
            } catch (error) {
                if ((error as Error).message !== 'target closed while handling command' && (error as Error).message !== 'Cannot find context with specified id') {
                    if (options?.withReturnValue) {
                        await context.evaluate((id, seq, error) => {
                            if (window._executionContextId === undefined) {
                                window._executionContextId = id;
                            } else {
                                console.assert(window._executionContextId === id, `window._executionContextId:${window._executionContextId} !== id:${id}`);
                            }
                            if (window._returnErrors === undefined) {
                                window._returnErrors = {};
                            }
                            window._returnErrors[seq] = error;
                        }, executionContextId, payload.callSequence, error);
                    }
                }
            }
        }

        const bindingCalled = async (event: Protocol.Runtime.BindingCalledEvent) => {
            try {
                if (event.name === '_callback') {
                    const payload: Payload = this.superJSON.parse(event.payload);
                    if (payload.name === name) {
                        processBindingCall(event.executionContextId, payload);
                    }
                }
            } catch (error) {
                if ((error as Error).message !== 'target closed while handling command' && (error as Error).message !== 'Cannot find context with specified id') {
                    console.warn(error);
                }
            }
        };

        this.#exposeFunctions.set(name, { executionContextCreated, bindingCalled });

        this.on('execution-context-created', executionContextCreated);

        this.on('Runtime.bindingCalled', bindingCalled);

        this.webContents.on('destroyed', () => this.#exposeFunctions.delete(name));

        await this.evaluate(attachFunction, name, options);
    }

    /**
     * Removes an exposed function from the browser's global context.
     *
     * @param name - The name of the function to remove.
     * @returns A promise that resolves when the function has been removed.
     *
     * This function checks if a function is exposed using the `name` provided.
     * If it is, it removes the function from the internal storage and unbinds it from the global context.
     */
    async removeExposedFunction(name: string) {
        const entry = this.#exposeFunctions.get(name);
        if (entry) {
            this.#exposeFunctions.delete(name);
            await this.#removeExposedFunction(name, entry);
        }
    }

    /**
     * Checks if a function is exposed to the browser's global context.
     *
     * @param name - The name of the function to check.
     * @returns `true` if the function is currently exposed, otherwise `false`.
     */
    isFunctionExposed(name: string) {
        return this.#exposeFunctions.has(name);
    }

    async #removeExposedFunction(
        name: string,
        entry: {
            executionContextCreated: (context: ExecutionContext) => Promise<void>;
            bindingCalled: (event: Protocol.Runtime.BindingCalledEvent) => Promise<void>;
        }) {
        this.off('execution-context-created', entry.executionContextCreated);
        this.off('Runtime.bindingCalled', entry.bindingCalled);
        if (!this.webContents.isDestroyed()) {
            // @ts-expect-error : window[name]
            await Promise.all(Array.from(this.#executionContexts.values()).map(ctx => ctx.evaluate(name => delete window[name], name)));
        }
    }
}
