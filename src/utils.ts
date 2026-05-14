import { applyPolyfill } from './global';
import { Session } from './session';
import { SuperJSON } from 'superjson';

import superJSONBrowserScript from './superJSON.browser.js?raw';
import { WebFrameMain } from 'electron';

const FunctionSignature = '_$cdp_fn$_';

type AnyFunction = (...args: unknown[]) => unknown;

/**
 * Converts a function into the script body that can be injected before the
 * generated evaluate wrapper. String values are treated as already-extracted
 * script bodies so callers can pass raw JavaScript when needed.
 */
function getFunctionBody(fn: AnyFunction | string) {
    if (typeof fn === 'string') return fn;

    const source = Function.prototype.toString.call(fn).trim();

    const start = source.indexOf("{");
    const end = source.lastIndexOf("}");

    if (start !== -1 && end !== -1 && end > start) {
        return source.slice(start + 1, end).trim();
    }

    const arrowIndex = source.indexOf("=>");

    if (arrowIndex !== -1) {
        return source.slice(arrowIndex + 2).trim();
    }
}

/**
 * Options used to generate the browser-side wrapper script for evaluate calls.
 */
export type GenerateScriptOptions = {
    /**
     * Session that provides SuperJSON serialization settings and preload state.
     */
    session?: Session;

    /**
     * Maximum wait time, in milliseconds, for a preloaded SuperJSON instance.
     *
     * @default 5000
     */
    timeout?: number;

    /**
     * Script body or function body to run before the generated evaluate wrapper setup.
     */
    initScript?: (() => void) | string;
}

/**
 * Options accepted by `WebFrameMain.evaluate` when its first argument is an object.
 */
export type WebFrameEvaluateOptions = Omit<GenerateScriptOptions, 'session'> & {
    /**
     * Whether the evaluated code should run as if it was triggered by a user gesture.
     */
    userGesture?: boolean;

    /**
     * Script generation options applied only to this evaluate call.
     *
     * This is also accepted as a nested form so callers can share the same
     * `{ script }` object used by `Session.evaluate`.
     */
    script?: Omit<GenerateScriptOptions, 'session'>;
};

/**
 * Default options installed by `patchWebFrameMain` for patched frame evaluate calls.
 */
export type WebFramePatchOptions = Omit<GenerateScriptOptions, 'session'> & {
    /**
     * Replace an existing `evaluate` helper when one is already present on the frame.
     */
    overwrite?: boolean;
};

/**
 * Builds the JavaScript source evaluated inside a target frame or runtime context.
 *
 * The generated wrapper runs `initScript` first, prepares SuperJSON/polyfills,
 * restores function arguments that were serialized as source text, then invokes
 * `fn(...args)` and serializes either the result or thrown error back to Node.
 *
 * @template T - Return type of the function evaluated in the target context.
 * @template A - Argument tuple passed to the evaluated function.
 * @param options - Script generation options.
 * @param options.session - Session used for SuperJSON customization and serialization.
 * @param options.timeout - Maximum wait time, in milliseconds, for a preloaded SuperJSON instance.
 * @param options.initScript - Script body or function body to run before the generated wrapper setup.
 * @param fn - Function to execute in the target context.
 * @param args - Arguments passed to `fn`.
 * @returns JavaScript source string ready to pass to CDP `Runtime.evaluate` or Electron `executeJavaScript`.
 */
export function generateScriptString<T, A extends unknown[]>(options: GenerateScriptOptions | undefined, fn: (...args: A) => T, ...args: A) {
    const argsPacked = args.map(arg => (typeof arg === 'function' ? FunctionSignature + arg.toString() : arg));
    const argsCode = argsPacked
        .map((arg, index) =>
            (typeof arg === 'string' && arg.trim().startsWith(FunctionSignature)) ? `args[${index}] = ${arg.substring(FunctionSignature.length).toString()};` : '')
        .join(';\n');
    return '(async () => {' + `;;${getFunctionBody(options?.initScript ?? '')};;` +
        (options?.session?.isSuperJSONPreloaded ?
            `
            globalThis.$cdp ??= { consoleDebug: console.debug };
            if (globalThis.$cdp.superJSON === undefined) {
                try {
                    globalThis.$cdp.superJSON = globalThis.top.$cdp.superJSON;
                } catch (error) {
                }
                if (globalThis.$cdp.superJSON === undefined) {
                    for (const w of Array.from(globalThis)) {
                        try {
                            if (w.$cdp.superJSON) {
                                globalThis.$cdp.superJSON = w.$cdp.superJSON;
                                break;
                            }
                        } catch (error) {
                        }
                    }
                }
                if (globalThis.$cdp.superJSON === undefined) {
                    await new Promise(resolve => {
                        const h = setInterval(() => {
                            if (globalThis.$cdp.superJSON !== undefined) {
                            clearInterval(h);
                            resolve();
                            }
                        });
                        setTimeout(() => {
                            clearInterval(h);
                            resolve();
                        }, ${options?.timeout ?? 5000});
                    });
                }
                if (globalThis.$cdp.superJSON === undefined) {
                    console.error('globalThis.$cdp.superJSON === undefined');
                    debugger;
                    throw new Error('Critical Error: SuperJSON library is missing. The application cannot proceed without it. : (fn : "` + fn.name + `", executionContextId : ' + globalThis._executionContextId + ')');
                }
            }`

            :

            `
            ${superJSONBrowserScript};
            (${options?.session?.customizeSuperJSON.toString() ?? (() => { })})(SuperJSON.default); (globalThis.$cdp ??= { consoleDebug: console.debug }).superJSON = SuperJSON.default;
            `
        )
        +
        `
            ;;(${applyPolyfill.toString()})();;
            const fn = ${fn.toString()};
            const args = globalThis.$cdp.superJSON.parse(${JSON.stringify(options?.session ? options.session.superJSON.stringify(argsPacked) : SuperJSON.stringify(argsPacked))});
            ${argsCode}
            try {
                const result = await fn(...args);
                return globalThis.$cdp.superJSON.stringify(result);
            } catch (error) {
                throw globalThis.$cdp.superJSON.stringify(error);
            }
        })();`
}

/**
 * Adds the typed `evaluate` helper to an Electron `WebFrameMain`.
 *
 * The helper mirrors `executeJavaScript`, but accepts a function plus typed
 * arguments, serializes values through the session's SuperJSON instance, and
 * rethrows browser-side errors as parsed JavaScript values when possible.
 *
 * @param session - CDP session that owns serialization settings and SuperJSON customizations.
 * @param frame - Electron frame to patch.
 * @param options - Default script-generation options for frame evaluate calls. Set `overwrite` to replace an existing helper.
 * @returns The same frame instance after `evaluate` has been installed.
 */
export function patchWebFrameMain(session: Session, frame: WebFrameMain, options?: WebFramePatchOptions) {
    const { overwrite, ...defaultScriptOptions } = options ?? {};

    const fn = async <R>(...evaluateArgs: unknown[]): Promise<R> => {
        try {
            const [firstArg, secondArg, ...args] = evaluateArgs;
            let userGesture: boolean | undefined;
            let scriptOptions: Omit<GenerateScriptOptions, 'session'> | undefined = defaultScriptOptions;
            let targetFn: ((...args: unknown[]) => R) | undefined;
            let targetArgs: unknown[];

            if (typeof firstArg === 'boolean') {
                userGesture = firstArg;
                targetFn = secondArg as ((...args: unknown[]) => R) | undefined;
                targetArgs = args;
            } else if (typeof firstArg === 'function') {
                targetFn = firstArg as (...args: unknown[]) => R;
                targetArgs = evaluateArgs.slice(1);
            } else if (firstArg && typeof firstArg === 'object') {
                const { userGesture: evaluateUserGesture, script, ...inlineScriptOptions } = firstArg as WebFrameEvaluateOptions;
                userGesture = evaluateUserGesture;
                scriptOptions = { ...defaultScriptOptions, ...inlineScriptOptions, ...script };
                targetFn = secondArg as ((...args: unknown[]) => R) | undefined;
                targetArgs = args;
            } else {
                throw new Error('invalid parameter');
            }

            if (typeof targetFn !== 'function') {
                throw new TypeError('invalid parameter');
            }

            const source = generateScriptString({ ...scriptOptions, session }, targetFn, ...targetArgs);
            const result = userGesture === undefined
                ? await frame.executeJavaScript(source)
                : await frame.executeJavaScript(source, userGesture);
            return session.superJSON.parse(result as string);
        } catch (error) {
            if (typeof error === 'string') {
                let result;
                try {
                    result = session.superJSON.parse(error);
                } catch {
                }
                if (result) {
                    throw result;
                }
            }
            throw error;
        }
    };
    if (overwrite) {
        frame.evaluate = fn;
    } else {
        frame.evaluate ??= fn;
    }
    return frame;
}
