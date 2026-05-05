const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

const electronPath = require('electron');

test('Electron integration evaluates page code and exposed functions', { timeout: 15000 }, async (t) => {
  if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    t.skip('Electron e2e requires DISPLAY or WAYLAND_DISPLAY on Linux.');
    return;
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
});
