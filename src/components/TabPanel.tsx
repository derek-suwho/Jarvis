import type { ModelSettings } from '../lib/models';
import type { BrowserState, Tab } from '../lib/tabs';
import { tabTitle } from '../lib/tabs';
import { BrowserTab } from './BrowserTab';
import { ChatView } from './ChatView';
import { CloseIcon, CollapseIcon, ExpandIcon, GlobeIcon, SideChatIcon, SmallPlusIcon } from './Icons';

interface Props {
  tabs: Tab[];
  activeTabId: string | null;
  fullView: boolean;
  sidePendingId: string | null;
  model: ModelSettings;
  onModelChange: (s: ModelSettings) => void;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNewTab: () => void;
  onToggleFullView: () => void;
  onBrowserChange: (id: string, s: BrowserState) => void;
  onConvertToSideChat: (id: string) => void;
  onSideSend: (id: string, text: string) => void;
}

export function TabPanel(p: Props) {
  return (
    <section className="tab-panel">
      <div className="tab-strip">
        {p.tabs.map((t) => (
          <div
            key={t.id}
            className={`tab${t.id === p.activeTabId ? ' active' : ''}${t.kind === 'sidechat' ? ' side' : ''}`}
            onClick={() => p.onSelect(t.id)}
            onAuxClick={(e) => e.button === 1 && p.onClose(t.id)}
          >
            {t.kind === 'sidechat' ? <SideChatIcon /> : <GlobeIcon />}
            <span className="tab-title">{tabTitle(t)}</span>
            <button
              className="tab-close"
              title="Close tab"
              onClick={(e) => {
                e.stopPropagation();
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
        <button
          className="icon-btn"
          title={p.fullView ? 'Exit full view' : 'Full view'}
          onClick={p.onToggleFullView}
        >
          {p.fullView ? <CollapseIcon /> : <ExpandIcon />}
        </button>
      </div>

      {/* Inactive tabs stay mounted (hidden) so iframes keep their page and scroll position. */}
      {p.tabs.map((t) => (
        <div key={t.id} className="tab-body" hidden={t.id !== p.activeTabId}>
          {t.kind === 'browser' ? (
            <BrowserTab
              state={t.browser}
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
                pending={p.sidePendingId === t.id}
                model={p.model}
                onModelChange={p.onModelChange}
                onSend={(text) => p.onSideSend(t.id, text)}
                emptyTitle="Ask a side question"
                eyebrow="Side chat"
              />
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
