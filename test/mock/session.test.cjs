const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');

const { ExecutionContext, Session, attach, isAttached } = require('../..');

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
