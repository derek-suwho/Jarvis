# PDF and image analysis

Attach PDFs and PNG/JPEG/GIF/WebP images through the existing picker, paste, or drop flow, then ask either connected provider to analyze their actual contents. Reuse ChatGPT subscriptions and Claude Code. Native document/image inputs preserve scanned pages, charts, and layout without introducing an OCR service.

Keep existing text attachments and chat layout. Show image thumbnails and PDF file chips. Reject unsupported, empty, mismatched, or malformed media with actionable errors; never silently omit unavailable files. Preserve media in history for follow-ups, edits, regeneration, side chats, provider switches, and reloads. Temporary chats must not persist media.

Builder choices: image limit 3 MiB, PDF limit 10 MiB, text limit 128 KiB, ten files and 10 MiB per message. Complete conversations retain the existing 200-message/400,000-character text limits, plus a 20 MiB serialized media/request budget. Validate before draft consumption and again at provider IPC boundaries. Provider-specific page/encryption/model restrictions surface through existing provider errors.

Wire contract: messages keep `{role, content: string}`, with optional `media: {name, type, data}[]`; `data` is canonical base64. Attachments gain optional `data`. Preview URLs derive from data and are not persisted twice. ChatGPT maps to Responses image/file blocks. Claude uses stream-json input for media and preserves historical blocks during transcript reconstruction; plain text behavior stays compatible.

Store media in IndexedDB, chat metadata in existing localStorage. Restore media before rendering saved chats; surface storage failures. Remove unreferenced saved media and exclude temporary chats. No automatic model calls during verification: exercise real serialization with simulated transport.

UI: retain current neutral surfaces (#181818, #202020, #2b2b2b), text (#ededed, #ababab), accent (#57998a), Geist typography, and composer spacing. New previews fit existing file chips; no new sections or unrelated styling.
