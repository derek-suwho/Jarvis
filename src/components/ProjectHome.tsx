import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { Chat } from '../lib/chats';
import { sortByRecent } from '../lib/chats';
import type { Project } from '../lib/projects';
import { FolderIcon, PencilIcon, SideChatIcon } from './Icons';
import { RenameDialog } from './RenameDialog';

interface Props {
  project: Project;
  chats: Chat[];
  onSelect: (id: string) => void;
  onChange: (patch: Partial<Omit<Project, 'id'>>) => void;
  onDelete: () => void;
}

/** Shown under the composer on a project's home: its instructions and its chats. */
export function ProjectHome({ project, chats, onSelect, onChange, onDelete }: Props) {
  const errorId = useId();
  const instructionsHelpId = `${errorId}-instructions-help`;
  const instructionsErrorId = `${errorId}-instructions`;
  const deleteErrorId = `${errorId}-delete`;
  const deleteConfirmationId = `${errorId}-delete-confirmation`;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(project.instructions);
  const [armed, setArmed] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [instructionsError, setInstructionsError] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [openError, setOpenError] = useState('');
  const restoreInstructionsFocus = useRef(false);
  const instructionsRef = useRef<HTMLTextAreaElement>(null);
  const closeInstructions = () => {
    setInstructionsError('');
    restoreInstructionsFocus.current = true;
    setEditing(false);
  };
  const saveInstructions = () => {
    if (draft.trim().length > 4000) {
      setInstructionsError('Use instructions of 4,000 characters or fewer.');
      instructionsRef.current?.focus();
      return;
    }
    setInstructionsError('');
    try {
      onChange({ instructions: draft.trim() });
      closeInstructions();
    } catch {
      setInstructionsError('Could not save instructions. Your draft is still here. Try again.');
      instructionsRef.current?.focus();
    }
  };
  const onInstructionsActionKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if ((event.key === 'Enter' || event.key === ' ') && (event.repeat || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || event.keyCode === 229)) {
      event.preventDefault();
    }
  };
  const onInstructionsKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!editing || event.defaultPrevented || event.repeat || event.nativeEvent?.isComposing || event.nativeEvent?.keyCode === 229 || event.keyCode === 229) return;
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      saveInstructions();
    } else if (event.key === 'Escape' && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      setDraft(project.instructions);
      closeInstructions();
    }
  };
  const list = sortByRecent(chats.filter((c) => c.projectId === project.id && !c.archived));

  useEffect(() => {
    setDraft(project.instructions);
    setInstructionsError('');
    setEditing(false);
    setArmed(false);
    setDeleteError('');
    setOpenError('');
  }, [project.id]);

  useEffect(() => {
    if (!editing) setDraft(project.instructions);
  }, [project.instructions, editing]);

  useEffect(() => {
    setRenaming(false);
  }, [project.id]);

  useEffect(() => {
    if (!armed) return;
    const disarm = () => setArmed(false);
    window.addEventListener('blur', disarm);
    return () => window.removeEventListener('blur', disarm);
  }, [armed]);

  return (
    <div className="project-home">
      <div className="project-summary">
        <span>
          <FolderIcon />
          {list.length} {list.length === 1 ? 'conversation' : 'conversations'}
        </span>
        <button className="text-btn" onClick={() => setRenaming(true)}>
          <PencilIcon />
          Rename project
        </button>
      </div>
      <div className="project-card" onKeyDown={onInstructionsKeyDown}>
        <div className="project-card-head">
          <span>Instructions</span>
          {!editing && (
            <button
              className="text-btn"
              ref={(node) => {
                if (node && restoreInstructionsFocus.current) {
                  restoreInstructionsFocus.current = false;
                  node.focus();
                }
              }}
              onClick={() => setEditing(true)}
            >
              {project.instructions ? 'Edit' : 'Add'}
            </button>
          )}
        </div>
        {editing ? (
          <>
            <textarea
              ref={instructionsRef}
              aria-label="Project instructions"
              aria-invalid={instructionsError && draft.trim().length > 4000 ? true : undefined}
              aria-describedby={instructionsError ? `${instructionsHelpId} ${instructionsErrorId}` : instructionsHelpId}
              className="settings-textarea"
              rows={5}
              autoFocus
              maxLength={4000}
              placeholder="How should models behave in this project? e.g. “Answer as a thesis advisor; cite sources in APA.”"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setInstructionsError('');
              }}
              onKeyDown={onInstructionsKeyDown}
            />
            <div className="edit-actions">
              <button
                className="pill-btn"
                onKeyDown={onInstructionsActionKeyDown}
                onClick={(event) => {
                  if (event.defaultPrevented) return;
                  setDraft(project.instructions);
                  closeInstructions();
                }}
              >
                Cancel
              </button>
              <button
                className="pill-btn primary"
                onKeyDown={onInstructionsActionKeyDown}
                aria-keyshortcuts="Meta+Enter Control+Enter"
                title="Save instructions (⌘Enter / Ctrl+Enter)"
                onClick={saveInstructions}
              >
                Save
              </button>
            </div>
            <p id={instructionsHelpId} className="settings-hint">Press ⌘Enter or Ctrl+Enter to save. Press Escape to cancel without saving.</p>
            {instructionsError && <p id={instructionsErrorId} className="task-error" role="alert">{instructionsError}</p>}
          </>
        ) : (
          <p className={project.instructions ? 'project-instructions' : 'settings-hint'}>
            {project.instructions || 'No instructions yet. Chats in this project will follow what you write here.'}
          </p>
        )}
      </div>

      <div className="section-label">Chats in this project</div>
      {list.length === 0 ? (
        <p className="settings-hint">Start a chat above, or move one here from its ⋯ menu.</p>
      ) : (
        <ul className="project-chats">
          {list.map((c) => (
            <li key={c.id}>
              <button
                aria-describedby={openError ? `${errorId}-open` : undefined}
                onClick={() => {
                  setOpenError('');
                  try { onSelect(c.id); }
                  catch { setOpenError('Could not open this conversation. Try again.'); }
                }}
              >
                <SideChatIcon />
                <span className="history-title">{c.title}</span>
                <span className="mono">
                  {new Date(c.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        className="text-btn danger project-delete"
        aria-describedby={deleteError ? deleteErrorId : armed ? deleteConfirmationId : undefined}
        onBlur={() => setArmed(false)}
        onKeyDown={(event) => {
          if ((event.repeat || event.nativeEvent.isComposing || event.keyCode === 229) && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            return;
          }
          if (!armed || event.key !== 'Escape' || event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return;
          event.preventDefault();
          event.stopPropagation();
          setArmed(false);
        }}
        onClick={(event) => {
          if (event.defaultPrevented) return;
          setDeleteError('');
          if (!armed) { setArmed(true); return; }
          try { onDelete(); }
          catch {
            setArmed(false);
            setDeleteError('Could not delete project. Try again.');
          }
        }}
      >
        {armed ? 'Confirm delete project and its data' : 'Delete project'}
      </button>
      {renaming && (
        <RenameDialog
          title="Rename project"
          initialValue={project.name}
          onClose={() => setRenaming(false)}
          onSave={(name) => {
            onChange({ name });
            setRenaming(false);
          }}
        />
      )}
      <p id={deleteConfirmationId} className="settings-hint" role="status" aria-atomic={true}>
        {armed ? 'Deleting this project permanently removes its chats, project memory, and project history, including project history in chats moved elsewhere. This cannot be undone. Press Escape or move focus away to cancel.' : ''}
      </p>
      {deleteError && <p id={deleteErrorId} className="task-error" role="alert">{deleteError}</p>}
      {openError && <p id={`${errorId}-open`} className="task-error" role="alert">{openError}</p>}
    </div>
  );
}
