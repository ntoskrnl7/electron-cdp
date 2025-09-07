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
        if (!Reflect.defineProperty(Promise, 'withResolvers', { value, writable: true, enumerable: false, configurable: true })) {
            Promise.withResolvers = value;
        }
    };
}