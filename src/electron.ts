
import { WebContents } from 'electron';
import { Session as CDPSession } from '.';
import { readFileSync } from 'fs';

const SuperJSONScript = readFileSync(require.resolve('./window.SuperJSON')).toString();

declare global {
    namespace Electron {
        interface WebContents {

            /**
             * Retrieves the current CDP (Chrome DevTools Protocol) session associated with the web contents.
             *
             * @returns The CDP Session object for the web contents.
             */
            get cdp(): CDPSession;
        }
    }
}


/**
 * Attaches the current functionality to the specified browser window.
 *
 * @param target - The WebContents instance to which the functionality will be attached.
 * @param protocolVersion - The protocol version to use.
 */
export async function attach(target: WebContents, protocolVersion?: string) {

    if (isAttached(target)) {
        throw new Error('cdp session already attached');
    }

    const session = new CDPSession(target);

    session.attach(protocolVersion);

    await session.send('Runtime.evaluate', {
        expression: `${SuperJSONScript}; window.SuperJSON = SuperJSON.default;`,
        returnByValue: true,
        awaitPromise: true,
        silent: true,
        generatePreview: false,
        throwOnSideEffect: false,
        includeCommandLineAPI: false,
    });

    session.on('Runtime.executionContextCreated', event => {
        session.send('Runtime.evaluate', {
            expression: `${SuperJSONScript}; window.SuperJSON = SuperJSON.default;`,
            contextId: event.context.id,
            returnByValue: true,
            awaitPromise: true,
            silent: true,
            generatePreview: false,
            throwOnSideEffect: false,
            includeCommandLineAPI: false,
        }).catch(console.error);
    });

    Object.defineProperty(target, 'cdp', { get: () => session });

    return session;
}

export function isAttached(target: WebContents) {
    return target.cdp instanceof CDPSession;
}