import EventEmitter from 'events';
import { Protocol } from 'devtools-protocol/types/protocol.d';
import { ProtocolMapping } from 'devtools-protocol/types/protocol-mapping.d';
import { Debugger, WebContents } from 'electron';
import { EvaluateOptions, SuperJSON, ExecutionContext, generateScriptString } from '.';

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
        '__cdp.superJSON': SuperJSON;

        /**
         * Method used internally by the exposeFunction method.
         */
        '__cdp.callback'(payload: string): void;

        __cdp?: {
            /**
             * Callback invocation sequence.
             */
            callSequence: bigint;

            /**
             * Property used internally by the exposeFunction method.
             */
            returnValues: { [key: string]: { name?: string, args?: unknown[], init?: true, value?: Awaited<unknown> } };

            /**
             * Property used internally by the exposeFunction method.
             */
            returnErrors: { [key: string]: { name?: string, args?: unknown[], value?: Awaited<unknown> } };
        }
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
    /**
     * If not specified or set to false, the function call result will not be awaited.
     *
     * If the function does not return a value, this property should either be omitted or set to false.
     *
     * - `false`, `undefined` : The function call result will not be awaited.
     * - `true`, `{}` : The function call result will be awaited with the default settings for its sub-properties.
     */
    withReturnValue?: boolean | {
        /**
         * The maximum duration to wait for the function call result.
         * If the result is not received within this time frame, the operation will be considered failed.
         * Default: Infinity
         */
        timeout?: number;

        /**
         * The delay before starting to wait for the function result.
         * This value represents the initial wait time before the function result is checked.
         * Default: 1
         */
        delay?: number;

        /**
         * Indicates whether the function call should be retried if it fails.
         * If not specified, no retries will be performed.
         *
         * - `false`, `undefined` : No retry attempts will be made. The function call will fail immediately if it encounters an error.
         * - `true`, `{}`: The function call will be retried using the default retry configuration. By default, this means retries will continue indefinitely (if count is not specified) with a short delay between each attempt.
         */
        retry?: boolean | {
            /**
             * The maximum number of retry attempts.
             * This value determines how many times the function call will be retried in case of failure.
             * Default: Infinity
             */
            count?: number;

            /**
             * The delay between each retry attempt.
             * This represents the amount of time to wait before making another retry after a failure.
             * Default: 1
             */
            delay?: number;
        };
    };
}

export type CustomizeSuperJSONFunction = (superJSON: SuperJSON) => void;

type ExposeFunction = {
    scriptId: Protocol.Page.ScriptIdentifier;
    bindingCalled: (event: Protocol.Runtime.BindingCalledEvent) => void;
};

/**
 * Represents a session for interacting with the browser's DevTools protocol.
 */
export class Session extends EventEmitter<Events> {

    #superJSON: SuperJSON;
    #customizeSuperJSON: CustomizeSuperJSONFunction = () => { };

    readonly webContents: WebContents;
    readonly #debugger: Debugger;
    readonly #executionContexts: Map<Protocol.Runtime.ExecutionContextId, ExecutionContext> = new Map();

    readonly #exposeFunctions: Map<string, ExposeFunction> = new Map();

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
        registerTypes(this.#superJSON);

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
                await this.configureSuperJSON(customizeSuperJSON);
            }
            return;
        }

        if (customizeSuperJSON) {
            this.customizeSuperJSON = customizeSuperJSON;
        }

        await this.send('Page.addScriptToEvaluateOnNewDocument', {
            runImmediately: true,
            source: `${SuperJSONScript}; (${convertToFunction(this.#customizeSuperJSON.toString())})(SuperJSON.default); window['__cdp.superJSON'] = SuperJSON.default;`
        });

        const buildParams = () => ({
            expression: `${SuperJSONScript}; (${convertToFunction(this.#customizeSuperJSON.toString())})(SuperJSON.default); window['__cdp.superJSON'] = SuperJSON.default;`,
            throwOnSideEffect: false,
            awaitPromise: true,
            replMode: false,
            returnByValue: false,
            generatePreview: false,
            silent: true,
            includeCommandLineAPI: false
        });
        await this.send('Runtime.evaluate', buildParams()).catch(console.error);
        for (const context of this.executionContexts.values()) {
            this.send('Runtime.evaluate', { ...buildParams(), contextId: context.id, }).catch(console.error);
        }
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
            return await this.enableSuperJSON(customizeSuperJSON);
        }

        this.customizeSuperJSON = customizeSuperJSON;

        await this.send('Runtime.evaluate', {
            expression: `(${convertToFunction(this.#customizeSuperJSON.toString())})(window['__cdp.superJSON']);`,
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
                expression: `(${convertToFunction(this.#customizeSuperJSON.toString())})(window['__cdp.superJSON']);`,
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
        await this.send('Runtime.addBinding', { name: '__cdp.callback' });
        const attachFunction = (name: string, options?: ExposeFunctionOptions) => {
            // @ts-expect-error : window[name]
            window[name] = (...args: unknown[]) => {
                if (window.__cdp === undefined) {
                    window.__cdp = {
                        callSequence: BigInt(0),
                        returnValues: {},
                        returnErrors: {}
                    };
                }

                const cdp = window.__cdp;
                const callSequence = `${cdp.callSequence++}-${Math.random()}`;
                cdp.returnValues[callSequence] = { name, args };
                cdp.returnErrors[callSequence] = { name, args };

                window['__cdp.callback'](window['__cdp.superJSON'].stringify({ callSequence, name, args }));

                if (!options?.withReturnValue) {
                    delete cdp.returnValues[callSequence];
                    delete cdp.returnErrors[callSequence];
                    return;
                }

                const withReturnValue = typeof options.withReturnValue === 'object' ? options.withReturnValue : {};
                const { promise, resolve, reject } = Promise.withResolvers();
                const resultIntervalId = setInterval(() => {
                    try {
                        if (cdp.returnValues && callSequence in cdp.returnValues && 'value' in cdp.returnValues[callSequence]) {
                            resolve(cdp.returnValues[callSequence].value);
                        }
                        if (cdp.returnErrors && callSequence in cdp.returnErrors && 'value' in cdp.returnErrors[callSequence]) {
                            reject(cdp.returnErrors[callSequence].value as Error);
                        }
                    } catch (error) {
                        reject(error as Error);
                    }
                }, withReturnValue.delay ?? 1);
                promise.finally(() => {
                    clearInterval(resultIntervalId);
                    if (cdp.returnValues && callSequence in cdp.returnValues) {
                        delete cdp.returnValues[callSequence];
                    }
                    if (cdp.returnErrors && callSequence in cdp.returnErrors) {
                        delete cdp.returnErrors[callSequence];
                    }
                });
                if (withReturnValue.retry) {
                    const retry = withReturnValue.retry === true ? { delay: 1 } : withReturnValue.retry;
                    const retryIntervalId = setInterval(() => {
                        if ((retry.count !== undefined) && retry.count-- < 0) {
                            reject(new Error('Failed after maximum retry attempts.'));
                            return;
                        }
                        if (cdp.returnValues[callSequence].init) {
                            return;
                        }
                        window['__cdp.callback'](window['__cdp.superJSON'].stringify({ callSequence, name, args }));
                    }, retry.delay ?? 1);
                    promise.finally(() => clearInterval(retryIntervalId));
                }
                if (withReturnValue.timeout !== undefined) {
                    const timeoutId = setTimeout(() => reject(new Error('Operation did not complete before the timeout.')), withReturnValue.timeout);
                    promise.finally(() => clearTimeout(timeoutId));
                }

                return promise;
            };
        }

        type Payload = { executionContextId?: Protocol.Runtime.ExecutionContextId, options?: EvaluateOptions, callSequence: string, name: string, args: A };

        const processBindingCall = async (executionContextId: number, payload: Payload) => {
            if (payload.executionContextId === undefined) {
                payload.executionContextId = executionContextId;
            }
            if (payload.executionContextId === undefined) {
                console.error(`invalid context id : (payload: ${JSON.stringify(payload)})`);
                return;
            }
            if (!this.#executionContexts.has(payload.executionContextId)) {
                console.debug(`context not found: (id: ${payload.executionContextId}, payload: ${JSON.stringify(payload)})`);
                this.#executionContexts.set(payload.executionContextId, new ExecutionContext(this, payload.executionContextId));
            }
            const context = this.#executionContexts.get(payload.executionContextId);
            if (context === undefined) {
                console.error(`invalid context : (payload, ${JSON.stringify(payload)})`);
                return;
            }

            const withReturnValue = options?.withReturnValue;
            const timeout = typeof withReturnValue === 'object' ? withReturnValue.timeout : undefined;
            try {
                if (typeof withReturnValue === 'object' && withReturnValue.retry) {
                    await context.evaluate({ timeout }, (id, seq) => {
                        if (window.__cdp?.returnValues && seq in window.__cdp.returnValues) {
                            window.__cdp.returnValues[seq].init = true;
                        }
                    }, executionContextId, payload.callSequence);
                }
                const ret = await fn(...payload.args);

                if (withReturnValue) {
                    await context.evaluate({ timeout }, (id, seq, ret) => {
                        if (window.__cdp?.returnValues && seq in window.__cdp.returnValues) {
                            window.__cdp.returnValues[seq].value = ret;
                        }
                    }, executionContextId, payload.callSequence, ret);
                }
            } catch (error) {
                if ((error as Error).message !== 'target closed while handling command' && (error as Error).message !== 'Cannot find context with specified id') {
                    if (withReturnValue) {
                        await context.evaluate({ timeout }, (id, seq, error) => {
                            if (window.__cdp?.returnErrors && seq in window.__cdp.returnErrors) {
                                window.__cdp.returnErrors[seq].value = error;
                            }
                        }, executionContextId, payload.callSequence, error);
                    }
                }
            }
        }

        const bindingCalled = (event: Protocol.Runtime.BindingCalledEvent) => {
            try {
                if (event.name === '__cdp.callback') {
                    const payload: Payload = this.superJSON.parse(event.payload);
                    if (payload.name === name) {
                        processBindingCall(event.executionContextId, payload);
                    }
                }
            } catch (error) {
                if ((error as Error).message !== 'target closed while handling command' && (error as Error).message !== 'Cannot find context with specified id') {
                    console.debug(error);
                }
            }
        };

        this.on('Runtime.bindingCalled', bindingCalled);
        this.webContents.on('destroyed', () => this.#exposeFunctions.delete(name));
        this.#exposeFunctions.set(name, {
            scriptId: (await this.send('Page.addScriptToEvaluateOnNewDocument', {
                runImmediately: true,
                source: generateScriptString({ session: this }, attachFunction, name, options)
            })).identifier,
            bindingCalled
        });
        try {
            await this.evaluate(attachFunction, name, options);
        } catch (error) {
            if ((error as Error).message !== 'target closed while handling command' && (error as Error).message !== 'Cannot find context with specified id') {
                console.debug(error);
            }
        }
        for (const ctx of this.executionContexts.values()) {
            try {
                await ctx.evaluate(attachFunction, name, options);
            } catch (error) {
                if ((error as Error).message !== 'target closed while handling command' && (error as Error).message !== 'Cannot find context with specified id') {
                    console.debug(error);
                }
            }
        }
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
        entry: ExposeFunction) {
        this.off('Runtime.bindingCalled', entry.bindingCalled);
        await this.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: entry.scriptId });
        if (!this.webContents.isDestroyed()) {
            // @ts-expect-error : window[name]
            await Promise.all(Array.from(this.#executionContexts.values()).map(ctx => ctx.evaluate(name => delete window[name], name)));
        }
    }
}
