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

export class Expression<R> {

    readonly builder: ExpressionBuilder;

    constructor(builder: ExpressionBuilder) {
        this.builder = builder;
    }

    async execute(context: ExecutionContext): Promise<R> {
        const session = context.session;
        const contextId = context.id;
        const options = this.builder.options;

        let expression = (session.webContents.hasSuperJSON ? `
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
                        throw new Error('Critical Error: SuperJSON library is missing. The application cannot proceed without it. : (executionContextId : ' + window._executionContextId ?? ${contextId} + ')');
                    }
                }`
            :
            `
            ;;(${applyGlobal.toString()})();;
            ${SuperJSONScript}; (${session.customizeSuperJSON.toString()})(SuperJSON.default); window.SuperJSON = SuperJSON.default;
            (async () => {
            `)
            +
            `
                const fn = new Function(...
                const args = SuperJSON.pars....
                const result = await fn(...args);
                return SuperJSON.stringify(result);
            })();
            `;

        for (const { fn, args } of this.builder.result) {
            expression += `
            ;;(async () => {
                const fn = new Function('return ' + ${JSON.stringify(fn.toString())})();
                const args = SuperJSON.parse(${JSON.stringify(session.superJSON.stringify(args))});
                const result = await fn(...args);
                return SuperJSON.stringify(result);
            })()`
        }

        const res = await session.send('Runtime.evaluate', {
            expression,
            contextId,
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

        return res.result?.value === undefined ? undefined : session.superJSON.parse<any>(res.result.value);
    }

    static all<T extends readonly unknown[] | []>(values: T): Promise<{ -readonly [P in keyof T]: Awaited<T[P]>; }> {
        throw new Error();
    }
    static race<T extends readonly unknown[] | []>(values: T): Promise<Awaited<T[number]>> {
        throw new Error();
    }
}

export class ExpressionBuilder {

    #options?: EvaluateOptions;
    get options() {
        return this.#options;
    }

    readonly result: Array<{ fn: Function; args: unknown[]; }> = [];

    static append<T, A extends unknown[]>(fn: (...args: A) => T, ...args: A): ExpressionBuilder {
        const ret = new ExpressionBuilder();
        ret.result.push({ fn, args: args });
        return ret;
    }

    append<T, A extends unknown[]>(fn: (...args: A) => T, ...args: A): this {
        this.result.push({ fn, args: args });
        return this;
    }

    build<T, A extends unknown[]>(fn: (...args: A) => T, ...args: A): Expression<T>;
    build<T, A extends unknown[]>(options: EvaluateOptions, fn: (...args: A) => T, ...args: A): Expression<T>;
    build<R, F extends (...args: ARGS) => R, ARG_0, ARGS_OTHER extends unknown[], ARGS extends [ARG_0, ...ARGS_OTHER]>(
        fnOrOptions: F | EvaluateOptions,
        fnOrArg0?: ARG_0 | F,
        ...args: ARGS_OTHER | ARGS
    ): Expression<R> {
        if (typeof fnOrOptions === 'function') {
            this.result.push({ fn: fnOrOptions, args: [fnOrArg0, ...args] });
        } else if (typeof fnOrOptions !== 'function' && typeof fnOrArg0 === 'function') {
            this.#options = fnOrOptions;
            this.result.push({ fn: fnOrArg0, args: args });
        }
        return new Expression(this);
    }
}


async function evaluate<T, A extends unknown[]>(context: ExecutionContext, options: EvaluateOptions | undefined, fn: (...args: A) => T, ...args: A): Promise<T> {
    const session = context.session;
    const contextId = context.id;
    const expression = (session.webContents.hasSuperJSON ? `
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
                    throw new Error('Critical Error: SuperJSON library is missing. The application cannot proceed without it. : (fn : "` + fn.name + `", executionContextId : ' + window._executionContextId ?? ${contextId} + ')');
                }
            }`
        :
        `
        ;;(${applyGlobal.toString()})();;
        ${SuperJSONScript}; (${session.customizeSuperJSON.toString()})(SuperJSON.default); window.SuperJSON = SuperJSON.default;
        (async () => {
        `)
        +
        `
            const fn = new Function('return ' + ${JSON.stringify(fn.toString())})();
            const args = SuperJSON.parse(${JSON.stringify(session.superJSON.stringify(args))});
            const result = await fn(...args);
            return SuperJSON.stringify(result);
        })();
        `;
    const res = await session.send('Runtime.evaluate', {
        expression,
        contextId,
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

    return res.result?.value === undefined ? undefined : session.superJSON.parse<any>(res.result.value);
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


    evaluateAll<T extends readonly unknown[] | []>(values: T): Promise<{ -readonly [P in keyof T]: Awaited<T[P]>; }> {
        throw new Error();
    }
    evaluateRace<T extends readonly unknown[] | []>(values: T): Promise<Awaited<T[number]>> {
        throw new Error();
    }

    async evaluate<R>(expression: Expression<R>): Promise<R>;

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
        fnOrOptions: F | EvaluateOptions | Expression<R>,
        fnOrArg0?: ARG_0 | F,
        ...args: ARGS_OTHER | ARGS
    ): Promise<R> {
        if (fnOrOptions instanceof Expression) {
            return fnOrOptions.execute(this);
        }
        if (typeof fnOrOptions === 'function') {
            return this.evaluate(new ExpressionBuilder().build(fnOrOptions, ...[fnOrArg0, ...args] as ARGS));
        } else if (typeof fnOrOptions !== 'function' && typeof fnOrArg0 === 'function') {
            return this.evaluate(new ExpressionBuilder().build(fnOrOptions, fnOrArg0 as F, ...args as ARGS));
        }
        throw new Error('invalid parameter');
    }
}




function phase1() {
    console.log(1);
}
function phase2() {
    console.log(2);
}

const a = ExpressionBuilder.append(() => { console.log(1); return 1 }).append((a) => { console.log(a); return a; }, 2).build((a, b) => { return true; }, 1, 2)
const b = ExpressionBuilder.append(phase1).append(phase2).build((a) => a, 100);

import { webContents } from 'electron';
const ctx = new ExecutionContext((new Session(webContents.fromId(0)!)));
ctx.evaluate(a);
ctx.evaluateAll([a, b]);
ctx.evaluateRace([a, b]);





