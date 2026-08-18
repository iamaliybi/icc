/**
 * Channel vocabulary: the two maps an application declares, and the helpers that
 * turn a channel name into the exact arguments and results of every method.
 *
 * @packageDocumentation
 */

/**
 * Declaration of every **event** channel: a channel name mapped to the payload
 * it carries.
 *
 * Events are broadcasts. Any number of listeners may subscribe, and no answer
 * travels back, so the payload is the whole contract.
 *
 * Augment this interface from your application to make every call site type
 * safe. Use `void` for a channel that carries no data — `send` will then refuse
 * a payload instead of accepting `undefined`.
 *
 * @example Declaring the events of an application
 * ```ts
 * // icc.d.ts
 * import type { CartItem } from './models';
 *
 * declare module 'icc' {
 *   interface IccEvents {
 *     'cart:item-added': CartItem;
 *     'theme:change': 'dark' | 'light';
 *     'modal:close': void;
 *   }
 * }
 * ```
 *
 * @remarks
 * While this interface is empty, every channel name is accepted with an
 * `unknown` payload, so the library is usable before anything is declared and
 * becomes stricter as channels are added.
 *
 * @see {@link IccRequests} for the request/response counterpart.
 */
export interface IccEvents {}

/**
 * Declaration of every **request** channel, written as a function signature:
 * the parameters describe the request, the return type describes the response.
 *
 * Requests are calls. Exactly one handler answers a channel, and the caller
 * receives its result, so both directions are part of the contract.
 *
 * A handler may be synchronous or asynchronous; declare the plain response type
 * either way, since `invoke` always resolves it through a promise.
 *
 * @example Declaring the requests of an application
 * ```ts
 * // icc.d.ts
 * import type { User } from './models';
 *
 * declare module 'icc' {
 *   interface IccRequests {
 *     'user:fetch': (id: string) => User;   // handler may be async, declare `User`
 *     'app:version': () => string;          // no request payload
 *   }
 * }
 * ```
 *
 * @see {@link IccEvents} for the broadcast counterpart.
 */
export interface IccRequests {}

/**
 * Constraint every event map has to satisfy: any channel name mapped to any
 * payload type.
 *
 * @typeParam E - The map being constrained.
 *
 * @remarks
 * Written self-referentially — `E extends EventMap<E>` — so plain `interface`
 * declarations are accepted. A `Record<string, unknown>` constraint would reject
 * every interface, which is exactly what applications augment.
 */
export type EventMap<E> = Record<keyof E, any>;

/**
 * Constraint every request map has to satisfy: any channel name mapped to a
 * `(request) => response` signature.
 *
 * @typeParam R - The map being constrained.
 *
 * @see {@link EventMap} for why the constraint is self-referential.
 */
export type RequestMap<R> = Record<keyof R, (...args: any[]) => any>;

/**
 * The event map in use: {@link IccEvents} once it has been augmented, or a
 * permissive map accepting any channel with an `unknown` payload while it is
 * still empty.
 */
export type ResolvedEvents = [keyof IccEvents] extends [never] ? Record<string, unknown> : IccEvents;

/**
 * The request map in use: {@link IccRequests} once it has been augmented, or a
 * permissive map accepting any channel while it is still empty.
 */
export type ResolvedRequests = [keyof IccRequests] extends [never]
	? Record<string, (payload?: any) => unknown>
	: IccRequests;

/**
 * Names of the event channels of a map.
 *
 * @typeParam E - The event map to read the names from.
 *
 * @example
 * ```ts
 * type Channels = EventChannel<{ 'a': number; 'b': void }>; // 'a' | 'b'
 * ```
 *
 * @remarks Symbol and number keys are filtered out; channels are strings.
 */
export type EventChannel<E> = Extract<keyof E, string>;

/**
 * Names of the request channels of a map.
 *
 * @typeParam R - The request map to read the names from.
 */
export type RequestChannel<R> = Extract<keyof R, string>;

/**
 * Payload carried by an event channel.
 *
 * @typeParam E - The event map.
 * @typeParam C - The channel to read the payload of.
 */
export type EventPayload<E, C extends keyof E> = E[C];

/**
 * Arguments accepted after the channel name by `send`, `sendSync` and the like.
 *
 * Three cases, in this order:
 *
 * - a channel declared as `void` takes nothing, so `send('modal:close')` is the
 *   only valid form and passing anything is an error;
 * - an undeclared channel — payload `unknown`, which is what an unaugmented
 *   {@link IccEvents} resolves to — takes an optional payload of any shape, so
 *   the library stays usable before a single channel has been declared;
 * - anything else requires exactly the declared payload.
 *
 * @typeParam P - The declared payload of the channel.
 *
 * @example
 * ```ts
 * type A = PayloadArgs<number>;  // [payload: number]
 * type B = PayloadArgs<void>;    // [payload?: undefined]
 * type C = PayloadArgs<unknown>; // [payload?: unknown]
 * ```
 */
export type PayloadArgs<P> = [P] extends [void]
	? [payload?: undefined]
	: unknown extends P
		? [payload?: P]
		: [payload: P];

/**
 * A value that may be delivered directly or through a promise.
 *
 * @typeParam T - The delivered value.
 */
export type Awaitable<T> = T | Promise<T>;

/**
 * Unwraps `Promise<T>` into `T` and leaves any other type untouched.
 *
 * @typeParam T - The type to unwrap.
 *
 * @example
 * ```ts
 * type A = Unwrap<Promise<string>>; // string
 * type B = Unwrap<string>;          // string
 * ```
 */
export type Unwrap<T> = T extends Promise<infer U> ? U : T;

/**
 * Arguments a request channel expects, derived from its declared signature.
 *
 * @typeParam F - The `(request) => response` signature of the channel.
 *
 * @example
 * ```ts
 * type A = RequestArgs<(id: string) => User>; // [id: string]
 * type B = RequestArgs<() => string>;         // []
 * ```
 */
export type RequestArgs<F> = F extends (...args: infer A) => any ? A : never;

/**
 * Response a request channel produces, with any promise already unwrapped.
 *
 * @typeParam F - The `(request) => response` signature of the channel.
 *
 * @example
 * ```ts
 * type A = RequestResult<(id: string) => User>;          // User
 * type B = RequestResult<(id: string) => Promise<User>>; // User
 * ```
 */
export type RequestResult<F> = F extends (...args: any[]) => infer R ? Unwrap<R> : never;
