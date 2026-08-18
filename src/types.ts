/**
 * Payload map for fire-and-forget events (`on` / `once` / `send`).
 *
 * Augment it from your application to get fully typed channels:
 *
 * ```ts
 * declare module 'icc' {
 *   interface IccEvents {
 *     'cart:item-added': { id: string; qty: number };
 *     'modal:close': void;
 *   }
 * }
 * ```
 *
 * While the interface is empty, every channel is accepted with an `unknown`
 * payload, so the library stays usable without any declaration at all.
 */
export interface IccEvents {}

/**
 * Signature map for request/response channels (`handle` / `invoke`).
 * Each entry is written as a function: parameters describe the request,
 * the return type describes the response.
 *
 * ```ts
 * declare module 'icc' {
 *   interface IccRequests {
 *     'user:fetch': (id: string) => User;
 *     'app:version': () => string;
 *   }
 * }
 * ```
 */
export interface IccRequests {}

/**
 * Constraint for event maps. Written self-referentially (`E extends EventMap<E>`)
 * so plain `interface` declarations are accepted: requiring `Record<string, ...>`
 * would reject every interface, which is exactly what users augment.
 */
export type EventMap<E> = Record<keyof E, any>;

/** Constraint for request maps: every entry must be a `(request) => response` signature. */
export type RequestMap<R> = Record<keyof R, (...args: any[]) => any>;

/** Falls back to a permissive map while {@link IccEvents} has not been augmented. */
export type ResolvedEvents = [keyof IccEvents] extends [never] ? Record<string, unknown> : IccEvents;

/** Falls back to a permissive map while {@link IccRequests} has not been augmented. */
export type ResolvedRequests = [keyof IccRequests] extends [never]
	? Record<string, (payload?: any) => unknown>
	: IccRequests;

/** Usable channel names of a map (symbol/number keys are not supported). */
export type Channel<M> = Extract<keyof M, string>;

/** Makes the payload argument optional when the channel carries no data. */
export type EventArgs<P> = [P] extends [void] ? [payload?: undefined] : [payload: P];

/** Listener signature of an event channel. */
export type Listener<P> = (payload: P) => void;

/** Unwraps `Promise<T>` into `T`, leaving anything else untouched. */
export type Unwrap<T> = T extends Promise<infer U> ? U : T;

/** A value that may or may not be wrapped in a promise. */
export type Awaitable<T> = T | Promise<T>;

/** Request arguments derived from a {@link IccRequests} entry. */
export type RequestArgs<F> = F extends (...args: infer A) => any ? A : never;

/** Response type derived from a {@link IccRequests} entry. */
export type RequestResult<F> = F extends (...args: any[]) => infer R ? Unwrap<R> : never;

/** Handler signature accepted by `handle`, may be sync or async. */
export type RequestHandler<F> = (...args: RequestArgs<F>) => Awaitable<RequestResult<F>>;

/** Removes the registration it was returned from. Safe to call more than once. */
export type Unsubscribe = () => void;

/**
 * An `AbortSignal`, or the `AbortController` owning it. Accepting both keeps the
 * call sites terse and mirrors the ergonomics of the DOM event APIs.
 */
export type AbortLike = AbortSignal | AbortController;

export interface ListenerOptions {
	/** Removes the listener right after its first invocation. */
	once?: boolean;
	/** Removes the listener as soon as the signal is aborted. */
	signal?: AbortLike;
}

export interface HandlerOptions {
	/** Removes the handler right after it answers a single `invoke`. */
	once?: boolean;
	/** Removes the handler as soon as the signal is aborted. */
	signal?: AbortLike;
}

export interface ErrorContext {
	/** Channel the failing listener was registered on. */
	channel: string;
	/** Only listeners are reported here; handler failures reject the `invoke` promise. */
	type: 'listener';
}

export interface IccOptions {
	/**
	 * Called when a listener throws. Dispatch always continues with the remaining
	 * listeners. Defaults to `console.error`.
	 */
	onError?: (error: unknown, context: ErrorContext) => void;
}
