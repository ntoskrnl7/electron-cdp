declare global {
    interface PromiseWithResolvers<T> {
        promise: Promise<T>;
        resolve: (value: T | PromiseLike<T>) => void;
        reject: (reason?: any) => void;
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

export function applyGlobal() {
    if (!('withResolvers' in Promise)) {
        try {
            Object.defineProperty(Promise, 'withResolvers', {
                value: function <T>() {
                    let resolve: (value: T | PromiseLike<T>) => void;
                    let reject: (reason?: any) => void;
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
            });
        } catch (error) {
        }
    };
}