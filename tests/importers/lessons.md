# Importer scope lessons

- Re-read the issue and latest comments when scope changes; final decisions
  supersede earlier acquisition/sync proposals.
- Keep consumer-history imports separate from local setup selection. A source
  label or contract does not establish local adapter/path support.
- The importer encodes memory exclusion on accepted, rejected, and cancelled
  outcomes. Persistence/search/queue/extractor enforcement needs integration tests.
- Selection is not activation approval. Hooks stay disabled; plugins/MCP require
  separate review of the exact current revision. Never pass raw config through a
  metadata-only contract.
- Identify providers by core discriminators or validated candidates; unrelated
  extension fields must not create ambiguity. Reject genuinely valid hybrids.
- Separate validated provider evidence from shape-only candidates across the
  entire batch. Use shape fallback only when no record validates; test foreign
  malformed neighbors in both orders and with explicit provider options.
- Validate optional metadata containers before inspecting omissions. Malformed
  metadata must not silently become a complete transcript.
- Emit visible user/assistant dialogue only; omitted system/tool content must
  never appear in any result, and omissions must lower completeness.
- Bound each child collection and global edge work before iteration/allocation.
  Use deterministic complexity assertions; wall-clock timing is not correctness.
- Typecheck test instrumentation too; Vitest passing does not prove TypeScript
  iterator/mock signatures compile in the full verification gate.
- Synthetic fixtures prove tested shapes, not current vendor compatibility.
  Require sanitized real-export validation before production; never commit personal data.
