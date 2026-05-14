# electron-cdp-utils

A powerful TypeScript library that simplifies Chrome DevTools Protocol (CDP) usage in Electron applications. This library provides an intuitive API for interacting with browser contexts, executing functions, and managing complex data serialization.

## Features

- 🚀 **Easy CDP Integration**: Simple API for Chrome DevTools Protocol commands
- 🔧 **Function Execution**: Execute TypeScript/JavaScript functions in browser contexts with full type safety
- 📦 **SuperJSON Support**: Advanced serialization for complex data types (Date, Map, Set, Error, Buffer, etc.)
- 🎯 **Type Safety**: Full TypeScript support with comprehensive type definitions and strict typing
- 🔄 **Frame Management**: Support for iframes and multiple execution contexts with automatic frame detection
- ⚡ **Event Handling**: Built-in event system for CDP events with proper type definitions
- 🛠️ **Function Exposure**: Expose Node.js functions to browser contexts with retry and timeout options
- 🔍 **Execution Context Tracking**: Monitor and manage browser execution contexts in real-time
- 🔗 **Auto Target Attachment**: Automatically attach to related targets (iframes, workers, etc.)
- 📱 **Cross-Platform**: Works on Windows, macOS, and Linux
- 🎨 **Modern API**: Clean, intuitive API design with async/await support
- 🔒 **Session Management**: Advanced session lifecycle management with proper cleanup
- 🎭 **Type-Safe Events**: Strongly typed event system for better developer experience

## Installation

```bash
npm install electron-cdp-utils
```

## Quick Start

### Basic Usage

```ts
import { attach } from 'electron-cdp-utils';
import { BrowserWindow } from 'electron';

const window = new BrowserWindow({
  webPreferences: {
    nodeIntegration: false,
    contextIsolation: true
  }
});

// Attach CDP functionality and get MainSession instance
const session = attach(window.webContents, '1.3');

// Setup the session with advanced options
await session.setup({
  preloadSuperJSON: true,
  trackExecutionContexts: true,
  autoAttachToRelatedTargets: ['page', 'iframe', 'worker']
});

// Use CDP commands
await session.send('Page.enable');
await session.send('Page.setBypassCSP', { enabled: true });
await session.send('Runtime.enable');
```

### Using the Convenient WebContents Extension

```ts
import { attach } from 'electron-cdp-utils';

const window = new BrowserWindow({...});

// Attach and setup in one go
const session = attach(window.webContents, '1.3');
await session.setup({
  preloadSuperJSON: true,
  trackExecutionContexts: true
});

// Now you can use the convenient cdp property
await window.webContents.cdp.send('Page.enable');
await window.webContents.cdp.send('Page.setBypassCSP', { enabled: true });
```

### MainSession Class

The `MainSession` class extends the base `Session` class with additional setup capabilities:

```ts
import { MainSession } from 'electron-cdp-utils';

// Create MainSession directly
const session = new MainSession(window.webContents, undefined, '1.3');

// Setup with options
await session.setup({
  preloadSuperJSON: (superJSON) => {
    // Customize SuperJSON instance
    superJSON.registerCustom({
      isApplicable: (v) => v instanceof MyCustomClass,
      serialize: (v) => v.toJSON(),
      deserialize: (v) => MyCustomClass.fromJSON(v)
    });
  },
  trackExecutionContexts: true,
  autoAttachToRelatedTargets: true
});
```

## Core Concepts

### Session Management

The library provides two main session classes:

#### Base Session Class
```ts
import { Session } from 'electron-cdp-utils';

// Create a base session directly
const session = new Session(window.webContents, sessionId, protocolVersion);

// Use for specific targets (iframes, workers, etc.)
const iframeSession = await Session.fromTargetId(webContents, targetId);
```

#### MainSession Class
```ts
import { MainSession, attach } from 'electron-cdp-utils';

// Create MainSession directly
const session = new MainSession(window.webContents, undefined, '1.3');
await session.setup({
  preloadSuperJSON: true,
  trackExecutionContexts: true
});

// Or use the convenient attach function
const session = attach(window.webContents, '1.3');
await session.setup({
  preloadSuperJSON: true,
  trackExecutionContexts: true
});
```

#### Key Differences

- **Session**: Base class for all CDP communication, used for specific targets
- **MainSession**: Extended class with setup capabilities, used for main WebContents
- **attach()**: Convenient factory function that returns a MainSession instance

### Function Execution

Execute functions in browser contexts with full type safety:

```ts
// Simple function execution
const result = await session.evaluate(() => {
  return document.title;
});

// With parameters
const result = await session.evaluate((message: string) => {
  console.log(message);
  return document.title;
}, 'Hello from browser!');

// With complex data types (thanks to SuperJSON)
const data = await session.evaluate((userData: { name: string; createdAt: Date }) => {
  return {
    ...userData,
    processedAt: new Date()
  };
}, { name: 'John', createdAt: new Date() });

// With script-generation options
const value = await session.evaluate({
  script: {
    initScript: 'globalThis.__evaluateStarted = true;',
    timeout: 3000
  }
}, () => {
  return globalThis.__evaluateStarted;
});
```

### Execution Contexts

Work with specific execution contexts:

```ts
// Get all execution contexts
const contexts = session.executionContexts;

// Execute in a specific context
const context = contexts.get(contextId);
const result = await context.evaluate(() => {
  return window.location.href;
});
```

### Event Handling

Listen to CDP events with full type safety:

```ts
// Listen to console messages
session.on('Runtime.consoleAPICalled', (params) => {
  console.log('Console message:', params);
});

// Listen to page load events
session.on('Page.loadEventFired', () => {
  console.log('Page loaded!');
});

// Listen to execution context events
session.on('execution-context-created', (context) => {
  console.log('New execution context:', context.id);
});

// Listen to session lifecycle events
session.on('session-attached', (newSession) => {
  console.log('New session attached:', newSession.id);
});

session.on('session-detached', (detachedSession, reason) => {
  console.log('Session detached:', detachedSession.id, reason);
});
```

### Function Exposure

Expose Node.js functions to browser contexts:

```ts
// Expose a simple function
await session.exposeFunction('getSystemInfo', () => {
  return {
    platform: process.platform,
    version: process.version
  };
});

// Expose with options
await session.exposeFunction('complexOperation', async (data: any) => {
  // Complex operation here
  return processedData;
}, {
  mode: 'CDP',
  withReturnValue: true,
  retry: { count: 3, delay: 1000 },
  script: {
    initScript: 'globalThis.__bridgeReady = true;'
  }
});
```

## Advanced Features

### MainSession Setup Options

The `MainSession.setup()` method provides comprehensive configuration:

```ts
const session = attach(window.webContents, '1.3');
await session.setup({
  // Preload SuperJSON into browser contexts. Use true for the default instance,
  // or provide a function to customize it before injection.
  preloadSuperJSON: (superJSON) => {
    superJSON.registerCustom({
      isApplicable: (v) => v instanceof MyClass,
      serialize: (v) => v.toJSON(),
      deserialize: (v) => MyClass.fromJSON(v)
    });
  },

  // Default script-generation options for patched WebFrameMain.evaluate calls.
  // Per-call options can still override these values.
  initScript: 'globalThis.__cdpSetup = true;',
  timeout: 3000,
  
  // Execution context tracking
  trackExecutionContexts: true,
  
  // Auto target attachment. Use true for all related targets,
  // or pass specific target types.
  autoAttachToRelatedTargets: ['iframe', 'worker', 'service_worker'],
});
```

### Service Worker Support

Enhanced service worker support with automatic event handling:

```ts
const session = attach(window.webContents, '1.3');
await session.setup({
  autoAttachToRelatedTargets: ['service_worker']
});

// Listen for service worker events
session.on('service-worker-restarted', (session) => {
  console.log('Service worker restarted:', session.id);
});

session.on('service-worker-version-updated', (version, session) => {
  console.log('Service worker updated:', version.versionId);
  console.log('Scope URL:', version.scopeURL);
});

// Expose functions to service workers
await session.exposeFunction('serviceWorkerFunction', (data) => {
  console.log('Called from service worker:', data);
  return { processed: true, timestamp: new Date() };
});
```

### SuperJSON Integration

The library includes SuperJSON for advanced serialization:

```ts
// Complex data types are automatically handled
const result = await session.evaluate((data) => {
  // data is properly deserialized
  return {
    original: data,
    processed: new Map([['key', 'value']]),
    timestamp: new Date()
  };
}, {
  map: new Map([['key', 'value']]),
  set: new Set([1, 2, 3]),
  date: new Date()
});
```

### Frame Management

Work with iframes and multiple frames:

```ts
// The library automatically handles frame creation and navigation
window.webContents.on('frame-created', (event, details) => {
  console.log('New frame created:', details.frameId);
});

// Execute in specific frames
const frame = webFrameMain.fromId(processId, routingId);
const result = await frame.evaluate(() => {
  return document.title;
});

// Pass a user gesture, preserving the existing boolean-first form
await frame.evaluate(true, () => {
  return document.documentElement.requestFullscreen();
});

// Or pass per-call options
const frameState = await frame.evaluate({
  userGesture: true,
  initScript: 'globalThis.__frameEvaluate = true;'
}, () => {
  return globalThis.__frameEvaluate;
});
```

### Error Handling

Comprehensive error handling with detailed information:

```ts
try {
  const result = await session.evaluate(() => {
    throw new Error('Something went wrong');
  });
} catch (error) {
  console.error('Execution error:', error);
  // Error includes stack trace, line numbers, and context
}
```

## API Reference

For detailed API documentation, see [API.md](docs/API.md).

### Quick Reference

#### MainSession Class
- `setup()` - Configure session with options
- `send()` - Send CDP commands
- `evaluate()` - Execute functions in browser context
- `exposeFunction()` - Expose Node.js functions to browser
- `setAutoAttach()` - Enable auto target attachment
- `enableTrackExecutionContexts()` - Enable execution context tracking

#### Session Class (Base)
- `send()` - Send CDP commands
- `evaluate()` - Execute functions in browser context
- `exposeFunction()` - Expose Node.js functions to browser
- `fromTargetId()` - Create session from target ID
- `fromTargetInfo()` - Create session from target info
- `fromSessionId()` - Create session from session ID

#### Key Types
- `EvaluateOptions` - CDP evaluate options plus nested script-generation options
- `GenerateScriptOptions` - Script wrapper options such as `initScript` and `timeout`
- `WebFrameEvaluateOptions` - Options accepted by `WebFrameMain.evaluate`
- `SessionWithId` - Session with guaranteed ID
- `DetachedSession` - Detached session with limited functionality
- `DetachedSessionWithId` - Detached session with guaranteed ID
- `ServiceWorkerVersion` - Enhanced service worker version with scope URL
- `Target` - Target information with initial URL

## TypeScript Support

The library provides comprehensive TypeScript definitions:

```ts
import { Protocol } from 'electron-cdp-utils';

// Use CDP protocol types
const result: Protocol.Runtime.EvaluateResponse = await session.send('Runtime.evaluate', {
  expression: '1 + 1'
});
```

## Auto Target Attachment

The library can automatically attach to related targets like iframes and workers:

```ts
// Create and setup session with auto attachment
const session = attach(window.webContents, '1.3');
await session.setup({
  autoAttachToRelatedTargets: true
});

// Or specify target types
const session = attach(window.webContents, '1.3');
await session.setup({
  autoAttachToRelatedTargets: ['iframe', 'worker', 'shared_worker', 'service_worker']
});

// Listen for new sessions
session.on('session-attached', (newSession) => {
  console.log('New target attached:', newSession.target.type);
});

// Listen for service worker events
session.on('service-worker-restarted', (session) => {
  console.log('Service worker restarted:', session.id);
});
```

## Execution Context Tracking

Monitor execution contexts in real-time:

```ts
const session = attach(window.webContents, '1.3');
await session.setup({
  trackExecutionContexts: true
});

// Access all execution contexts
console.log('Available contexts:', session.executionContexts.size);

// Listen for context events
session.on('execution-context-created', (context) => {
  console.log('New context created:', context.id);
});

session.on('execution-context-destroyed', (event) => {
  console.log('Context destroyed:', event.executionContextId);
});

session.on('execution-contexts-cleared', () => {
  console.log('All execution contexts cleared');
});
```

## Common Use Cases

### Web Scraping

```ts
const session = attach(window.webContents, '1.3');
await session.setup({
  preloadSuperJSON: true,
  trackExecutionContexts: true
});

// Navigate to page
await session.send('Page.navigate', { url: 'https://example.com' });
await new Promise(resolve => session.once('Page.loadEventFired', resolve));

// Extract data with complex types
const data = await session.evaluate(() => {
  return {
    title: document.title,
    links: Array.from(document.querySelectorAll('a')).map(a => ({
      href: a.href,
      text: a.textContent,
      timestamp: new Date()
    })),
    images: Array.from(document.querySelectorAll('img')).map(img => ({
      src: img.src,
      alt: img.alt,
      dimensions: { width: img.width, height: img.height }
    }))
  };
});
```

### Testing and Automation

```ts
const session = attach(window.webContents, '1.3');
await session.setup({
  preloadSuperJSON: true,
  autoAttachToRelatedTargets: true
});

// Fill form with complex data
const formData = {
  username: 'test',
  password: 'secret',
  preferences: new Map([['theme', 'dark'], ['notifications', true]]),
  lastLogin: new Date()
};

await session.evaluate((data) => {
  document.querySelector('#username').value = data.username;
  document.querySelector('#password').value = data.password;
  document.querySelector('#preferences').value = JSON.stringify(data.preferences);
  document.querySelector('#login-form').submit();
}, formData);

// Wait for navigation and handle iframes
session.on('session-attached', (newSession) => {
  if (newSession.target.type === 'iframe') {
    console.log('Iframe detected:', newSession.target.initialURL);
  }
});
```

### Performance Monitoring

```ts
const session = attach(window.webContents, '1.3');
await session.setup({
  trackExecutionContexts: true,
  autoAttachToRelatedTargets: ['worker', 'service_worker']
});

// Enable performance monitoring
await session.send('Performance.enable');
await session.send('Runtime.enable');

// Listen for performance metrics
session.on('Performance.metrics', (params) => {
  console.log('Performance metrics:', params.metrics);
});

// Monitor service worker performance
session.on('service-worker-restarted', (session) => {
  console.log('Service worker restarted:', session.id);
});

// Get memory usage with complex data
const memory = await session.evaluate(() => {
  const memInfo = performance.memory;
  return {
    used: memInfo.usedJSHeapSize,
    total: memInfo.totalJSHeapSize,
    limit: memInfo.jsHeapSizeLimit,
    timestamp: new Date(),
    contexts: Array.from(document.querySelectorAll('iframe')).length
  };
});
```

## Troubleshooting

### Common Issues

**1. CDP Connection Failed**
```ts
// Ensure debugger is attached
if (!webContents.debugger.isAttached()) {
  webContents.debugger.attach('1.3');
}
```

**2. Function Execution Timeout**
```ts
// Increase timeout for long-running functions
const result = await session.evaluate({ timeout: 30000 }, () => {
  // Long-running operation
}); // 30 seconds
```

**3. Serialization Issues**
```ts
// Preload SuperJSON for complex data types
await session.enableSuperJSONPreload();
const result = await session.evaluate((data) => {
  return new Map(Object.entries(data));
}, { key: 'value' });
```

## Requirements

- Node.js 22.12+ for the current Electron 42 development/test setup
- Electron 42+
- TypeScript 5.4+ for TypeScript projects

## License

ISC

## Documentation

- [API Reference](docs/API.md) - Complete API documentation
- [Changelog](CHANGELOG.md) - Version history and changes

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Best Practices

### Session Management
```ts
// Always check if session is attached before using
if (session.id) {
  // Session is attached to a specific target
  console.log('Session ID:', session.id);
}

// Use proper cleanup
process.on('beforeExit', async () => {
  await session.detach();
});
```

### Error Handling
```ts
try {
  const result = await session.evaluate(() => {
    // Your code here
  });
} catch (error) {
  if (error.message.includes('target closed')) {
    console.log('Target was closed, session may be detached');
  } else {
    console.error('Execution error:', error);
  }
}
```

### Performance Optimization
```ts
// Enable SuperJSON preloading for better performance
const session = attach(window.webContents, '1.3');
await session.setup({
  preloadSuperJSON: true
});

// Use execution context tracking only when needed
const session = attach(window.webContents, '1.3');
await session.setup({
  trackExecutionContexts: true
});

// Customize SuperJSON for better serialization
const session = attach(window.webContents, '1.3');
await session.setup({
  preloadSuperJSON: (superJSON) => {
    // Register custom transformers for your data types
    superJSON.registerCustom({
      isApplicable: (v) => v instanceof MyCustomClass,
      serialize: (v) => v.toJSON(),
      deserialize: (v) => MyCustomClass.fromJSON(v)
    });
  }
});
```

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for a detailed list of changes and version history.
