# Importer scope lessons

- Re-read the issue and latest comments when scope changes; final decisions
  supersede earlier acquisition/sync proposals.
- Keep consumer-history imports separate from local setup selection. A source
  label or contract does not establish local adapter/path support.
- Historical imports and retrieved history must not trigger durable-memory
  extraction. Test the policy on accepted, rejected, and cancelled outcomes.
- Selection is not activation approval. Hooks stay disabled; plugins/MCP require
  separate review of the exact current revision. Never pass raw config through a
  metadata-only contract.
