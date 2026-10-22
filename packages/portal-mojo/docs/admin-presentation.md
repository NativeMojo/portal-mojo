# Admin presentation and visual QA

Use intuitive, simple screens with clean spacing. Keep only important data and
short action-oriented copy on the primary surface. Use tabs for distinct jobs,
modals for record inspection/confirmation, and keyboard-accessible help popovers
for explanations. Keep action-specific errors, unknown outcomes and concrete
interruptions visible where the operator needs them. Permission/consent/session
and no-replay checks are behavioral requirements, not prose to remove.

Both applications import `portal-mojo/styles.css`. Never add app-local copies of
package component CSS: unlayered stale copies override the canonical layer.
Showcase owns only tokens, chrome and demo-only styling. Test fixture controls
stay in closed Demo controls disclosures; they are not the product's UI.

## Required acceptance

1. Run `npm run verify:admin-presentation`. It compiles each app's real theme
   through Vite and checks the six operations layouts, plus the shared style
   entrypoint. A CSS file existing on disk does not prove it is loaded.
2. Wait for actual loaded data and controls, not just a heading, spinner or
   skeleton. Inspect initial-viewport screenshots of **all six** screens
   (GeoLocation, Fleet, Maintenance, Deployments, Domains, Serving) in light and
   dark at desktop and 390px. Revisit each image; producing one is not review.
3. Check computed page/row display, padding/gap and heading size. Check field
   separation, alignment, readable contrast, wrapping and no page overflow.
   Tables may scroll inside their own container. Inspect internal scroll areas
   and sticky actions, not just document width.
4. Open help, tabs, details and dialogs. Verify popovers inside a native dialog,
   Escape/outside dismissal, readable fields and reachable actions at narrow
   width. Inspect every changed surface, including errors and unknown outcomes.
5. Exercise mock workflows: provider test/save, a combined scaling draft retained
   across tabs and exact plan review, maintenance outage/resource confirmation,
   API/WebApp tabs and recovery/setup, Domain actions/details, Serving wizard.
   Cancel billable/destructive actions unless a test explicitly owns the mock.
6. Repeat a smoke check in the actual Admin shell and built Showcase output.
   Check the browser console and run focused behavior contracts plus typecheck.
   DOM-only tests verify behavior; they cannot certify layout or visual quality.
   At mobile width, verify navigation starts collapsed, expands over the page,
   closes with Escape/outside activation or navigation, and preserves the saved
   desktop preference when returning to a wider viewport.

Keep screenshot evidence and the screen/theme/viewport/interaction results on
the Maestro item. State whether evidence is mock or live. A preview link must
work when handed over; the development server's lifetime is part of that check.
