import EventEmitter from 'events';
import { Protocol } from 'devtools-protocol/types/protocol.d';
import { ProtocolMapping } from 'devtools-protocol/types/protocol-mapping.d';
import Electron, { Debugger, WebContents, webFrameMain } from 'electron';
import { EvaluateOptions, SuperJSON, ExecutionContext, generateScriptString } from '.';

import { readFileSync } from 'fs';
import { registerTypes } from './superJSON';

const SuperJSONScript = readFileSync(require.resolve('./window.SuperJSON')).toString();

function convertToFunction(code: string) {
    const trimmedCode = code.trim();
    if (/^\s*\(.*\)\s*=>\s*{/.test(trimmedCode)) {
        return code;
    }
    if (/^\s*function\s*\w*\s*\(.*\)\s*{/.test(trimmedCode)) {
        return code;
    }
    return `function ${trimmedCode}`;
}

type FrameId = `${number}-${number}`;

function getWebFrameFromFrameId(frameId: FrameId) {
    const [processId, routingId] = frameId.split('-').map(v => Number(v))
    return webFrameMain.fromId(processId, routingId);
}

declare global {
    namespace globalThis {
        var __cdp_frameId: Promise<FrameId>;
        var __cdp_frameIdResolve: (id: FrameId) => void;

        /**
          * SuperJSON.
          */
        var __cdp_superJSON: SuperJSON;

        /**
         * Method used internally by the exposeFunction method.
         */
        var __cdp_callback: (payload: string) => void;

        var __cdp: {
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
        };
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
    [Property in keyof ProtocolMapping.Events]: [...ProtocolMapping.Events[Property], sessionId?: Protocol.Target.SessionID];
} & {
    'execution-context-created': [ExecutionContext];
    'execution-context-destroyed': [Protocol.Runtime.ExecutionContextDestroyedEvent & { sessionId?: Protocol.Target.SessionID }];
};

/**
 * Options for awaiting the function call result.
 */
export interface WithReturnValueOptions {
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
}

/**
 * Options for retrying a function call if it fails.
 */
export interface RetryOptions {
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
}

/**
 * Options for exposing a function.
 */
export interface ExposeFunctionOptions {

    /**
     * Behavior when exposing a function
     *
     * - `'Electron'`: Detects function calls through the 'console-message' event handler in Electron.
     * - `'CDP'`: Uses CDP's `Runtime.bindingCalled` to detect function calls.
     *   Requires `Runtime.enable` to be enabled in CDP.
     *
     * Default: `'Electron'`
     */
    mode?: 'Electron' | 'CDP';

    /**
     * If not specified or set to false, the function call result will not be awaited.
     *
     * If the function does not return a value, this property should either be omitted or set to false.
     *
     * - `false`, `undefined` : The function call result will not be awaited.
     * - `true`, `{}` : The function call result will be awaited with the default settings for its sub-properties.
     */
    withReturnValue?: boolean | WithReturnValueOptions;

    /**
     * Indicates whether the function call should be retried if it fails.
     * If not specified, no retries will be performed.
     *
     * - `false`, `undefined` : No retry attempts will be made. The function call will fail immediately if it encounters an error.
     * - `true`, `{}`: The function call will be retried using the default retry configuration.
     */
    retry?: boolean | RetryOptions;
}

export type CustomizeSuperJSONFunction = (superJSON: SuperJSON) => void;

type XOR<T extends any[]> = T extends [infer T1, infer T2]
    ? XOR_<T1, T2>
    : T extends [infer T1, infer T2, ...infer Rest]
    ? XOR_<T1, XOR<[T2, ...Rest]>>
    : never;

type XOR_<T1, T2> = (T1 | T2) extends object
    ? (T1 extends T2 ? never : T1) | (T2 extends T1 ? never : T2)
    : T1 | T2;

type ExposeFunction =
    XOR<[{ executionContextCreated: (context: ExecutionContext) => Promise<void>; }, { frameCreated: (event: Electron.Event, details: Electron.FrameCreatedDetails) => void }, { scriptId: Protocol.Page.ScriptIdentifier; }]>
    &
    { removeHandler: () => void };

/**
 * Represents a session for interacting with the browser's DevTools protocol.
 */
export class Session extends EventEmitter<Events> {

    readonly id?: Protocol.Target.SessionID;
    #superJSON: SuperJSON;
    #customizeSuperJSON: CustomizeSuperJSONFunction = () => { };

    #webContents: WebContents;
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

    private fromSessionId(sessionId: Protocol.Target.SessionID) {
        return new Session(this.#webContents, sessionId);
    }

    /**
     * Creates a new Session instance.
     *
     * @param webContents - The web contents associated with this session.
     * @param sessionId -
     */
    constructor(webContents: WebContents, sessionId?: Protocol.Target.SessionID) {
        super();
        this.id = sessionId;
        this.#superJSON = new SuperJSON();
        registerTypes(this.#superJSON);

        this.#webContents = webContents;
        this.#debugger = webContents.debugger;
        this.#debugger.on('message', (_, method, params, sessionId) => {
            if (this.id === undefined && sessionId !== '') {
                return;
            }
            if (this.id && this.id !== sessionId) {
                return;
            }
            this.emit(method as keyof ProtocolMapping.Events, params, sessionId || undefined);
            switch (method) {
                case 'Runtime.executionContextCreated': {
                    const event = params as Protocol.Runtime.ExecutionContextCreatedEvent;
                    const ctx = new ExecutionContext(sessionId ? this.fromSessionId(sessionId) : this, event.context);
                    this.#executionContexts.set(event.context.id, ctx);
                    this.emit('execution-context-created', ctx);
                    break;
                }
                case 'Runtime.executionContextDestroyed':
                    this.emit('execution-context-destroyed', { ...params, sessionId });
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
        return this.#debugger.sendCommand(method, params, this.id);
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
        if (this.#webContents.hasSuperJSON) {
            if (customizeSuperJSON) {
                await this.configureSuperJSON(customizeSuperJSON);
            }
            return;
        }

        if (customizeSuperJSON) {
            this.customizeSuperJSON = customizeSuperJSON;
        }

        const source = `${SuperJSONScript}; (${convertToFunction(this.#customizeSuperJSON.toString())})(SuperJSON.default); globalThis.__cdp_superJSON = SuperJSON.default;`;
        try {
            await this.send('Page.addScriptToEvaluateOnNewDocument', { runImmediately: true, source });
        } catch (error) {
            this.#webContents.on('frame-created', (_, details) => details.frame?.executeJavaScript(source).catch(console.error));
            for (const frame of this.#webContents.mainFrame.framesInSubtree) {
                frame.executeJavaScript(source).catch(console.error);
            }
        }

        const buildParams = () => ({
            expression: source,
            throwOnSideEffect: false,
            awaitPromise: true,
            replMode: false,
            returnByValue: false,
            generatePreview: false,
            silent: true,
            includeCommandLineAPI: false
        });
        await this.send('Runtime.evaluate', buildParams()).catch(console.error);
        for (const contextId of this.#executionContexts.keys()) {
            this.send('Runtime.evaluate', { ...buildParams(), contextId }).catch(console.error);
        }
        this.#webContents.hasSuperJSON = true;
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
        if (!this.#webContents.hasSuperJSON) {
            return await this.enableSuperJSON(customizeSuperJSON);
        }

        this.customizeSuperJSON = customizeSuperJSON;

        let promises = [];
        const expression = `(${convertToFunction(this.#customizeSuperJSON.toString())})(globalThis.__cdp_superJSON);`;
        for (const frame of this.#webContents.mainFrame.framesInSubtree) {
            promises.push(frame.executeJavaScript(expression));
        }
        promises.push(this.send('Runtime.evaluate', {
            expression,
            throwOnSideEffect: false,
            awaitPromise: true,
            replMode: false,
            returnByValue: false,
            generatePreview: false,
            silent: true,
            includeCommandLineAPI: false,
        }));

        for (const contextId of this.#executionContexts.keys()) {
            promises.push(this.send('Runtime.evaluate', {
                contextId,
                expression,
                throwOnSideEffect: false,
                awaitPromise: true,
                replMode: false,
                returnByValue: false,
                generatePreview: false,
                silent: true,
                includeCommandLineAPI: false,
            }));
        }

        await Promise.allSettled(promises);
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
        const attachFunction = (name: string, options?: ExposeFunctionOptions, sessionId?: Protocol.Target.SessionID, frameId?: FrameId) => {
            const mode = options?.mode ?? 'Electron';
            if (frameId) {
                if (globalThis.__cdp_frameId === undefined) {
                    globalThis.__cdp_frameId = Promise.resolve(frameId);
                } else if (globalThis.__cdp_frameIdResolve) {
                    globalThis.__cdp_frameIdResolve(frameId);
                }
            }
            if (mode === 'Electron') {
                globalThis.__cdp_callback = payload => {
                    if (globalThis.__cdp_frameId === undefined) {
                        const { promise, resolve } = Promise.withResolvers<FrameId>();
                        globalThis.__cdp_frameId = promise;
                        globalThis.__cdp_frameIdResolve = resolve;
                    }
                    globalThis.__cdp_frameId.then(frameId => console.debug('cdp-utils-' + JSON.stringify({ frameId, sessionId, payload })));
                }
            }

            // @ts-expect-error : globalThis[name]
            globalThis[name] = (...args: unknown[]) => {
                if (globalThis.__cdp === undefined) {
                    globalThis.__cdp = {
                        callSequence: BigInt(0),
                        returnValues: {},
                        returnErrors: {}
                    };
                }

                const cdp = globalThis.__cdp;
                const callSequence = `${cdp.callSequence++}-${Math.random()}`;
                cdp.returnValues[callSequence] = { name, args };
                cdp.returnErrors[callSequence] = { name, args };

                globalThis.__cdp_callback(globalThis.__cdp_superJSON.stringify({ callSequence, name, args }));

                const { promise, resolve, reject } = Promise.withResolvers();

                if (options?.retry) {
                    const retry = options?.retry === true ? { delay: 1 } : options?.retry;
                    const retryIntervalId = setInterval(() => {
                        if (cdp.returnValues[callSequence].init) {
                            return;
                        }
                        if ((retry.count !== undefined) && retry.count-- < 0) {
                            console.warn('Failed after maximum retry attempts.');
                            return;
                        }
                        globalThis.__cdp_callback(globalThis.__cdp_superJSON.stringify({ callSequence, name, args }));
                    }, retry.delay ?? 1);
                    promise.finally(() => clearInterval(retryIntervalId));
                }

                if (!options?.withReturnValue) {
                    delete cdp.returnValues[callSequence];
                    delete cdp.returnErrors[callSequence];
                    return;
                }

                const withReturnValue = typeof options.withReturnValue === 'object' ? options.withReturnValue : {};

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
                if (withReturnValue.timeout !== undefined) {
                    const timeoutId = setTimeout(() => reject(new Error('Operation did not complete before the timeout.')), withReturnValue.timeout);
                    promise.finally(() => clearTimeout(timeoutId));
                }

                return promise;
            };
        }

        type Payload = { options?: EvaluateOptions, callSequence: string, name: string, args: A };

        const processBindingCall = async (executionContextId: number, payload: Payload) => {
            if (!this.#executionContexts.has(executionContextId)) {
                console.debug(`context not found: (id: ${executionContextId}, payload: ${JSON.stringify(payload)})`);
                this.#executionContexts.set(executionContextId, new ExecutionContext(this, executionContextId));
            }
            const context = this.#executionContexts.get(executionContextId);
            if (context === undefined) {
                console.error(`invalid context : (payload, ${JSON.stringify(payload)})`);
                return;
            }

            const withReturnValue = options?.withReturnValue;
            const timeout = typeof withReturnValue === 'object' ? withReturnValue.timeout : undefined;
            try {
                if (options?.retry) {
                    await context.evaluate({ timeout }, (seq) => {
                        if (globalThis.__cdp?.returnValues && seq in globalThis.__cdp.returnValues) {
                            globalThis.__cdp.returnValues[seq].init = true;
                        }
                    }, payload.callSequence);
                }
                const ret = await fn(...payload.args);

                if (withReturnValue) {
                    await context.evaluate({ timeout }, (seq, ret) => {
                        if (globalThis.__cdp?.returnValues && seq in globalThis.__cdp.returnValues) {
                            globalThis.__cdp.returnValues[seq].value = ret;
                        }
                    }, payload.callSequence, ret);
                }
            } catch (error) {
                if ((error as Error).message !== 'target closed while handling command' && (error as Error).message !== 'Cannot find context with specified id') {
                    if (withReturnValue) {
                        await context.evaluate({ timeout }, (seq, error) => {
                            if (globalThis.__cdp?.returnErrors && seq in globalThis.__cdp.returnErrors) {
                                globalThis.__cdp.returnErrors[seq].value = error;
                            }
                        }, payload.callSequence, error);
                    }
                }
            }
        }

        const mode = options?.mode ?? 'Electron';

        const bindingCalled = (event: Protocol.Runtime.BindingCalledEvent) => {
            try {
                if (event.name === '__cdp_callback') {
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

        const onConsoleMessage = async (details: Electron.Event<Electron.WebContentsConsoleMessageEventParams>) => {
            if (details.level === 'debug' && details.message.startsWith('cdp-utils-')) {
                const { sessionId, frameId, payload: payloadString } = JSON.parse(details.message.substring('cdp-utils-'.length));
                const frame = frameId ? getWebFrameFromFrameId(frameId) ?? details.frame : details.frame;

                if (frame.evaluate === undefined) {
                    frame.evaluate = async <A0, A extends unknown[], R>(userGestureOrFn: boolean | ((...args: [A0, ...A]) => R), fnOrArg0: A0 | ((...args: [A0, ...A]) => R), ...args: A): Promise<R> => {
                        if (typeof userGestureOrFn === 'boolean') {
                            return this.superJSON.parse(await (frame.executeJavaScript(generateScriptString({ session: this }, fnOrArg0 as (...args: A) => R, ...args), userGestureOrFn)) as string);
                        } else {
                            return this.superJSON.parse(await (frame.executeJavaScript(generateScriptString({ session: this }, userGestureOrFn, ...[fnOrArg0 as A0, ...args]))) as string);
                        }
                    };
                }

                if (sessionId === this.id) {
                    const payload: Payload = this.superJSON.parse(payloadString);
                    if (payload.name === name) {
                        const withReturnValue = options?.withReturnValue;
                        const timeout = typeof withReturnValue === 'object' ? withReturnValue.timeout : undefined;
                        try {
                            if (options?.retry) {
                                const { promise, resolve, reject } = Promise.withResolvers<void>();
                                if (timeout) {
                                    setTimeout(reject, timeout);
                                }
                                await Promise.race([frame.evaluate(seq => {
                                    if (globalThis.__cdp?.returnValues && seq in globalThis.__cdp.returnValues) {
                                        globalThis.__cdp.returnValues[seq].init = true;
                                    }
                                }, payload.callSequence), promise]);
                                resolve();
                            }
                            const ret = await fn(...payload.args);

                            if (withReturnValue) {
                                const { promise, resolve, reject } = Promise.withResolvers<void>();
                                if (timeout) {
                                    setTimeout(reject, timeout);
                                }
                                await Promise.race([frame.evaluate((seq, ret) => {
                                    if (globalThis.__cdp?.returnValues && seq in globalThis.__cdp.returnValues) {
                                        globalThis.__cdp.returnValues[seq].value = ret;
                                    }
                                }, payload.callSequence, ret), promise]);
                                resolve();
                            }
                        } catch (error) {
                            if (withReturnValue) {
                                const { promise, resolve, reject } = Promise.withResolvers<void>();
                                if (timeout) {
                                    setTimeout(reject, timeout);
                                }
                                await Promise.race([frame.evaluate((seq, error) => {
                                    if (globalThis.__cdp?.returnErrors && seq in globalThis.__cdp.returnErrors) {
                                        globalThis.__cdp.returnErrors[seq].value = error;
                                    }
                                }, payload.callSequence, error), promise]);
                                resolve();
                            }
                        }
                    }
                }
            }
        };

        if (mode === 'CDP') {
            await this.send('Runtime.addBinding', { name: '__cdp_callback' });
            this.on('Runtime.bindingCalled', bindingCalled);
        } else {
            this.#webContents.on('console-message', onConsoleMessage);
        }
        this.#webContents.on('destroyed', () => this.#exposeFunctions.delete(name));

        let entry;
        const removeHandler = (mode === 'CDP') ? () => this.off('Runtime.bindingCalled', bindingCalled) : () => this.#webContents.off('console-message', onConsoleMessage);

        try {
            const scriptId = (await this.send('Page.addScriptToEvaluateOnNewDocument', {
                runImmediately: true,
                source: generateScriptString({ session: this }, attachFunction, name, options, this.id)
            })).identifier;
            entry = {
                scriptId,
                removeHandler
            };
        } catch (error) {
            if (mode === 'CDP') {
                const executionContextCreated = async (context: ExecutionContext) => {
                    try {
                        await context.evaluate(attachFunction, name, options, this.id);
                    } catch (error) {
                        if ((error as Error).message !== 'Cannot find context with specified id') {
                            console.debug(error);
                        }
                    }
                };
                this.on('execution-context-created', executionContextCreated);
                entry = {
                    executionContextCreated,
                    removeHandler
                };
            } else {
                const frameCreated = async (event: Electron.Event, details: Electron.FrameCreatedDetails) => {
                    try {
                        details.frame?.evaluate(attachFunction, name, options, this.id, `${details.frame.processId}-${details.frame.routingId}`);
                    } catch (error) {
                        if ((error as Error).message !== 'Cannot find context with specified id') {
                            console.debug(error);
                        }
                    }
                };
                this.#webContents.on('frame-created', frameCreated);
                entry = {
                    frameCreated,
                    removeHandler
                };
            }
        }
        this.#exposeFunctions.set(name, entry);

        let promises = [];

        for (const frame of this.#webContents.mainFrame.framesInSubtree) {
            promises.push(frame.evaluate(attachFunction, name, options, this.id, `${frame.processId}-${frame.routingId}`).catch(console.debug));
        }

        promises.push(this.evaluate(attachFunction, name, options, this.id).catch(error => {
            if ((error as Error).message !== 'target closed while handling command' && (error as Error).message !== 'Cannot find context with specified id') {
                console.debug(error);
            }
        }));
        for (const ctx of this.#executionContexts.values()) {
            promises.push(ctx.evaluate(attachFunction, name, options, this.id).catch(error => {
                if ((error as Error).message !== 'target closed while handling command' && (error as Error).message !== 'Cannot find context with specified id') {
                    console.debug(error);
                }
            }));
        }

        this.#webContents.on('destroyed', () => this.#removeExposedFunction(name, entry));

        await Promise.allSettled(promises);
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

    async #removeExposedFunction(name: string, entry: ExposeFunction) {
        entry.removeHandler();
        if ('scriptId' in entry) {
            await this.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: entry.scriptId });
        } else if ('executionContextCreated' in entry) {
            this.off('execution-context-created', entry.executionContextCreated);
        } else {
            this.#webContents.off('frame-created', entry.frameCreated);
        }
        if (!this.#webContents.isDestroyed()) {
            // @ts-expect-error : globalThis[name]
            await Promise.allSettled(this.#webContents.mainFrame.framesInSubtree.map(frame => frame.evaluate(name => delete globalThis[name], name)).concat(Array.from(this.#executionContexts.values()).map(ctx => ctx.evaluate(name => delete globalThis[name], name))));
        }
    }

    set webContents(newWebContents: WebContents) {
        this.#webContents = newWebContents;
    }

    get webContents() {
        return this.#webContents;
    }
}
