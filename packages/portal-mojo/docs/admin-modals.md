# Admin modal presentation and lifecycle

Admin inspection uses `modal.detail` and `DetailView`: identity, useful subtitle and
chips, supported lifecycle state, a contextual header menu, and close. Navigation
contains record content. Editors and operations use focused `modal.open` or
`formModal` dialogs. Tables remain pages and retain their URL/query state.

A current-record action belongs in the header menu or a focused dialog. Do not
create Delete, Danger, Manage, Control, Operations or Actions navigation sections,
or rename an action pane to disguise it. Genuine autosave fields remain content.
A nested child may have its own contextual actions. Evidence such as a firewall
log's Action **column** describes the event and is not an operation section.

Use `modal-pad`, `modal-title`, `modal-message`, grouped fields and `modal-actions`.
Cancel precedes the primary button. Pending operations disable repeat submission;
`canDismiss` also protects native Escape/backdrop dismissal during a write.
Cancellation preserves data. Errors retain authoritative state and surface a
refusal. Fresh authentication, write-only secrets and resource-specific imperative
save/reconciliation helpers stay in force. Closing a view never cancels a server
operation that has already started.

The content rail becomes a collapsible in-flow button list at narrow **container**
widths. Both presentations use the same permission-filtered sections, active key,
rich ReactNode badges (including zero and dots), dividers and keep-alive state.
Revoked sections unmount. Modal height limits use available dynamic viewport
height; embedded/page hosts have no modal minimum or maximum and may omit
`onClose`. A flush modal has a fallback close control while its body loads or
fails; successful DetailView bodies supply the normal header close.

## Executable inventory

`scripts/admin-modal-inventory.json` records file, owner, launcher/helper, body,
category, helper target, parent flow and expression fingerprint. The finite AST
scanner follows imported aliases, namespace/destructured/generic modal calls,
named forwarding helpers, literal dynamic imports and resolved section literals,
arrays, conditionals, spreads and explicit pushes. Unrelated table columns are
not section configurations. Assignment, unsupported mutation/property forwarding,
unknown computed members and unclassified modal references fail review.

`scripts/admin-modal-review.json` contains the reviewed semantics of generic
modal bodies and destructive exceptions. Editors are classified by their actual
body, not by whether the launcher happens to be `formModal`. Forwarders inherit
categories from their target; a flow with multiple categories is `nested-flow`.
Unknown syntax requires an exact expression/fingerprint mapping with a reason,
classification and runtime case; stale mappings fail. This is a finite syntax
contract, not a general JavaScript evaluator. When changing a surface, review the
body, permission/lifecycle behavior and matching runtime evidence before updating
the inventory using `node scripts/verify-admin-modals.mjs --write-inventory`.

## Family map

| Family | Record bodies and focused flows | Lifecycle policy |
|---|---|---|
| Groups and members | Group, Member, nested parent/subgroup/user; admission/invite, disable reason, auth configuration/reset | Existing disable/reactivate and inherited configuration semantics |
| Users and credentials | User, group API key, webhook; profile/password/MFA/avatar/passkey/OAuth/personal keys, reveal/rate limits/rotation | Header lifecycle; deactivate group keys/webhooks; child credentials stay focused |
| Bouncer and device intelligence | Signal, device, signature, login/location/GeoIP dossiers; signature editor, lookup/threat/enforcement | Evidence retained; signature lifecycle and explicit enforcement remain |
| Security operations | Ticket, Incident, Event, RuleSet; feed/attachments, status/LLM/Assistant, conditions/handler editor | Header operations; properties remain content; RuleSet deactivation |
| Monitoring and CloudWatch | Log, resource/dashboard/metrics drills, chart/data/range/permission dialogs | Read-only evidence; explicit permission reset |
| Jobs | Job, runner, schedule, result; retry/cancel/payload/broadcast, schedule editor, queue maintenance | Schedule enabled state; runner controls focused; bounded purge only |
| Network/geofence | IPSet, blocked IP, GeoIP; expiry/editor/sync/source refresh, policy/reset/allowlist | IPSet disable/enable; no unsupported IPSet DELETE |
| DNS | Domain, certificate, credential, purchase; record set, credential rotation/link, revoke/onboard/contact | Retire credentials; certificate revoke; provider record-set removal only |
| Storage/shortlinks | Bucket, FileManager, File, shortlink; owner/backend/test/CORS/upload/rendition/share | FileManager/shortlink/share active state; no File disable promise; bucket empty only |
| Email/support | Domain, mailbox, sent message, template, contact; credentials/onboarding/audit/reconcile/test/template/status | Preserve evidence; separate mailbox directions and support status |
| Phone/Push | Number, SMS, config, device, delivery, template; lookup/test/config editors | Config/template lifecycle; number/SMS/device/delivery evidence retained |
| Assistant/settings | Conversation, Skill, Setting; feed continuation, scoped memory, typed settings editor | Owner-only continuation; Skill active selection; memory is scoped editing |

## Resource lifecycle matrix

| Resource | Built-in Admin behavior |
|---|---|
| User / Group / Member | Existing deactivate/reactivate actions; preserve reason, fresh-auth and membership rules |
| Group API key / webhook | Toggle `is_active`; retain history; reveal and rotate remain credential-safe |
| RuleSet / schedule | Disable/reactivate; no parent/result cascade deletion. Disabling a schedule does not cancel already published jobs |
| IPSet | Existing enable/disable/sync/source refresh; server `CAN_DELETE=False` |
| DNS credential | Retire/reactivate and rotate with `sys.manage_dns OR sys.security` |
| FileManager | Existing active state and provider/owner operations via atomic imperative save |
| File | No File, filename-confirmation or batch Delete; no active toggle. Delivery URLs and file-backed shortlinks do not consistently enforce File active state |
| Shortlink / File share | Deactivate/reactivate using existing reconciler; preserve click history. Previously issued destinations cannot be recalled |
| Email domain / template | Retain rows; no delete or invented archive flag |
| Mailbox | Independent inbound/outbound flags; no delete or synthetic combined active flag |
| Support contact | Existing status transition using the status gate; delete permission does not grant status-write authority |
| Phone cache / SMS audit | Retain evidence; deleting a local row cannot recall a provider delivery |
| Phone config | Existing `is_active` through write-only-secret-safe save; disabling restores backend fallback. Test mode is not a disable switch |
| Push config / template | Existing active selection with separate manage/test grants |
| Assistant conversation | Retain history; no arbitrary REST save or invented archive |
| Assistant Skill | Existing `is_active` save requires `sys.view_admin`; authoritative reload after mutation |
| Other logs/devices/history | Read-only by default, even where low-level REST supports DELETE |

The public low-level exported delete APIs remain compatible. Built-in controls
are a narrower product contract. File delivery enforcement, email archival and
conversation archival require backend work before new lifecycle UI is added.

## Retained irreversible operations

| Operation | Authority and confirmation contract |
|---|---|
| Rule condition removal | `sys.manage_security OR sys.security`; selected children of the exact parent, freshly read before confirmation. ALL removal broadens matching, ANY removal narrows it while conditions remain; last removal makes either mode catch-all. Warn when active. After partial refusal, refresh parent and children and report counts |
| OAuth unlink | Live owner or `sys.manage_users OR sys.users`, plus caller restriction; confirm provider and user. Removes association only; reconnect requires provider authorization. Preserve server lockout refusal |
| Passkey removal | Live owner or user-management grant; confirm friendly name, relying party and user. Disable remains reversible; removal requires reenrollment and never erases a physical device |
| Memory key removal | `sys.assistant`; selected group additionally requires inherited member `assistant` authority or superuser. Confirm tier/group/key, freeze scope, recheck authority, no optimistic deletion |
| DNS record-set removal | DNS manage gate, provider capability and record coordinator. Preview all values, apex/service impact and exact name/type; stale-state preflight and reconcile failures; no domain deletion |
| Empty bucket | `sys.manage_aws OR sys.files`, then fresh auth; header to focused armed confirmation and exact case-sensitive bucket name. Removes objects, versions, markers and multipart uploads; retains bucket. Display partial/unknown outcomes and always refresh |
| Jobs retention purge | `sys.manage_jobs OR sys.jobs`; dry-run estimate bound to normalized days/status plus generation. Editing/replacing preview resets arming. Ignore stale/unmounted responses; lock inputs/dismissal during execution. Report actual cutoff and cascade-inclusive counts; rejection requires another preview |
| Queue/consumer cleanup | Jobs manage grant, exact channel/scope and armed confirmation; queue clear sends `confirm:yes` only after consent and may cancel pending database jobs. Report partial outcomes |

Other non-row removals retain their scoped editor semantics: rate-limit override
clear, secret clear, inherited auth/geofence reset, metrics permission clear,
registrant clear, geofence exemption removal, unsaved handler entries, local
upload candidates and supported avatar/attachment detachment. Explain fallback
and inheritance rather than promising restoration of discarded values.

## Verification

Run `verify:admin-modals`, `verify:admin-modal-scanner`,
`verify:admin-modal-lifecycle` and `verify:admin-modal-mounted`. The mounted Node
assertions use JSDOM and React StrictMode for asynchronous scope/effect behavior;
they do not establish native dialog stacking, focus or layout. Use actual mock
browser interactions for all family bodies, both themes, desktop/narrow,
390px embedded hosts and short viewports, including nested dialogs, rich badges,
keyboard navigation and console checks. The lazy Showcase **Admin modal audit**
demo supplies long-title, rich/zero/dot badges, nested editor, lifecycle-cancel and
embedded-host cases. Existing ToastHost top-layer visibility work remains separate.
