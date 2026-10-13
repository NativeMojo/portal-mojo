# Realtime transport

Import `RealtimeClient`, `RealtimeProvider`, `useRealtime`,
`useRealtimeStatus`, `useRealtimeEvent`, `useRealtimeTopic`, and
`defineRealtimeEvent` from `portal-mojo/client`.

Mount one `RealtimeProvider` inside the app's auth root. It owns the connection;
consumer permissions own topic subscriptions. Disabling the provider or losing
the auth token closes the socket. A permission loss in one consumer must not
disable this shared provider.

The provider binds both owned and injected clients to the shared auth session.
Before opening a socket and again when challenged, it waits for `ensureValidToken()`;
HTTP and realtime share one refresh POST. A slow or temporarily failed renewal
keeps the connection in `connecting`/`authenticating`/`backoff`, not `auth-failed`.
Consumers should preserve their current workspace during these transient states.
Confirmed refresh denial still fails closed. Token replacement invalidates old
handshakes synchronously, including during a pending refresh.

For a non-React session consumer, call `const unbind = client.bindAuthSession()`
before `client.setEnabled(true)`, and call `unbind()` on teardown. One binding
owns the client at a time; unbinding closes the connection without aborting a
renewal shared by HTTP. Standalone `connect(token)` clients keep explicit-token
behavior and are responsible for their token lifecycle.

## Wire contract

- URL is derived from the configured API origin as exactly `/ws/realtime/`
  with `ws:`/`wss:`. Credentials are never placed in the URL, lifecycle state,
  logs, caches, mock observations, or storage beyond the existing auth store.
- An open socket is not ready. The client waits for `auth_required`, then sends
  `{type:'authenticate',token,prefix:'bearer'}` and becomes ready only after
  `auth_success`. An auth error closes and suspends the connection until the
  token value changes. The exact direct admission-capacity error described
  below is a transport refusal, not an authentication failure.
- Heartbeat is a `ping` every 20 seconds with a 10-second `pong` deadline.
  A server-initiated `{type:'ping'}` (django-mojo 1.32+ sends one every 20
  seconds and culls a socket silent for 90) is answered at once with
  `{type:'pong'}` while ready, clears the pending `pong` deadline, and is never
  dispatched to consumers. Answering from the message handler keeps the socket
  alive while a background tab throttles the client's own ping timer.
  Reconnect uses capped jittered backoff. Pre-accept close code 4429 enforces at
  least 60 seconds. The direct `{type:'error',message:'Too many connections'}`
  admission refusal while authenticating or ready uses the same delay, even
  when followed by a normal server close. Focus/visibility, token replacement,
  and provider remount cannot bypass the deadline on that client. Queued frames
  from the refused socket are ignored; recovery still requires authentication.
- Desired topics are refcounted and replay after authentication. Operations are
  serialized because acknowledgements carry only the topic and denial is a
  generic uncorrelated `error`. Denial yields topic status `denied`; it does not
  reconnect the socket. The server's automatic `user:<id>` topic is reported
  separately and is never explicitly subscribed by the client. That automatic
  topic is a delivery scope, not a presence feed.
- Framework messages, one wrapped `{type:'message',data,topic?,timestamp?}`
  layer, and direct application events share one dispatch boundary. Every
  projected event carries `source: 'wrapped' | 'direct'` so consumers can keep
  capability-bearing protocols on their exact wire source. Malformed frames
  drop. No generic Query invalidation is performed.

## Error frames

A top-level `{type:'error'}` frame is attributed in order:

0. **Exact admission capacity refusal** — `message === 'Too many connections'`
   while authenticating or ready: close and enter bounded `backoff`, without
   dispatching an application error or declaring account access revoked.
   Substrings, the `error` field, and wrapped application events do not match.
   Consumers retain their independent HTTP authorization checks.

1. **During authentication** — auth failure: the client closes and suspends
   until the token value changes. Surfaces through the lifecycle status only;
   no `error` event is dispatched. Exception: the exact direct
   `message === 'Authentication timeout'` before credentials were sent on a
   session-bound socket is a transport timeout and enters bounded retry.
   The same error after credentials were sent remains an authentication failure.
2. **While a subscribe/unsubscribe is pending** — that operation's denial
   (acknowledgements are uncorrelated, so denial is a generic `error`); the
   topic reports `denied`. Surfaces through the topic status only; no `error`
   event is dispatched.
3. **Otherwise** — a backend answer to an application frame (chat rate limit,
   room rules, moderation block). Dispatched as an observable `error` event
   with `source: 'direct'`.

Application error frames carry the message in `error` and may carry a
`reasons` array: `{type:'error', error:'Rate limit exceeded'}`,
`{type:'error', error:'Message blocked by moderation', reasons:[...]}`.

Known ambiguity, inherent to the uncorrelated wire: an application error
landing while a subscribe/unsubscribe is pending is still read as that
operation's denial.

Consumer pattern — a chat composer listens for `error` alongside its ack event
and surfaces the backend's message instead of guessing from a timeout:

```tsx
const chatError = defineRealtimeEvent('error', (value) => {
  const frame = value as {error?: unknown; reasons?: unknown};
  return typeof frame?.error === 'string'
    ? {error: frame.error, reasons: Array.isArray(frame.reasons) ? frame.reasons : undefined}
    : null;
});

useRealtimeEvent(chatError, ({data}) => showSendFailure(data.error, data.reasons));
```

The may-not-have-sent timeout heuristic remains the right fallback for the
no-frame-at-all case — a socket drop mid-send produces no error frame at all.

The transport does not invent application events. Current django-mojo has no
canonical record-created/updated/deleted stream and no canonical presence
stream, so neither record cache invalidation nor online status can be derived
from this client. `defineRealtimeEvent` and `useRealtimeTopic` are useful only
when a backend producer defines and authorizes that exact event/topic contract;
Assistant streaming is the package's current concrete application consumer.

```tsx
// Hypothetical: this works only if the consuming backend publishes this
// application-specific event and authorizes the `orders` topic.
const orderChanged = defineRealtimeEvent('order_changed', (value) => {
  if (!value || typeof value !== 'object') return null;
  const id = (value as {id?: unknown}).id;
  return typeof id === 'number' ? {id} : null;
});

function OrdersLive() {
  const topic = useRealtimeTopic('orders');
  useRealtimeEvent(orderChanged, ({data}) => console.log(data.id));
  return <span>{topic}</span>;
}
```

`createRealtimeMock()` is an adjacent deterministic in-memory server for demos
and behavioral verification. Its injected factory replaces no global
`WebSocket`; controls cover delayed challenge, auth failure left open, 4429,
topic denial, missing pong, wrapped/direct events, forced disconnect, and
multiple connections. Observations contain only bounded derived metadata.
