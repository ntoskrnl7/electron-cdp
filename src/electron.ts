
import { WebContents } from 'electron';
import { Session as CDPSession, SuperJSON } from '.';

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

    return session;
}

export function isAttached(target: WebContents) {
    return target.cdp instanceof CDPSession;
}