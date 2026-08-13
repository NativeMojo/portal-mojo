// portal-mojo/client — the typed django-mojo protocol layer: envelope unwrap
// (one boundary; a failed save REJECTS), start/size paging, '-field' sort,
// Django lookups, the URL-synced table-params store, TanStack Query hooks,
// and the auth client (password/magic/passkey flows, single-flight refresh,
// pre-request gate, DUID). The in-memory mock transport (mock.ts) is internal
// to client.ts — it is the wire contract's executable spec and evolves in
// lockstep with the client.
export * from './client';
export * from './errors';
export * from './model';
export * from './action-result';
export * from './active-group';
export * from './endpoint-scope';
export * from './scoped';
export * from './auth';
export * from './jwt';
export * from './duid';
export * from './me';
export * from './group-context';
export * from './group';
export * from './hooks';
export * from './params';
export * from './persist';
export * from './lookups';
export * from './location';
export * from './markdown';
export * from './record-feed';
export * from './safe-export';
export * from './upload';
export * from './realtime';
export * from './realtime-mock';
export * from './types';
// Dev affordance: per-endpoint call counts from the mock (single-flight proof).
export {
    armMockReauth, clearMockRequestHistory, getMockCallCounts,
    getMockRequestHistory, setMockDnsConfigMalformed, setMockDnsAcmeMode, armMockDnsWriteFault,
    getMockPhoneConfigCredentialState, getMockEffectivePhoneConfigId,
    deleteMockPhoneGroupForTest,
    setMockDnsRegistrarMode, armMockRegistrarPurchaseFault,
    getMockPushConfigCredentialState,
    armMockUploadFault, armMockRecordNoteFault, clearMockUploadObservations, getMockUploadObservations, setMockUploadMode,
} from './mock';
