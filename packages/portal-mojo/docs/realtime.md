# Realtime transport

Import `RealtimeClient`, `RealtimeProvider`, `useRealtime`,
`useRealtimeStatus`, `useRealtimeEvent`, `useRealtimeTopic`, and
`defineRealtimeEvent` from `portal-mojo/client`.

Mount one `RealtimeProvider` inside the app's auth root. It owns the connection;
consumer permissions own topic subscriptions. Disabling the provider or losing
the auth token closes the socket. A permission loss in one consumer must not
disable this shared provider.

## Wire contract

- URL is derived from the configured API origin as exactly `/ws/realtime/`
  with `ws:`/`wss:`. Credentials are never placed in the URL, lifecycle state,
  logs, caches, mock observations, or storage beyond the existing auth store.
- An open socket is not ready. The client waits for `auth_required`, then sends
  `{type:'authenticate',token,prefix:'bearer'}` and becomes ready only after
  `auth_success`. An auth error closes and suspends the connection until the
  token value changes.
- Heartbeat is a `ping` every 20 seconds with a 10-second `pong` deadline.
  Reconnect uses capped jittered backoff. Pre-accept close code 4429 enforces at
  least 60 seconds, and focus/visibility cannot bypass that deadline.
- Desired topics are refcounted and replay after authentication. Operations are
  serialized because acknowledgements carry only the topic and denial is a
  generic uncorrelated `error`. Denial yields topic status `denied`; it does not
  reconnect the socket. The server's automatic `user:<id>` topic is reported
  separately and is never explicitly subscribed by the client.
- Framework messages, one wrapped `{type:'message',data,topic?,timestamp?}`
  layer, and direct application events share one dispatch boundary. Malformed
  frames drop. No generic Query invalidation is performed.

```tsx
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
