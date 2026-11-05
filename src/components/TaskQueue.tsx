import { useEffect, useLayoutEffect, useId, useRef, useState } from 'react';
import type { TaskResult, TaskSnapshot } from '../shared/tasks';
import './Tasks.css';

interface Props {
  task: TaskSnapshot;
  onRemove: (entryId: string) => Promise<TaskResult>;
  onInterrupt: () => Promise<TaskResult>;
}

export function TaskQueue({ task, onRemove, onInterrupt }: Props) {
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const queueRef = useRef<HTMLElement>(null);
  const focusedControl = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const previous = focusedControl.current;
    if (!previous || previous.isConnected) return;
    focusedControl.current = null;
    if (document.activeElement === document.body) queueRef.current?.focus();
  });
  const inFlight = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const errorId = `${useId()}-error`;
  const entries = task.queue.filter((entry) => entry.state === 'queued' || entry.state === 'applying');
  const interrupting = task.state === 'interrupting';
  if (!entries.length && !interrupting && !error && !working) return null;
  const perform = async (action: () => Promise<TaskResult>) => {
    if (!mounted.current || inFlight.current) return;
    inFlight.current = true;
    setWorking(true);
    setError('');
    try { const result = await action(); if (mounted.current && !result.ok) setError(result.message); }
    catch { if (mounted.current) setError('Could not confirm this update. Check the task before trying again.'); }
    finally { inFlight.current = false; if (mounted.current) setWorking(false); }
  };
  return (
    <section ref={queueRef} tabIndex={-1} onFocusCapture={(event) => { focusedControl.current = event.target as HTMLElement; }} className="task-queue" aria-label="Queued messages">
      <div className="task-queue-heading">
        <span role="status">{interrupting ? 'Interrupting…' : working ? 'Updating queued messages…' : entries.some((entry) => entry.state === 'applying') ? 'Applying queued messages…' : `${entries.length} ${entries.length === 1 ? 'message' : 'messages'} queued`}</span>
        <button className="task-action" aria-describedby={error ? errorId : undefined} disabled={working || task.state !== 'running' || !entries.some((entry) => entry.state === 'queued')}
          onClick={() => void perform(onInterrupt)}>Interrupt &amp; apply</button>
      </div>
      <ul aria-busy={working || interrupting || entries.some((entry) => entry.state === 'applying')}>
        {entries.map((entry) => (
          <li key={entry.id}>
            <div className="task-queue-content">
              {entry.message.content && <p>{entry.message.content}</p>}
              {!!entry.message.attachments?.length && <div className="task-queue-files">{entry.message.attachments.map((file) => (
                <span className="task-file" key={file.id}>{file.preview && <img src={file.preview} alt="" />}<span>{file.name}</span></span>
              ))}</div>}
            </div>
            {entry.state === 'queued' ? <button className="task-action" aria-describedby={error ? errorId : undefined} disabled={working} aria-label={`Remove queued message: ${entry.message.content.trim().slice(0, 40) || entry.message.attachments?.map((file) => file.name).join(', ') || 'Attachment'}`}
              onClick={() => void perform(() => onRemove(entry.id))}>Remove</button> : <span className="task-state">Applying</span>}
          </li>
        ))}
      </ul>
      {error && <p id={errorId} className="task-error" role="alert">{error}</p>}
      {error && <button className="task-action" aria-label="Dismiss queue error" onClick={() => setError('')}>Dismiss</button>}
    </section>
  );
}
