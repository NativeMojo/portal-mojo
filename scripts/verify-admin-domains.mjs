import assert from 'node:assert/strict';
import { createServer } from 'vite';
// A strict independent wire peer: exercises production API/auth code without
// teaching the central mock the very contract this regression is proving.
globalThis.window = { addEventListener() {}, removeEventListener() {}, location: { hash: '', pathname: '/', search: '' }, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
const server = await createServer({ root: process.cwd(), appType: 'custom', logLevel: 'silent', server: { middlewareMode: true }, plugins: [{ name: 'domains-independent-peer', enforce: 'pre', transform(source, id) { if (!id.endsWith('/client/mock.ts')) return; return source.replace('export async function mockFetch(path: string, opts: MockFetchOpts): Promise<unknown> {', 'export async function mockFetch(path: string, opts: MockFetchOpts): Promise<unknown> { if ((globalThis as any).__domainsPeer) return (globalThis as any).__domainsPeer(path, opts);'); } }] });
try {
    const mock = await server.ssrLoadModule('/packages/portal-mojo/src/client/mock.ts');
    if (!process.env.DOMAINS_API_ONLY) {
        const session = await mock.mockFetch('/api/login', {method:'POST',body:{username:'dns.manager@nativemojo.com',password:'mojo'}});
        const headers={Authorization:`Bearer ${session.data.access_token}`};
        const quote=(await mock.mockFetch('/api/dnsman/registrar/quote',{method:'POST',headers,body:{group:1,domain:'strict-domains.example',years:1}})).data;
        const base={group:1,purchase:quote.purchase,confirm_token:quote.token};
        for (const fields of [{},{confirm_domain:quote.name,confirm_price:'12.01'},{confirm_domain:'wrong.example',confirm_price:quote.price}]) {
            const denied=await mock.mockFetch('/api/dnsman/registrar/purchase',{method:'POST',headers,body:{...base,...fields}});
            assert.equal(denied.status,false,'missing/mismatched confirmation tuple must be rejected before consuming token');
            assert.equal((await mock.mockFetch(`/api/dnsman/purchase/${quote.purchase}`,{headers,params:{graph:'default'}})).data.status,'quoted','tuple refusal must leave durable intent unspent');
        }
        assert.equal((await mock.mockFetch('/api/dnsman/registrar/purchase',{method:'POST',headers,body:{...base,confirm_domain:quote.name,confirm_price:quote.price}})).status,true,'same unspent token works with exact tuple');
        console.log('PASS Domains strict central mock tuple contract');
    }
    if (!process.env.DOMAINS_MOCK_CONTRACT_ONLY) {
        const api=await server.ssrLoadModule('/packages/portal-mojo/src/admin/dns/api.ts');
        const auth=await server.ssrLoadModule('/packages/portal-mojo/src/client/auth.ts');
        const tuple=Object.freeze({group:1,purchase:8301,confirm_token:'transient-only',confirm_domain:'exact.example',confirm_price:'12.00'});
        let calls=0,prompts=0;
        const result={status:true,data:{purchase:8301,domain:8201,name:'exact.example',status:'registering',operation_id:null,privacy:true,privacy_downgraded:false}};
        globalThis.__domainsPeer=async(path,opts)=>{assert.equal(path,'/api/dnsman/registrar/purchase');assert.deepEqual(opts.body,tuple);calls++;return calls===1?{status:false,error:'Fresh authentication required',error_code:440}:result;};
        auth.setFreshAuthHandler(async()=>{prompts++;return true;});
        await api.purchaseDomain(tuple);
        assert.equal(prompts,1);assert.equal(calls,2,'only a 440 may resume the identical immutable tuple');
        calls=0;auth.setFreshAuthHandler(async()=>false);
        await assert.rejects(api.purchaseDomain(tuple));assert.equal(calls,1,'cancelled fresh auth never replays');
        calls=0;globalThis.__domainsPeer=async()=>{calls++;return {status:false,error:'Acknowledgement lost',error_code:503};};
        await assert.rejects(api.purchaseDomain(tuple));assert.equal(calls,1,'ambiguous provider attempt never replays');
        auth.setFreshAuthHandler(null);
        delete globalThis.__domainsPeer;
        const registrar = await server.ssrLoadModule('/packages/portal-mojo/src/admin/dns/registrar-api.ts');
        await assert.rejects(registrar.saveDomainRegistrarSettings(1, { metadata: {} }), /Only changed boolean/);
        await assert.rejects(registrar.saveDomainRegistrarSettings(1, { auto_renew: 'true' }), /Only changed boolean/);
        await assert.rejects(registrar.saveDomainRegistrarSettings(1, {}), /Only changed boolean/);
        const navigation = await server.ssrLoadModule('/packages/portal-mojo/src/admin/dns/domain-navigation.ts');
        assert.equal(navigation.domainRecordsHref('/embedded/admin/dns/domains', 82), '/embedded/admin/dns/records?domain=82');
        assert.equal(navigation.domainRecordsHref('/dns/domains', 82), '/dns/records?domain=82');
        assert.equal(navigation.supportsDomainRecords('mojo'), false);
        assert.equal(navigation.supportsDomainRecords('unknown'), false);
        assert.equal(navigation.domainScopeLabel(null), 'Platform');
        assert.equal(navigation.domainScopeLabel({id:3,name:'Actual row group'}), 'Actual row group');
        console.log('PASS Domains exact purchase tuple, fresh-auth continuation/cancel, ambiguous no-replay');
    }
} finally { delete globalThis.__domainsPeer; await server.close(); }
