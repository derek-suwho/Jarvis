import { useState } from 'react';
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
  const entries = task.queue.filter((entry) => entry.state === 'queued' || entry.state === 'applying');
  const interrupting = task.state === 'interrupting';
  if (!entries.length && !interrupting) return null;
  const perform = async (action: () => Promise<TaskResult>) => {
    setWorking(true);
    setError('');
    try { const result = await action(); if (!result.ok) setError(result.message); }
    catch { setError('Could not update this task. Your messages are still here.'); }
    finally { setWorking(false); }
  };
  return (
    <section className="task-queue" aria-label="Queued messages">
      <div className="task-queue-heading">
        <span role="status">{interrupting ? 'Interrupting…' : entries.some((entry) => entry.state === 'applying') ? 'Applying queued messages…' : `${entries.length} ${entries.length === 1 ? 'message' : 'messages'} queued`}</span>
        <button className="task-action" disabled={working || task.state !== 'running' || !entries.some((entry) => entry.state === 'queued')}
          onClick={() => void perform(onInterrupt)}>Interrupt &amp; apply</button>
      </div>
      <ul>
        {entries.map((entry) => (
          <li key={entry.id}>
            <div className="task-queue-content">
              {entry.message.content && <p>{entry.message.content}</p>}
              {!!entry.message.attachments?.length && <div className="task-queue-files">{entry.message.attachments.map((file) => (
                <span className="task-file" key={file.id}>{file.preview && <img src={file.preview} alt="" />}<span>{file.name}</span></span>
              ))}</div>}
            </div>
            {entry.state === 'queued' ? <button className="task-action" disabled={working} aria-label={`Remove queued message: ${entry.message.content.slice(0, 40) || 'Attachment'}`}
              onClick={() => void perform(() => onRemove(entry.id))}>Remove</button> : <span className="task-state">Applying</span>}
          </li>
        ))}
      </ul>
      {error && <p className="task-error" role="alert">{error}</p>}
    </section>
  );
}
