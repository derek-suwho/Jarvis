# Navigation rail and profile menu

Match the supplied ChatGPT screenshots within Jarvis's existing React/Electron shell.

- Persistent 64px rail: Home, chat-history toggle, Tasks; Settings and profile anchored at bottom.
- Separate 256px history column: Jarvis heading, search, new chat, existing projects and conversations. History scrolls independently; collapsing it leaves the rail available.
- Profile opens an anchored, rounded menu with account name, connection summary, Settings, Help/keyboard shortcuts, and logout for connected accounts. Use existing capabilities; do not add pet or referral features.
- Identity: saved display name, connected provider name, connected email, then Account. Never hardcode the screenshot's name or default to You.
- Reference palette: rail #282827, history #1f1f1e, menu #30302f, text #ececec, muted #a1a19f, avatar #ed9b0a. Preserve light-mode equivalents. System sans typography; 14px controls, 16px identity, 18px history title. Left-aligned labels, 8px spacing grid, 20px menu corners.
- Layout: [icon rail] [scrolling history] [existing conversation]. On narrow screens, history overlays content beside the rail. Keep native window controls clear.
- Verify profile focus, Escape/outside dismissal, settings handoff, name changes, history collapse, existing chat/project actions, dark/light/mobile layouts. Run existing relevant checks and two localhost screenshot reviews.

Unresolved questions: none.
