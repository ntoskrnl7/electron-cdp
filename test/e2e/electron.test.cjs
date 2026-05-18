const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

const electronPath = require('electron');

function assertThrown(errorResult) {
  assert.equal(errorResult.threw, true);
}

async function runElectronApp(t) {
  if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    t.skip('Electron e2e requires DISPLAY or WAYLAND_DISPLAY on Linux.');
    return undefined;
  }

  const appPath = path.join(__dirname, 'electron-app.cjs');
  const env = {
    ...process.env,
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    ELECTRON_DISABLE_SANDBOX: 'true',
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const child = spawn(electronPath, ['--no-sandbox', appPath], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => {
    stdout += chunk;
  });
  child.stderr.on('data', chunk => {
    stderr += chunk;
  });

  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });

  assert.equal(exitCode, 0, `Electron e2e failed.\nstdout:\n${stdout}\nstderr:\n${stderr}`);

  const resultLine = stdout
    .split(/\r?\n/)
    .find(line => line.startsWith('E2E_RESULT '));

  assert.ok(resultLine, `Electron e2e did not report results.\nstdout:\n${stdout}\nstderr:\n${stderr}`);

  return JSON.parse(resultLine.slice('E2E_RESULT '.length));
}

test('Electron integration covers session, frame, context, and exposed-function contracts', { timeout: 15000 }, async (t) => {
  const result = await runElectronApp(t);
  if (!result) {
    return;
  }

  await t.test('attach and setup contracts', () => {
    assert.deepEqual(result.attach, {
      before: false,
      after: true,
      webContentsGetter: true,
    });

    assert.deepEqual(result.setup, {
      isSuperJSONPreloaded: true,
      trackExecutionContextsEnabled: true,
      targetType: 'page',
      hasRuntimeDomain: true,
      hasPageDomain: true,
    });

    assert.deepEqual(result.rawSend, {
      title: 'electron-cdp-utils e2e',
    });
  });

  await t.test('Session.evaluate contracts', () => {
    assert.equal(result.sessionEvaluate.title, 'electron-cdp-utils e2e');
    assert.equal(result.sessionEvaluate.args, 42);
    assert.equal(result.sessionEvaluate.asyncValue, 42);
    assert.equal(result.sessionEvaluate.functionArg, 42);
    assert.equal(result.sessionEvaluate.undefinedResult, true);
    assert.deepEqual(result.sessionEvaluate.complexArg, {
      dateIsDate: true,
      dateIso: '2023-05-06T07:08:09.000Z',
      mapEntries: [['one', 1], ['two', 2]],
      setValues: ['a', 'b'],
      big: '12345678901234567890',
      errorMessage: 'complex-error',
    });
    assert.deepEqual(result.sessionEvaluate.complexReturn, {
      dateIsDate: true,
      dateIso: '2024-01-02T03:04:05.000Z',
      mapEntries: [['alpha', 1], ['beta', 2]],
      setValues: ['blue', 'red'],
      big: '9007199254740993',
    });
    assert.equal(result.sessionEvaluate.scriptRuns, 1);
    assert.equal(result.sessionEvaluate.functionInitScriptValue, 'from-function');
    assertThrown(result.sessionEvaluate.thrown);
  });

  await t.test('ExecutionContext.evaluate contracts', () => {
    assert.ok(result.executionContext.trackedCount >= 1);
    assert.equal(result.executionContext.hasId, true);
    assert.equal(result.executionContext.title, 'electron-cdp-utils e2e');
    assert.equal(result.executionContext.args, 'ctx:42');
    assert.equal(result.executionContext.scriptRuns, 1);
  });

  await t.test('WebFrameMain.evaluate contracts', () => {
    assert.equal(result.frameEvaluate.defaultRuns, 10);
    assert.equal(result.frameEvaluate.args, 42);
    assert.deepEqual(result.frameEvaluate.complexReturn, {
      dateIsDate: true,
      dateIso: '2025-02-03T04:05:06.000Z',
      mapEntries: [['frame', 1]],
      setValues: ['frame', 'main'],
    });
    assert.deepEqual(result.frameEvaluate.inlineScript, {
      value: 'inline',
      setupRuns: 11,
    });
    assert.deepEqual(result.frameEvaluate.nestedScript, {
      value: 'nested',
      setupRuns: 11,
    });
    assert.equal(result.frameEvaluate.defaultRunsAfterOverrides, 12);
    assert.equal(result.frameEvaluate.booleanUserGestureFalse, 'boolean-false');
    assert.equal(result.frameEvaluate.optionsUserGestureTrue, 'gesture');

    assert.deepEqual(result.childFrame, {
      ready: 'child',
      setupRuns: 1,
    });
  });

  await t.test('exposeFunction contracts', () => {
    assert.equal(result.exposeFunction.noReturnValue, 'recorded');
    assert.equal(result.exposeFunction.nestedName, 'a:b:c');
    assert.deepEqual(result.exposeFunction.overwriteAndRemove, {
      first: 'first',
      duplicateResult: false,
      stillFirst: 'first',
      beforeRemoveExposed: true,
      second: 'second',
      removeResult: true,
      afterRemoveExposed: false,
      typeAfterRemove: 'undefined',
    });
    assert.deepEqual(result.exposeFunction.electronMode, {
      sum: 42,
      scriptRuns: 2,
    });
    assert.deepEqual(result.exposeFunction.cdpMode, {
      product: 42,
      scriptRuns: 2,
    });
    assertThrown(result.exposeFunction.thrown);
    assert.equal(result.exposeFunction.throwScriptRuns, 2);
  });

  await t.test('navigation and detach contracts', () => {
    assert.deepEqual(result.afterNavigation.frame, {
      title: 'electron-cdp-utils e2e navigated',
      ready: 'after-navigation',
      setupRuns: 3,
    });
    assert.deepEqual(result.afterNavigation.exposedFunctions, {
      addType: 'function',
      multiplyType: 'function',
      sum: 3,
      product: 12,
      electronScriptRuns: 2,
      cdpScriptRuns: 2,
    });

    assert.deepEqual(result.detach, {
      debuggerAttached: false,
    });
  });
});
