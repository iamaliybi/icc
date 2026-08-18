# icc

**Inter-Component Communication** — a tiny, strongly typed, zero-dependency event bus for the browser, modelled after the Electron IPC API.

Components that sit far apart in the tree often need to talk: a toast triggered from a service, a cart badge updated from a product card, a modal closed from a router guard. Lifting state up, threading callbacks through five layers, or reaching for a full state manager is usually more machinery than the problem deserves. `icc` gives those components one shared channel registry with the API you already know from Electron.

- **Zero dependencies.** Nothing in `dependencies`, ever.
- **Strongly typed.** Declare your channels once and get autocompletion, payload checking and inferred responses everywhere.
- **Two communication styles.** `send` / `on` for broadcasts, `invoke` / `handle` for request–response.
- **Framework agnostic.** Works with React, Vue, Angular, Svelte or no framework at all.
- **Small and portable.** Under 1.5 KB minified and gzipped, ES2015 output, no polyfill needed beyond `Promise`.

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

Request–response works the same way, with a single responder per channel:

```ts
icc.handle('user:fetch', async (id) => {
  const response = await fetch(`/api/users/${id}`);
  return response.json();
});

const user = await icc.invoke('user:fetch', 'u_42');
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

### Events

| Method | Description |
| --- | --- |
| `on(channel, listener, options?)` | Subscribes to a channel. Returns a disposer. |
| `once(channel, listener, options?)` | Subscribes to the next emission only. |
| `off(channel, listener)` | Removes a listener by reference. Returns whether one was found. |
| `send(channel, payload?)` | Broadcasts to every listener on a microtask, after the current call stack unwinds. |
| `sendSync(channel, payload?)` | Broadcasts synchronously, before the call returns. |

`options` accepts `{ once?: boolean; signal?: AbortSignal | AbortController }`.

Dispatch is deferred by default so an emit never re-enters the emitting component mid-render. Listeners are dispatched over a snapshot of the list: subscribing or unsubscribing from inside a listener is safe and takes effect immediately.

A listener that throws is reported to `onError` (which defaults to `console.error`) and the remaining listeners still run.

### Requests

| Method | Description |
| --- | --- |
| `handle(channel, handler, options?)` | Registers the single responder of a channel. Returns a disposer. |
| `invoke(channel, request?)` | Calls the handler and resolves with its result. |
| `hasHandler(channel)` | Whether the channel currently has a handler. |
| `removeHandler(channel)` | Removes the handler, keeping the listeners intact. |

Registering a second handler replaces the first. `invoke` rejects with an `IccError` carrying `code: 'ERR_ICC_NO_HANDLER'` when nothing is registered, and forwards whatever the handler throws or rejects with — handler failures belong to the caller, so they are never swallowed into `console`.

### Registry

| Method | Description |
| --- | --- |
| `listenerCount(channel?)` | Listener count for one channel, or for the whole bus. |
| `channelNames()` | Every channel name currently known to the bus. |
| `removeAllListeners(channel?)` | Removes the listeners of one channel, or of all of them. |
| `removeChannel(...channels)` | Drops the given channels entirely, listeners and handler alike. |
| `clear()` | Resets the bus to its initial state. |

### Instances

| Export | Description |
| --- | --- |
| `icc` (also the default export) | The application-wide bus, shared by every module that imports it. |
| `createIcc<E, R>(options?)` | Creates an isolated bus, useful per feature or per test. |
| `Icc` | The class itself, for `instanceof` checks and subclassing. |

`options` accepts `{ onError?: (error, context) => void }`.

## Browser support

The published bundle targets ES2015 and touches no API newer than ES5 plus `Promise`, which the request API requires. `queueMicrotask` is used when available and falls back to the promise job queue, then to `setTimeout`. `AbortSignal` is entirely optional: the disposers work without it.

Both ESM (`dist/index.mjs`) and CommonJS (`dist/index.cjs`) builds ship with their own type definitions.

## Development

```bash
npm install
npm run build      # bundles ESM + CJS + type definitions into dist/
npm run dev        # rebuilds on change
npm run typecheck  # tsc --noEmit
npm test           # builds, then runs the suite against the built output
```

## License

[MIT](LICENSE) © Ali Yaghoubi
