import { Protocol } from 'devtools-protocol/types/protocol.d';
import { EvaluateOptions, Session, SuperJSON } from ".";
import { readFileSync } from 'fs';

const SuperJSONScript = readFileSync(require.resolve('./window.SuperJSON')).toString();

/**
 * Represents an execution context in the browser.
 */
export class ExecutionContext {
    readonly session: Session;
    readonly id?: Protocol.Runtime.ExecutionContextId;
    readonly description?: Protocol.Runtime.ExecutionContextDescription;

    /**
     * Creates an instance of ExecutionContext.
     *
     * @param session - The CDP session associated with this execution context.
     */
    constructor(session: Session);

    /**
     * Creates an instance of ExecutionContext with a specific ID.
     *
     * @param session - The CDP session associated with this execution context.
     * @param id - The ID of the execution context.
     */
    constructor(session: Session, id: Protocol.Runtime.ExecutionContextId);

    /**
     * Creates an instance of ExecutionContext with a specific description.
     *
     * @param session - The CDP session associated with this execution context.
     * @param description - The description of the execution context.
     */
    constructor(session: Session, description: Protocol.Runtime.ExecutionContextDescription);

    constructor(session: Session, idOrDescription?: Protocol.Runtime.ExecutionContextId | Protocol.Runtime.ExecutionContextDescription) {
        this.session = session;
        if (idOrDescription) {
            if (typeof idOrDescription === 'number') {
                this.id = idOrDescription;
            } else if ('id' in idOrDescription) {
                this.id = idOrDescription.id;
                this.description = idOrDescription;
            }
        }
    }


    /**
     * Evaluates the provided function with the given arguments in the context of the current execution context.
     *
     * @param fn - The function to be evaluated.
     * @param args - The arguments to pass to the function.
     * @returns A promise that resolves with the result of the function.
     * @throws If an argument type is not supported.
     */
    async evaluate<T, A extends unknown[]>(fn: (...args: A) => T, ...args: A): Promise<T>;

    /**
     * Evaluates the provided function with additional options and the given arguments in the context of the current execution context.
     *
     * @param options - Additional options to customize the evaluation.
     * @param fn - The function to be evaluated.
     * @param args - The arguments to pass to the function.
     * @returns A promise that resolves with the result of the function.
     * @throws If an argument type is not supported.
     */
    async evaluate<T, A extends unknown[]>(options: EvaluateOptions, fn: (...args: A) => T, ...args: A): Promise<T>;

    async evaluate<T, A extends unknown[]>(fnOrOptions: ((...args: A) => T) | EvaluateOptions, fnOrArg0?: unknown | ((...args: A) => T), ...args: A): Promise<T> {
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

        return this.#evaluate(options, fn, ...actualArgs);
    }

    async #evaluate<T, A extends unknown[]>(options: EvaluateOptions | undefined, fn: (...args: A) => T, ...args: A): Promise<T> {
        const expression = (this.session.webContents.cdp ? `
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
                            }, ${options?.timeout ? options.timeout : 5000});
                        });
                    }
                    if (window.SuperJSON === undefined) {
                        console.error('window.SuperJSON === undefined');
                        throw new Error('Critical Error: SuperJSON library is missing. The application cannot proceed without it.');
                        debugger;
                    }
                }`
            :
            `
            ${SuperJSONScript}; window.SuperJSON = SuperJSON.default;
            (async () => {
            `)
            +
            `
                const fn = new Function('return ' + ${JSON.stringify(fn.toString())})();
                const args = SuperJSON.parse(${JSON.stringify(SuperJSON.stringify(args))});
                const result = await fn(...args);
                return SuperJSON.stringify(result);
            })();
            `;

        const res = await this.session.send('Runtime.evaluate', {
            expression,
            contextId: this.id,
            returnByValue: true,
            awaitPromise: true,
            silent: true,
            generatePreview: false,
            throwOnSideEffect: false,
            includeCommandLineAPI: false,
            userGesture: options?.userGesture,
            timeout: options?.timeout,
        });

        if (res.exceptionDetails) {
            const error: { [key: string]: unknown } = {};
            if (res.exceptionDetails.exception) {
                if (res.exceptionDetails.exception.preview) {
                    res.exceptionDetails.exception.preview.properties.forEach(prop => {
                        switch (prop.type) {
                            case 'number':
                                error[prop.name] = Number(prop.value);
                                break;
                            case 'string':
                                error[prop.name] = prop.value;
                                break;
                        }
                    });
                    if (res.exceptionDetails.exception.preview.description) {
                        error['description'] = res.exceptionDetails.exception.preview.description;
                    }
                } else {
                    if (res.exceptionDetails.exception.className) {
                        error['className'] = res.exceptionDetails.exception.className;
                    }
                    if (res.exceptionDetails.exception.description) {
                        error['description'] = res.exceptionDetails.exception.description;
                    }
                }
            } else {
                error['text'] = res.exceptionDetails.text;
            }
            throw error;
        }

        return res.result?.value === undefined ? undefined : SuperJSON.parse<any>(res.result.value);
    }
}