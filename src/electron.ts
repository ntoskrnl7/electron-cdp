
import { BrowserWindow, WebContents } from 'electron';
import { Session as CDPSession, ExposeFunctionOptions, Session } from './session';
import Protocol from 'devtools-protocol';
import { ExecutionContext } from './executionContext';

declare global {
    interface Window {
        _callSeq?: bigint;
        _executionContextId?: Protocol.Runtime.ExecutionContextId;
        _callback(payload: string): void;
        _retrunValues?: { [key: string]: Awaited<any> };
        [key: string]: Function;
    }

    namespace Electron {
        interface BrowserWindow {
            /**
             * Retrieves the current CDP (Chrome DevTools Protocol) session associated with the browser window.
             *
             * @returns The CDPSession object for the browser window.
             */
            get session(): CDPSession;
        }

        interface WebContents {
            /**
             * Evaluates the provided function with the given arguments in the context of the current page.
             *
             * @param fn - The function to be evaluated.
             * @param args - The arguments to pass to the function.
             * @returns A promise that resolves with the result of the function.
             */
            evaluate<T, A extends any[]>(fn: (...args: A) => T, ...args: A): Promise<T>;

            /**
             * Exposes a function to the browser's global context under the specified name.
             *
             * @param name - The name under which the function will be exposed.
             * @param fn - The function to expose.
             * @param options - Optional settings for exposing the function.
             * @returns A promise that resolves when the function is successfully exposed.
             */
            exposeFunction<T, A extends any[]>(name: string, fn: (...args: A) => T, options?: ExposeFunctionOptions): Promise<void>;
        }
    }
}

/**
 * Attaches the current functionality to the specified browser window.
 *
 * @param target - The BrowserWindow instance to which the functionality will be attached.
 */
export function attach(target: BrowserWindow) {
    const session = new Session(target.webContents);
    session.attach('1.3');
    Object.defineProperty(target, 'session', { get: () => session });

    const webContents = target.webContents;
    Object.defineProperty(webContents, 'evaluate', { value: evaluate.bind(webContents) });
    Object.defineProperty(webContents, 'exposeFunction', { value: session.exposeFunction.bind(session) });
}

async function evaluate<T, A extends any[]>(this: WebContents, fn: (...args: A) => T, ...args: A): Promise<T> {
    const argsString = args.map(arg => {
        switch (typeof arg) {
            case 'string':
                return `\`${arg.replace(/`/g, '\\`')}\``;
            case 'object':
                return JSON.stringify(arg);
            case 'number':
            case 'bigint':
            case 'boolean':
                return arg.toString();
            case 'undefined':
                return 'undefined';
            default:
                throw new Error(`Unsupported argument type: ${typeof arg}`);
        }
    }).join(', ');

    const result = await this.executeJavaScript(`
        (async () => {
            try {
                const fn = new Function('return ' + ${JSON.stringify(fn.toString())})();
                const result = await fn(${argsString});
                return JSON.stringify(result);
            } catch (error) {
                console.log(error);
                return JSON.stringify(error);
            }
        })();`);
    return result === undefined ? undefined : JSON.parse(result);
}
