import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

globalThis.window = {
    location: { origin: 'https://portal.example.test', pathname: '/', search: '', hash: '' },
    addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout,
};
globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
globalThis.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
globalThis.sessionStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };

class FakeClock {
    value = 1_000;
    next = 1;
    timers = new Map();
    now = () => this.value;
    random = () => 0.5;
    setTimeout = (callback, delay) => { const id = this.next++; this.timers.set(id, { at: this.value + delay, callback }); return id; };
    clearTimeout = (id) => { this.timers.delete(id); };
    advance(ms) {
        const target = this.value + ms;
        while (true) {
            const due = [...this.timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
            if (!due) break;
            this.value = due[1].at; this.timers.delete(due[0]); due[1].callback();
        }
        this.value = target;
    }
}

const root = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({ root, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
try {
    const { RealtimeClient, defineRealtimeEvent } = await vite.ssrLoadModule('/packages/portal-mojo/src/client/realtime.ts');
    const { createRealtimeMock } = await vite.ssrLoadModule('/packages/portal-mojo/src/client/realtime-mock.ts');

    const clock = new FakeClock();
    const mock = createRealtimeMock({ autoOpen: false });
    const client = new RealtimeClient({ origin: 'https://api.example.test/root?bad=1', socketFactory: mock.factory, clock });
    assert.equal(client.url, 'wss://api.example.test/ws/realtime/');
    assert(!client.url.includes('token'));
    client.setToken('private-token-value');
    client.setEnabled(true);
    mock.open(1);
    assert.equal(client.getStatus().status, 'authenticating');
    assert.equal(mock.observations.length, 0, 'authentication must wait for auth_required');
    mock.authRequired(1);
    assert.deepEqual(mock.observations[0], { connection: 1, kind: 'authenticate', hasToken: true });
    assert.equal(JSON.stringify(mock.observations).includes('private-token-value'), false);
    assert.equal(client.getStatus().status, 'ready');
    assert.equal(client.getStatus().automaticUserTopic, 'user:14');

    const releaseOne = client.retainTopic('orders');
    const releaseTwo = client.retainTopic('orders');
    assert.equal(mock.observations.filter((entry) => entry.kind === 'topic' && entry.action === 'subscribe').length, 1);
    assert.equal(client.topicStatus('orders'), 'subscribed');
    releaseOne();
    assert.equal(client.topicStatus('orders'), 'subscribed');
    releaseTwo();
    assert.equal(mock.observations.filter((entry) => entry.kind === 'topic' && entry.action === 'unsubscribe').length, 1);

    mock.deniedTopics.add('private');
    client.retainTopic('private');
    assert.equal(client.topicStatus('private'), 'denied');
    assert.equal(client.getStatus().status, 'ready', 'topic denial must not reconnect the socket');

    const projected = [];
    const event = defineRealtimeEvent('order_changed', (value) => typeof value?.id === 'number' ? { id: value.id } : null);
    client.on(event, (received) => projected.push(received));
    mock.wrapped({ type: 'order_changed', id: 7, secret: 'drop-by-projector' }, 'orders', 1);
    mock.direct({ type: 'order_changed', id: 8, secret: 'drop-by-projector' }, 1);
    mock.direct({ type: 'order_changed', id: 'malformed' }, 1);
    assert.deepEqual(projected.map((entry) => [entry.source, entry.data]), [
        ['wrapped', { id: 7 }], ['direct', { id: 8 }],
    ]);

    const firstGeneration = client.getStatus().generation;
    client.setToken('replacement-token');
    assert.equal(client.getStatus().generation, firstGeneration + 1, 'one token-value change invalidates exactly one generation');
    mock.sockets[0].onmessage?.({ data: JSON.stringify({ type: 'order_changed', id: 99 }) });
    assert.equal(projected.length, 2, 'stale socket callbacks must be ignored');

    const failedMock = createRealtimeMock({ autoOpen: false, authMode: 'fail-open' });
    const failed = new RealtimeClient({ socketFactory: failedMock.factory, clock: new FakeClock() });
    failed.connect('bad-token'); failedMock.open(1); failedMock.authRequired(1);
    assert.equal(failed.getStatus().status, 'auth-failed');
    failed.nudge();
    assert.equal(failedMock.sockets.length, 1, 'auth failure stays suspended until token replacement');

    const limitedClock = new FakeClock();
    const limitedMock = createRealtimeMock({ autoOpen: false });
    const limited = new RealtimeClient({ socketFactory: limitedMock.factory, clock: limitedClock });
    limited.connect('token'); limitedMock.preacceptRateLimit(1);
    assert.equal(limited.getStatus().status, 'backoff');
    assert(limited.getStatus().retryAt - limitedClock.now() >= 60_000);
    limited.nudge();
    assert.equal(limitedMock.sockets.length, 1, 'focus nudge cannot bypass 4429');

    const heartbeatClock = new FakeClock();
    const heartbeatMock = createRealtimeMock({ autoOpen: false, autoPong: false });
    const heartbeat = new RealtimeClient({ socketFactory: heartbeatMock.factory, clock: heartbeatClock });
    heartbeat.connect('token'); heartbeatMock.open(1); heartbeatMock.authRequired(1);
    heartbeatClock.advance(20_000);
    assert.equal(heartbeatMock.observations.at(-1).kind, 'ping');
    heartbeatClock.advance(10_000);
    assert.equal(heartbeat.getStatus().status, 'backoff', 'missing pong must close and reconnect');

    const source = await (await import('node:fs/promises')).readFile(new URL('../packages/portal-mojo/src/client/realtime.ts', import.meta.url), 'utf8');
    assert.match(source, /useEffect\(\(\) => \{ owned\.setToken\(token\); \}, \[owned, token\]\)/);
    assert.equal((source.match(/owned\.setToken\(token\)/g) ?? []).length, 1, 'refresh and cross-tab replacement share one token-value comparison path');
    assert.match(source, /return \(\) => owned\.setEnabled\(false\)/, 'StrictMode cleanup must close the owned socket');

    const strictMock = createRealtimeMock({ autoOpen: false });
    const strictClient = new RealtimeClient({ socketFactory: strictMock.factory, clock: new FakeClock() });
    strictClient.setToken('strict-token'); strictClient.setEnabled(true);
    strictClient.setEnabled(false); strictClient.setEnabled(true);
    strictMock.sockets[0].onopen?.({});
    assert.notEqual(strictClient.getStatus().status, 'ready', 'stale StrictMode callbacks cannot ready the replacement generation');
    strictMock.open(2); strictMock.authRequired(2);
    assert.equal(strictClient.getStatus().status, 'ready', 'StrictMode remount owns exactly the replacement socket');

    const attributionMock = createRealtimeMock({ autoOpen: false });
    const attribution = new RealtimeClient({ socketFactory: attributionMock.factory, clock: new FakeClock() });
    const observedErrors = [];
    const errorEvent = defineRealtimeEvent('error', (value) => value != null && typeof value === 'object' ? value : null);
    attribution.on(errorEvent, (received) => observedErrors.push(received));
    attribution.connect('token'); attributionMock.open(1); attributionMock.authRequired(1);
    assert.equal(attribution.getStatus().status, 'ready');
    attributionMock.direct({ type: 'error', error: 'Rate limit exceeded' }, 1);
    assert.equal(observedErrors.length, 1, 'idle-state error frame must dispatch as an observable event');
    assert.equal(observedErrors[0].source, 'direct');
    assert.equal(observedErrors[0].data.error, 'Rate limit exceeded');

    attributionMock.deniedTopics.add('locked');
    attribution.retainTopic('locked');
    assert.equal(attribution.topicStatus('locked'), 'denied', 'error during a pending subscribe still resolves as that op denial');
    assert.equal(observedErrors.length, 1, 'topic-denial error must not double-report through the error event');

    attribution.retainTopic('chat');
    assert.equal(attribution.topicStatus('chat'), 'subscribed');
    attributionMock.direct({ type: 'error', error: 'Message blocked by moderation', reasons: ['profanity'] }, 1);
    assert.equal(observedErrors.length, 2, 'the attribution window closes when the pending op completes');
    assert.deepEqual(observedErrors[1].data, { type: 'error', error: 'Message blocked by moderation', reasons: ['profanity'] });

    const authErrorMock = createRealtimeMock({ autoOpen: false, authMode: 'fail-open' });
    const authErrorClient = new RealtimeClient({ socketFactory: authErrorMock.factory, clock: new FakeClock() });
    const authErrors = [];
    authErrorClient.on(errorEvent, (received) => authErrors.push(received));
    authErrorClient.connect('bad-token'); authErrorMock.open(1); authErrorMock.authRequired(1);
    assert.equal(authErrorClient.getStatus().status, 'auth-failed', 'auth-failure error still suspends');
    assert.equal(authErrors.length, 0, 'auth-failure error must not dispatch through the error event');

    const errorBranch = source.slice(source.indexOf("if (frame.type === 'error')"), source.indexOf("if (frame.type === 'message')"));
    const attributionArms = errorBranch.slice(0, errorBranch.indexOf('} else {'));
    assert(attributionArms.includes('suspend') && attributionArms.includes('denyCurrentTopic'), 'auth and topic attribution arms precede the dispatch arm');
    assert.equal((attributionArms.match(/this\.dispatch\(/g) ?? []).length, 0, 'auth/topic attribution arms contain no dispatch call');
    assert.equal((errorBranch.match(/this\.dispatch\(/g) ?? []).length, 1, 'the error branch dispatches exactly once, in the else arm');
    assert.match(errorBranch, /this\.dispatch\('error', frame, 'direct'\)/);

    const multi = createRealtimeMock({ autoOpen: false });
    const multiOne = new RealtimeClient({ socketFactory: multi.factory, clock: new FakeClock() });
    const multiTwo = new RealtimeClient({ socketFactory: multi.factory, clock: new FakeClock() });
    multiOne.connect('one'); multiTwo.connect('two');
    multi.open(1); multi.authRequired(1); multi.open(2); multi.authRequired(2);
    assert.equal(multi.activeConnections, 2);
    multi.sockets[0].close(1000, 'one closed');
    assert.equal(multi.activeConnections, 1, 'mock connections have independent lifecycle state');
    console.log('realtime behavioral contract verified');
} finally {
    await vite.close();
}
