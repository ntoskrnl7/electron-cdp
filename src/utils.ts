import { readFileSync } from "fs";
import { applyGlobal } from "./global";
import { Session } from "./session";
import { SuperJSON } from ".";

const SuperJSONScript = readFileSync(require.resolve('./window.SuperJSON')).toString();

export function generateScriptString<T, A extends unknown[]>(options: ({ session?: Session, timeout?: number; }) | undefined, fn: (...args: A) => T, ...args: A) {
    return (options?.session?.webContents.hasSuperJSON ? `
        (async () => {
            if (globalThis.__cdp_superJSON === undefined) {
                try {
                    globalThis.__cdp_superJSON = globalThis.top.__cdp_superJSON;
                } catch (error) {
                }
                if (globalThis.__cdp_superJSON === undefined) {
                    for (const w of Array.from(globalThis)) {
                        try {
                            if (w.__cdp_superJSON) {
                                globalThis.__cdp_superJSON = w.__cdp_superJSON;
                                break;
                            }
                        } catch (error) {
                        }
                    }
                }
                if (globalThis.__cdp_superJSON === undefined) {
                    await new Promise(resolve => {
                        const h = setInterval(() => {
                            if (globalThis.__cdp_superJSON !== undefined) {
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
                if (globalThis.__cdp_superJSON === undefined) {
                    console.error('globalThis.__cdp_superJSON === undefined');
                    debugger;
                    throw new Error('Critical Error: SuperJSON library is missing. The application cannot proceed without it. : (fn : "` + fn.name + `", executionContextId : ' + globalThis._executionContextId + ')');
                }
            }`
        :
        `
        ${SuperJSONScript}; (${options?.session ? options.session.customizeSuperJSON.toString() : () => { }})(SuperJSON.default); globalThis.__cdp_superJSON = SuperJSON.default;
        (async () => {
        `)
        +
        `
            ;;(${applyGlobal.toString()})();;
            const fn = new Function('return ' + ${JSON.stringify(fn.toString())})();
            const args = globalThis.__cdp_superJSON.parse(${JSON.stringify(options?.session ? options.session.superJSON.stringify(args) : SuperJSON.stringify(args))});
            const result = await fn(...args);
            return globalThis.__cdp_superJSON.stringify(result);
        })();`
}
