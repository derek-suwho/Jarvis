import { useEffect, useRef, useState } from 'react';
import { ChatView } from './components/ChatView';
import { ComposeIcon, SidebarIcon } from './components/Icons';
import { NewTabMenu } from './components/NewTabMenu';
import { Sidebar } from './components/Sidebar';
import { TabPanel } from './components/TabPanel';
import './components/TabPanel.css';
import type { Chat } from './lib/chats';
import { appendMessage, createChat, loadChats, mockReply, newId, saveChats } from './lib/chats';
import type { ModelSettings } from './lib/models';
import { DEFAULT_SETTINGS, modelLabel } from './lib/models';
import type { BrowserState, Tab } from './lib/tabs';
import { createBrowserTab, createSideChat, mockSideReply, updateSideChat } from './lib/tabs';

const REPLY_DELAY_MS = 700;

const SUGGESTIONS = [
  'Compare Tauri and Electron for a desktop chat app',
  'Turn these lecture notes into a 40-minute study plan',
  'Explain how prompt caching changes API costs',
];

export function App() {
  const [chats, setChats] = useState<Chat[]>(loadChats);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [model, setModel] = useState<ModelSettings>(DEFAULT_SETTINGS);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [fullView, setFullView] = useState(false);
  const [sidePendingId, setSidePendingId] = useState<string | null>(null);

  useEffect(() => saveChats(chats), [chats]);

  const activeChat = chats.find((c) => c.id === activeId) ?? null;
  const panelOpen = tabs.length > 0;
  const label = () => {
    const { name, detail } = modelLabel(model);
    return `${name} ${detail}`.trim();
  };

  // A chat is only created on first send, so "New chat" never leaves empty entries in history.
  const send = (text: string) => {
    let id = activeId;
    if (!id) {
      const chat = createChat();
      id = chat.id;
      setChats((cs) => [chat, ...cs]);
      setActiveId(id);
    }
    const chatId = id;
    setChats((cs) => appendMessage(cs, chatId, { id: newId(), role: 'user', content: text }));
    setPendingId(chatId);
    const model = label();
    setTimeout(() => {
      setChats((cs) =>
        appendMessage(cs, chatId, { id: newId(), role: 'assistant', content: mockReply(text, model), model }),
      );
      setPendingId(null);
    }, REPLY_DELAY_MS);
  };

  const deleteChat = (id: string) => {
    setChats((cs) => cs.filter((c) => c.id !== id));
    if (id === activeId) setActiveId(null);
  };

  const openTab = (tab: Tab, full: boolean) => {
    setTabs((ts) => [...ts, tab]);
    setActiveTabId(tab.id);
    setFullView(full);
  };

  const openSideChat = () => openTab(createSideChat(activeChat), false);

  // Replace a new-tab page with a side chat, as its "Side chat" tool does.
  const convertToSideChat = (id: string) => {
    const side = { ...createSideChat(activeChat), id };
    setTabs((ts) => ts.map((t) => (t.id === id ? side : t)));
  };

  const closeTab = (id: string) => {
    const i = tabs.findIndex((t) => t.id === id);
    const rest = tabs.filter((t) => t.id !== id);
    setTabs(rest);
    if (id === activeTabId) setActiveTabId(rest[Math.min(i, rest.length - 1)]?.id ?? null);
    if (rest.length === 0) setFullView(false);
  };

  const setBrowser = (id: string, browser: BrowserState) =>
    setTabs((ts) => ts.map((t) => (t.id === id && t.kind === 'browser' ? { ...t, browser } : t)));

  const sendSide = (tabId: string, text: string) => {
    setTabs((ts) =>
      updateSideChat(ts, tabId, (s) => ({ ...s, messages: [...s.messages, { id: newId(), role: 'user', content: text }] })),
    );
    setSidePendingId(tabId);
    const model = label();
    setTimeout(() => {
      setTabs((ts) =>
        updateSideChat(ts, tabId, (s) => ({
          ...s,
          messages: [...s.messages, { id: newId(), role: 'assistant', content: mockSideReply(text, model, s), model }],
        })),
      );
      setSidePendingId(null);
    }, REPLY_DELAY_MS);
  };

  // Keyboard shortcuts read the latest handlers through a ref so the listener is registered once.
  const shortcuts = useRef({ openTab, openSideChat });
  shortcuts.current = { openTab, openSideChat };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const s = shortcuts.current;
      if (e.shiftKey && !e.altKey && e.code === 'KeyB') s.openTab(createBrowserTab(), false);
      else if (e.shiftKey && !e.altKey && e.code === 'KeyF') s.openTab(createBrowserTab(), true);
      else if (e.altKey && !e.shiftKey && e.code === 'KeyS') s.openSideChat();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app">
      {sidebarOpen && (
        <Sidebar
          chats={chats}
          activeId={activeId}
          onNewChat={() => setActiveId(null)}
          onSelect={setActiveId}
          onDelete={deleteChat}
          onCollapse={() => setSidebarOpen(false)}
        />
      )}
      <main className="main">
        <header className="topbar">
          {!sidebarOpen && (
            <>
              <button className="icon-btn" title="Open sidebar" onClick={() => setSidebarOpen(true)}>
                <SidebarIcon />
              </button>
              <button className="icon-btn" title="New chat" onClick={() => setActiveId(null)}>
                <ComposeIcon />
              </button>
            </>
          )}
          <span className="topbar-title">{activeChat?.title ?? ''}</span>
          <div className="spacer" />
          <NewTabMenu
            onNewTab={() => openTab(createBrowserTab(), false)}
            onNewTabFull={() => openTab(createBrowserTab(), true)}
            onSideChat={openSideChat}
          />
        </header>
        <div className={`workspace${panelOpen ? ' split' : ''}`}>
          {panelOpen && (
            <TabPanel
              tabs={tabs}
              activeTabId={activeTabId}
              fullView={fullView}
              sidePendingId={sidePendingId}
              model={model}
              onModelChange={setModel}
              onSelect={setActiveTabId}
              onClose={closeTab}
              onNewTab={() => openTab(createBrowserTab(), fullView)}
              onToggleFullView={() => setFullView((f) => !f)}
              onBrowserChange={setBrowser}
              onConvertToSideChat={convertToSideChat}
              onSideSend={sendSide}
            />
          )}
          {!(panelOpen && fullView) && (
            <div className="chat-pane">
              <ChatView
                chat={activeChat}
                pending={pendingId !== null && pendingId === activeId}
                model={model}
                onModelChange={setModel}
                onSend={send}
                suggestions={SUGGESTIONS}
              />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
