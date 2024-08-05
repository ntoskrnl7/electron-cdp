import { Protocol } from "devtools-protocol";
import { Session } from "./session";

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
    async evaluate<T, A extends any[]>(fn: (...args: A) => T, ...args: A): Promise<T> {
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
        })).result;
        return res.value === undefined ? undefined : JSON.parse(res.value);
    }
}