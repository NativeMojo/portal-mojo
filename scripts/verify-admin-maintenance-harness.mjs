/** Test-only adapter until central integration registers the owned mock. No source files are changed. */
export function maintenanceTestBridge() {
    return {
        name: 'maintenance-contract-bridge',
        enforce: 'pre',
        transform(source, id) {
            if (!id.endsWith('/src/client/mock.ts')) return;
            const injection = `
    const fixture = (globalThis as any).__maintenanceFixture;
    if (fixture) {
      const actual = userFromBearer(opts.headers);
      const caller = actual ? {...actual, ...(fixture.persona ?? {})} : null;
      if(path === '/api/user/me' && actual) return {status:true,data:caller};
      if(path === '/api/account/admin/bootstrap' && method === 'GET') {
        const facts = maintenanceTestFacts();
        if(!caller || !maintenanceTestCan(caller,['view_admin','manage_users','manage_settings','admin']) || facts.bootstrap==='denied') return {status:false,error:'permission denied',error_code:'permission_denied',code:403};
        return {status:true,data:facts.bootstrap==='malformed'?{infrastructure:{mode:'future'}}:{infrastructure:{mode:facts.mode},features:{platform:{capabilities:{infrastructure_managed:facts.infrastructureManaged}}}}};
      }
      const time=authTimeFromBearer(opts.headers);
      const response=maintenanceTestMock(path,method,opts.body,opts.params??{},{user:caller,keyBacked:fixture.keyBacked===true,fresh:typeof time==='number' && Date.now()/1000-time<=600});
      if(response!==undefined){
        if(method==='POST'){fixture.posts=(fixture.posts??0)+1;fixture.lastImmediate=opts.body?.apply_immediately;}
        if(fixture.delay) await new Promise(resolve=>setTimeout(resolve,fixture.delay));
        return response;
      }
    }
`;
            return (
                `import {maintenanceMock as maintenanceTestMock,readMaintenanceBootstrapFacts as maintenanceTestFacts} from './maintenance-mock';\nimport {backendGlobalCan as maintenanceTestCan} from '../admin/fleet/access';\n` +
                source.replace(
                    '    // ── Admin Assistant — authoritative HTTP side (#1299)',
                    injection + '    // ── Admin Assistant — authoritative HTTP side (#1299)',
                )
            );
        },
    };
}
