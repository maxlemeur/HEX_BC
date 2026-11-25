---
name: mergeone-database
description: Change MergeOne schema, RLS or tenant authorization, or apply and verify shared migrations.
---

Ordered migrations define the schema. Follow “Ajouter une migration et régénérer
les types” for timestamps, manifest checks and type generation. Restamp only
unapplied migrations. Add compatible schema before switching callers in a later
release. Keep hand-written refinements separate from generated types.

Enforce tenant membership, active tenant and RLS on the server. Keep service
credentials server-side. Check grants for widened access to existing data.

After a reviewed migration reaches main, apply it using “Appliquer sur une base
partagée” for target and history checks, exact SQL, verification and the receipt.
If two changes replace the same SQL function, merge the first before starting
the second from main.
