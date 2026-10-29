# Desktop experience polish

Preserve Jarvis's quiet, neutral interface and existing React/Electron architecture. Make daily chat workflows dependable and discoverable using Claude and ChatGPT as interaction references. Official-source flow research lives in `docs/research/2026-10-22-desktop-ux-audit.md`; native Claude inspection was unavailable.

## Design

- Palette: graphite #202020 canvas, #181818 navigation, #2b2b2b composer, #ededed text, #a8a8a8 secondary text, muted teal #57998a focus/selection accent. Light counterparts retain neutral surfaces.
- Type: Geist for controls and conversation; system display sans for welcome headings; Geist Mono only for code and key combinations. Clear sentence-case labels.
- Layout: persistent 248px sidebar, quiet 56px toolbar, centered 760px conversation column. Welcome text left-aligned above a spacious two-row composer. Project context and connection state visible without oversized banners. At narrow widths use an accessible sidebar drawer.
- Hierarchy: base canvas, inset navigation, elevated composer, floating menus/dialogs. Borders separate meaningful regions; layered shadows only on floating surfaces.
- Motion: transform/opacity only; reduced-motion support. Keyboard focus always visible.

## Flows and acceptance

1. New chat: suggestions prepare an editable prompt; text drafts isolated by chat/project and restored after navigation. Temporary drafts never persist.
2. Compose: multiline entry, attachments with actual supported text contents, read/error feedback, stop generation, draft follow-up while streaming. Unsupported binary attachments explicitly rejected.
3. Conversation: readable messages, visible retry for failure, edit context warning, copy feedback, model attribution, no silent cancellation when navigating saved chats.
4. Find and organize: keyboard searchable history with snippets, project/archive labels; native row buttons; accessible menus; safe chat deletion with undo; rename works inside projects too.
5. Projects/personalization: instructions reach the provider; project instructions take precedence. Editable project name and instructions, chat list, clear empty state.
6. Settings: focus trap/restore, Escape dismissal, keyboard shortcuts, truthful connection counts.
7. Desktop/responsive: real sidebar drawer at small widths; side-chat stop/close cleans up streams; existing tabs/browser features preserved.

No claims of provider feature parity: voice modes, artifacts, full document/image analysis, cross-device sync, native Work/Cowork and shared-memory integration require separate capabilities. Existing memory scope must not be narrowed by UI claims.

## Verification

Build/typecheck, existing unit suite plus meaningful tests for payload/drafts; deterministic localhost browser flow checks. Capture baseline then two visual review rounds including light/dark, conversation, project, search/settings and narrow viewport. Retain screenshots locally.

Unresolved questions: none.
