import { useEffect, useState } from 'react';
import type { ToolServer, ToolsScan, ToolsState } from '../lib/desktop';
import './ToolsPanel.css';

const STATUS: Record<ToolServer['status'], string> = {
  off: 'Off',
  idle: 'Not connected yet',
  connecting: 'Connecting…',
  connected: 'Connected',
  'needs-auth': 'Needs sign-in',
  error: 'Error',
};

function statusLine(s: ToolServer) {
  if (s.status === 'connected') return `${s.toolCount} tool${s.toolCount === 1 ? '' : 's'}`;
  if (s.status === 'error' && s.error) return s.error;
  return STATUS[s.status];
}

function ImportView({
  scan,
  onCancel,
  onImport,
}: {
  scan: ToolsScan;
  onCancel: () => void;
  onImport: (ids: string[]) => Promise<void>;
}) {
  const [picked, setPicked] = useState(
    () => new Set([...scan.servers, ...scan.skills].filter((x) => x.selected).map((x) => x.id)),
  );
  const [importing, setImporting] = useState(false);
  const toggle = (id: string) =>
    setPicked((p) => {
      const next = new Set(p);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const setAll = (ids: string[], on: boolean) =>
    setPicked((p) => {
      const next = new Set(p);
      for (const id of ids) on ? next.add(id) : next.delete(id);
      return next;
    });
  const skillIds = scan.skills.map((s) => s.id);
  const serverIds = scan.servers.map((s) => s.id);
  const nothing = scan.servers.length === 0 && scan.skills.length === 0;

  return (
    <div className="tools-import">
      {nothing && <p className="settings-hint">Nothing to import was found for Codex, Claude Code or Claude Desktop on this Mac.</p>}
      {scan.servers.length > 0 && (
        <section>
          <header className="tools-group-head">
            <span>MCP servers ({scan.servers.length})</span>
            <button className="text-btn" onClick={() => setAll(serverIds, !serverIds.every((id) => picked.has(id)))}>
              {serverIds.every((id) => picked.has(id)) ? 'Select none' : 'Select all'}
            </button>
          </header>
          <ul className="tools-pick-list">
            {scan.servers.map((s) => (
              <li key={s.id}>
                <label>
                  <input type="checkbox" checked={picked.has(s.id)} onChange={() => toggle(s.id)} />
                  <span className="tools-pick-text">
                    <span className="tools-pick-name">
                      {s.name}
                      <span className="tools-source">{s.label}</span>
                    </span>
                    <span className="tools-target mono" title={s.target}>
                      {s.target}
                    </span>
                    {s.secretKeys.length > 0 && (
                      <span className="tools-secret">Brings {s.secretKeys.join(', ')} with it, stored only on this Mac</span>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      )}
      {scan.skills.length > 0 && (
        <section>
          <header className="tools-group-head">
            <span>Skills ({scan.skills.length})</span>
            <button className="text-btn" onClick={() => setAll(skillIds, !skillIds.every((id) => picked.has(id)))}>
              {skillIds.every((id) => picked.has(id)) ? 'Select none' : 'Select all'}
            </button>
          </header>
          <ul className="tools-pick-list compact">
            {scan.skills.map((s) => (
              <li key={s.id}>
                <label title={s.description}>
                  <input type="checkbox" checked={picked.has(s.id)} onChange={() => toggle(s.id)} />
                  <span className="tools-pick-name">
                    {s.name}
                    <span className="tools-source">{s.label}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      )}
      {scan.notes.map((n) => (
        <p key={n} className="settings-hint">
          {n}
        </p>
      ))}
      <footer className="tools-import-actions">
        <button className="text-btn" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="add-btn"
          disabled={picked.size === 0 || importing}
          onClick={() => {
            setImporting(true);
            void onImport([...picked]).finally(() => setImporting(false));
          }}
        >
          {importing ? 'Importing…' : `Import ${picked.size}`}
        </button>
      </footer>
    </div>
  );
}

/** Settings › Tools: MCP servers and skills shared by every model in Jarvis. */
export function ToolsPanel() {
  const bridge = window.jarvis?.tools;
  const [state, setState] = useState<ToolsState | null>(null);
  const [scan, setScan] = useState<ToolsScan | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!bridge) return;
    void bridge.state().then(setState);
    // Connect enabled servers so their status and tool counts are current.
    void bridge.refresh().then(setState);
  }, [bridge]);

  if (!bridge) return <p className="settings-hint">Open the Jarvis desktop app to manage tools.</p>;

  const run = async (key: string, task: () => Promise<ToolsState | void>) => {
    setBusy(key);
    setNotice(null);
    try {
      const next = await task();
      if (next) setState(next);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  };

  if (scan) {
    return (
      <ImportView
        scan={scan}
        onCancel={() => setScan(null)}
        onImport={async (ids) => {
          const result = await bridge.import(ids);
          setScan(null);
          const parts = [`${result.servers} server${result.servers === 1 ? '' : 's'}`, `${result.skills} skill${result.skills === 1 ? '' : 's'}`];
          setNotice(`Imported ${parts.join(' and ')}.${result.failed.length ? ` Could not copy: ${result.failed.join(', ')}.` : ''}`);
          setState(await bridge.state());
          setState(await bridge.refresh());
        }}
      />
    );
  }

  const servers = state?.servers ?? [];
  const skills = state?.skills ?? [];
  return (
    <>
      <div className="settings-row">
        <span className="tools-intro">
          Bring over MCP servers, skills and plugins you set up in Claude Code, Claude Desktop or ChatGPT&rsquo;s Codex.
        </span>
        <button
          className="add-btn"
          disabled={busy === 'scan'}
          onClick={() =>
            void run('scan', async () => {
              setScan(await bridge.scan());
            })
          }
        >
          {busy === 'scan' ? 'Looking…' : 'Import…'}
        </button>
      </div>
      {notice && <p className="settings-hint tools-notice">{notice}</p>}

      <ul className="provider-list">
        {servers.map((s) => (
          <li key={s.id} className="provider-row">
            <div className="provider-info">
              <span className="provider-name">
                {s.name}
                <span className="provider-company">{s.label}</span>
              </span>
              <span className="provider-meta">
                <span className={`status-dot${s.status === 'connected' ? ' connected' : ''}`} title={s.error ?? s.target}>
                  {statusLine(s)}
                </span>
              </span>
            </div>
            <div className="provider-actions">
              {s.status === 'needs-auth' && (
                <button
                  className="text-btn"
                  disabled={busy === s.id}
                  onClick={() =>
                    void run(s.id, async () => {
                      const r = await bridge.signIn(s.id);
                      if (!r.ok) setNotice(r.error ?? 'Sign-in failed.');
                      return r.state;
                    })
                  }
                >
                  {busy === s.id ? 'Finish in browser…' : 'Sign in'}
                </button>
              )}
              <label className="tools-switch" title={s.enabled ? 'Turn off' : 'Turn on'}>
                <input
                  type="checkbox"
                  checked={s.enabled}
                  onChange={(e) => void run(`toggle:${s.id}`, () => bridge.setEnabled(s.id, e.target.checked))}
                />
                <span className="sr-only">Use {s.name}</span>
              </label>
              <button className="text-btn danger" onClick={() => void run(`rm:${s.id}`, () => bridge.removeServer(s.id))}>
                Remove
              </button>
            </div>
          </li>
        ))}
      </ul>

      <div className="settings-stack">
        <span>Skills ({skills.length})</span>
        {skills.length === 0 ? (
          <span className="settings-hint">Imported skills are offered to every model, which loads one when your request matches.</span>
        ) : (
          <ul className="archived-list">
            {skills.map((s) => (
              <li key={s.id} title={s.description}>
                <span className="history-title">{s.name}</span>
                <span className="tools-source">{s.label}</span>
                <button className="text-btn" onClick={() => void run(`rm:${s.id}`, () => bridge.removeSkill(s.id))}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <footer className="dialog-footnote">
        <span className="mono">
          {servers.filter((s) => s.enabled).length} servers on · {skills.length} skills
        </span>
        <span>
          Models can use these tools without asking first, so only turn on servers you trust. Connectors added on claude.ai or
          chatgpt.com stay with those accounts.
        </span>
      </footer>
    </>
  );
}
