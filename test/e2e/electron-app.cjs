const { app, BrowserWindow } = require('electron');
const { attach, isAttached } = require('../..');

async function waitFor(read, timeout = 5000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeout) {
    const value = read();
    if (value) {
      return value;
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }

  throw new Error('Timed out while waiting for e2e condition.');
}

async function captureError(action) {
  try {
    await action();
    return { threw: false };
  } catch (error) {
    return {
      threw: true,
      name: error?.name,
      message: error?.message,
      description: error?.description,
      text: error?.text,
      code: error?.code,
      string: String(error),
      keys: error && typeof error === 'object' ? Object.keys(error).sort() : [],
    };
  }
}

function debug(message) {
  if (process.env.ELECTRON_CDP_E2E_DEBUG) {
    console.error(`[e2e] ${message}`);
  }
}

function pageUrl(body, title = 'electron-cdp-utils e2e') {
  return `data:text/html;charset=utf-8,${encodeURIComponent(`
    <!doctype html>
    <html>
      <head><title>${title}</title></head>
      ${body}
    </html>
  `)}`;
}

async function main() {
  debug('disable hardware acceleration');
  app.commandLine.appendSwitch('no-sandbox');
  app.disableHardwareAcceleration();
  debug('wait for app ready');
  await app.whenReady();

  debug('create browser window');
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const results = {};

  debug('attach session');
  results.attach = {
    before: isAttached(window.webContents),
  };
  const session = attach(window.webContents, '1.3');
  results.attach.after = isAttached(window.webContents);
  results.attach.webContentsGetter = window.webContents.cdp === session;

  debug('load page');
  await window.loadURL(pageUrl('<body data-ready="yes"></body>'));

  debug('setup session');
  await session.setup({
    initScript: 'globalThis.__setupFrameScriptRuns = (globalThis.__setupFrameScriptRuns ?? 0) + 1;',
    preloadSuperJSON: true,
    timeout: 1000,
    trackExecutionContexts: true,
  });

  const targetInfo = await session.getTargetInfo();
  const domains = await session.getDomains();
  results.setup = {
    isSuperJSONPreloaded: session.isSuperJSONPreloaded,
    trackExecutionContextsEnabled: session.trackExecutionContextsEnabled,
    targetType: targetInfo.type,
    hasRuntimeDomain: domains.some(domain => domain.name === 'Runtime'),
    hasPageDomain: domains.some(domain => domain.name === 'Page'),
  };

  debug('send raw CDP command');
  const rawTitle = await session.send('Runtime.evaluate', {
    expression: 'document.title',
    returnByValue: true,
  });
  results.rawSend = {
    title: rawTitle.result.value,
  };

  debug('evaluate basic session calls');
  const returnedComplex = await session.evaluate(() => ({
    date: new Date('2024-01-02T03:04:05.000Z'),
    map: new Map([['alpha', 1], ['beta', 2]]),
    set: new Set(['red', 'blue']),
    big: 9007199254740993n,
  }));

  results.sessionEvaluate = {
    title: await session.evaluate(() => document.title),
    args: await session.evaluate((a, b) => a + b, 19, 23),
    asyncValue: await session.evaluate(async value => value * 2, 21),
    functionArg: await session.evaluate((value, transform) => transform(value), 7, value => value * 6),
    undefinedResult: await session.evaluate(() => undefined) === undefined,
    complexArg: await session.evaluate(payload => ({
      dateIsDate: payload.date instanceof Date,
      dateIso: payload.date.toISOString(),
      mapEntries: Array.from(payload.map.entries()),
      setValues: Array.from(payload.set.values()).sort(),
      big: payload.big.toString(),
      errorMessage: payload.error.message,
    }), {
      date: new Date('2023-05-06T07:08:09.000Z'),
      map: new Map([['one', 1], ['two', 2]]),
      set: new Set(['b', 'a']),
      big: 12345678901234567890n,
      error: new Error('complex-error'),
    }),
    complexReturn: {
      dateIsDate: returnedComplex.date instanceof Date,
      dateIso: returnedComplex.date.toISOString(),
      mapEntries: Array.from(returnedComplex.map.entries()),
      setValues: Array.from(returnedComplex.set.values()).sort(),
      big: returnedComplex.big.toString(),
    },
    scriptRuns: await session.evaluate(
      {
        script: {
          initScript: 'globalThis.__sessionEvaluateScriptRuns = (globalThis.__sessionEvaluateScriptRuns ?? 0) + 1;',
        },
      },
      () => globalThis.__sessionEvaluateScriptRuns,
    ),
    functionInitScriptValue: await session.evaluate(
      {
        script: {
          initScript() {
            globalThis.__sessionFunctionInitScriptValue = 'from-function';
          },
        },
      },
      () => globalThis.__sessionFunctionInitScriptValue,
    ),
    thrown: await captureError(() => session.evaluate(() => {
      const error = new Error('session-evaluate-failure');
      error.code = 'E_SESSION_EVALUATE';
      throw error;
    })),
  };

  debug('evaluate tracked execution context');
  const executionContext = await waitFor(() =>
    Array.from(session.executionContexts.values()).find(context => context.id),
  );
  results.executionContext = {
    trackedCount: session.executionContexts.size,
    hasId: typeof executionContext.id === 'number',
    title: await executionContext.evaluate(() => document.title),
    args: await executionContext.evaluate((left, right) => `${left}:${right}`, 'ctx', 42),
    scriptRuns: await executionContext.evaluate(
      {
        script: {
          initScript: 'globalThis.__contextEvaluateScriptRuns = (globalThis.__contextEvaluateScriptRuns ?? 0) + 1;',
        },
      },
      () => globalThis.__contextEvaluateScriptRuns,
    ),
  };

  debug('evaluate main frame');
  const frameReturnedComplex = await window.webContents.mainFrame.evaluate(() => ({
    date: new Date('2025-02-03T04:05:06.000Z'),
    map: new Map([['frame', 1]]),
    set: new Set(['main', 'frame']),
  }));
  results.frameEvaluate = {
    defaultRuns: await window.webContents.mainFrame.evaluate(
      () => globalThis.__setupFrameScriptRuns,
    ),
    args: await window.webContents.mainFrame.evaluate((a, b) => a * b, 6, 7),
    complexReturn: {
      dateIsDate: frameReturnedComplex.date instanceof Date,
      dateIso: frameReturnedComplex.date.toISOString(),
      mapEntries: Array.from(frameReturnedComplex.map.entries()),
      setValues: Array.from(frameReturnedComplex.set.values()).sort(),
    },
    inlineScript: await window.webContents.mainFrame.evaluate(
      {
        initScript: 'globalThis.__frameInlineScriptValue = "inline";',
      },
      () => ({
        value: globalThis.__frameInlineScriptValue,
        setupRuns: globalThis.__setupFrameScriptRuns,
      }),
    ),
    nestedScript: await window.webContents.mainFrame.evaluate(
      {
        script: {
          initScript: 'globalThis.__frameNestedScriptValue = "nested";',
        },
      },
      () => ({
        value: globalThis.__frameNestedScriptValue,
        setupRuns: globalThis.__setupFrameScriptRuns,
      }),
    ),
    defaultRunsAfterOverrides: await window.webContents.mainFrame.evaluate(
      () => globalThis.__setupFrameScriptRuns,
    ),
    booleanUserGestureFalse: await window.webContents.mainFrame.evaluate(
      false,
      () => 'boolean-false',
    ),
    optionsUserGestureTrue: await window.webContents.mainFrame.evaluate(
      {
        userGesture: true,
        script: {
          initScript: 'globalThis.__frameGestureScriptValue = "gesture";',
        },
      },
      () => globalThis.__frameGestureScriptValue,
    ),
  };

  debug('create and evaluate child frame');
  await session.evaluate(() => new Promise(resolve => {
    const iframe = document.createElement('iframe');
    iframe.id = 'child-frame';
    iframe.srcdoc = '<!doctype html><html><body data-ready="child"></body></html>';
    iframe.onload = () => resolve(true);
    document.body.append(iframe);
  }));

  const mainFrame = window.webContents.mainFrame;
  const childFrame = await waitFor(() => mainFrame.framesInSubtree.find(frame =>
    frame !== mainFrame &&
    !frame.isDestroyed() &&
    typeof frame.evaluate === 'function',
  ));

  results.childFrame = await childFrame.evaluate(() => ({
    ready: document.body.dataset.ready,
    setupRuns: globalThis.__setupFrameScriptRuns,
  }));

  debug('expose functions');
  results.exposeFunction = {};
  let recordedValue;
  await session.exposeFunction('recordNativeCall', value => {
    recordedValue = value;
  });
  await session.evaluate(() => globalThis.recordNativeCall('recorded'));
  await waitFor(() => recordedValue === 'recorded');
  results.exposeFunction.noReturnValue = recordedValue;

  await session.exposeFunction('native.tools.join', (...parts) => parts.join(':'), {
    withReturnValue: { timeout: 1000 },
  });
  results.exposeFunction.nestedName = await session.evaluate(async () =>
    globalThis.native.tools.join('a', 'b', 'c'),
  );

  await session.exposeFunction('replaceValue', () => 'first', {
    withReturnValue: { timeout: 1000 },
  });
  const firstReplaceValue = await session.evaluate(async () => globalThis.replaceValue());
  const duplicateExposeResult = await session.exposeFunction('replaceValue', () => 'duplicate', {
    withReturnValue: { timeout: 1000 },
  });
  const stillFirstReplaceValue = await session.evaluate(async () => globalThis.replaceValue());
  const beforeRemoveExposed = session.isFunctionExposed('replaceValue');
  await session.exposeFunction('replaceValue', () => 'second', {
    overwrite: true,
    withReturnValue: { timeout: 1000 },
  });
  const secondReplaceValue = await session.evaluate(async () => globalThis.replaceValue());
  const removeResult = await session.removeExposedFunction('replaceValue');
  const afterRemoveExposed = session.isFunctionExposed('replaceValue');
  const typeAfterRemove = await session.evaluate(() => typeof globalThis.replaceValue);
  results.exposeFunction.overwriteAndRemove = {
    first: firstReplaceValue,
    duplicateResult: duplicateExposeResult,
    stillFirst: stillFirstReplaceValue,
    beforeRemoveExposed,
    second: secondReplaceValue,
    removeResult,
    afterRemoveExposed,
    typeAfterRemove,
  };

  debug('expose function in Electron mode');
  await session.exposeFunction('nativeAdd', (a, b) => a + b, {
    script: {
      initScript: 'globalThis.__electronExposeScriptRuns = (globalThis.__electronExposeScriptRuns ?? 0) + 1;',
    },
    withReturnValue: { timeout: 1000 },
  });

  results.exposeFunction.electronMode = await session.evaluate(async () => {
    const sum = await globalThis.nativeAdd(20, 22);
    return {
      sum,
      scriptRuns: globalThis.__electronExposeScriptRuns,
    };
  });

  debug('expose function in CDP mode');
  await session.exposeFunction('nativeMultiply', (a, b) => a * b, {
    mode: 'CDP',
    script: {
      initScript: 'globalThis.__cdpExposeScriptRuns = (globalThis.__cdpExposeScriptRuns ?? 0) + 1;',
    },
    withReturnValue: { timeout: 1000 },
  });

  results.exposeFunction.cdpMode = await session.evaluate(async () => {
    const product = await globalThis.nativeMultiply(6, 7);
    return {
      product,
      scriptRuns: globalThis.__cdpExposeScriptRuns,
    };
  });

  await session.exposeFunction('nativeThrow', () => {
    throw new Error('native-throw-failure');
  }, {
    script: {
      initScript: 'globalThis.__nativeThrowScriptRuns = (globalThis.__nativeThrowScriptRuns ?? 0) + 1;',
    },
    withReturnValue: { timeout: 1000 },
  });
  results.exposeFunction.thrown = await captureError(() =>
    session.evaluate(async () => globalThis.nativeThrow()),
  );
  results.exposeFunction.throwScriptRuns = await session.evaluate(() => globalThis.__nativeThrowScriptRuns);

  debug('navigate and verify setup/exposed functions remain installed');
  await window.loadURL(pageUrl('<body data-ready="after-navigation"></body>', 'electron-cdp-utils e2e navigated'));
  results.afterNavigation = {
    frame: await window.webContents.mainFrame.evaluate(() => ({
      title: document.title,
      ready: document.body.dataset.ready,
      setupRuns: globalThis.__setupFrameScriptRuns,
    })),
    exposedFunctions: await session.evaluate(async () => ({
      addType: typeof globalThis.nativeAdd,
      multiplyType: typeof globalThis.nativeMultiply,
      sum: await globalThis.nativeAdd(1, 2),
      product: await globalThis.nativeMultiply(3, 4),
      electronScriptRuns: globalThis.__electronExposeScriptRuns,
      cdpScriptRuns: globalThis.__cdpExposeScriptRuns,
    })),
  };

  debug('detach and close');
  await session.detach();
  results.detach = {
    debuggerAttached: window.webContents.debugger.isAttached(),
  };
  await window.close();
  await new Promise(resolve => {
    process.stdout.write(`E2E_RESULT ${JSON.stringify(results)}\n`, resolve);
  });
}

main()
  .then(() => {
    app.exit(0);
  })
  .catch(error => {
    console.error(error);
    app.exit(1);
  });
