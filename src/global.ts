declare global {
    interface PromiseWithResolvers<T> {
        promise: Promise<T>;
        resolve: (value: T | PromiseLike<T>) => void;
        reject: (reason?: unknown) => void;
    }

    interface PromiseConstructor {
        /**
         * Creates a new Promise and returns it in an object, along with its resolve and reject functions.
         * @returns An object with the properties `promise`, `resolve`, and `reject`.
         *
         * ```ts
         * const { promise, resolve, reject } = Promise.withResolvers<T>();
         * ```
         */
        withResolvers<T>(): PromiseWithResolvers<T>;
    }
}

export function applyPolyfill() {
    if (!Promise.withResolvers) {
        const value = <T>() => {
            let resolve: ReturnType<typeof Promise.withResolvers<T>>['resolve'];
            let reject: ReturnType<typeof Promise.withResolvers<T>>['reject'];
            const promise = new Promise<T>((res, rej) => {
                resolve = res;
                reject = rej;
            });
            return {
                promise,
                resolve: resolve!,
                reject: reject!,
            };
        }
        try {
            Object.defineProperty(Promise, 'withResolvers', { value, configurable: true });
        } catch {
            Promise.withResolvers = value;
        }
    };
}