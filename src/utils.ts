import { readFileSync } from "fs";
import { applyGlobal } from "./global";
import { Session } from "./session";
import { SuperJSON } from ".";

const SuperJSONScript = readFileSync(require.resolve('./window.SuperJSON')).toString();

export function generateScriptString<T, A extends unknown[]>(options: ({ session?: Session, timeout?: number; }) | undefined, fn: (...args: A) => T, ...args: A) {

    const argsPacked = args.map(arg => (typeof arg === 'function' ? arg.toString() : arg));
    const argsCode = argsPacked.map((arg, index) => {
        if (typeof arg === 'string' && arg.startsWith('function')) {
            return `args[${index}] = ${arg.toString()};`;
        }
        return '';
    }).join(';\n');
    return (options?.session?.webContents.hasSuperJSON ? `
        (async () => {
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
        ${SuperJSONScript}; (${options?.session ? options.session.customizeSuperJSON.toString() : () => { }})(SuperJSON.default); (globalThis.$cdp ??= {}).superJSON = SuperJSON.default;
        (async () => {
        `)
        +
        `
            ;;(${applyGlobal.toString()})();;
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
