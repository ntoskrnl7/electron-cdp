const assert = require('node:assert/strict');
const { app, BrowserWindow } = require('electron');
const { attach } = require('../..');
let stage = 'startup';
setTimeout(() => { console.error(`Sandbox test timed out at: ${stage}`); app.exit(1); }, 15000).unref();

app.disableHardwareAcceleration();

async function main() {
  await app.whenReady();
  stage = 'setup';
  const window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: false, sandbox: true } });
  const session = attach(window.webContents, '1.3');
  await window.loadURL('about:blank');
  await session.applyOptions({ trackExecutionContexts: true });
  await session.enableSuperJSONPreload();
  const warnings = [];
  window.webContents.on('console-message', event => {
    if (event.message.includes('Blocked script execution')) warnings.push(event.message);
  });
  const results = [];
  let finishLateCall;
  const lateCallStarted = Promise.withResolvers();
  for (const mode of ['CDP']) {
    stage = `expose ${mode}`;
    await session.exposeFunction(`native${mode}`, async outcome => {
      if (outcome === 'reject') throw new TypeError('sandbox-response-error');
      if (outcome === 'timeout') return new Promise(() => {});
      if (outcome === 'late') {
        return new Promise(resolve => { finishLateCall = resolve; lateCallStarted.resolve(); });
      }
      await new Promise(resolve => setTimeout(resolve, 100));
      return { answer: 42, value: undefined };
    }, { mode, retry: { delay: 1000 }, withReturnValue: { timeout: 1000 } });
  }
  stage = 'load';
  await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<iframe name="blocked" sandbox="allow-same-origin" src="about:blank"></iframe>'));
  const { frameTree } = await session.send('Page.getFrameTree');
  const frameId = frameTree.childFrames.find(child => child.frame.name === 'blocked').frame.id;
  const context = [...session.executionContexts.values()].find(context => context.description?.auxData?.frameId === frameId && context.description?.auxData?.isDefault);
  assert.ok(context);
  const before = warnings.length;
  for (const mode of ['CDP']) {
    for (const outcome of ['resolve', 'reject', 'timeout']) {
      stage = `${mode}:${outcome}`;
      // Host evaluation is allowed; ordinary page scripts and timers remain sandboxed.
      const result = await context.evaluate(async (name, outcome) => {
        try {
          return { value: await globalThis[name](outcome) };
        } catch (error) {
          return { error: { name: error.name, message: error.message } };
        }
      }, `native${mode}`, outcome);
      if (outcome === 'resolve') assert.deepEqual(result, { value: { answer: 42, value: undefined } });
      else assert.deepEqual(result, { error: {
        name: outcome === 'reject' ? 'TypeError' : 'Error',
        message: outcome === 'reject' ? 'sandbox-response-error' : 'Operation did not complete before the timeout.',
      } });
      results.push(`${mode}:${outcome}`);
    }
  }
  assert.deepEqual(await context.evaluate(() => [Object.keys($cdp.callback.returnValues).length, Object.keys($cdp.callback.errors).length]), [0, 0]);
  await new Promise(resolve => setTimeout(resolve, 1100));
  assert.equal(warnings.length, before, `Sandbox warnings increased: ${JSON.stringify(warnings)}`);
  const permissions = await window.webContents.executeJavaScript(`(() => {
    const frame = document.querySelector('iframe');
    const script = frame.contentDocument.createElement('script');
    script.textContent = 'globalThis.pageScriptRan = true';
    frame.contentDocument.body.appendChild(script);
    return { sandbox: frame.getAttribute('sandbox'), ran: frame.contentWindow.pageScriptRan === true };
  })()`);
  assert.deepEqual(permissions, { sandbox: 'allow-same-origin', ran: false });
  stage = 'destroyed context';
  const unhandled = [];
  const onUnhandled = error => unhandled.push(String(error));
  process.on('unhandledRejection', onUnhandled);
  const pending = context.evaluate(() => globalThis.nativeCDP('late')).catch(() => undefined);
  await lateCallStarted.promise;
  await window.webContents.executeJavaScript('document.querySelector("iframe").remove()');
  finishLateCall(42);
  await pending;
  await new Promise(resolve => setTimeout(resolve, 100));
  process.off('unhandledRejection', onUnhandled);
  assert.deepEqual(unhandled, []);
  results.push('CDP:destroyed-context');
  window.destroy();
  await new Promise(resolve => process.stdout.write(`SANDBOX_RESULT ${JSON.stringify(results)}\n`, resolve));
}
main().then(() => app.exit(0), error => { console.error(error); app.exit(1); });
