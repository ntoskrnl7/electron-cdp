import { Protocol } from 'devtools-protocol/types/protocol.d';
import { Session } from "./session";
import { EvaluateOptions } from ".";


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
            actualArgs = [fnOrArg0, ...args] as A;
        } else {
            options = fnOrOptions as EvaluateOptions;
            fn = fnOrArg0 as (...args: A) => T;
            actualArgs = args;
        }

        return this.#evaluate(options, fn, ...actualArgs);
    }

    async #evaluate<T, A extends unknown[]>(options: EvaluateOptions | undefined, fn: (...args: A) => T, ...args: A): Promise<T> {
        const argsString = args.map(arg => {
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

        const expression = `(async () => {
            const fn = new Function('return ' + ${JSON.stringify(fn.toString())})();
            const result = await fn(${argsString});
            return JSON.stringify(result);
        })();`;

        const res = (await this.session.send('Runtime.evaluate', {
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
        }));

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

        return res.result.value === undefined ? undefined : JSON.parse(res.result.value);
    }
}