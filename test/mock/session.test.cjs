const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');

const { ExecutionContext, Session, attach, isAttached, patchWebFrameMain } = require('../..');

class MockDebugger extends EventEmitter {
  constructor() {
    super();
    this.attached = false;
    this.attachCalls = [];
    this.commands = [];
    this.runtimeEvaluateResult = undefined;
  }

  attach(protocolVersion) {
    this.attached = true;
    this.attachCalls.push(protocolVersion);
  }

  isAttached() {
    return this.attached;
  }

  detach() {
    this.attached = false;
  }

  async sendCommand(method, params, sessionId) {
    this.commands.push({ method, params, sessionId });

    if (method === 'Target.getTargetInfo') {
      return {
        targetInfo: {
          targetId: 'target-1',
          type: 'page',
          title: 'Mock page',
          url: 'https://example.test/',
          attached: true,
          canAccessOpener: false,
        },
      };
    }

    if (method === 'Schema.getDomains') {
      return { domains: [{ name: 'Page' }, { name: 'Runtime' }, { name: 'Target' }] };
    }

    if (method === 'Runtime.evaluate') {
      if (this.runtimeEvaluateResult instanceof Error) {
        throw this.runtimeEvaluateResult;
      }
      return this.runtimeEvaluateResult ?? { result: { value: undefined } };
    }

    if (method === 'Page.addScriptToEvaluateOnNewDocument') {
      return { identifier: 'script-1' };
    }

    if (method === 'Target.detachFromTarget') {
      return {};
    }

    return {};
  }
}

function createMockWebContents() {
  const webContents = new EventEmitter();
  webContents.id = 101;
  webContents.debugger = new MockDebugger();
  webContents.session = { serviceWorkers: new EventEmitter() };
  webContents.mainFrame = {
    processId: 1,
    routingId: 2,
    framesInSubtree: [],
    isDestroyed: () => false,
    executeJavaScript: async () => undefined,
  };
  return webContents;
}

test('attach wires a MainSession onto webContents.cdp', async () => {
  const webContents = createMockWebContents();

  const session = attach(webContents, '1.3');
  await session.getTargetInfo();

  assert.equal(webContents.cdp, session);
  assert.equal(isAttached(webContents), true);
  assert.deepEqual(webContents.debugger.attachCalls, ['1.3']);
});

test('Session.send forwards commands through Electron debugger with session id', async () => {
  const webContents = createMockWebContents();
  const session = new Session(webContents, 'child-session');

  await session.send('Runtime.evaluate', { expression: '1 + 1' });

  const command = webContents.debugger.commands.find(({ method }) => method === 'Runtime.evaluate');
  assert.equal(command.sessionId, 'child-session');
  assert.deepEqual(command.params, { expression: '1 + 1' });
});

test('ExecutionContext.evaluate sends Runtime.evaluate and parses SuperJSON results', async () => {
  const webContents = createMockWebContents();
  const session = new Session(webContents);
  const expected = { total: 5, createdAt: new Date('2026-05-05T00:00:00.000Z') };
  webContents.debugger.runtimeEvaluateResult = {
    result: {
      value: session.superJSON.stringify(expected),
    },
  };

  const context = new ExecutionContext(session, 7);
  const actual = await context.evaluate((a, b) => ({ total: a + b }), 2, 3);

  assert.deepEqual(actual, expected);

  const command = webContents.debugger.commands.findLast(({ method }) => method === 'Runtime.evaluate');
  assert.equal(command.params.contextId, 7);
  assert.equal(command.params.awaitPromise, true);
  assert.equal(command.params.returnByValue, false);
  assert.match(command.params.expression, /const fn = \(a, b\) =>/);
});

test('ExecutionContext.evaluate keeps script options out of Runtime.evaluate params', async () => {
  const webContents = createMockWebContents();
  const session = new Session(webContents);
  webContents.debugger.runtimeEvaluateResult = {
    result: {
      value: session.superJSON.stringify('ready'),
    },
  };

  const context = new ExecutionContext(session, 9);
  const actual = await context.evaluate(
    {
      timeout: 1234,
      script: {
        initScript: 'globalThis.__contextEvaluateScript = true;',
      },
    },
    () => 'ready',
  );

  assert.equal(actual, 'ready');

  const command = webContents.debugger.commands.findLast(({ method }) => method === 'Runtime.evaluate');
  assert.equal(command.params.contextId, 9);
  assert.equal(command.params.timeout, 1234);
  assert.equal('script' in command.params, false);
  assert.match(command.params.expression, /__contextEvaluateScript/);
});

test('WebFrameMain.evaluate accepts options object with userGesture and script options', async () => {
  const webContents = createMockWebContents();
  const session = new Session(webContents);
  const calls = [];
  const frame = {
    executeJavaScript: async (...callArgs) => {
      calls.push(callArgs);
      return session.superJSON.stringify({ ok: true });
    },
  };

  patchWebFrameMain(session, frame);

  const actual = await frame.evaluate(
    {
      userGesture: true,
      initScript: 'globalThis.__frameEvaluateOption = true;',
    },
    () => ({ ok: globalThis.__frameEvaluateOption === true }),
  );

  assert.deepEqual(actual, { ok: true });
  assert.equal(calls[0].length, 2);
  assert.equal(calls[0][1], true);
  assert.match(calls[0][0], /__frameEvaluateOption/);
});

test('WebFrameMain.evaluate preserves boolean userGesture overload', async () => {
  const webContents = createMockWebContents();
  const session = new Session(webContents);
  const calls = [];
  const frame = {
    executeJavaScript: async (...callArgs) => {
      calls.push(callArgs);
      return session.superJSON.stringify('ok');
    },
  };

  patchWebFrameMain(session, frame);

  const actual = await frame.evaluate(false, () => 'ok');

  assert.equal(actual, 'ok');
  assert.equal(calls[0].length, 2);
  assert.equal(calls[0][1], false);
});

test('WebFrameMain.evaluate omits userGesture when it is not provided', async () => {
  const webContents = createMockWebContents();
  const session = new Session(webContents);
  const calls = [];
  const frame = {
    executeJavaScript: async (...callArgs) => {
      calls.push(callArgs);
      return session.superJSON.stringify('ok');
    },
  };

  patchWebFrameMain(session, frame);

  const actual = await frame.evaluate(() => 'ok');

  assert.equal(actual, 'ok');
  assert.equal(calls[0].length, 1);
});

test('WebFrameMain.evaluate applies patch defaults and lets per-call script override them', async () => {
  const webContents = createMockWebContents();
  const session = new Session(webContents);
  const calls = [];
  const frame = {
    executeJavaScript: async (...callArgs) => {
      calls.push(callArgs);
      return session.superJSON.stringify('ok');
    },
  };

  patchWebFrameMain(session, frame, {
    initScript: 'globalThis.__defaultFrameScript = true;',
  });

  await frame.evaluate(() => 'ok');
  await frame.evaluate(
    {
      script: {
        initScript: 'globalThis.__overrideFrameScript = true;',
      },
    },
    () => 'ok',
  );

  assert.match(calls[0][0], /__defaultFrameScript/);
  assert.doesNotMatch(calls[0][0], /__overrideFrameScript/);
  assert.match(calls[1][0], /__overrideFrameScript/);
  assert.doesNotMatch(calls[1][0], /__defaultFrameScript/);
});

test('patchWebFrameMain respects overwrite option', async () => {
  const webContents = createMockWebContents();
  const session = new Session(webContents);
  const existingEvaluate = async () => 'existing';
  const frame = {
    evaluate: existingEvaluate,
    executeJavaScript: async () => session.superJSON.stringify('patched'),
  };

  patchWebFrameMain(session, frame);
  assert.equal(frame.evaluate, existingEvaluate);
  assert.equal(await frame.evaluate(), 'existing');

  patchWebFrameMain(session, frame, { overwrite: true });
  assert.notEqual(frame.evaluate, existingEvaluate);
  assert.equal(await frame.evaluate(() => 'patched'), 'patched');
});

test('MainSession.setup applies frame evaluate script defaults to existing and created frames', async () => {
  const webContents = createMockWebContents();
  const frameCalls = [];
  let session;
  webContents.mainFrame.executeJavaScript = async (...callArgs) => {
    frameCalls.push(callArgs);
    return callArgs[0].includes('const fn =') ? session.superJSON.stringify('main') : undefined;
  };

  session = attach(webContents);
  await session.setup({
    initScript: 'globalThis.__setupFrameScript = true;',
    timeout: 4321,
  });

  assert.equal(await webContents.mainFrame.evaluate(() => 'main'), 'main');

  const mainEvaluateCall = frameCalls.find(([source]) => source.includes('const fn ='));
  assert.match(mainEvaluateCall[0], /__setupFrameScript/);

  const childCalls = [];
  const childFrame = {
    processId: 3,
    routingId: 4,
    framesInSubtree: [],
    isDestroyed: () => false,
    executeJavaScript: async (...callArgs) => {
      childCalls.push(callArgs);
      return session.superJSON.stringify('child');
    },
  };

  webContents.emit('frame-created', {}, { frame: childFrame });

  assert.equal(await childFrame.evaluate(() => 'child'), 'child');
  assert.match(childCalls[0][0], /__setupFrameScript/);
});

test('Session.exposeFunction applies script options to browser bridge injection', async () => {
  const webContents = createMockWebContents();
  const session = new Session(webContents);

  await session.exposeFunction('nativeFromMock', () => undefined, {
    script: {
      initScript: 'globalThis.__exposeFunctionScript = true;',
    },
  });

  const command = webContents.debugger.commands.findLast(({ method }) => method === 'Page.addScriptToEvaluateOnNewDocument');

  assert.match(command.params.source, /__exposeFunctionScript/);
});

test('ExecutionContext.evaluate converts CDP exception details into thrown objects', async () => {
  const webContents = createMockWebContents();
  const session = new Session(webContents);
  webContents.debugger.runtimeEvaluateResult = {
    exceptionDetails: {
      text: 'Evaluation failed',
    },
  };

  const context = new ExecutionContext(session);

  await assert.rejects(
    () => context.evaluate(() => {
      throw new Error('boom');
    }),
    { text: 'Evaluation failed' },
  );
});
