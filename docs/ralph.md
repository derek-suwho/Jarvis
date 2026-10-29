# Ralph for Jarvis

Ralph CLI **2.10.1** is a pinned development dependency. The upstream
`ralph-hats`, `ralph-loop`, and `ralph-docs` skills from the same release live in
`.agents/skills/`. They are available to Codex on the next turn.

## Run

From the Jarvis project root:

```sh
npm run ralph:check
npm run ralph:dry-run -- -p "Describe one concrete task"
npm run ralph:run -- -p "Describe one concrete task"
```

For a longer task, copy `PROMPT.example.md` to `PROMPT.md`, fill it in, then run
`npm run ralph:run`. `PROMPT.md` and `.ralph/` runtime state are ignored by Git.
No default task is supplied; a run without a prompt fails until one is provided.

Use `npm run ralph -- <command>` or `npx --no-install ralph <command>` for other
CLI operations. For example:

```sh
npm run ralph -- loops list
npm run ralph -- hooks validate --format json
npm run ralph:run -- --continue -p "Continue the same task"
```

Inside Codex, ask to use `$ralph-loop`, `$ralph-hats`, or `$ralph-docs`.
Those upstream skills show `ralph` commands; use the npm wrapper above for this
project-local installation. Commands launched through npm inherit the local
binary directory, so agents started by Ralph can also call `ralph` directly.

## Configuration

`ralph.yml` launches `codex exec --sandbox workspace-write` using Ralph's custom
adapter. The native Codex adapter in this release adds `--yolo`. Authentication
uses the existing Codex login; check with `codex login status`.

Runs stop after 20 iterations or one hour. Parallel loops and automatic merges
are disabled. Guardrails require preserving unrelated edits and explicit
authorization for commits, pushes, and deployment. A dirty working tree causes
a preflight warning, not failure.

Before accepting `LOOP_COMPLETE`, a blocking hook runs:

```sh
npm run ralph:verify
# npm test && npm run build && npm run typecheck:backend
```

Failed checks stop completion; the hook does not automatically start a repair
iteration. Read the failure, correct it, then continue the task. Existing
project check failures must also be resolved for this gate to pass.

## Reinstall

```sh
npm ci
npm run ralph -- --version
```

The pinned package's installer downloads the platform binary from its GitHub
release. Its install script is approved in `package.json` for npm versions
that use `allowScripts`. Skills are included in this project and need no
global plugin installation.

Upstream: [Ralph v2.10.1](https://github.com/mikeyobrien/ralph-orchestrator/releases/tag/v2.10.1)
and [agent skills](https://github.com/mikeyobrien/ralph-orchestrator/blob/v2.10.1/skills/README.md).
