// portal-mojo/personas — the persona primitive: hats/roles a signed-in user
// operates under. A persona is PRESENTATION only — it picks the active menu
// (via the ui/active-persona signal + MenuConfig.personas), stamps
// <html data-persona>/<html data-density>, and names a home route. It never
// grants or gates a permission: <Guarded>/hasPermission stay the security
// boundary, and hasPermission has no persona input by design.
//
// Reference: packages/portal-mojo/docs/personas.md
export * from './registry';
export * from './PersonaProvider';
export * from './sections';
export * from './presets';
export * from './audit';
