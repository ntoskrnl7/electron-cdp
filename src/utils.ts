import { applyPolyfill } from "./global";
import { Session } from "./session";
import { SuperJSON } from ".";

import superJSONBrowserScript from './superJSON.browser.js?raw';

const FunctionSignature = '_$cdp_fn$_';

export function generateScriptString<T, A extends unknown[]>(options: ({ session?: Session, timeout?: number; }) | undefined, fn: (...args: A) => T, ...args: A) {
    const argsPacked = args.map(arg => (typeof arg === 'function' ? FunctionSignature + arg.toString() : arg));
    const argsCode = argsPacked
        .map((arg, index) =>
            (typeof arg === 'string' && arg.trim().startsWith(FunctionSignature)) ? `args[${index}] = ${arg.substring(FunctionSignature.length).toString()};` : '')
        .join(';\n');
    return '(async () => {' +
        (options?.session?.isSuperJSONPreloaded ?
            `
            globalThis.$cdp ??= {};
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
            (${options?.session ? options.session.customizeSuperJSON.toString() : () => { }})(SuperJSON.default); (globalThis.$cdp ??= {}).superJSON = SuperJSON.default;
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
