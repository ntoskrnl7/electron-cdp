import EventEmitter from 'events';
import { Protocol } from 'devtools-protocol/types/protocol.d';
import { ProtocolMapping } from 'devtools-protocol/types/protocol-mapping.d';
import Electron, { WebContents, webFrameMain } from 'electron';
import { EvaluateOptions, SuperJSON, ExecutionContext, generateScriptString } from '.';

import { readFileSync } from 'fs';
import { registerTypes } from './superJSON';

declare const globalThis: GlobalThis;

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

/**
 * Stable identifier for an Electron frame composed as `${processId}-${routingId}`.
 * Example: "1234-7"
 */
export type FrameId = `${number}-${number}`;

function getWebFrameFromFrameId(frameId: FrameId) {
    const [processId, routingId] = frameId.split('-').map(v => Number(v))
    return webFrameMain.fromId(processId, routingId);
}

/**
 * Options for sending commands.
 */
export declare interface CommandOptions {
    /** 
     * Maximum time in milliseconds to wait for the CDP command to complete.
     * Default: Infinity
     */
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

type XOR<T extends unknown[]> = T extends [infer T1, infer T2]
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
    readonly webContents: WebContents;

    #superJSON: SuperJSON;
    #customizeSuperJSON: CustomizeSuperJSONFunction = () => { };

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
    evaluate<A extends unknown[], R>(fn: (...args: A) => R, ...args: A): Promise<R>;

    /**
     * Evaluates the provided function with additional options and the given arguments in the context of the current page.
     *
     * @param options Additional options to customize the evaluation.
     * @param fn - The function to be evaluated.
     * @param args - The arguments to pass to the function.
     * @returns A promise that resolves with the result of the function.
     */
    evaluate<A extends unknown[], R>(options: EvaluateOptions, fn: (...args: A) => R, ...args: A): Promise<R>;

    /**
     * Exposes a function to the browser's global context under the specified name.
     *
     * @param name - The name under which the function will be exposed.
     * @param fn - The function to expose.
     * @param options - Optional settings for exposing the function.
     * @returns A promise that resolves when the function is successfully exposed.
     */
    async evaluate<F extends (...args: ARGS) => R, ARG_0, ARGS_OTHER extends unknown[], ARGS extends [ARG_0, ...ARGS_OTHER], R>(
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
     * Attaches to a specific DevTools Protocol target and returns a Session
     * scoped to that target's dedicated CDP session.
     *
     * Internally calls `Target.attachToTarget({ targetId, flatten: true })`
     * and uses the returned `sessionId`.
     *
     * @param webContents - The WebContents used to issue the CDP command.
     * @param targetId - Target ID of the page/iframe/worker/etc. to attach to.
     * @returns A `Session` bound to the attached target's session.
     */
    static async fromTargetId(webContents: WebContents, targetId: Protocol.Target.TargetID) {
        const session = new Session(webContents);
        const { sessionId } = await session.send('Target.attachToTarget', { targetId, flatten: true });
        return new Session(webContents, sessionId);
    }

    /**
     * Creates a new Session instance bound to a specific WebContents.
     *
     * @param webContents - The WebContents this session communicates with via CDP.
     * @param sessionId - Optional DevTools Protocol session ID. If provided,
     *                    only messages for this session are handled.
     * @param trackExecutionContexts - Whether to track Runtime execution context
     *                                 lifecycle events (created/destroyed/cleared)
     *                                 and expose them as ExecutionContext objects.
     */
    constructor(webContents: WebContents, sessionId?: Protocol.Target.SessionID, trackExecutionContexts = false) {
        super();
        this.id = sessionId;
        this.#superJSON = new SuperJSON();
        registerTypes(this.#superJSON);

        this.webContents = webContents;

        if (!webContents.debugger.isAttached()) {
            webContents.debugger.attach();
        }

        webContents.debugger.on('message', (_, method, params, sessionId) => {
            if (this.id === undefined && sessionId) {
                return;
            }
            if (this.id && this.id !== sessionId) {
                return;
            }
            this.emit(method as keyof ProtocolMapping.Events, params, sessionId || undefined);

            if (trackExecutionContexts) {
                switch (method) {
                    case 'Runtime.executionContextCreated': {
                        const event = params as Protocol.Runtime.ExecutionContextCreatedEvent;
                        const ctx = new ExecutionContext(this, event.context);
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
            }
        });
    }

    /**
     * Registers `listener` as the only handler for `eventName` on this instance.
     * Any existing listeners for the same event are removed first to prevent duplicates.
     *
     * @param eventName - CDP event name (e.g., 'Runtime.consoleAPICalled').
     * @param listener  - Listener function to attach.
     * @returns This `Session` instance (for chaining).
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
    async send<T extends keyof ProtocolMapping.Commands>(method: T, params?: ProtocolMapping.Commands[T]['paramsType'][0]): Promise<ProtocolMapping.Commands[T]['returnType']> {
        if (!this.webContents.debugger.isAttached()) {
            throw new Error('not attached');
        }
        return await this.webContents.debugger.sendCommand(method, params, this.id);
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

        const source = `${SuperJSONScript}; (${convertToFunction(this.#customizeSuperJSON.toString())})(SuperJSON.default); (globalThis.$cdp ??= {}).superJSON = SuperJSON.default;`;
        try {
            await this.send('Page.addScriptToEvaluateOnNewDocument', { runImmediately: true, source });
        } catch (error) {
            console.error('[Session.enableSuperJSON] Failed to inject code :', error);
            this.webContents.on('frame-created', (_, details) => details.frame?.executeJavaScript(source).catch(console.error));
            for (const frame of this.webContents.mainFrame.framesInSubtree) {
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

        const promises = [];
        const expression = `(${convertToFunction(this.#customizeSuperJSON.toString())})(globalThis.$cdp.superJSON);`;
        for (const frame of this.webContents.mainFrame.framesInSubtree) {
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
    async detach() {
        if (this.id) {
            await this.webContents.debugger.sendCommand('Target.detachFromTarget', { sessionId: this.id });
        } else if (this.webContents.debugger.isAttached()) {
            this.webContents.debugger.detach();
        }
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
            // @ts-expect-error : ignore
            globalThis.$cdp ??= { callback: {} };

            globalThis.$cdp.callback ??= { sequence: BigInt(0), returnValues: {}, errors: {} };

            const mode = options?.mode ?? 'Electron';

            if ('window' in globalThis && frameId) {
                if (window.$cdp.frameId === undefined) {
                    window.$cdp.frameId = Promise.resolve(frameId);
                } else if (window.$cdp.frameIdResolve) {
                    window.$cdp.frameIdResolve(frameId);
                    delete window.$cdp.frameIdResolve;
                }
            }

            if (mode === 'Electron') {
                globalThis.$cdp.callback.invoke = (payload, sessionId, frameId) => {
                    let type: 'unknown' | 'window' | 'worker' | 'shared-worker' | 'service-worker';
                    if (globalThis.DedicatedWorkerGlobalScope !== undefined) {
                        type = 'worker';
                    } else if (globalThis.SharedWorkerGlobalScope !== undefined) {
                        type = 'shared-worker';
                    } else if (globalThis.ServiceWorkerGlobalScope !== undefined) {
                        type = 'service-worker';
                    } else if (globalThis.Window !== undefined) {
                        type = 'window';
                    } else {
                        type = 'unknown'
                    }
                    if (globalThis.Window) {
                        if (window.$cdp.frameId === undefined) {
                            const { promise, resolve } = Promise.withResolvers<FrameId>();
                            window.$cdp.frameId = promise;
                            window.$cdp.frameIdResolve = resolve;
                        }
                        if (frameId) {
                            console.debug('cdp-utils-' + JSON.stringify({ type, frameId, sessionId, payload } as InvokeMessage));
                        } else {
                            window.$cdp.frameId.then(frameId => console.debug('cdp-utils-' + JSON.stringify({ type, frameId, sessionId, payload } as InvokeMessage)));
                        }
                    } else {
                        console.debug('cdp-utils-' + JSON.stringify({ type, frameId, sessionId, payload } as InvokeMessage));
                    }
                };
            }

            let global: Record<string, unknown> = globalThis;
            let lastName = name;
            if (name.includes('.')) {
                let scope: Record<string, unknown> = global;
                const parts = name.split('.');
                for (let i = 0, part = parts[i]; i < parts.length - 1; part = parts[++i]) {
                    if (!(part in scope) || typeof scope[part] !== "object" || scope[part] === null) {
                        scope[part] = {};
                    }
                    scope = scope[part] as Record<string, unknown>;
                }
                global = scope;
                lastName = parts[parts.length - 1];
            }

            if (!global[lastName]) {
                global[lastName] = (...args: unknown[]) => {
                    const sequence = `${globalThis.$cdp.callback.sequence++}-${Math.random()}`;
                    globalThis.$cdp.callback.returnValues[sequence] = { name, args };
                    globalThis.$cdp.callback.errors[sequence] = { name, args };

                    const invoke = () => {
                        if (mode === 'Electron' && globalThis.$cdp.callback.invoke) {
                            globalThis.$cdp.callback.invoke(globalThis.$cdp.superJSON.stringify({ sequence, name, args }), sessionId, frameId);
                        } else if (mode === 'CDP' && globalThis['$cdp.callback.invoke']) {
                            globalThis['$cdp.callback.invoke'](globalThis.$cdp.superJSON.stringify({ sequence, name, args }));
                        } else {
                            throw new Error('CDP callback invocation failed: handler not found.');
                        }
                    }

                    invoke();

                    const { promise, resolve, reject } = Promise.withResolvers();

                    if (options?.retry) {
                        const retry = options?.retry === true ? { delay: 1 } : options?.retry;
                        const retryIntervalId = setInterval(() => {
                            if (globalThis.$cdp.callback.returnValues?.[sequence].init) {
                                return;
                            }
                            if ((retry.count !== undefined) && retry.count-- < 0) {
                                console.warn('Failed after maximum retry attempts.');
                                return;
                            }
                            try {
                                invoke();
                            } catch (error) {
                                console.debug(error);
                                reject(error);
                            }
                        }, retry.delay ?? 1);
                        promise.finally(() => clearInterval(retryIntervalId));
                    }

                    if (!options?.withReturnValue) {
                        delete globalThis.$cdp.callback.returnValues[sequence];
                        delete globalThis.$cdp.callback.errors[sequence];
                        return;
                    }

                    const withReturnValue = typeof options.withReturnValue === 'object' ? options.withReturnValue : {};

                    const resultIntervalId = setInterval(() => {
                        try {
                            if (globalThis.$cdp.callback.returnValues && sequence in globalThis.$cdp.callback.returnValues && 'value' in globalThis.$cdp.callback.returnValues[sequence]) {
                                resolve(globalThis.$cdp.callback.returnValues[sequence].value);
                            }
                            if (globalThis.$cdp.callback.errors && sequence in globalThis.$cdp.callback.errors && 'value' in globalThis.$cdp.callback.errors[sequence]) {
                                reject(globalThis.$cdp.callback.errors[sequence].value as Error);
                            }
                        } catch (error) {
                            reject(error as Error);
                        }
                    }, withReturnValue.delay ?? 1);
                    promise.finally(() => {
                        clearInterval(resultIntervalId);
                        if (globalThis.$cdp.callback.returnValues && sequence in globalThis.$cdp.callback.returnValues) {
                            delete globalThis.$cdp.callback.returnValues[sequence];
                        }
                        if (globalThis.$cdp.callback.errors && sequence in globalThis.$cdp.callback.errors) {
                            delete globalThis.$cdp.callback.errors[sequence];
                        }
                    });
                    if (withReturnValue.timeout !== undefined) {
                        const timeoutId = setTimeout(() => reject(new Error('Operation did not complete before the timeout.')), withReturnValue.timeout);
                        promise.finally(() => clearTimeout(timeoutId));
                    }

                    return promise;
                };
                (global[lastName] as CallableFunction)['$mode'] = mode;
            }
        };

        type Payload = { options?: EvaluateOptions, sequence: string, name: string, args: A };

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
                        if (globalThis.$cdp?.callback.returnValues && seq in globalThis.$cdp.callback.returnValues) {
                            globalThis.$cdp.callback.returnValues[seq].init = true;
                        }
                    }, payload.sequence);
                }
                const ret = await fn(...payload.args);

                if (withReturnValue) {
                    await context.evaluate({ timeout }, (seq, ret) => {
                        if (globalThis.$cdp?.callback?.returnValues && seq in globalThis.$cdp.callback.returnValues) {
                            globalThis.$cdp.callback.returnValues[seq].value = ret;
                        }
                    }, payload.sequence, ret);
                }
            } catch (error) {
                if ((error as Error).message !== 'target closed while handling command' && (error as Error).message !== 'Cannot find context with specified id') {
                    if (withReturnValue) {
                        await context.evaluate({ timeout }, (seq, error) => {
                            if (globalThis.$cdp?.callback?.errors && seq in globalThis.$cdp.callback.errors) {
                                globalThis.$cdp.callback.errors[seq].value = error;
                            }
                        }, payload.sequence, error);
                    }
                }
            }
        };

        const mode = options?.mode ?? 'Electron';

        const bindingCalled = (event: Protocol.Runtime.BindingCalledEvent) => {
            try {
                if (event.name === '$cdp.callback.invoke') {
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
                const { type, sessionId, frameId, payload: payloadString } = JSON.parse(details.message.substring('cdp-utils-'.length)) as InvokeMessage;
                const frame = frameId ? getWebFrameFromFrameId(frameId) ?? details.frame : details.frame;

                frame.evaluate ??= async <A0, A extends unknown[], R>(userGestureOrFn: boolean | ((...args: [A0, ...A]) => R), fnOrArg0: A0 | ((...args: [A0, ...A]) => R), ...args: A): Promise<R> => {
                    if (typeof userGestureOrFn === 'boolean') {
                        return this.superJSON.parse(await (frame.executeJavaScript(generateScriptString({ session: this }, fnOrArg0 as (...args: A) => R, ...args), userGestureOrFn)) as string);
                    } else {
                        return this.superJSON.parse(await (frame.executeJavaScript(generateScriptString({ session: this }, userGestureOrFn, fnOrArg0 as A0, ...args))) as string);
                    }
                };

                if (sessionId === this.id) {
                    const target = ((type === 'worker' || type === 'service-worker' || type === 'shared-worker') ? new Session(this.webContents, sessionId) : frame);
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
                                await Promise.race([target.evaluate(seq => {
                                    if (globalThis.$cdp?.callback.returnValues && seq in globalThis.$cdp.callback.returnValues) {
                                        globalThis.$cdp.callback.returnValues[seq].init = true;
                                    }
                                }, payload.sequence), promise]);
                                resolve();
                            }
                            const ret = await fn(...payload.args);

                            if (withReturnValue) {
                                const { promise, resolve, reject } = Promise.withResolvers<void>();
                                if (timeout) {
                                    setTimeout(reject, timeout);
                                }
                                await Promise.race([target.evaluate((seq, ret) => {
                                    if (globalThis.$cdp?.callback.returnValues && seq in globalThis.$cdp.callback.returnValues) {
                                        globalThis.$cdp.callback.returnValues[seq].value = ret;
                                    }
                                }, payload.sequence, ret), promise]);
                                resolve();
                            }
                        } catch (error) {
                            if (withReturnValue) {
                                const { promise, resolve, reject } = Promise.withResolvers<void>();
                                if (timeout) {
                                    setTimeout(reject, timeout);
                                }
                                try {
                                    await Promise.race([target.evaluate((seq, error) => {
                                        if (globalThis.$cdp?.callback?.errors && seq in globalThis.$cdp.callback.errors) {
                                            globalThis.$cdp.callback.errors[seq].value = error;
                                        }
                                    }, payload.sequence, error), promise]);
                                } catch (error) {
                                    if (error instanceof Error) {
                                        error.message = error.message + `\t(sessionId: ${sessionId})`
                                        throw new Error(error.message);
                                    }
                                    throw error;
                                }
                                resolve();
                            }
                        }
                    }
                }
            }
        };

        if (mode === 'CDP') {
            await this.send('Runtime.addBinding', { name: '$cdp.callback.invoke' });
            this.on('Runtime.bindingCalled', bindingCalled);
        } else {
            this.webContents.on('console-message', onConsoleMessage);
        }
        this.webContents.on('destroyed', () => this.#exposeFunctions.delete(name));

        let entry;
        const removeHandler = (mode === 'CDP') ? () => this.off('Runtime.bindingCalled', bindingCalled) : () => this.webContents.off('console-message', onConsoleMessage);

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
            console.trace(`[CDP.exposeFunction] Failed to inject code(attachFunction:${name}) :`, error);
            try {
                await this.evaluate(attachFunction, name, options, this.id);
            } catch (error) {
                console.error(`[CDP.exposeFunction] Failed to inject code(attachFunction:${name}) :`, error);
            }
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
                const frameCreated = async (_: Electron.Event, details: Electron.FrameCreatedDetails) => {
                    try {
                        details.frame?.evaluate(attachFunction, name, options, this.id, `${details.frame.processId}-${details.frame.routingId}`);
                    } catch (error) {
                        if ((error as Error).message !== 'Cannot find context with specified id') {
                            console.debug(error);
                        }
                    }
                };
                this.webContents.on('frame-created', frameCreated);
                entry = {
                    frameCreated,
                    removeHandler
                };
            }
        }
        this.#exposeFunctions.set(name, entry);

        const promises = [];

        for (const frame of this.webContents.mainFrame.framesInSubtree) {
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
            return true;
        }
        return false;
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
            this.webContents.off('frame-created', entry.frameCreated);
        }
        // @ts-expect-error : globalThis[name]
        await Promise.allSettled(this.webContents.mainFrame.framesInSubtree.map(frame => frame.evaluate(name => delete globalThis[name], name)).concat(Array.from(this.#executionContexts.values()).map(ctx => ctx.evaluate(name => delete globalThis[name], name))));
    }
}
