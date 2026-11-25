# MergeOne

An analysis request ends with findings. For a requested change, deliver the
verified result through a reviewed PR and confirm its merge into protected
`main`. Repository delivery rules take precedence over a skill's defaults.
This repository is public. Use fictional fixtures and keep customer documents,
private feedback, local settings and unpublished evidence out of Git and PRs.

## Actions requiring the owner's go

Get the requesting owner's explicit agreement before deploying, activating a
production feature, merging someone else's PR outside the task, changing
membership, roles, collaborators or keys, widening access to existing data,
deleting or overwriting shared data, or dropping a column or table. Apply a
reviewed migration after merge without a separate migration approval. Check
what its SQL does against these same boundaries.

## Runtime and workspaces

Shared Supabase serves production. Run writing campaigns on owned stacks.
A shared test requires an explicit request and the designated account and
tenant « ARMY TesterArmy QA ». Shared ad hoc SQL writes require approval for
the specific statement. Preserve other people's work and personal data.

## Verification

Match local checks to the diff. Documentation needs content, link and diff
checks. Use the project verification skill for application, journey or
release work. Keep required CI checks enforced.

## Review and delivery

Require independent read-only review for money, authorization, migrations,
concurrency, public contracts and cross-module implementation changes.
Use the project delivery skill when preparing or following a PR.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
