---
name: mergeone-delivery
description: Prepare, review, stack or merge MergeOne PRs, diagnose red CI, or hand off multi-session work.
---

Branch from current origin/main. Fetch before committing. Integrate main into
a standalone PR only for a GitHub-reported conflict, a migration restamp or a
landed change the branch needs. Stage task files only, check the staged diff,
and use an English Conventional Commit with the Linear ID when available. For
a public API change, update its OpenAPI source and generated contract together.

Give a required independent reviewer the stable diff, contract, consumers and
actual check results. Allow one full reading and one recheck of fixes. Block
for data loss or corruption, wider rights, changed amounts or failure of the
requested outcome. Name a follow-up PR for other findings. After round two the
delivering agent records the decision and reason.

Open a ready PR with the template. Push once per finished task or review round
so CI can run during review. Enable automatic squash merge once review clears
(or immediately when independent review is optional). For red CI follow
“Check rouge sur une pull request” and “Tentative unique et quarantaine”.
Fix regressions your merge causes in post-merge campaigns.

Use separate PRs for independent changes. For a dependent series follow
“Pull requests empilées”. Give each migration and its SQL tests their own
layer below consumers. Coordinate one publisher, review each immediate-base
diff and resolve every thread before merging from the top with all required
checks green at every layer. Only the stack extension's atomic lease-checked
push is authorized after reconciling collaborators' work. Other force pushes
and deleting work outside main require the owner's agreement.

For work spanning sessions, keep current status and dated decisions in STATE.md
in the canonical task outputs, alongside an append-only log. Resume from that
state. Preserve unique work and evidence before retiring a workspace.
