# electron-cdp-utils

A powerful TypeScript library that simplifies Chrome DevTools Protocol (CDP) usage in Electron applications. This library provides an intuitive API for interacting with browser contexts, executing functions, and managing complex data serialization.

## Features

- 🚀 **Easy CDP Integration**: Simple API for Chrome DevTools Protocol commands
- 🔧 **Function Execution**: Execute TypeScript/JavaScript functions in browser contexts
- 📦 **SuperJSON Support**: Advanced serialization for complex data types (Date, Map, Set, Error, Buffer, etc.)
- 🎯 **Type Safety**: Full TypeScript support with comprehensive type definitions
- 🔄 **Frame Management**: Support for iframes and multiple execution contexts
- ⚡ **Event Handling**: Built-in event system for CDP events
- 🛠️ **Function Exposure**: Expose Node.js functions to browser contexts
- 🔍 **Execution Context Tracking**: Monitor and manage browser execution contexts

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

// Attach CDP functionality
const session = await attach(window.webContents);

// Use CDP commands
await session.send('Page.enable');
await session.send('Page.setBypassCSP', { enabled: true });
await session.send('Runtime.enable');
```

### Using the Convenient WebContents Extension

```ts
import { attach } from 'electron-cdp-utils';

const window = new BrowserWindow({...});
await attach(window.webContents);

// Now you can use the convenient cdp property
await window.webContents.cdp.send('Page.enable');
await window.webContents.cdp.send('Page.setBypassCSP', { enabled: true });
```

## Core Concepts

### Session Management

The `Session` class is the main interface for CDP communication:

```ts
import { Session } from 'electron-cdp-utils';

// Create a session directly
const session = new Session(window.webContents);

// Or use the attach function for enhanced functionality
const session = await attach(window.webContents, {
  protocolVersion: '1.3',
  preloadSuperJSON: true
});
```

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

Listen to CDP events:

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
  retry: { count: 3, delay: 1000 }
});
```

## Advanced Features

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
  date: new Date(),
  buffer: Buffer.from('hello')
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

### Session Class

#### Methods

- `send<T>(method: string, params?: any): Promise<T>` - Send CDP command
- `evaluate<T, A extends unknown[]>(fn: (...args: A) => T, ...args: A): Promise<T>` - Execute function
- `exposeFunction(name: string, fn: Function, options?: ExposeFunctionOptions): Promise<void>` - Expose function
- `enableSuperJSON(customize?: (superJSON: SuperJSON) => void): Promise<void>` - Enable SuperJSON

#### Properties

- `executionContexts: Map<number, ExecutionContext>` - Available execution contexts
- `webContents: WebContents` - Associated WebContents
- `superJSON: SuperJSON` - SuperJSON instance

### ExecutionContext Class

#### Methods

- `evaluate<T, A extends unknown[]>(fn: (...args: A) => T, ...args: A): Promise<T>` - Execute in specific context

### Attach Function

```ts
attach(target: WebContents, options?: {
  protocolVersion?: string;
  preloadSuperJSON?: boolean | ((superJSON: SuperJSON) => void);
}): Promise<Session>
```

## TypeScript Support

The library provides comprehensive TypeScript definitions:

```ts
import { Protocol } from 'electron-cdp-utils';

// Use CDP protocol types
const result: Protocol.Runtime.EvaluateResponse = await session.send('Runtime.evaluate', {
  expression: '1 + 1'
});
```

## Requirements

- Node.js 14+
- Electron 13+
- TypeScript 4.5+ (for TypeScript projects)

## License

ISC

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
