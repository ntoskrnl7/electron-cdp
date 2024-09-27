# electron-cdp-utils

This is a library that makes it easier to use CDP (Chrome DevTools Protocol) in Electron.

## Usage

```ts
import { attach } from 'electron-cdp-utils';

const window = new BrowserWindow(...);

...

const session = await attach(window.webContents);
await session.send('Page.enable');
await session.send('Page.setBypassCSP', { enabled: true });

await window.webContents.cdp.send('Page.enable');
await window.webContents.cdp.send('Page.setBypassCSP', { enabled: true });
```

```ts
import { Session } from 'electron-cdp-utils';

const window = new BrowserWindow(...);

...

const session = new Session(window.webContents);
await session.send('Page.enable');
await session.send('Page.setBypassCSP', { enabled: true });
```
