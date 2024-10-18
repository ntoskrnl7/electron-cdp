
import { WebContents } from 'electron';
import { Session as CDPSession } from '.';

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
 * Attaches the current functionality to the specified browser window.
 * Optionally, preloads SuperJSON into all contexts to make it available
 * globally, or defers loading to individual evaluate calls.
 *
 * @param target - The WebContents instance to which the functionality will be attached.
 * @param options - Configuration options.
 * @param options.protocolVersion - The protocol version to use.
 * @param options.preloadSuperJSON - If true, SuperJSON will be loaded into all contexts upfront.
 *                                   If false, SuperJSON will be loaded only during evaluate calls.
 * @returns A promise that resolves with the created CDPSession.
 * @throws An error if a CDP session is already attached to the target.
 */
export async function attach(target: WebContents, options?: { protocolVersion?: string, preloadSuperJSON?: boolean }) {

    if (isAttached(target)) {
        throw new Error('cdp session already attached');
    }

    const session = new CDPSession(target);

    session.attach(options?.protocolVersion);

    if (options?.preloadSuperJSON) {
        session.enableSuperJSON();
    }

    Object.defineProperty(target, 'cdp', { get: () => session });

    return session;
}

export function isAttached(target: WebContents) {
    return target.cdp instanceof CDPSession;
}