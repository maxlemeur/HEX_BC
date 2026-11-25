---
name: mergeone-delivery
description: Prepare, review, stack or merge MergeOne PRs, diagnose red CI, or hand off multi-session work.
---

Branch from current origin/main. Fetch before committing. Integrate main into
a standalone PR only for a GitHub-reported conflict, a migration restamp or a
landed change the branch needs. Run `git diff --cached --check`. Use an
English Conventional Commit with the Linear ID when available. For a public
API change, update its OpenAPI source and generated contract together.

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

Send independent changes to main separately. For dependent changes, follow
“Pull requests empilées” for the migration layer, immediate-base reviews,
required checks and top-of-stack merge. Only the stack extension’s atomic,
lease-checked push is authorized after reconciling collaborators’ work. Other
force pushes and deleting work outside main require the owner’s agreement.

For multi-session work, resume from STATE.md in the canonical task outputs.
Update it with current status and dated owner decisions. Append events to the log.
