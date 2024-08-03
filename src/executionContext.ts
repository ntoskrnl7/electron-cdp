import { Protocol } from "devtools-protocol";
import { Session } from "./session";

export class ExecutionContext {
    readonly session;

    readonly description: Protocol.Runtime.ExecutionContextDescription;

    constructor(session: Session, description: Protocol.Runtime.ExecutionContextDescription) {
        this.session = session;
        this.description = description;
    }

    async evaluate<T, A extends any[]>(fn: (...args: A) => T, ...args: A): Promise<T> {
        const functionString = JSON.stringify(fn.toString());
        const argsString = args.map(arg => {
            if (typeof arg === 'string') {
                return `"${arg}"`;
            } else if (typeof arg === 'number' || typeof arg === 'boolean') {
                return arg.toString();
            } else if (typeof arg === 'object') {
                return JSON.stringify(arg);
            } else {
                throw new Error(`Unsupported argument type: ${typeof arg}`);
            }
        }).join(', ');

        const expression = `(async () => {
            const fn = new Function('return ' + ${functionString})();
            const result = await fn(${argsString});
            return JSON.stringify(result);
        })();`;

        const res = (await this.session.send('Runtime.evaluate', {
            expression,
            uniqueContextId: this.description.uniqueId,
        })).result;
        return res.value === undefined ? undefined : JSON.parse(res.value);
    }
}