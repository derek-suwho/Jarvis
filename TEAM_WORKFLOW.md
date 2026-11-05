# Jarvis Engineering Operating Model

## Decision authority

- CEO owns scope, sequencing, reversible product decisions, and release acceptance.
- Engineering Lead owns architecture, file ownership, integration order, and technical standards.
- Product/Design define acceptance behavior; Quality independently validates security, regressions, and release gates.
- Derek is interrupted only for paid spend, credentials, legal/commercial commitments, or irreversible/high-risk actions.

## Repository model

- The dedicated automation identity is GitHub user `hermes-helper`; it has write access only to `derek-suwho/Jarvis` and uses an isolated VPS credential store.
- Human-owner GitHub credentials are not exposed to Ralph or implementation agents. Trusted integration invokes `/opt/data/building-team/scripts/jarvis_bot_gh` for bot-owned GitHub API/PR operations.
- `main` is the protected integration baseline and is never used for parallel editing. It requires a pull request, one approval, dismissal of stale approvals, linear history, resolved conversations, and includes administrators; force-push and deletion are disabled.
- Every parallel implementation lane receives one named branch and one Git worktree from the same baseline.
- A lane has one writing owner. Other agents may review it read-only.
- Worktrees live under a project-specific worktree root and must never share generated output, dependency folders, or runtime databases.
- Work is integrated in dependency order after lane-level verification. The integration owner reruns the complete suite after every merge or patch application.

## Current Ralph model

Ralph's fresh Codex iterations are sequential and operate as one writing owner in one isolated repository. This is the integration lane, so those iterations cannot conflict concurrently. Parallel team agents are initially review-only. A second writing lane may start only after Engineering records:

1. an exclusive file-ownership boundary;
2. an explicit base revision;
3. its branch/worktree path;
4. its lane-specific test command;
5. its integration order and expected contracts.

Ralph agents do not commit, push, merge, deploy, access credentials, or broaden their sandbox. The trusted integration owner collects verified diffs, resolves overlap, and reruns all gates.

## Workstream ownership

| Lane | Primary scope | Default owner | Validator |
| --- | --- | --- | --- |
| Integration | shared contracts, cross-lane integration, full verification | Engineering Lead / Ralph sequential loop | Quality |
| Provider runtime | provider adapters, task coordination, cancellation and context transfer | Engineering | Quality + Security review |
| Memory and storage | SQLite, migrations, retrieval, deletion and export | Engineering | Quality |
| Desktop product | renderer UX, onboarding, accessibility, state handling | Product/Design + Engineering | Quality |
| Release | CI, packaging, dependencies, operator docs | Engineering | Quality + CEO |

Shared contract or migration files remain integration-owned unless explicitly reassigned. If two lanes need the same file, the upstream contract lands first; the downstream lane rebases or regenerates its patch afterward.

## Required gates

1. Tests are written or strengthened before behavior changes.
2. Lane-specific tests and typechecks pass before handoff.
3. Quality reviews security/privacy-sensitive changes independently.
4. Integration applies one lane at a time and runs `npm run ralph:verify` after each.
5. The release candidate requires the full automated suite, build, backend typecheck, packaged-app checks where the host supports them, and an honest external-gates report.
6. Fixture results never count as live provider, commercial-permission, Apple signing, notarization, or clean-Mac evidence.

## Conflict protocol

- Stop only the conflicting lane, not the whole program.
- Preserve both diffs and identify the contract owner.
- Engineering chooses the canonical behavior; a neutral reconciler resolves the patch mechanically.
- Quality adds a regression test for the disputed behavior before integration continues.
- Routine conflict decisions are logged and do not require Derek.
