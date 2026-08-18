# icc

**Inter-Component Communication** — a tiny, strongly typed, zero-dependency event bus for the browser, modelled after the Electron IPC API.

Components that sit far apart in the tree often need to talk: a toast triggered from a service, a cart badge updated from a product card, a modal closed from a router guard. Lifting state up, threading callbacks through five layers, or reaching for a full state manager is usually more machinery than the problem deserves. `icc` gives those components one shared channel registry with the API you already know from Electron.

- **Zero dependencies.** Nothing in `dependencies`, ever.
- **Two obvious halves.** `send` / `on` when nobody answers, `invoke` / `handle` when somebody does.
- **Strongly typed.** Declare your channels once and get autocompletion, payload checking and inferred responses everywhere.
- **Documented where you read it.** Every method, option and type carries JSDoc with examples, so hovering in the IDE is enough — no tab to the docs.
- **Framework agnostic.** Works with React, Vue, Angular, Svelte or no framework at all.
- **Small and portable.** Under 2 KB minified and gzipped, compiled all the way down to **ES5**, no polyfill needed beyond `Promise`.

## Installation

```bash
npm install icc
```

## Quick start

```ts
import icc from 'icc';

// Somewhere in a header component
const off = icc.on('cart:item-added', (item) => {
  console.log(item.id, item.qty);
});

// Somewhere in a product card, with no relation to the header
icc.send('cart:item-added', { id: 'sku-1', qty: 2 });

// When the component goes away
off();
```

## Which half do I want?

|  | Broadcast | Request |
| --- | --- | --- |
| Question it answers | "this happened" | "what is the value of …?" |
| Registration | `on` / `once` | `handle` / `handleOnce` |
| Sending | `send` / `sendSync` | `invoke` |
| Receivers | any number | exactly one |
| Result | none, `send` returns `void` | always a `Promise` |

That split is the whole mental model, and it removes the two questions an event emitter usually raises:

- **Is it async?** A broadcast never is — `send` returns nothing and there is nothing to await. A request always is — `invoke` returns a promise even when the handler is synchronous, so the call site never has to know how the other side is written.
- **How do I do this once?** Every registration has a dedicated one-shot method (`once`, `handleOnce`) and an equivalent option (`{ once: true }`). Pick whichever reads better; they do the same thing.

```ts
icc.handle('user:fetch', async (id) => {
  const response = await fetch(`/api/users/${id}`);
  return response.json();
});

const user = await icc.invoke('user:fetch', 'u_42');
```

Need to await an event rather than handle it? `waitFor` is the promise-shaped `once`:

```ts
await icc.waitFor('app:ready', { timeout: 5_000 });
```

## Typing your channels

Declare your channels once and every call site becomes type safe. Events map a channel to its payload; requests map a channel to a `(request) => response` signature.

```ts
// icc.d.ts
import type { User } from './types';

declare module 'icc' {
  interface IccEvents {
    'cart:item-added': { id: string; qty: number };
    'modal:close': void; // a channel without payload
  }

  interface IccRequests {
    'user:fetch': (id: string) => User;
    'app:version': () => string;
  }
}
```

```ts
icc.send('cart:item-added', { id: 'sku-1', qty: 2 }); // ok
icc.send('cart:item-added');                          // error: payload is required
icc.send('modal:close');                              // ok, no payload declared
icc.send('cart:removed', {});                         // error: unknown channel

const user = await icc.invoke('user:fetch', 'u_42');  // user is User
```

Until those interfaces are augmented, every channel is accepted with an `unknown` payload, so the library is usable straight away and becomes stricter as you declare more.

Prefer explicit generics over a global declaration? Create your own bus:

```ts
import { createIcc } from 'icc';

const bus = createIcc<MyEvents, MyRequests>();
```

## Depending on less than the whole bus

The bus is described by three role interfaces, so a unit can accept the slice it actually uses — and a test can hand it a stub of that slice instead of a full bus:

```ts
import type { IccBus, IccEventBus, IccRequestBus } from 'icc';

function trackCart(bus: IccEventBus): void { /* only publishes and subscribes */ }
function serveUsers(bus: IccRequestBus): void { /* only answers requests */ }
function wireApp(bus: IccBus): void { /* needs both */ }
```

## Automatic cleanup

Every registration returns a disposer, and every registration also accepts an `AbortSignal` (or the `AbortController` itself). One controller can tear down an entire component at once:

```ts
const controller = new AbortController();

icc.on('theme:change', applyTheme, { signal: controller });
icc.on('modal:close', closeModal, { signal: controller });
icc.handle('form:validate', validate, { signal: controller });

controller.abort(); // all three are gone
```

## Framework recipes

### React

```tsx
import { useEffect, useState } from 'react';
import icc from 'icc';

function CartBadge() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    icc.on('cart:item-added', (item) => setCount((c) => c + item.qty), { signal: controller });

    return () => controller.abort();
  }, []);

  return <span>{count}</span>;
}
```

### Vue

```ts
import { onScopeDispose, ref } from 'vue';
import icc from 'icc';

export function useCartCount() {
  const count = ref(0);
  const off = icc.on('cart:item-added', (item) => { count.value += item.qty; });

  onScopeDispose(off);

  return count;
}
```

### Angular

```ts
@Component({ /* ... */ })
export class CartBadgeComponent implements OnInit, OnDestroy {
  private readonly controller = new AbortController();
  count = 0;

  ngOnInit(): void {
    icc.on('cart:item-added', (item) => { this.count += item.qty; }, { signal: this.controller });
  }

  ngOnDestroy(): void {
    this.controller.abort();
  }
}
```

## API

### Events — `IccEventBus`

| Method | Description |
| --- | --- |
| `on(channel, listener, options?)` | Subscribes to a channel. Returns a disposer. |
| `once(channel, listener, options?)` | Subscribes to the next emission only. |
| `off(channel, listener)` | Removes a listener by reference. Returns whether one was found. |
| `send(channel, payload?)` | Broadcasts once the current call stack unwinds. |
| `sendSync(channel, payload?)` | Broadcasts before the call returns. |
| `waitFor(channel, options?)` | Resolves with the payload of the next emission. |

`options` accepts `{ once?: boolean; signal?: AbortSignal | AbortController }`, and `waitFor` adds `{ timeout?: number }`.

Dispatch is deferred by default so an emit never re-enters the emitting component mid-render. Listeners run over a snapshot of the list: subscribing or unsubscribing from inside a listener is safe and takes effect immediately. A listener that throws is reported to `onError` (which defaults to `console.error`) and the remaining listeners still run.

### Requests — `IccRequestBus`

| Method | Description |
| --- | --- |
| `handle(channel, handler, options?)` | Registers the single responder of a channel. Returns a disposer. |
| `handleOnce(channel, handler, options?)` | Registers a responder that answers one request. |
| `invoke(channel, request?)` | Calls the handler and resolves with its result. |
| `hasHandler(channel)` | Whether the channel currently has a handler. |
| `removeHandler(channel)` | Removes the handler, keeping the listeners intact. |

Registering a second handler replaces the first. `invoke` rejects with an `IccError` carrying `code: 'ERR_ICC_NO_HANDLER'` when nothing is registered, and forwards whatever the handler throws or rejects with — handler failures belong to the caller, so they are never swallowed into the console.

### Registry — `IccChannelAdmin`

| Method | Description |
| --- | --- |
| `listenerCount(channel?)` | Listener count for one channel, or for the whole bus. |
| `channelNames()` | Every channel name currently known to the bus. |
| `removeAllListeners(channel?)` | Removes the listeners of one channel, or of all of them. |
| `removeChannels(...channels)` | Drops the given channels entirely, listeners and handler alike. |
| `clear()` | Resets the bus to its initial state. |

### Instances

| Export | Description |
| --- | --- |
| `icc` (also the default export) | The application-wide bus, shared by every module that imports it. |
| `createIcc<E, R>(options?)` | Creates an isolated bus, useful per feature or per test. |
| `Icc` | The class itself, for `instanceof` checks and subclassing. |

`options` accepts:

| Option | Default | Description |
| --- | --- | --- |
| `onError` | logs to `console.error` | Where a listener failure is reported. |
| `scheduler` | `queueMicrotask` | Decides when a deferred broadcast runs. |

```ts
// Synchronous dispatch, so a test needs no await
const bus = createIcc({ scheduler: (task) => task() });
```

## Architecture

```
src/
  types/       every public type, implementation-free
    channels.ts    the channel vocabulary and the helpers deriving arguments from it
    handlers.ts    listeners, handlers, disposers, registration options
    options.ts     the seams: Scheduler, ErrorReporter
    errors.ts      IccError and its codes
    contracts.ts   IccEventBus / IccRequestBus / IccChannelAdmin / IccBus
  internal/    one concern per file
    channel-registry.ts  storage of channels, and nothing else
    event-dispatcher.ts  subscription bookkeeping and dispatch
    request-broker.ts    one responder per channel, one answer per call
    scheduler.ts         the default deferral strategy
    signals.ts           AbortSignal wiring
    errors.ts            error construction and the default reporter
  icc.ts       the Icc facade, composing the three collaborators
  index.ts     public entry: createIcc, the shared instance, the types
scripts/
  downlevel.mjs   transpiles the bundles to ES5 and chains their source maps
  verify-es5.mjs  fails the build if anything newer than ES5 survived
```

The class holds no dispatch logic of its own: it composes a registry, a dispatcher and a broker, and hands the last two their timing and reporting strategies through the constructor. That is why `scheduler` and `onError` are options rather than globals — the bus never reaches for `queueMicrotask` or `console` by itself, which is also what makes it trivial to drive deterministically in a test.

Reading `src/types/` is meant to be enough to understand the whole mechanism, without opening a single implementation file.

## Browser support

The published bundles are **ES5**: no `const`, no arrow functions, no classes, nothing an older engine has to be taught. The build fails if a single ES6 construct survives, and the test suite asserts the same thing independently.

The runtime API surface is just as conservative. Nothing newer than ES5 is used except `Promise`, which the request half inherently needs — `Map`, `Set`, `Symbol` and iterators are all absent, which the suite also enforces by scanning the bundle. `queueMicrotask` is used when available and falls back to the promise job queue, then to `setTimeout`. `AbortSignal` is entirely optional: the disposers work without it, and a legacy `onabort`-only signal is handled too.

In practice that means the broadcast half runs anywhere down to IE9, and the request half runs anywhere a `Promise` exists — natively or through any polyfill you already ship.

Both ESM (`dist/index.mjs`) and CommonJS (`dist/index.cjs`) builds ship with their own type definitions and source maps that point back at the original TypeScript.

## Testing

```bash
npm test
```

That builds the package and runs the whole suite — 187 runtime tests plus the type-level ones — in one pass. The suite is deliberately spread across environments, because a component bus that only works in one of them is not framework agnostic:

| Suite | Environment | What it guards |
| --- | --- | --- |
| `event-bus`, `request-bus`, `wait-for`, `registry`, `abort-signal`, `error-reporting`, `scheduler` | Node, no DOM | Dispatch order, disposer identity, re-entrancy, one-shot semantics, failure routing, hostile channel names |
| `framework-agnostic` | Node, no DOM | React, Vue, Angular and Svelte teardown shapes, driven without any of those frameworks |
| `dom-environment` | jsdom | Real DOM events, a controller shared with `addEventListener`, the shared instance on `window` |
| `bare-realm` | a fresh `node:vm` realm | The built bundle with no `queueMicrotask`, no `Promise`, no `console`, no `require` and no DOM |
| `package-output` | Node | Both builds, their type definitions, and the manifest that points at them |
| `types.test-d` | `tsc` | Payload inference, response inference, and every call that must *not* compile |

The bare realm is the strictest of them: the bundle is evaluated with nothing but the globals it is handed, which is what proves the scheduler fallback chain, the absence of runtime dependencies, and that exactly one global — the versioned bus key — is ever published.

```bash
npm run test:watch
```

```bash
npm run test:coverage
```

## Development

```bash
npm install
npm run build      # bundle, downlevel to ES5, then verify the result really is ES5
npm run dev        # rebuilds on change
npm run typecheck  # tsc --noEmit over src
npm run test:types # the type-level suite on its own
```

### Code style

`src/` is written in modern TypeScript — ES6 and above, arrow functions throughout, no `function` keyword anywhere. Class methods stay method shorthand rather than arrow-valued class fields, so they live on the prototype and a subclass can still override them and call `super`.

### How ES5 output is produced

esbuild, which tsup builds on, cannot emit ES5 at all: pointed at that target it refuses on `const` before it even reaches a class. The pipeline therefore splits the work:

1. **tsup** bundles `src/` into one ESM and one CJS file at esbuild's floor, and emits the type definitions;
2. **`scripts/downlevel.mjs`** hands the last step to TypeScript, whose ES5 emit predates all of this, and chains the two source maps so the published map still points at the original `.ts`;
3. **`scripts/verify-es5.mjs`** re-parses both bundles at an ES5 target — using esbuild's refusal as the check — and fails the build if anything newer survived.

The same guarantee is asserted from the test suite, so it cannot regress quietly.

## License

[MIT](LICENSE) © Ali Yaghoubi
