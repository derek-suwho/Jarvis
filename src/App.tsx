import { useEffect, useRef, useState } from 'react';
import { ChatGPTConnectBanner, ChatGPTPlanNote, ChatGPTWelcome } from './components/ChatGPTAccount';
import { ChatMenu } from './components/ChatMenu';
import { ChatView } from './components/ChatView';
import './components/Dialogs.css';
import { ComposeIcon, PanelRightIcon, SidebarIcon, TemporaryIcon } from './components/Icons';
import { NewTabMenu } from './components/NewTabMenu';
import { ProjectHome } from './components/ProjectHome';
import { SearchDialog } from './components/SearchDialog';
import type { SettingsSection } from './components/SettingsDialog';
import { SettingsDialog } from './components/SettingsDialog';
import { Sidebar } from './components/Sidebar';
import { TabPanel } from './components/TabPanel';
import './components/TabPanel.css';
import type { Attachment, Chat, Feedback, Message } from './lib/chats';
import {
  appendMessage,
  chatToMarkdown,
  createChat,
  loadChats,
  newId,
  renameChat,
  saveChats,
  togglePin,
  truncateFrom,
  updateChat,
  updateMessage,
} from './lib/chats';
import type { DesktopCommand } from './lib/desktop';
import { fileSlug, isDesktop, isMac, saveTextFile } from './lib/desktop';
import type { ModelSettings } from './lib/models';
import { AUTO_MODEL_ID, DEFAULT_SETTINGS, findModel, getCatalog, modelLabel, setLiveOpenAIModels } from './lib/models';
import { fetchChatGPTModels, streamChatGPTReply } from './lib/chatgptClient';
import type { Preferences } from './lib/preferences';
import { greeting, loadPreferences, savePreferences } from './lib/preferences';
import type { Project } from './lib/projects';
import { createProject, loadProjects, saveProjects, updateProject } from './lib/projects';
import type { Subscriptions } from './lib/subscriptions';
import { loadSubscriptions, saveSubscriptions } from './lib/subscriptions';
import type { BrowserState, Tab } from './lib/tabs';
import { createBrowserTab, createSideChat, mockSideReply, updateSideChat } from './lib/tabs';
import { useChatGPT } from './lib/useChatGPT';
import type { LiveReply } from './useReplyStream';
import { useReplyStream } from './useReplyStream';

const REPLY_DELAY_MS = 700;

const SUGGESTIONS = [
  'Compare Tauri and Electron for a desktop chat app',
  'Turn these lecture notes into a 40-minute study plan',
  'Explain how prompt caching changes API costs',
];

function useResolvedTheme(theme: Preferences['theme']) {
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.theme = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme;
    };
    apply();
    window.jarvis?.setTheme(theme);
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
}

export function App() {
  const [chats, setChats] = useState<Chat[]>(loadChats);
  const [projects, setProjects] = useState<Project[]>(loadProjects);
  const [prefs, setPrefs] = useState<Preferences>(loadPreferences);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [temporary, setTemporary] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [model, setModel] = useState<ModelSettings>(DEFAULT_SETTINGS);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [settings, setSettings] = useState<SettingsSection | null>(null);
  const [subscriptions, setSubscriptions] = useState<Subscriptions>(loadSubscriptions);
  const chatgpt = useChatGPT();
  const { streaming, start: startReply, stop } = useReplyStream(setChats);

  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [fullView, setFullView] = useState(false);
  const [panelVisible, setPanelVisible] = useState(true);
  const [sidePendingId, setSidePendingId] = useState<string | null>(null);

  useEffect(() => saveChats(chats), [chats]);
  useEffect(() => saveProjects(projects), [projects]);
  useEffect(() => savePreferences(prefs), [prefs]);
  useEffect(() => saveSubscriptions(subscriptions), [subscriptions]);
  useResolvedTheme(prefs.theme);
  useEffect(() => {
    document.documentElement.classList.toggle('desktop-mac', isDesktop() && isMac());
  }, []);

  const activeChat = chats.find((c) => c.id === activeId) ?? null;
  const panelOpen = tabs.length > 0 && panelVisible;
  const activeProject = projects.find((p) => p.id === (activeChat?.projectId ?? activeProjectId)) ?? null;
  const pending = !!streaming && streaming.chatId === activeId;

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
  /** Real ChatGPT reply config for a conversation, or undefined to use the placeholder stream. */
  const live = (history: Message[]): LiveReply | undefined => {
    const slug = chatgptSlug();
    return slug ? { slug, history } : undefined;
  };
  const label = () => {
    const { name, detail } = modelLabel(model);
    return `${name} ${detail}`.trim();
  };

  /** Switches view; temporary chats are discarded once you leave them, as in ChatGPT. */
  const navigate = (chatId: string | null, projectId: string | null = null) => {
    if (streaming && streaming.chatId !== chatId) stop();
    setChats((cs) => cs.filter((c) => !c.temporary || c.id === chatId));
    setActiveId(chatId);
    setActiveProjectId(projectId);
    if (chatId) setTemporary(false);
  };

  // A chat is only created on first send, so "New chat" never leaves empty entries in history.
  const send = (text: string, attachments: Attachment[]) => {
    let id = activeId;
    if (!id) {
      const chat = createChat(Date.now(), {
        ...(activeProjectId ? { projectId: activeProjectId } : {}),
        ...(temporary ? { temporary: true } : {}),
      });
      id = chat.id;
      setChats((cs) => [chat, ...cs]);
      setActiveId(id);
    }
    const msg: Message = { id: newId(), role: 'user', content: text, ...(attachments.length ? { attachments } : {}) };
    setChats((cs) => appendMessage(cs, id, msg));
    startReply(id, text, label(), attachments, live([...(activeChat?.messages ?? []), msg]));
  };

  const editMessage = (messageId: string, text: string) => {
    if (!activeChat) return;
    const original = activeChat.messages.find((m) => m.id === messageId);
    const chatId = activeChat.id;
    const edited: Message = { ...original!, id: newId(), content: text };
    const before = activeChat.messages.slice(0, activeChat.messages.findIndex((m) => m.id === messageId));
    setChats((cs) => appendMessage(truncateFrom(cs, chatId, messageId), chatId, edited));
    startReply(chatId, text, label(), original?.attachments, live([...before, edited]));
  };

  const regenerate = (messageId: string) => {
    if (!activeChat) return;
    const i = activeChat.messages.findIndex((m) => m.id === messageId);
    const prompt = activeChat.messages
      .slice(0, i)
      .reverse()
      .find((m) => m.role === 'user');
    setChats((cs) => truncateFrom(cs, activeChat.id, messageId));
    startReply(activeChat.id, prompt?.content ?? '', label(), prompt?.attachments, live(activeChat.messages.slice(0, i)));
  };

  const setFeedback = (messageId: string, feedback: Feedback | undefined) =>
    activeId && setChats((cs) => updateMessage(cs, activeId, messageId, { feedback }));

  const deleteChat = (id: string) => {
    if (streaming?.chatId === id) stop();
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

  const exportChat = (id: string) => {
    const chat = chats.find((c) => c.id === id);
    if (chat) void saveTextFile(`${fileSlug(chat.title)}.md`, chatToMarkdown(chat), 'text/markdown');
  };

  const chatActions = {
    onRename: (id: string) => {
      setSidebarOpen(true);
      setRenamingId(id);
    },
    onTogglePin: (id: string) => setChats((cs) => togglePin(cs, id)),
    onArchive: (id: string) => {
      setChats((cs) => updateChat(cs, id, { archived: true }));
      if (id === activeId) navigate(null);
    },
    onDelete: deleteChat,
    onExport: exportChat,
    onMove: (id: string, projectId: string | undefined) => setChats((cs) => updateChat(cs, id, { projectId })),
  };

  const deleteProject = (id: string) => {
    setProjects((ps) => ps.filter((p) => p.id !== id));
    setChats((cs) => cs.map((c) => (c.projectId === id ? { ...c, projectId: undefined } : c)));
    navigate(null);
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
        append: (msg: Message) =>
          setTabs((ts) => updateSideChat(ts, tabId, (s) => ({ ...s, messages: [...s.messages, msg] }))),
        update: (msgId: string, content: string) =>
          setTabs((ts) =>
            updateSideChat(ts, tabId, (s) => ({
              ...s,
              messages: s.messages.map((m) => (m.id === msgId ? { ...m, content } : m)),
            })),
          ),
        onFirstToken: () => setSidePendingId((cur) => (cur === tabId ? null : cur)),
        onSettled: () => setSidePendingId((cur) => (cur === tabId ? null : cur)),
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

  const runCommand = (c: DesktopCommand) => {
    if (c === 'new-chat') navigate(null);
    else if (c === 'search') setSearchOpen(true);
    else if (c === 'settings') setSettings('General');
    else setSidebarOpen((o) => !o);
  };

  // Keyboard shortcuts read the latest handlers through a ref so the listener is registered once.
  const shortcuts = useRef({ openTab, openSideChat, runCommand });
  shortcuts.current = { openTab, openSideChat, runCommand };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const s = shortcuts.current;
      if (e.shiftKey && !e.altKey && e.code === 'KeyB') s.openTab(createBrowserTab(), false);
      else if (e.shiftKey && !e.altKey && e.code === 'KeyF') s.openTab(createBrowserTab(), true);
      else if (e.altKey && !e.shiftKey && e.code === 'KeyS') s.openSideChat();
      else if (e.shiftKey && !e.altKey && e.code === 'KeyO') s.runCommand('new-chat');
      else if (e.shiftKey && !e.altKey && e.code === 'KeyS') s.runCommand('toggle-sidebar');
      else if (!e.shiftKey && !e.altKey && e.code === 'KeyK') s.runCommand('search');
      else if (!e.shiftKey && !e.altKey && e.key === ',') s.runCommand('settings');
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    const off = window.jarvis?.onCommand((c) => shortcuts.current.runCommand(c));
    return () => {
      window.removeEventListener('keydown', onKey);
      off?.();
    };
  }, []);

  const leading = !sidebarOpen && (
    <>
      <button
        className="icon-btn"
        title="Open sidebar (⇧⌘S)"
        onClick={() => {
          collapsedForPanel.current = false;
          setSidebarOpen(true);
        }}
      >
        <SidebarIcon />
      </button>
      <button className="icon-btn" title="New chat (⇧⌘O)" onClick={() => navigate(null)}>
        <ComposeIcon />
      </button>
    </>
  );

  // Chat title bar: full width without the panel; the right pane's own header with it.
  const chatBar = (
    <>
      {!panelOpen && leading}
      {activeProject && (
        <button className="crumb" onClick={() => navigate(null, activeProject.id)}>
          {activeProject.name}
          {activeChat && <span className="crumb-sep">/</span>}
        </button>
      )}
      <span className="topbar-title">{activeChat?.title ?? ''}</span>
      {activeChat?.temporary && <span className="temp-pill">Temporary</span>}
      <div className="spacer" />
      {activeChat && !activeChat.temporary && <ChatMenu chat={activeChat} projects={projects} variant="topbar" {...chatActions} />}
      {!activeChat && !activeProjectId && (
        <button
          className={`icon-btn${temporary ? ' pressed' : ''}`}
          title={temporary ? 'Turn off temporary chat' : 'Temporary chat — not saved to history'}
          aria-pressed={temporary}
          onClick={() => setTemporary((t) => !t)}
        >
          <TemporaryIcon />
        </button>
      )}
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

  const emptyCopy = temporary
    ? { eyebrow: 'Temporary chat', title: 'Temporary Chat', placeholder: 'Ask anything — this chat won’t be saved' }
    : activeProject
      ? { eyebrow: 'Project', title: activeProject.name, placeholder: `New chat in ${activeProject.name}` }
      : { eyebrow: 'New conversation', title: greeting(prefs.name), placeholder: undefined };

  return (
    <div className={`app${sidebarOpen ? '' : ' sidebar-closed'}`}>
      {sidebarOpen && (
        <Sidebar
          chats={chats}
          projects={projects}
          activeId={activeId}
          activeProjectId={activeId ? null : activeProjectId}
          renamingId={renamingId}
          userName={prefs.name}
          subscriptionCount={Object.keys(subscriptions).length}
          onNewChat={() => navigate(null)}
          onSelect={(id) => navigate(id)}
          onSelectProject={(id) => navigate(null, id)}
          onCreateProject={(name) => {
            const p = createProject(name);
            if (!p) return;
            setProjects((ps) => [...ps, p]);
            navigate(null, p.id);
          }}
          onRenameDone={(id, title) => {
            setRenamingId(null);
            if (title !== null) setChats((cs) => renameChat(cs, id, title));
          }}
          onSearch={() => setSearchOpen(true)}
          onCollapse={() => {
            collapsedForPanel.current = false;
            setSidebarOpen(false);
          }}
          onOpenSettings={() => setSettings('General')}
          {...chatActions}
        />
      )}
      <main className="main">
        {!panelOpen && <header className="topbar drag-region">{chatBar}</header>}
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
                pending={pending}
                streamingId={pending ? streaming?.messageId : null}
                model={model}
                onModelChange={setModel}
                onSend={send}
                onStop={stop}
                onEdit={editMessage}
                onRegenerate={regenerate}
                onFeedback={setFeedback}
                eyebrow={emptyCopy.eyebrow}
                emptyTitle={emptyCopy.title}
                placeholder={emptyCopy.placeholder}
                suggestions={temporary || activeProject ? undefined : SUGGESTIONS}
                disclaimer
                emptyFooter={
                  temporary ? (
                    <p className="settings-hint temp-note">
                      This chat won’t appear in history or be used for memory. It’s discarded when you leave it.
                    </p>
                  ) : activeProject && !activeChat ? (
                    <ProjectHome
                      project={activeProject}
                      chats={chats}
                      onSelect={(id) => navigate(id)}
                      onChange={(patch) => setProjects((ps) => updateProject(ps, activeProject.id, patch))}
                      onDelete={() => deleteProject(activeProject.id)}
                    />
                  ) : undefined
                }
                banner={temporary || activeProject ? undefined : <ChatGPTConnectBanner account={chatgpt} />}
                composerNote={usingChatGPTPlan && <ChatGPTPlanNote />}
              />
            </div>
          )}
        </div>
      </main>
      {searchOpen && (
        <SearchDialog chats={chats} onSelect={(id) => navigate(id)} onNewChat={() => navigate(null)} onClose={() => setSearchOpen(false)} />
      )}
      {settings && (
        <SettingsDialog
          initialSection={settings}
          subscriptions={subscriptions}
          onChange={setSubscriptions}
          preferences={prefs}
          onPreferencesChange={setPrefs}
          chats={chats}
          onUnarchive={(id) => setChats((cs) => updateChat(cs, id, { archived: false }))}
          onArchiveAll={() => {
            setChats((cs) => cs.map((c) => (c.temporary ? c : { ...c, archived: true })));
            navigate(null);
          }}
          onDeleteAll={() => {
            stop();
            setChats([]);
            navigate(null);
          }}
          onExportAll={() =>
            void saveTextFile('jarvis-chats.json', JSON.stringify(chats.filter((c) => !c.temporary), null, 2), 'application/json')
          }
          onClose={() => setSettings(null)}
          chatgpt={chatgpt}
        />
      )}
      <ChatGPTWelcome account={chatgpt} />
    </div>
  );
}
