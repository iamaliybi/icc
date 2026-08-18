/**
 * Every public type of the library, re-exported from one place.
 *
 * Reading this folder is meant to be enough to understand how the bus works:
 * {@link ./channels} declares the channel vocabulary, {@link ./handlers} the
 * callables and their lifetime, {@link ./options} the seams, {@link ./errors}
 * the failures, and {@link ./contracts} the roles a bus fulfils.
 *
 * @packageDocumentation
 */

export type {
	Awaitable,
	EventChannel,
	EventMap,
	EventPayload,
	IccEvents,
	IccRequests,
	PayloadArgs,
	RequestArgs,
	RequestChannel,
	RequestMap,
	RequestResult,
	ResolvedEvents,
	ResolvedRequests,
	Unwrap,
} from './channels';

export type {
	AbortLike,
	HandlerOptions,
	Listener,
	ListenerOptions,
	RegistrationOptions,
	RequestHandler,
	Unsubscribe,
	WaitForOptions,
} from './handlers';

export type { ErrorContext, ErrorReporter, IccOptions, Scheduler } from './options';

export type { IccError, IccErrorCode } from './errors';

export type { IccBus, IccChannelAdmin, IccEventBus, IccRequestBus } from './contracts';
