import type { ReactNode } from 'react';
import { useRef } from 'react';
import type { Attachment } from '../lib/chats';
import type { ModelSettings } from '../lib/models';
import type { BrowserState, Tab } from '../lib/tabs';
import { currentUrl, tabTitle } from '../lib/tabs';
import { BrowserTab } from './BrowserTab';
import type { TaskResult, TaskSnapshot } from '../shared/tasks';
import { isActiveTask } from '../shared/tasks';
import { TaskStatus, taskStateLabel } from './TasksPanel';
import { ChatView } from './ChatView';
import { ResizeHandle, useStoredWidth } from './ResizeHandle';
import { CloseIcon, CollapseIcon, ExpandIcon, GlobeIcon, SideChatIcon, SmallPlusIcon } from './Icons';
import { SiteIcon } from './SiteIcon';

interface Props {
  tabs: Tab[];
  activeTabId: string | null;
  fullView: boolean;
  tasks: TaskSnapshot[];
  tasksReady: boolean;
  taskQueue: (task: TaskSnapshot) => ReactNode;
  model: ModelSettings;
  /** Buttons shown at the start of the tab strip (sidebar toggle, new chat) when the sidebar is collapsed. */
  onModelChange: (s: ModelSettings) => void;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNewTab: () => void;
  onToggleFullView: () => void;
  onBrowserChange: (id: string, s: BrowserState) => void;
  onConvertToSideChat: (id: string) => void;
  onSideSend: (id: string, text: string, attachments: Attachment[]) => Promise<TaskResult>;
  onSideStop: (id: string) => void;
  validateSideSend: (id: string, text: string, attachments: Attachment[]) => string | null;
}

function TabIcon({ tab }: { tab: Tab }) {
  if (tab.kind === 'sidechat') return <SideChatIcon />;
  const url = currentUrl(tab.browser);
  return url ? <SiteIcon site={url} fallback={<GlobeIcon />} /> : <GlobeIcon />;
}

export function TabPanel(p: Props) {
  const [width, setWidth] = useStoredWidth('jarvis.tabPanelWidth', 360, 1600);
  const ref = useRef<HTMLElement>(null);
  return (
    <section ref={ref} className="tab-panel" style={!p.fullView && width ? { flexBasis: width } : undefined}>
      {!p.fullView && (
        <ResizeHandle minWidth={360} maxWidth={1600} label="Resize side panel" edge="left" measure={() => ref.current?.offsetWidth ?? 0} onResize={setWidth} onReset={() => setWidth(null)} />
      )}
      {/* The tab strip doubles as this pane's title bar, like ChatGPT desktop. */}
      <div className="tab-strip" role="tablist" aria-label="Workspace tabs">
        {p.tabs.map((t, index) => (
          <div
            key={t.id}
            className={`tab${t.id === p.activeTabId ? ' active' : ''}${t.kind === 'sidechat' ? ' side' : ''}`}
            role="tab"
            id={`workspace-tab-${encodeURIComponent(t.id)}`}
            aria-controls={`workspace-panel-${encodeURIComponent(t.id)}`}
            aria-selected={t.id === p.activeTabId}
            tabIndex={t.id === p.activeTabId || (!p.tabs.some(tab => tab.id === p.activeTabId) && index === 0) ? 0 : -1}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget || event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
              if (event.key === 'Delete') {
                event.preventDefault();
                if (p.tabs.length > 1) {
                  const neighbor = index < p.tabs.length - 1 ? index + 1 : index - 1;
                  event.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="tab"]')[neighbor]?.focus();
                }
                p.onClose(t.id);
                return;
              }
              const destination = event.key === 'ArrowLeft' ? (index + p.tabs.length - 1) % p.tabs.length
                : event.key === 'ArrowRight' ? (index + 1) % p.tabs.length
                : event.key === 'Home' ? 0 : event.key === 'End' ? p.tabs.length - 1 : null;
              if (destination !== null) {
                event.preventDefault();
                p.onSelect(p.tabs[destination].id);
                event.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="tab"]')[destination]?.focus();
                return;
              }
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                p.onSelect(t.id);
              }
            }}
            onClick={() => p.onSelect(t.id)}
            onAuxClick={(e) => e.button === 1 && p.onClose(t.id)}
          >
            <TabIcon tab={t} />
            <span className="tab-title">{tabTitle(t)}</span>
            <TaskStatus task={p.tasks.find((task) => task.target.kind === 'sidechat' && task.target.id === t.id)} />
            <button
              className="tab-close"
              title="Close tab"
              onClick={(e) => {
                e.stopPropagation();
                if (p.tabs.length > 1) {
                  const neighbor = index < p.tabs.length - 1 ? index + 1 : index - 1;
                  e.currentTarget.parentElement?.parentElement?.querySelectorAll<HTMLElement>('[role="tab"]')[neighbor]?.focus();
                }
                p.onClose(t.id);
              }}
            >
              <CloseIcon />
            </button>
          </div>
        ))}
        <button className="icon-btn" title="New tab (⇧⌘B)" onClick={p.onNewTab}>
          <SmallPlusIcon />
        </button>
        <div className="spacer" />
        <button className="icon-btn" title={p.fullView ? 'Exit full view' : 'Full view'} onClick={p.onToggleFullView}>
          {p.fullView ? <CollapseIcon /> : <ExpandIcon />}
        </button>
      </div>

      {/* Keep tab UI state mounted; only the active browser may own a live page. */}
      {p.tabs.map((t) => {
        const task = p.tasks.find((item) => item.target.kind === 'sidechat' && item.target.id === t.id && isActiveTask(item));
        return (
        <div key={t.id} className="tab-body" role="tabpanel" tabIndex={0} id={`workspace-panel-${encodeURIComponent(t.id)}`} aria-labelledby={`workspace-tab-${encodeURIComponent(t.id)}`} hidden={t.id !== p.activeTabId}>
          {t.kind === 'browser' ? (
            <BrowserTab
              state={t.browser}
              active={t.id === p.activeTabId}
              onChange={(s) => p.onBrowserChange(t.id, s)}
              onOpenSideChat={() => p.onConvertToSideChat(t.id)}
            />
          ) : (
            <div className="side-chat">
              <div className="side-chat-banner">
                <span className="temp-pill">Temporary</span>
                <span>
                  {t.sidechat.sourceTitle
                    ? `Knows “${t.sidechat.sourceTitle}” up to when it opened (${t.sidechat.context.length} messages). `
                    : 'No conversation context. '}
                  Deleted when closed.
                </span>
              </div>
              <ChatView
                chat={{ id: t.id, title: 'Side chat', messages: t.sidechat.messages, updatedAt: 0 }}
                pending={!!task}
                submitDisabled={!p.tasksReady}
                taskQueue={task && p.taskQueue(task)}
                taskStatus={task && taskStateLabel(task)}
                streamingId={task?.messages.filter((message) => message.role === 'assistant' && !message.outcome).at(-1)?.id}
                onStop={() => p.onSideStop(t.id)}
                draftKey={`side:${t.id}`}
                persistDraft={false}
                model={p.model}
                onModelChange={p.onModelChange}
                onSend={(text, attachments) => p.onSideSend(t.id, text, attachments)}
                validateSend={(text, attachments) => p.validateSideSend(t.id, text, attachments)}
                emptyTitle="Ask a side question"
                eyebrow="Side chat"
              />
            </div>
          )}
        </div>
      ); })}
    </section>
  );
}
