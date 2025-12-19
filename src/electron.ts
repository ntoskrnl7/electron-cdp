

import type Protocol from 'devtools-protocol';

import { WebContents, webFrameMain, WebFrameMain } from 'electron';
import { Session as CDPSession, SessionOptions } from './session';
import { generateScriptString } from './utils';
import SuperJSON from 'superjson';

declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Electron {
        interface WebContents {
            /**
             * Retrieves the current CDP (Chrome DevTools Protocol) session associated with the web contents.
             *
             * @returns The CDP Session object for the web contents. If no session is attached, it returns `undefined`.
             */
            get cdp(): CDPSession | undefined;
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

export class MainSession extends CDPSession {
    constructor(webContents: WebContents, sessionId?: Protocol.Target.SessionID, protocolVersion?: string | undefined) {
        super(webContents, sessionId, protocolVersion);
    }

    /**
     * Sets up the session.
     * 
     * @param options - Configuration options object.
     * @param options.preloadSuperJSON - If true, SuperJSON will be loaded into all contexts upfront.
     *                                   If false, SuperJSON will only be loaded during evaluate calls.
     *                                   This can also be a callback function to customize the SuperJSON instance.  
     * @param options.trackExecutionContexts - Whether to track Runtime execution context and maintain a map of them in the `executionContexts` property.
     * @param options.autoAttachToRelatedTargets - Whether to automatically attach to related targets.
     * @returns A promise that resolves when the session is setup.
     */
    async setup(options?: { preloadSuperJSON?: boolean | ((superJSON: SuperJSON) => void) } & SessionOptions) {

        const promises = [];
        promises.push(this.applyOptions(options));

        const preloadSuperJSON = options?.preloadSuperJSON;
        if (preloadSuperJSON) {
            promises.push(this.enableSuperJSONPreload(typeof preloadSuperJSON === 'boolean' ? undefined : preloadSuperJSON));
        }

        const initializeFrame = async (session: CDPSession, frame: WebFrameMain | undefined | null) => {
            if (frame && !frame.isDestroyed()) {
                frame.evaluate = async function <A0, A extends unknown[], R>(this: WebFrameMain, userGestureOrFn: boolean | ((...args: [A0, ...A]) => R), fnOrArg0: A0 | ((...args: [A0, ...A]) => R), ...args: A): Promise<R> {
                    try {
                        if (typeof userGestureOrFn === 'boolean') {
                            return session.superJSON.parse(await (this.executeJavaScript(generateScriptString({ session }, fnOrArg0 as (...args: A) => R, ...args), userGestureOrFn)) as string);
                        } else {
                            return session.superJSON.parse(await (this.executeJavaScript(generateScriptString({ session }, userGestureOrFn, fnOrArg0 as A0, ...args))) as string);
                        }
                    } catch (error) {
                        if (typeof error === 'string') {
                            let result;
                            try {
                                result = session.superJSON.parse(error);
                            } catch {
                            }
                            if (result) {
                                throw result;
                            }
                        }
                        throw error;
                    }
                }
                await frame.executeJavaScript(`
                    globalThis.$cdp ??= { consoleDebug: console.debug };
                    if (globalThis.$cdp.frameIdResolve) {
                        globalThis.$cdp.frameIdResolve('${frame.processId}-${frame.routingId}');
                        delete globalThis.$cdp.frameIdResolve;
                    } else {
                        globalThis.$cdp.frameId = Promise.resolve('${frame.processId}-${frame.routingId}');
                    }`);
            }
        };

        const webContents = this.webContents;
        initializeFrame(this, webContents.mainFrame);

        if (webContents.getMaxListeners() <= webContents.listenerCount('frame-created')) {
            webContents.setMaxListeners(webContents.listenerCount('frame-created') + 1);
        }
        if (webContents.getMaxListeners() <= webContents.listenerCount('will-frame-navigate')) {
            webContents.setMaxListeners(webContents.listenerCount('will-frame-navigate') + 1);
        }
        if (webContents.getMaxListeners() <= webContents.listenerCount('did-frame-navigate')) {
            webContents.setMaxListeners(webContents.listenerCount('did-frame-navigate') + 1);
        }
        webContents
            .on('frame-created', async (_, details) => initializeFrame(this, details.frame))
            .on('will-frame-navigate', details => initializeFrame(this, details.frame))
            .on('did-frame-navigate', (event, url, httpResponseCode, httpStatusText, isMainFrame, frameProcessId, frameRoutingId) =>
                initializeFrame(this, webFrameMain.fromId(frameProcessId, frameRoutingId)));

        promises.push(this.send('Page.addScriptToEvaluateOnNewDocument', {
            runImmediately: true,
            source: `
            globalThis.$cdp ??= { consoleDebug: console.debug };
            if (globalThis.$cdp.frameId === undefined) {
                const { promise, resolve } = Promise.withResolvers();
                globalThis.$cdp.frameId = promise;
                globalThis.$cdp.frameIdResolve = resolve;
            }`
        }));

        await Promise.all(promises);
    }
}

/**
 * Attaches the functionality to the specified browser window (WebContents).
 * Optionally, preloads SuperJSON into all contexts to make it available globally,
 * or defers loading until individual evaluate calls are made.
 *
 * @param target - The WebContents instance to which the functionality will be attached.
 * @param protocolVersion - The protocol version to use for the CDP session.
 *
 * @returns The created MainSession instance.
 */
export function attach(target: WebContents, protocolVersion?: string) {
    if (isAttached(target)) {
        throw new Error('CDP session already attached');
    }
    const session = new MainSession(target, undefined, protocolVersion);
    Object.defineProperty(session.webContents, 'cdp', { get: () => session });
    return session;
}

/**
 * Checks if a CDP session is attached to the target.
 *
 * @param target - The WebContents instance to check if a CDP session is attached.
 * @returns Whether a CDP session is attached to the target.
 */
export function isAttached(target: WebContents) {
    return target.cdp instanceof CDPSession;
}