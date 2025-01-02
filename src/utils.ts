import { readFileSync } from "fs";
import { applyGlobal } from "./global";
import { Session } from "./session";
import { Protocol, SuperJSON } from ".";

const SuperJSONScript = readFileSync(require.resolve('./window.SuperJSON')).toString();

export function generateScriptString<T, A extends unknown[]>(options: ({ session?: Session, timeout?: number; }) | undefined, fn: (...args: A) => T, ...args: A) {
    return (options?.session?.webContents.hasSuperJSON ? `
        (async () => {
            if (window.SuperJSON === undefined) {
                try {
                    window.SuperJSON = window.top.SuperJSON;
                } catch (error) {
                }
                if (window.SuperJSON === undefined) {
                    for (const w of Array.from(window)) {
                        try {
                            if (w.SuperJSON) {
                                window.SuperJSON = w.SuperJSON;
                                break;
                            }
                        } catch (error) {
                        }
                    }
                }
                if (window.SuperJSON === undefined) {
                    await new Promise(resolve => {
                        const h = setInterval(() => {
                            if (window.SuperJSON !== undefined) {
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
                if (window.SuperJSON === undefined) {
                    console.error('window.SuperJSON === undefined');
                    debugger;
                    throw new Error('Critical Error: SuperJSON library is missing. The application cannot proceed without it. : (fn : "` + fn.name + `", executionContextId : ' + window._executionContextId + ')');
                }
            }`
        :
        `
        ${SuperJSONScript}; (${options?.session ? options.session.customizeSuperJSON.toString() : () => { }})(SuperJSON.default); window.SuperJSON = SuperJSON.default;
        (async () => {
        `)
        +
        `
            ;;(${applyGlobal.toString()})();;
            const fn = new Function('return ' + ${JSON.stringify(fn.toString())})();
            const args = SuperJSON.parse(${JSON.stringify(options?.session ? options.session.superJSON.stringify(args) : SuperJSON.stringify(args))});
            const result = await fn(...args);
            return SuperJSON.stringify(result);
        })();`
}
