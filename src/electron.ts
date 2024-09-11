
import { WebContents } from 'electron';
import { ExposeFunctionOptions, Session as CDPSession } from './session';
import { Protocol } from 'devtools-protocol/types/protocol.d';
import { EvaluateOptions, SuperJSON } from '.';
import { readFileSync } from 'fs';

declare global {
    interface Window {

        SuperJSON: SuperJSON;

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
        interface WebContents {

            /**
             * Retrieves the current CDP (Chrome DevTools Protocol) session associated with the web contents.
             *
             * @returns The CDPSession object for the web contents.
             */
            get cdp(): CDPSession;

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
 * @param target - The WebContents instance to which the functionality will be attached.
 * @param protocolVersion - The protocol version to use.
 */
export async function attach(target: WebContents, protocolVersion?: string) {
    const session = new CDPSession(target);

    session.attach(protocolVersion);

    const script = readFileSync(require.resolve('./window.SuperJSON')).toString();

    await session.send('Runtime.evaluate', {
        expression: `${script}; window.SuperJSON = SuperJSON.default;`,
        returnByValue: true,
        awaitPromise: true,
        silent: true,
        generatePreview: false,
        throwOnSideEffect: false,
        includeCommandLineAPI: false,
    });

    session.on('Runtime.executionContextCreated', event => {
        session.send('Runtime.evaluate', {
            expression: `${script}; window.SuperJSON = SuperJSON.default;`,
            contextId: event.context.id,
            returnByValue: true,
            awaitPromise: true,
            silent: true,
            generatePreview: false,
            throwOnSideEffect: false,
            includeCommandLineAPI: false,
        }).catch(console.error);
    });

    Object.defineProperty(target, 'evaluate', { value: evaluate.bind(target) });
    Object.defineProperty(target, 'exposeFunction', { value: session.exposeFunction.bind(session) });

    Object.defineProperty(target, 'cdp', { get: () => session });

    return session;
}

export function isAttached(target: WebContents) {
    return target.cdp instanceof CDPSession;
}

async function evaluate<T, A extends unknown[]>(this: WebContents, fnOrOptions: ((...args: A) => T) | EvaluateOptions, fnOrArg0?: unknown | ((...args: A) => T), ...args: A): Promise<T> {
    let options: EvaluateOptions | undefined;
    let fn: (...args: A) => T;
    let actualArgs: A;

    if (typeof fnOrOptions === 'function') {
        fn = fnOrOptions as (...args: A) => T;
        actualArgs = fnOrArg0 === undefined ? args : [fnOrArg0, ...args] as A;
    } else {
        options = fnOrOptions as EvaluateOptions;
        fn = fnOrArg0 as (...args: A) => T;
        actualArgs = args;
    }

    const result = await this.executeJavaScript(`
        (async () => {
            const fn = new Function('return ' + ${JSON.stringify(fn.toString())})();
            const args = SuperJSON.parse(${JSON.stringify(SuperJSON.stringify(actualArgs))});
            const result = await fn(...args);
            return SuperJSON.stringify(result);
        })();`,
        options?.userGesture);
    return result === undefined ? undefined : SuperJSON.parse<any>(result);
}
