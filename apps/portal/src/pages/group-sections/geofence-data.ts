// group-sections/geofence-data.ts — a RE-EXPORT SHIM.
//
// Wave 4 lifted ~13 exports of web-mojo
// `@ext/admin/security/geofence/geofenceData.js` into this file for the
// group-scoped panel. Board #1287 promoted that module into the package
// (`portal-mojo/admin` → `admin/network/geofence/geofence-data.ts`) and added
// the exports the platform surfaces need, so the lossy rule↔form projection is
// defined exactly ONCE — which is what the source file's own docstring asks
// for. The inline 249-entry country table that lived here is gone: names come
// from #1426's `COUNTRY_CENTROIDS`, the framework's only country-name source.
//
// This file exists so `GeofenceSection.tsx` keeps its short import path. Add
// nothing here; extend the package module.
export {
    ABUSE_FLAGS,
    COUNTRY_MODE_OPTS,
    COUNTRY_OPTIONS,
    EMPTY_RULE_FORM,
    GEOFENCE_MANAGE_PERMS,
    GEOFENCE_VIEW_PERMS,
    GROUP_GEOFENCE_EDIT_PERMS,
    SECURITY_EVENTS_PERMS,
    US_STATES,
    buildGroupRulePayload,
    coerceRuleInput,
    countryName,
    describeRule,
    formToRule,
    isAdvancedRule,
    regionName,
    ruleToForm,
} from 'portal-mojo/admin/security';

export type {
    AbuseFlagKey,
    GeoRulesConfig,
    GeofenceRule,
    RuleClause,
    RuleForm,
} from 'portal-mojo/admin/security';
