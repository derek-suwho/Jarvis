# Lessons

- Preserve core product scope when narrowing an MVP. Shared memory across AI providers means persistent memory spanning conversations and multiple projects; provider count can shrink without replacing this with isolated project briefs.
- Describe manual effort completely. A clipboard handoff requiring capture, outbound paste, and return capture is not a single-paste workflow.
- Distinguish memory maintained across chats inside the app from importing or syncing conversations in providers' own apps.
- Preserve the Cursor analogy: one chat interface and model picker, powered by users' existing provider subscriptions, with shared persistent memory. Subscription reuse is a core requirement; separate API billing or manual handoffs are different product directions, not equivalent MVP reductions.
- Subscription integration research must distinguish observed implementation, live compatibility, and documented provider permission. Free distribution does not automatically resolve usage restrictions; transcript replay does not establish persistent cross-project memory.
- Distinguish subscription-backed model calls, embeddable coding agents, and complete native products. A Codex/Claude Code adapter does not establish ChatGPT Work/Claude Cowork feature, history, project, or memory portability.
- Track app pricing separately from model funding. Jarvis is a monthly paid app; customers retain their own provider subscriptions. Founder-owned subscriptions establish available test accounts, not commercial integration eligibility.

- Keep implementation code readable and multiline. Concise conversation and commit instructions do not authorize compressed control flow.
- Validate evidence polarity against the complete source utterance. Model-selected substrings can strip negation or later rejection; exact quotation alone does not establish affirmative support.
- Trace every UI capability to its actual provider payload. File chips and saved instructions do not prove files or instructions reach the model.
- Freeze contextual instructions with side-chat snapshots; resolve existing-chat scope independently of the last project home. Clear temporary drafts on every exit path.
- Validate the complete serialized request against provider limits before clearing a draft; individual attachment limits alone are insufficient.
- Distinguish queued messages from explicit interruption. Queue by default; only apply mid-run when the user chooses interruption. Scope background work to the requested app lifecycle before adding durable workers.
- Trace provider execution separately from output delivery: a destroyed renderer can lose results while backend work continues. Do not infer cancellation from missing output.
- When moving attachments to binary storage, migrate every previously accepted MIME alias before stripping inline data; verify migration through reload.
- Vite refreshes renderer code, not Electron's loaded main process. Restart the actual desktop app after backend changes; verify media through real preload/IPC and a live response before declaring the integration working.
- Verify the exact npm command users will run; individually valid CLI flags can conflict. Ralph's `--autonomous` and `--no-tui` are mutually exclusive.
- Resolve profile identity from saved preferences or connected account metadata; never leave a signed-in person's profile labeled You. Keep global navigation separate from scrolling chat history when the reference does.
- Gate provider plan controls and model availability on verified sign-in; a locally selected plan or opened login page is not an authenticated account.
- Check CLI auth parsers against published or observed output, including login preludes and trailing failures. Mock success alone does not prove live compatibility.
- Serialize login/logout with status checks, and wait for owned provider processes during app shutdown. Do not block normal user configuration merely because it exists; restrict actual executable capabilities.
- Verify skill invocation in the user's actual client. Codex CLI uses `$name` or `/skills`; a skill file does not register a `/<name>` CLI command. Distinguish file validation from picker discovery.
- Keep requested local apps independent of managed exec sessions: detach the launcher, redirect stdio to a log, and verify it survives the launching shell before reporting it running. Record PID and log path for diagnosis.
