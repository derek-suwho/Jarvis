import { useEffect, useRef, useState } from 'react';
import { ChatGPTConnectBanner, ChatGPTPlanNote, ChatGPTWelcome } from './components/ChatGPTAccount';
import { ChatView } from './components/ChatView';
import { ComposeIcon, PanelRightIcon, SidebarIcon } from './components/Icons';
import { NewTabMenu } from './components/NewTabMenu';
import { SettingsDialog } from './components/SettingsDialog';
import { Sidebar } from './components/Sidebar';
import { TabPanel } from './components/TabPanel';
import './components/TabPanel.css';
import type { Chat } from './lib/chats';
import type { Message } from './lib/chats';
import { appendMessage, createChat, loadChats, mockReply, newId, saveChats, updateMessage } from './lib/chats';
import { fetchChatGPTModels, streamChatGPTReply } from './lib/chatgptClient';
import type { ModelSettings } from './lib/models';
import { AUTO_MODEL_ID, DEFAULT_SETTINGS, findModel, getCatalog, modelLabel, setLiveOpenAIModels } from './lib/models';
import type { Subscriptions } from './lib/subscriptions';
import { loadSubscriptions, saveSubscriptions } from './lib/subscriptions';
import type { BrowserState, Tab } from './lib/tabs';
import { createBrowserTab, createSideChat, mockSideReply, updateSideChat } from './lib/tabs';
import { useChatGPT } from './lib/useChatGPT';

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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [subscriptions, setSubscriptions] = useState<Subscriptions>(loadSubscriptions);
  const chatgpt = useChatGPT();

  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [fullView, setFullView] = useState(false);
  const [panelVisible, setPanelVisible] = useState(true);
  const [sidePendingId, setSidePendingId] = useState<string | null>(null);

  useEffect(() => saveChats(chats), [chats]);
  useEffect(() => saveSubscriptions(subscriptions), [subscriptions]);

  const activeChat = chats.find((c) => c.id === activeId) ?? null;
  const panelOpen = tabs.length > 0 && panelVisible;
  const chatgptConnected = chatgpt.state.phase === 'connected';

  // When signed in, the OpenAI group lists the account's real models instead of placeholders.
  const [, setCatalogVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    if (!chatgptConnected) {
      setLiveOpenAIModels(null);
      setCatalogVersion((v) => v + 1);
      return;
    }
    fetchChatGPTModels()
      .then((models) => {
        if (cancelled) return;
        setLiveOpenAIModels(models);
        setCatalogVersion((v) => v + 1);
        setModel((m) =>
          m.modelId !== AUTO_MODEL_ID && !findModel(m.modelId) && models[0] ? { ...m, modelId: models[0].slug } : m,
        );
      })
      .catch(() => {
        // Keep placeholders; sending will surface the real error.
      });
    return () => {
      cancelled = true;
    };
  }, [chatgptConnected]);

  /** ChatGPT slug for the current selection, or null when it can't go through the ChatGPT plan. */
  const chatgptSlug = (): string | null => {
    if (!chatgptConnected) return null;
    if (model.modelId === AUTO_MODEL_ID) return getCatalog().find((m) => m.group === 'OpenAI')?.id ?? null;
    return findModel(model.modelId)?.group === 'OpenAI' ? model.modelId : null;
  };
  const usingChatGPTPlan = chatgptSlug() !== null;
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
    const userMsg: Message = { id: newId(), role: 'user', content: text };
    const history = [...(activeChat?.messages ?? []), userMsg];
    setChats((cs) => appendMessage(cs, chatId, userMsg));
    setPendingId(chatId);
    const model = label();
    const slug = chatgptSlug();
    if (slug) {
      streamChatGPTReply({
        model: slug,
        label: model,
        history,
        append: (msg) => setChats((cs) => appendMessage(cs, chatId, msg)),
        update: (msgId, content) => setChats((cs) => updateMessage(cs, chatId, msgId, content)),
        setPending: (p) => setPendingId((cur) => (p ? chatId : cur === chatId ? null : cur)),
      });
      return;
    }
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

  // Like ChatGPT desktop, showing the tab panel collapses the sidebar; hiding the panel restores it.
  const collapsedForPanel = useRef(false);
  const showPanel = (visible: boolean) => {
    setPanelVisible(visible);
    if (visible && sidebarOpen) {
      collapsedForPanel.current = true;
      setSidebarOpen(false);
    } else if (!visible && collapsedForPanel.current) {
      collapsedForPanel.current = false;
      setSidebarOpen(true);
    }
  };

  const openTab = (tab: Tab, full: boolean) => {
    setTabs((ts) => [...ts, tab]);
    setActiveTabId(tab.id);
    setFullView(full);
    showPanel(true);
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
    if (rest.length === 0) {
      setFullView(false);
      showPanel(false);
    }
  };

  const setBrowser = (id: string, browser: BrowserState) =>
    setTabs((ts) => ts.map((t) => (t.id === id && t.kind === 'browser' ? { ...t, browser } : t)));

  const sendSide = (tabId: string, text: string) => {
    setTabs((ts) =>
      updateSideChat(ts, tabId, (s) => ({ ...s, messages: [...s.messages, { id: newId(), role: 'user', content: text }] })),
    );
    setSidePendingId(tabId);
    const model = label();
    const slug = chatgptSlug();
    const side = tabs.find((t) => t.id === tabId);
    if (slug && side?.kind === 'sidechat') {
      // Frozen context snapshot first, then this side chat's own messages.
      const userMsg: Message = { id: newId(), role: 'user', content: text };
      const history = [...side.sidechat.context, ...side.sidechat.messages, userMsg];
      setTabs((ts) => updateSideChat(ts, tabId, (s) => ({ ...s, messages: [...s.messages.slice(0, -1), userMsg] })));
      streamChatGPTReply({
        model: slug,
        label: model,
        history,
        append: (msg) => setTabs((ts) => updateSideChat(ts, tabId, (s) => ({ ...s, messages: [...s.messages, msg] }))),
        update: (msgId, content) =>
          setTabs((ts) =>
            updateSideChat(ts, tabId, (s) => ({
              ...s,
              messages: s.messages.map((m) => (m.id === msgId ? { ...m, content } : m)),
            })),
          ),
        setPending: (p) => setSidePendingId((cur) => (p ? tabId : cur === tabId ? null : cur)),
      });
      return;
    }
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
      else if (!e.shiftKey && !e.altKey && e.key === ',') setSettingsOpen(true);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const leading = !sidebarOpen && (
    <>
      <button
        className="icon-btn"
        title="Open sidebar"
        onClick={() => {
          collapsedForPanel.current = false;
          setSidebarOpen(true);
        }}
      >
        <SidebarIcon />
      </button>
      <button className="icon-btn" title="New chat" onClick={() => setActiveId(null)}>
        <ComposeIcon />
      </button>
    </>
  );

  // Chat title bar: full width without the panel; the right pane's own header with it.
  const chatBar = (
    <>
      {!panelOpen && leading}
      <span className="topbar-title">{activeChat?.title ?? 'New chat'}</span>
      <div className="spacer" />
      <NewTabMenu
        onNewTab={() => openTab(createBrowserTab(), false)}
        onNewTabFull={() => openTab(createBrowserTab(), true)}
        onSideChat={openSideChat}
      />
      {tabs.length > 0 && (
        <button
          className={`icon-btn${panelOpen ? ' pressed' : ''}`}
          title={panelOpen ? 'Hide side panel' : 'Show side panel'}
          onClick={() => showPanel(!panelOpen)}
        >
          <PanelRightIcon />
        </button>
      )}
    </>
  );

  return (
    <div className={`app${sidebarOpen ? '' : ' sidebar-closed'}`}>
      {sidebarOpen && (
        <Sidebar
          chats={chats}
          activeId={activeId}
          onNewChat={() => setActiveId(null)}
          onSelect={setActiveId}
          onDelete={deleteChat}
          onCollapse={() => {
            collapsedForPanel.current = false;
            setSidebarOpen(false);
          }}
          onOpenSettings={() => setSettingsOpen(true)}
          subscriptionCount={Object.keys(subscriptions).length}
        />
      )}
      <main className="main">
        {!panelOpen && <header className="topbar">{chatBar}</header>}
        <div className={`workspace${panelOpen ? ' split' : ''}`}>
          {panelOpen && (
            <TabPanel
              tabs={tabs}
              activeTabId={activeTabId}
              fullView={fullView}
              sidePendingId={sidePendingId}
              model={model}
              leading={leading}
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
              {panelOpen && <header className="topbar">{chatBar}</header>}
              <ChatView
                chat={activeChat}
                pending={pendingId !== null && pendingId === activeId}
                model={model}
                onModelChange={setModel}
                onSend={send}
                suggestions={SUGGESTIONS}
                banner={<ChatGPTConnectBanner account={chatgpt} />}
                composerNote={usingChatGPTPlan && <ChatGPTPlanNote />}
              />
            </div>
          )}
        </div>
      </main>
      {settingsOpen && (
        <SettingsDialog
          subscriptions={subscriptions}
          onChange={setSubscriptions}
          onClose={() => setSettingsOpen(false)}
          chatgpt={chatgpt}
        />
      )}
      <ChatGPTWelcome account={chatgpt} />
    </div>
  );
}
