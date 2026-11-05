# Production dependency license review

Generate the production lockfile inventory and evaluate the reviewed policy:

```sh
npm run release:licenses
```

The command emits deterministic JSON to stdout and exits 1 if any production
package has missing identity/source/integrity, missing license metadata, or a
license expression absent from the policy. Invalid input and linked production
packages also fail. Optional and platform-specific production packages are
included; dev-only entries are excluded. Duplicate installations remain separate
by lockfile path. This is a lockfile metadata review, not a scan of distributed
license texts or proof of legal compliance.

The checked-in allowlist is deliberately empty pending review by the release
owner and legal approval. A failing report currently means release review is
incomplete. Approve exact complete license expressions only after reviewing
obligations, bundled notices and distribution scope; approving `MIT` does not
implicitly approve a compound expression containing MIT. Unknown metadata,
including the audit's `khroma` finding, requires evidence and explicit disposition;
this tool does not infer a license or silently exempt packages.

CI runs `npm audit --omit=dev --audit-level=low` and `npm run release:licenses`
after the configured verification gate. Either command failing blocks the job;
there is no continue-on-error exemption. The audit requires registry connectivity
and rejects production advisories of every severity. The license check works
offline against the committed lockfile and policy. With the current empty policy,
CI is expected to remain blocked pending explicit license review. Passing tests
alone does not establish release readiness.

Retain the report with release evidence. Development-tool vulnerability review,
THIRD_PARTY_NOTICES, the application license/EULA and inspection of the actual
packaged dependency set remain required release work.
