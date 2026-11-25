---
name: mergeone-database
description: Change MergeOne schema, RLS or tenant authorization, or apply and verify shared migrations.
---

Ordered migrations define the schema. Follow “Ajouter une migration et régénérer
les types” for timestamp order, manifest checks and generated types. Restamp
only unapplied migrations. Add compatible schema before switching callers in a
later release. Keep hand-written refinements separate from generated types.

For tenant-protected operations, enforce membership, active tenant and RLS on the
server. Keep service credentials server-side. Check grants on existing data
against the owner's approval boundaries.

Qualify SQL/RLS on an owned stack. After a reviewed migration reaches main,
follow “Appliquer sur une base partagée” for target and history checks, exact
SQL, post-application checks and the receipt. A migration can proceed without
a separate approval. An action covered by an owner approval rule still needs
that agreement. For sequential replacements of the same SQL function, merge
the first before starting the second from main.
