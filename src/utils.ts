import { readFileSync } from "fs";
import { applyGlobal } from "./global";
import { Session } from "./session";
import { SuperJSON } from ".";

const SuperJSONScript = readFileSync(require.resolve('./window.SuperJSON')).toString();

export function generateScriptString<T, A extends unknown[]>(options: ({ session?: Session, timeout?: number; }) | undefined, fn: (...args: A) => T, ...args: A) {
    return (options?.session?.webContents.hasSuperJSON ? `
        (async () => {
            if (window['__cdp.superJSON'] === undefined) {
                try {
                    window['__cdp.superJSON'] = window.top['__cdp.superJSON'];
                } catch (error) {
                }
                if (window['__cdp.superJSON'] === undefined) {
                    for (const w of Array.from(window)) {
                        try {
                            if (w['__cdp.superJSON']) {
                                window['__cdp.superJSON'] = w['__cdp.superJSON'];
                                break;
                            }
                        } catch (error) {
                        }
                    }
                }
                if (window['__cdp.superJSON'] === undefined) {
                    await new Promise(resolve => {
                        const h = setInterval(() => {
                            if (window['__cdp.superJSON'] !== undefined) {
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
                if (window['__cdp.superJSON'] === undefined) {
                    console.error('window['__cdp.superJSON'] === undefined');
                    debugger;
                    throw new Error('Critical Error: SuperJSON library is missing. The application cannot proceed without it. : (fn : "` + fn.name + `", executionContextId : ' + window._executionContextId + ')');
                }
            }`
        :
        `
        ${SuperJSONScript}; (${options?.session ? options.session.customizeSuperJSON.toString() : () => { }})(SuperJSON.default); window['__cdp.superJSON'] = SuperJSON.default;
        (async () => {
        `)
        +
        `
            ;;(${applyGlobal.toString()})();;
            const fn = new Function('return ' + ${JSON.stringify(fn.toString())})();
            const args = window['__cdp.superJSON'].parse(${JSON.stringify(options?.session ? options.session.superJSON.stringify(args) : SuperJSON.stringify(args))});
            const result = await fn(...args);
            return window['__cdp.superJSON'].stringify(result);
        })();`
}
