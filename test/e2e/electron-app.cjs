const { app, BrowserWindow } = require('electron');
const { attach } = require('../..');

function debug(message) {
  if (process.env.ELECTRON_CDP_E2E_DEBUG) {
    console.error(`[e2e] ${message}`);
  }
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

  debug('attach session');
  const session = attach(window.webContents, '1.3');

  debug('load page');
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
    <!doctype html>
    <html>
      <head><title>electron-cdp-utils e2e</title></head>
      <body data-ready="yes"></body>
    </html>
  `)}`);

  debug('setup session');
  await session.setup({
    preloadSuperJSON: true,
    trackExecutionContexts: true,
  });

  debug('evaluate title');
  const title = await session.evaluate(() => document.title);
  if (title !== 'electron-cdp-utils e2e') {
    throw new Error(`Unexpected title: ${title}`);
  }

  debug('evaluate main frame');
  const frameValue = await window.webContents.mainFrame.evaluate(() => document.body.dataset.ready);
  if (frameValue !== 'yes') {
    throw new Error(`Unexpected frame value: ${frameValue}`);
  }

  debug('expose function');
  await session.exposeFunction('nativeAdd', (a, b) => a + b, {
    withReturnValue: { timeout: 1000 },
  });

  debug('call exposed function');
  const sum = await session.evaluate(async () => globalThis.nativeAdd(20, 22));
  if (sum !== 42) {
    throw new Error(`Unexpected exposed function result: ${sum}`);
  }

  debug('detach and close');
  await session.detach();
  await window.close();
}

main()
  .then(() => {
    app.exit(0);
  })
  .catch(error => {
    console.error(error);
    app.exit(1);
  });
