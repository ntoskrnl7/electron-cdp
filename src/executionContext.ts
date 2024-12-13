import { Protocol } from 'devtools-protocol/types/protocol.d';
import { EvaluateOptions, Session } from ".";
import { readFileSync } from 'fs';
import { applyGlobal } from './global';

const SuperJSONScript = readFileSync(require.resolve('./window.SuperJSON')).toString();

function convertExceptionDetailsToError(exceptionDetails: Protocol.Runtime.ExceptionDetails) {
    const error: { [key: string]: unknown } = {};
    if (exceptionDetails.exception) {
        if (exceptionDetails.exception.preview) {
            exceptionDetails.exception.preview.properties.forEach(prop => {
                switch (prop.type) {
                    case 'number':
                        error[prop.name] = Number(prop.value);
                        break;
                    case 'string':
                        error[prop.name] = prop.value;
                        break;
                }
            });
            if (exceptionDetails.exception.preview.description) {
                error['description'] = exceptionDetails.exception.preview.description;
            }
        } else {
            if (exceptionDetails.exception.className) {
                error['className'] = exceptionDetails.exception.className;
            }
            if (exceptionDetails.exception.description) {
                error['description'] = exceptionDetails.exception.description;
            }
        }
    } else {
        error['text'] = exceptionDetails.text;
    }
    return error;
}

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
        if (idOrDescription === undefined) {
            return;
        }
        if (typeof idOrDescription === 'number') {
            this.id = idOrDescription;
        } else if ('id' in idOrDescription) {
            this.id = idOrDescription.id;
            this.description = idOrDescription;
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

    async evaluate<R, F extends (...args: ARGS) => R, ARG_0, ARGS_OTHER extends unknown[], ARGS extends [ARG_0, ...ARGS_OTHER]>(
        fnOrOptions: F | EvaluateOptions,
        fnOrArg0?: ARG_0 | F,
        ...args: ARGS_OTHER | ARGS
    ): Promise<R> {
        if (typeof fnOrOptions === 'function') {
            return this.#evaluate(undefined, fnOrOptions, ...[fnOrArg0, ...args] as ARGS);
        } else if (typeof fnOrOptions !== 'function' && typeof fnOrArg0 === 'function') {
            return this.#evaluate(fnOrOptions, fnOrArg0 as F, ...args as ARGS);
        }
        throw new Error('invalid parameter');
    }

    async #evaluate<T, A extends unknown[]>(options: EvaluateOptions | undefined, fn: (...args: A) => T, ...args: A): Promise<T> {
        const expression = (this.session.webContents.hasSuperJSON ? `
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
                        throw new Error('Critical Error: SuperJSON library is missing. The application cannot proceed without it. : (fn : "` + fn.name + `", executionContextId : ' + window._executionContextId ?? ${this.id} + ')');
                    }
                }`
            :
            `
            ${SuperJSONScript}; (${this.session.customizeSuperJSON.toString()})(SuperJSON.default); window.SuperJSON = SuperJSON.default;
            (async () => {
            `)
            +
            `
                ;;(${applyGlobal.toString()})();;
                const fn = new Function('return ' + ${JSON.stringify(fn.toString())})();
                const args = SuperJSON.parse(${JSON.stringify(this.session.superJSON.stringify(args))});
                const result = await fn(...args);
                return SuperJSON.stringify(result);
            })();
            `;
        const res = await this.session.send('Runtime.evaluate', {
            expression,
            contextId: this.id,
            throwOnSideEffect: false,
            awaitPromise: true,
            replMode: false,
            returnByValue: false,
            generatePreview: false,
            ...options
        });

        if (res.exceptionDetails) {
            throw convertExceptionDetailsToError(res.exceptionDetails);
        }

        return res.result?.value === undefined ? undefined : this.session.superJSON.parse<any>(res.result.value);
    }
}