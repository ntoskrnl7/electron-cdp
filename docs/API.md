# API Reference

This document provides a comprehensive reference for all public APIs in electron-cdp-utils.

## Table of Contents

- [MainSession Class](#mainsession-class)
- [Session Class](#session-class)
- [ExecutionContext Class](#executioncontext-class)
- [Attach Function](#attach-function)
- [Utility Functions](#utility-functions)
- [Type Definitions](#type-definitions)
- [Interfaces](#interfaces)
- [Events](#events)

## MainSession Class

The main interface for CDP communication with enhanced setup capabilities. Extends the base `Session` class.

### Constructor

```ts
constructor(webContents: WebContents, sessionId?: Protocol.Target.SessionID, protocolVersion?: string)
```

Creates a new MainSession instance bound to a specific WebContents.

### Methods

#### `setup(options?: MainSessionSetupOptions): Promise<void>`

Configures the session with comprehensive options.

**Parameters:**
- `options` - Optional configuration options for the session

**Options:**
- `preloadSuperJSON?: boolean | ((superJSON: SuperJSON) => void)` - SuperJSON configuration
- `trackExecutionContexts?: boolean` - Enable execution context tracking
- `autoAttachToRelatedTargets?: boolean | TargetType[]` - Auto attachment configuration

**Behavior:**
- Sets up WebFrameMain integration
- Configures SuperJSON preloading if enabled
- Enables execution context tracking if specified
- Sets up auto target attachment if specified
- Injects global scripts for frame communication

**Example:**
```ts
const session = new MainSession(window.webContents, undefined, '1.3');
await session.setup({
  preloadSuperJSON: true,
  trackExecutionContexts: true,
  autoAttachToRelatedTargets: ['iframe', 'worker', 'service_worker']
});
```

### Properties

Inherits all properties from the base `Session` class.

## Session Class

The base interface for CDP communication.

### Constructor

```ts
constructor(webContents: WebContents, sessionId?: Protocol.Target.SessionID, protocolVersion?: string)
```

Creates a new Session instance bound to a specific WebContents.

### Methods

#### `send<T extends keyof ProtocolMapping.Commands>(method: T, params?: ProtocolMapping.Commands[T]['paramsType'][0]): Promise<ProtocolMapping.Commands[T]['returnType']>`

Sends a command to the browser's DevTools protocol with full type safety.

**Type Parameters:**
- `T` - The CDP command method name (e.g., 'Page.enable', 'Runtime.evaluate')

**Parameters:**
- `method` - The CDP method name with full type checking
- `params` - Command parameters with type-safe parameter structure

**Returns:** Promise that resolves with the typed command response

**Throws:**
- `Error` - If debugger is not attached

**Examples:**
```ts
// Page commands
await session.send('Page.enable');
const title = await session.send('Page.getTitle');

// Runtime commands with parameters
const result = await session.send('Runtime.evaluate', {
  expression: '1 + 1',
  returnByValue: true
});

// Type-safe parameters and return values
const response: Protocol.Runtime.EvaluateResponse = await session.send('Runtime.evaluate', {
  expression: 'document.title',
  returnByValue: true
});
```

#### `evaluate<T, A extends unknown[]>(fn: (...args: A) => T, ...args: A): Promise<T>`

Executes a function in the browser context with full type safety and SuperJSON serialization.

**Type Parameters:**
- `T` - The return type of the function
- `A` - The argument types of the function

**Parameters:**
- `fn` - The function to execute in the browser context
- `...args` - Arguments to pass to the function (automatically serialized with SuperJSON)

**Returns:** Promise that resolves with the function result (automatically deserialized)

**Throws:**
- `Error` - If function execution fails or throws an error
- `Error` - If serialization/deserialization fails

**Examples:**
```ts
// Simple function execution
const result = await session.evaluate(() => {
  return document.title;
});

// Function with parameters
const data = await session.evaluate((message: string) => {
  console.log(message);
  return window.location.href;
}, 'Hello from browser!');

// Complex data types (automatically handled by SuperJSON)
const result = await session.evaluate((userData: { name: string; createdAt: Date }) => {
  return {
    ...userData,
    processedAt: new Date()
  };
}, { name: 'John', createdAt: new Date() });
```

#### `exposeFunction<T, A extends unknown[]>(name: string, fn: (...args: A) => Promise<T> | T, options?: ExposeFunctionOptions): Promise<void>`

Exposes a Node.js function to the browser's global context with advanced options.

**Type Parameters:**
- `T` - The return type of the function
- `A` - The argument types of the function

**Parameters:**
- `name` - The name under which the function will be exposed (supports dot notation for nested objects)
- `fn` - The function to expose (can be async or sync)
- `options` - Optional settings for exposing the function

**Options:**
- `mode?: 'Electron' | 'CDP'` - Detection method (default: 'Electron')
- `withReturnValue?: boolean | WithReturnValueOptions` - Whether to await return values
- `retry?: boolean | RetryOptions` - Retry configuration for failed calls

**Throws:**
- `Error` - If function exposure fails
- `Error` - If CDP binding setup fails

**Examples:**
```ts
// Simple function exposure
await session.exposeFunction('getSystemInfo', () => {
  return {
    platform: process.platform,
    version: process.version
  };
});

// Function with options
await session.exposeFunction('complexOperation', async (data: any) => {
  // Complex operation here
  return processedData;
}, {
  mode: 'CDP',
  withReturnValue: true,
  retry: { count: 3, delay: 1000 }
});

// Nested function exposure
await session.exposeFunction('utils.formatDate', (date: Date) => {
  return date.toISOString();
});
```

#### `enableSuperJSONPreload(customize?: (superJSON: SuperJSON) => void): Promise<void>`

Enables SuperJSON to be preloaded into all contexts for better performance.

**Parameters:**
- `customize` - Optional callback to customize SuperJSON instance before setup

**Behavior:**
- Injects SuperJSON script into all existing and future execution contexts
- Sets up automatic SuperJSON loading for new frames and contexts
- Falls back to frame-level injection if page-level injection fails

**Throws:**
- `Error` - If SuperJSON injection fails (logged to console)

**Example:**
```ts
await session.enableSuperJSONPreload((superJSON) => {
  // Customize SuperJSON instance
  superJSON.registerCustom<Date, string>(
    {
      isApplicable: (v) => v instanceof Date,
      serialize: (v) => v.toISOString(),
      deserialize: (v) => new Date(v)
    },
    'Date'
  );
});
```

#### `configureSuperJSON(customize: (superJSON: SuperJSON) => void): Promise<void>`

Configures the SuperJSON instance with custom settings for preloaded contexts.

**Parameters:**
- `customize` - Callback function to customize SuperJSON instance

**Behavior:**
- Only works when SuperJSON is preloaded (`isSuperJSONPreloaded` is true)
- Applies customizations to all existing execution contexts
- Automatically enables SuperJSON preloading if not already enabled

**Throws:**
- `Error` - If SuperJSON is not preloaded and enabling fails

**Example:**
```ts
// Configure SuperJSON for preloaded contexts
await session.configureSuperJSON((superJSON) => {
  superJSON.registerCustom<Map<any, any>, [any, any][]>(
    {
      isApplicable: (v) => v instanceof Map,
      serialize: (v) => Array.from(v.entries()),
      deserialize: (v) => new Map(v)
    },
    'Map'
  );
});
```

#### `setAutoAttach(options?: SetAutoAttachOptions): Promise<boolean>`

Enables automatic attachment to related targets like iframes, workers, and other browser contexts.

**Parameters:**
- `options` - Optional settings for auto attachment

**Options:**
- `targetTypes?: TargetType[]` - Specific target types to attach to
- `recursive?: boolean` - Whether to recursively attach to targets created by attached targets

**Returns:** Promise that resolves to `true` if enabled, `false` if already enabled

**Behavior:**
- Sends `Target.setAutoAttach` CDP command
- Sets up event listeners for target lifecycle events
- Automatically attaches to new targets of specified types
- Emits `session-attached` and `session-detached` events

**Throws:**
- `Error` - If auto attachment setup fails

**Example:**
```ts
// Attach to all related targets
await session.setAutoAttach({ recursive: true });

// Attach only to specific target types
await session.setAutoAttach({
  targetTypes: ['iframe', 'worker', 'shared_worker'],
  recursive: false
});
```

#### `enableTrackExecutionContexts(): Promise<boolean>`

Enables tracking of execution contexts with real-time monitoring.

**Returns:** Promise that resolves to `true` if enabled, `false` if already enabled

**Behavior:**
- Sends `Runtime.enable` CDP command
- Sets up event listeners for execution context lifecycle events
- Maintains a map of active execution contexts in `executionContexts` property
- Emits `execution-context-created`, `execution-context-destroyed`, and `execution-contexts-cleared` events

**⚠️ Caution:** `Runtime.enable` can be detected by bots and anti-automation systems.

**Throws:**
- `Error` - If execution context tracking setup fails

**Example:**
```ts
await session.enableTrackExecutionContexts();

// Access tracked execution contexts
console.log('Active contexts:', session.executionContexts.size);

// Listen for context events
session.on('execution-context-created', (context) => {
  console.log('New context:', context.id);
});
```

#### `getTargetInfo(): Promise<Protocol.Target.TargetInfo>`

Gets information about the target associated with this session.

**Returns:** Promise that resolves with target information

#### `detach(): Promise<void>`

Detaches the debugger from the browser window.

#### `equals(other: Session): boolean`

Compares this session with another session for equality.

**Parameters:**
- `other` - The session to compare with

**Returns:** `true` if the sessions are equal, `false` otherwise

### Properties

#### `id?: Protocol.Target.SessionID`

Session ID (if attached to specific target).

#### `webContents: WebContents`

Associated WebContents instance.

#### `executionContexts: Map<Protocol.Runtime.ExecutionContextId, ExecutionContext>`

Map of available execution contexts.

#### `superJSON: SuperJSON`

SuperJSON instance for serialization.

#### `isSuperJSONPreloaded: boolean`

Whether SuperJSON is preloaded in the web contents.

#### `trackExecutionContextsEnabled: boolean`

Whether execution context tracking is enabled.

#### `autoAttachToRelatedTargetsEnabled: boolean`

Whether auto attachment to related targets is enabled.

#### `target: Target`

Target information (throws if not initialized).

## ExecutionContext Class

Represents an execution context in the browser.

### Constructor

```ts
constructor(session: Session, idOrDescription?: Protocol.Runtime.ExecutionContextId | Protocol.Runtime.ExecutionContextDescription)
```

### Methods

#### `evaluate<T, A extends unknown[]>(fn: (...args: A) => T, ...args: A): Promise<T>`

Executes a function in the specific execution context.

**Parameters:**
- `fn` - The function to execute
- `...args` - Arguments to pass to the function

**Returns:** Promise that resolves with the function result

**Example:**
```ts
const context = session.executionContexts.get(contextId);
const result = await context.evaluate(() => {
  return window.location.href;
});
```

### Properties

#### `session: Session`

The CDP session associated with this execution context.

#### `id?: Protocol.Runtime.ExecutionContextId`

The ID of the execution context.

#### `description?: Protocol.Runtime.ExecutionContextDescription`

The description of the execution context.

## Attach Function

```ts
attach(target: WebContents, protocolVersion?: string): MainSession
```

Attaches CDP functionality to a WebContents instance and returns a MainSession.

**Parameters:**
- `target` - The WebContents instance to attach to
- `protocolVersion` - Optional CDP protocol version (default: latest)

**Returns:** MainSession instance ready for configuration

**Behavior:**
- Creates a new MainSession instance
- Attaches the session to the WebContents
- Sets up the `webContents.cdp` property for convenient access
- Throws error if a session is already attached

**Example:**
```ts
// Basic usage
const session = attach(window.webContents, '1.3');
await session.setup({
  preloadSuperJSON: true,
  trackExecutionContexts: true,
  autoAttachToRelatedTargets: ['page', 'iframe', 'worker']
});

// Using the convenient cdp property
await window.webContents.cdp.send('Page.enable');
```

## Utility Functions

### `isAttached`

```ts
isAttached(target: WebContents): boolean
```

Checks if a CDP session is already attached to the WebContents.

**Parameters:**
- `target` - The WebContents instance to check

**Returns:** `true` if a session is attached, `false` otherwise

**Example:**
```ts
if (isAttached(window.webContents)) {
  console.log('CDP session already attached');
} else {
  const session = attach(window.webContents, '1.3');
  await session.setup();
}
```

## Type Definitions

### `SessionWithId`

A session with a guaranteed session ID.

```ts
type SessionWithId = Session & { id: Protocol.Target.SessionID };
```

### `DetachedSession`

A detached session with limited functionality.

```ts
type DetachedSession = Pick<Session, 
  | 'id' 
  | 'target' 
  | 'webContents' 
  | 'executionContexts'
  | 'superJSON'
  | 'isSuperJSONPreloaded'
  | 'trackExecutionContextsEnabled'
  | 'autoAttachToRelatedTargetsEnabled'
  | 'equals'
>;
```

### `DetachedSessionWithId`

A detached session with a guaranteed session ID.

```ts
type DetachedSessionWithId = DetachedSession & { id: Protocol.Target.SessionID };
```

### `FrameId`

Stable identifier for an Electron frame.

```ts
type FrameId = `${number}-${number}`;
```

## Interfaces

### `MainSessionSetupOptions`

Options for setting up a MainSession.

```ts
interface MainSessionSetupOptions {
  preloadSuperJSON?: boolean | ((superJSON: SuperJSON) => void);
  trackExecutionContexts?: boolean;
  autoAttachToRelatedTargets?: boolean | TargetType[];
}
```

### `SessionOptions`

Options for creating a Session.

```ts
interface SessionOptions {
  protocolVersion?: string;
  trackExecutionContexts?: boolean;
  autoAttachToRelatedTargets?: boolean | TargetType[];
  preloadSuperJSON?: boolean | ((superJSON: SuperJSON) => void);
}
```

### `SetAutoAttachOptions`

Options for setting auto attach.

```ts
interface SetAutoAttachOptions {
  targetTypes?: TargetType[];
  recursive?: boolean;
}
```

### `ExposeFunctionOptions`

Options for exposing a function.

```ts
interface ExposeFunctionOptions {
  mode?: 'Electron' | 'CDP';
  withReturnValue?: boolean | WithReturnValueOptions;
  retry?: boolean | RetryOptions;
}
```

### `EvaluateOptions`

Options for function evaluation (extends CDP Runtime.evaluate parameters).

```ts
type EvaluateOptions = Omit<Protocol.Runtime.EvaluateRequest, 
  | 'contextId' 
  | 'uniqueContextId' 
  | 'expression' 
  | 'throwOnSideEffect' 
  | 'awaitPromise' 
  | 'replMode' 
  | 'returnByValue' 
  | 'generatePreview' 
  | 'serializationOptions' 
  | 'objectGroup'
>;
```

**Available Options:**
- `timeout?: number` - Maximum execution time in milliseconds
- `silent?: boolean` - Whether to suppress console output
- `includeCommandLineAPI?: boolean` - Whether to include command line API
- `userGesture?: boolean` - Whether to treat as user gesture
- `awaitPromise?: boolean` - Whether to await promises (always true)
- `returnByValue?: boolean` - Whether to return by value (always false)
- `generatePreview?: boolean` - Whether to generate preview (always false)

### `WithReturnValueOptions`

Options for awaiting function call results.

```ts
interface WithReturnValueOptions {
  timeout?: number;
  delay?: number;
}
```

### `RetryOptions`

Options for retrying function calls.

```ts
interface RetryOptions {
  count?: number;
  delay?: number;
}
```

### `Target`

Target information with enhanced properties.

```ts
interface Target extends Omit<Protocol.Target.TargetInfo, 'url' | 'title' | 'type' | 'targetId'> {
  type: 'tab' | 'page' | 'iframe' | 'worker' | 'shared_worker' | 'service_worker' | 'worklet' | 'shared_storage_worklet' | 'browser' | 'webview' | 'other' | 'auction_worklet' | 'assistive_technology';
  id: Protocol.Target.TargetID;
  initialURL: string;
}
```

### `ServiceWorkerVersion`

Enhanced service worker version with scope URL information.

```ts
type ServiceWorkerVersion = Protocol.ServiceWorker.ServiceWorkerVersion & { 
  scopeURL?: string 
};
```

## Events

The Session class extends EventEmitter and emits the following events:

### CDP Events

All standard CDP events are supported:

```ts
session.on('Runtime.consoleAPICalled', (params) => {
  console.log('Console message:', params);
});

session.on('Page.loadEventFired', () => {
  console.log('Page loaded!');
});
```

### Custom Events

#### `session-attached`

Emitted when a new session is attached.

```ts
session.on('session-attached', (newSession: SessionWithId, url: string) => {
  console.log('New session attached:', newSession.id, url);
});
```

#### `session-detached`

Emitted when a session is detached.

```ts
session.on('session-detached', (detachedSession: DetachedSessionWithId, reason: string) => {
  console.log('Session detached:', detachedSession.id, reason);
});
```

#### `execution-context-created`

Emitted when a new execution context is created.

```ts
session.on('execution-context-created', (context: ExecutionContext) => {
  console.log('New execution context:', context.id);
});
```

#### `execution-context-destroyed`

Emitted when an execution context is destroyed.

```ts
session.on('execution-context-destroyed', (event: Protocol.Runtime.ExecutionContextDestroyedEvent) => {
  console.log('Execution context destroyed:', event.executionContextId);
});
```

#### `execution-contexts-cleared`

Emitted when all execution contexts are cleared.

```ts
session.on('execution-contexts-cleared', () => {
  console.log('All execution contexts cleared');
});
```

#### `service-worker-running-status-changed`

Emitted when a service worker's running status changes.

```ts
session.on('service-worker-running-status-changed', (event: { runningStatus: string; versionId: number }, session: SessionWithId) => {
  console.log('Service worker status changed:', event.runningStatus);
  console.log('Version ID:', event.versionId);
});
```

#### `service-worker-version-updated`

Emitted when a service worker version is updated.

```ts
session.on('service-worker-version-updated', (version: ServiceWorkerVersion, session: SessionWithId) => {
  console.log('Service worker updated:', version.versionId);
  console.log('Scope URL:', version.scopeURL);
});
```

## Error Handling

The library provides comprehensive error handling:

### Common Error Types

- **Target closed errors**: When the target is closed while executing commands
- **Context not found errors**: When execution context is not available
- **Serialization errors**: When data cannot be serialized/deserialized
- **Timeout errors**: When operations exceed the specified timeout

### Error Handling Example

```ts
try {
  const result = await session.evaluate(() => {
    // Your code here
  });
} catch (error) {
  if (error.message.includes('target closed')) {
    console.log('Target was closed, session may be detached');
  } else if (error.message.includes('Cannot find context')) {
    console.log('Execution context not found');
  } else {
    console.error('Execution error:', error);
  }
}
```
