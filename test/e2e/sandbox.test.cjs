const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const test = require('node:test');

test('sandboxed exposed functions settle results, errors and timeouts without polling', { timeout: 30000 }, async t => {
  if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    t.skip('Electron e2e requires DISPLAY or WAYLAND_DISPLAY on Linux.');
    return;
  }
  const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' };
  delete env.ELECTRON_RUN_AS_NODE;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-cdp-sandbox-'));
  const child = spawn(require('electron'), ['--no-sandbox', `--user-data-dir=${profile}`, path.join(__dirname, 'sandbox-app.cjs')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  assert.equal(path.dirname(profile), path.resolve(os.tmpdir()));
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  assert.equal(code, 0, output);
  const line = output.split(/\r?\n/).find(line => line.startsWith('SANDBOX_RESULT '));
  assert.ok(line, output);
  assert.deepEqual(JSON.parse(line.slice('SANDBOX_RESULT '.length)), [
    'CDP:resolve', 'CDP:reject', 'CDP:timeout', 'CDP:destroyed-context',
  ]);
});
