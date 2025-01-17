
import { WebContents } from 'electron';
import { Session as CDPSession, generateScriptString, SuperJSON } from '.';

declare global {
    namespace Electron {
        interface WebContents {
            /**
             * Retrieves the current CDP (Chrome DevTools Protocol) session associated with the web contents.
             *
             * @returns The CDP Session object for the web contents.
             */
            get cdp(): CDPSession;
            /**
             * Indicates whether the SuperJSON library is preloaded and available
             * within the web contents' context.
             *
             * @returns A boolean value. `true` if SuperJSON is preloaded and can be
             * accessed globally within the web contents, `false` otherwise.
             */
            hasSuperJSON: boolean;
        }

        interface WebFrameMain {
            /**
             * A promise that resolves with the result of the executed code or is rejected if
             * execution throws or results in a rejected promise.
             *
             * Evaluates `fn(...args)` in page.
             *
             * In the browser window some HTML APIs like `requestFullScreen` can only be
             * invoked by a gesture from the user. Setting `userGesture` to `true` will remove
             * this limitation.
             */
            evaluate<A extends unknown[], R>(userGesture: boolean, fn: (...args: A) => R, ...args: A): Promise<R>;

            /**
              * A promise that resolves with the result of the executed code or is rejected if
              * execution throws or results in a rejected promise.
              *
              * Evaluates `fn(...args)` in page.
              */
            evaluate<A extends unknown[], R>(fn: (...args: A) => R, ...args: A): Promise<R>;
        }
    }
}

/**
 * Attaches the functionality to the specified browser window (WebContents).
 * Optionally, preloads SuperJSON into all contexts to make it available globally,
 * or defers loading until individual evaluate calls are made.
 *
 * @param target - The WebContents instance to which the functionality will be attached.
 * @param options - Configuration options object.
 * @param options.protocolVersion - The protocol version to use for the CDP session.
 * @param options.preloadSuperJSON - If true, SuperJSON will be loaded into all contexts upfront.
 *                                   If false, SuperJSON will only be loaded during evaluate calls.
 *                                   This can also be a callback function to customize the SuperJSON instance.
 * @returns A promise that resolves with the created CDPSession instance.
 * @throws Will throw an error if a CDP session is already attached to the target.
 */
export async function attach(target: WebContents, options?: { protocolVersion?: string, preloadSuperJSON?: boolean | ((superJSON: SuperJSON) => void) }) {

    if (isAttached(target)) {
        throw new Error('CDP session already attached');
    }

    const session = new CDPSession(target);

    session.attach(options?.protocolVersion);

    const preloadSuperJSON = options?.preloadSuperJSON;
    if (preloadSuperJSON) {
        await session.enableSuperJSON(typeof preloadSuperJSON === 'boolean' ? undefined : preloadSuperJSON);
    }

    Object.defineProperty(target, 'cdp', { get: () => session });

    target.mainFrame.evaluate = async <A0, A extends unknown[], R>(userGestureOrFn: boolean | ((...args: [A0, ...A]) => R), fnOrArg0: A0 | ((...args: [A0, ...A]) => R), ...args: A): Promise<R> => {
        if (typeof userGestureOrFn === 'boolean') {
            return session.superJSON.parse(await (target.mainFrame.executeJavaScript(generateScriptString({ session }, fnOrArg0 as (...args: A) => R, ...args), userGestureOrFn)) as string);
        } else {
            return session.superJSON.parse(await (target.mainFrame.executeJavaScript(generateScriptString({ session }, userGestureOrFn, ...[fnOrArg0 as A0, ...args]))) as string);
        }
    };

    target
        .on('frame-created', async (_, details) => {
            if (details.frame) {
                const frame = details.frame;
                frame.evaluate = async <A0, A extends unknown[], R>(userGestureOrFn: boolean | ((...args: [A0, ...A]) => R), fnOrArg0: A0 | ((...args: [A0, ...A]) => R), ...args: A): Promise<R> => {
                    if (typeof userGestureOrFn === 'boolean') {
                        return session.superJSON.parse(await (target.mainFrame.executeJavaScript(generateScriptString({ session }, fnOrArg0 as (...args: A) => R, ...args), userGestureOrFn)) as string);
                    } else {
                        return session.superJSON.parse(await (target.mainFrame.executeJavaScript(generateScriptString({ session }, userGestureOrFn, ...[fnOrArg0 as A0, ...args]))) as string);
                    }
                };
            }
        });
    return session;
}

export function isAttached(target: WebContents) {
    return target.cdp instanceof CDPSession;
}