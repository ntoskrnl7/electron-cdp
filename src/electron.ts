
import { BrowserWindow, WebContents } from 'electron';
import { Session as CDPSession, ExposeFunctionOptions, Session } from './session';
import { Protocol } from 'devtools-protocol/types/protocol.d';
import { EvaluateOptions } from '.';

declare global {
    interface Window {
        /**
         * Callback invocation sequence.
         */
        _callSeq?: bigint;

        /**
         * Execution context identifier.
         *
         * (Main frame is undefined.)
         */
        _executionContextId?: Protocol.Runtime.ExecutionContextId;

        /**
         * Method used internally by the exposeFunction method.
         */
        _callback(payload: string): void;

        /**
         * Property used internally by the exposeFunction method.
         */
        _returnValues?: { [key: string]: Awaited<unknown> };

        /**
         * Property used internally by the exposeFunction method.
         */
        _returnErrors?: { [key: string]: Awaited<unknown> };
    }

    // eslint-disable-next-line @typescript-eslint/no-namespace
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
            exposeFunction<T, A extends unknown[]>(name: string, fn: (...args: A) => T, options?: ExposeFunctionOptions): Promise<void>;
        }
    }
}

/**
 * Attaches the current functionality to the specified browser window.
 *
 * @param target - The BrowserWindow instance to which the functionality will be attached.
 * @param protocolVersion - The protocol version to use.
 */
export function attach(target: BrowserWindow, protocolVersion?: string) {
    const session = new Session(target.webContents);
    session.attach(protocolVersion);
    Object.defineProperty(target, 'session', { get: () => session });

    const webContents = target.webContents;
    Object.defineProperty(webContents, 'evaluate', { value: evaluate.bind(webContents) });
    Object.defineProperty(webContents, 'exposeFunction', { value: session.exposeFunction.bind(session) });
}

async function evaluate<T, A extends unknown[]>(this: WebContents, fnOrOptions: ((...args: A) => T) | EvaluateOptions, fnOrArg0?: unknown | ((...args: A) => T), ...args: A): Promise<T> {
    let options: EvaluateOptions | undefined;
    let fn: (...args: A) => T;
    let actualArgs: A;

    if (typeof fnOrOptions === 'function') {
        fn = fnOrOptions as (...args: A) => T;
        actualArgs = [fnOrArg0, ...args] as A;
    } else {
        options = fnOrOptions as EvaluateOptions;
        fn = fnOrArg0 as (...args: A) => T;
        actualArgs = args;
    }

    const argsString = actualArgs.map(arg => {
        switch (typeof arg) {
            case 'string':
                return `\`${arg.replace(/`/g, '\\`')}\``;
            case 'object': {
                if (arg === null) {
                    return 'null';
                }
                const toObject = (obj: object, depth?: number): object | null => {
                    if (depth === undefined) {
                        depth = 1;
                    }
                    const toObjectI = (obj: object, current: number) => {
                        if (current > depth) {
                            try {
                                return JSON.parse(JSON.stringify(obj));
                            } catch (error) {
                                return null;
                            }
                        }
                        const ret: { [key: string]: object | null } = {};
                        for (const key in Object.getPrototypeOf(obj)) {
                            const value = (obj as { [key: string]: object })[key];
                            switch (typeof value) {
                                case 'function':
                                    break;
                                case 'object':
                                    if (value) {
                                        ret[key] = toObjectI(value, current + 1);
                                    }
                                    break;
                                default:
                                    ret[key] = value;
                                    break;
                            }
                        }
                        for (const key in obj) {
                            const value = (obj as { [key: string]: object })[key];
                            switch (typeof value) {
                                case 'function':
                                    break;
                                case 'object':
                                    if (value) {
                                        ret[key] = toObjectI(value, current + 1);
                                    }
                                    break;
                                default:
                                    ret[key] = value;
                                    break;
                            }
                        }
                        if (Object.entries(ret).length === 0 && ret.constructor === Object) {
                            return obj.toString();
                        }
                        return ret;
                    };
                    return toObjectI(obj, 1);
                };
                return JSON.stringify(toObject(arg));
            }
            case 'number':
            case 'bigint':
            case 'boolean':
                return arg.toString();
            case 'undefined':
                return 'undefined';
            case 'function':
                if (!arg.toString().endsWith('{ [native code] }')) {
                    return `new Function('return ' + ${JSON.stringify(arg.toString())})()`;
                }
            // eslint-disable-next-line no-fallthrough
            default:
                throw new Error(`Unsupported argument type: ${typeof arg}`);
        }
    }).join(', ');

    const result = await this.executeJavaScript(`
        (async () => {
            const fn = new Function('return ' + ${JSON.stringify(fn.toString())})();
            const result = await fn(${argsString});
            return JSON.stringify(result);
        })();`,
        options?.userGesture);
    return result === undefined ? undefined : JSON.parse(result);
}
