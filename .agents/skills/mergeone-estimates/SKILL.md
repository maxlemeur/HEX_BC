---
name: mergeone-estimates
description: Change estimate calculations, lifecycle, DPGF imports or takeoff in MergeOne.
---

Consult the domain guides “Règles de calcul” and “Cycle de vie du devis” for the affected
operation. Preserve integer cents and basis points. New estimate versions use
engine 3 unless tenant policy selects 2. Historical versions retain their
engine. Preserve fresh snapshots and issued or sealed amounts. Rollbacks on
v3 data must support v3 creation and snapshots.

Keep raw DPGF rows, mappings and unified import confirmation connected.
Preserve CSV, XLS, XLSX and PDF compatibility and provenance. When changing
takeoff workers, storage paths, portal tokens or email side effects, check
tenant membership and active-tenant authorization at the server boundary.
