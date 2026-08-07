# Admin dashboard

`AdminDashboardPage` is the package-owned global Admin landing at `/` in the standalone portal and `/system` when embedded. Import it, its data helpers, and `ADMIN_DASHBOARD_PERMISSIONS` from `portal-mojo/admin`.

The page uses only authoritative django-mojo signals: time series `user_activity_day`, `group_activity_day`, `api_calls`, and `api_errors`; global scalars `total_users` and `total_groups`; and `size=0` counts for open incidents, failed jobs, and bounced sent email. Scalar values must be finite non-negative strings or numbers. Malformed values surface as errors rather than fabricated zeroes.

Each panel owns an independent permission gate. A caller without metrics access can still see authorized incident, job, email, or login-geography panels, and no denied panel issues a request. Every dashboard query cache key includes the authenticated caller UID. Login geography starts at the previous 30-day date and deliberately omits `dr_end`, matching the backend's instant-bound semantics.

The dashboard section contributes the single Overview → Dashboard menu entry. If the caller has none of the aggregate dashboard grants, the root route redirects to their first visible Admin route; if no Admin route is visible it renders Access denied.

Attention links preserve the exact server filter in the URL:

- `/security/incidents?status=open`
- `/jobs/list?status=failed`
- `/email/sent?status=bounced`
