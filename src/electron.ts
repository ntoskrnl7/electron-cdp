
import { WebContents, webFrameMain, WebFrameMain } from 'electron';
import { Session as CDPSession, generateScriptString, Session, SessionOptions, SuperJSON } from '.';

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
 * @param options.trackExecutionContexts - Whether to track Runtime execution context and maintain a map of them in the `executionContexts` property.
 * @param options.autoAttachToRelatedTargets - Whether to automatically attach to related targets.
 * @returns A promise that resolves with the created CDPSession instance.
 * @throws Will throw an error if a CDP session is already attached to the target.
 */
export async function attach(target: WebContents, options?: { protocolVersion?: string, preloadSuperJSON?: boolean | ((superJSON: SuperJSON) => void) } & SessionOptions) {

    if (isAttached(target)) {
        throw new Error('CDP session already attached');
    }

    const session = new CDPSession(target, undefined, options?.protocolVersion);

    const promises = [];
    promises.push(session.applyOptions(options));

    const preloadSuperJSON = options?.preloadSuperJSON;
    if (preloadSuperJSON) {
        promises.push(session.enableSuperJSONPreload(typeof preloadSuperJSON === 'boolean' ? undefined : preloadSuperJSON));
    }

    promises.push(defineWebFrameMainProperties(session));

    await Promise.all(promises);

    Object.defineProperty(target, 'cdp', { get: () => session });

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

/**
 * Defines the properties of the WebFrameMain instance.
 *
 * @param session - The session instance to define the properties of the WebFrameMain instance.
 */
async function defineWebFrameMainProperties(session: Session) {
    const initializeFrame = async (session: Session, frame: WebFrameMain | undefined | null) => {
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
                globalThis.$cdp ??= {};
                if (globalThis.$cdp.frameIdResolve) {
                    globalThis.$cdp.frameIdResolve('${frame.processId}-${frame.routingId}');
                    delete globalThis.$cdp.frameIdResolve;
                } else {
                    globalThis.$cdp.frameId = Promise.resolve('${frame.processId}-${frame.routingId}');
                }`);
        }
    };

    const webContents = session.webContents;
    initializeFrame(session, webContents.mainFrame);

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
        .on('frame-created', async (_, details) => initializeFrame(session, details.frame))
        .on('will-frame-navigate', details => initializeFrame(session, details.frame))
        .on('did-frame-navigate', (event, url, httpResponseCode, httpStatusText, isMainFrame, frameProcessId, frameRoutingId) =>
            initializeFrame(session, webFrameMain.fromId(frameProcessId, frameRoutingId)));

    await session.send('Page.addScriptToEvaluateOnNewDocument', {
        runImmediately: true,
        source: `
        globalThis.$cdp ??= {};
        if (globalThis.$cdp.frameId === undefined) {
            const { promise, resolve } = Promise.withResolvers();
            globalThis.$cdp.frameId = promise;
            globalThis.$cdp.frameIdResolve = resolve;
        }`
    });
}