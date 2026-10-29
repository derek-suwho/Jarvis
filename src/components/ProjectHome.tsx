import { useEffect, useState } from 'react';
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
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(project.instructions);
  const [armed, setArmed] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const list = sortByRecent(chats.filter((c) => c.projectId === project.id && !c.archived));

  useEffect(() => {
    setDraft(project.instructions);
    setEditing(false);
    setArmed(false);
  }, [project.id, project.instructions]);

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
      <div className="project-card">
        <div className="project-card-head">
          <span>Instructions</span>
          {!editing && (
            <button className="text-btn" onClick={() => setEditing(true)}>
              {project.instructions ? 'Edit' : 'Add'}
            </button>
          )}
        </div>
        {editing ? (
          <>
            <textarea
              aria-label="Project instructions"
              className="settings-textarea"
              rows={5}
              autoFocus
              maxLength={4000}
              placeholder="How should models behave in this project? e.g. “Answer as a thesis advisor; cite sources in APA.”"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <div className="edit-actions">
              <button
                className="pill-btn"
                onClick={() => {
                  setDraft(project.instructions);
                  setEditing(false);
                }}
              >
                Cancel
              </button>
              <button
                className="pill-btn primary"
                onClick={() => {
                  onChange({ instructions: draft.trim() });
                  setEditing(false);
                }}
              >
                Save
              </button>
            </div>
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
              <button onClick={() => onSelect(c.id)}>
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
        onBlur={() => setArmed(false)}
        onClick={() => (armed ? onDelete() : setArmed(true))}
      >
        {armed ? 'Click again — chats move back to Recents' : 'Delete project'}
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
    </div>
  );
}
