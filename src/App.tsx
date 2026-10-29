import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ChatGPTPlanNote, ChatGPTWelcome } from './components/ChatGPTAccount';
import { ChatMenu } from './components/ChatMenu';
import { ChatView } from './components/ChatView';
import './components/Dialogs.css';
import { CloseIcon, ComposeIcon, PanelRightIcon, SidebarIcon, TemporaryIcon } from './components/Icons';
import { RenameDialog } from './components/RenameDialog';
import { NewTabMenu } from './components/NewTabMenu';
import { ProjectHome } from './components/ProjectHome';
import { SearchDialog } from './components/SearchDialog';
import type { SettingsSection } from './components/SettingsDialog';
import { SettingsDialog } from './components/SettingsDialog';
import { Sidebar } from './components/Sidebar';
import { NavigationRail } from './components/NavigationRail';
import { TabPanel } from './components/TabPanel';
import './components/TabPanel.css';
import type { Attachment, Chat, Feedback, Message } from './lib/chats';
import {
  chatToMarkdown,
  createChat,
  loadChats,
  newId,
  titleFrom,
  renameChat,
  saveChats,
  subscribeToChatStorageErrors,
  togglePin,
  truncateFrom,
  updateChat,
  updateMessage,
} from './lib/chats';
import type { DesktopCommand } from './lib/desktop';
import { fileSlug, isDesktop, isMac, saveTextFile } from './lib/desktop';
import type { ModelSettings } from './lib/models';
import {
  AUTO_MODEL_ID,
  DEFAULT_SETTINGS,
  findModel,
  getCatalog,
  isClaudeModel,
  modelLabel,
  setAvailableGroups,
  setLiveOpenAIModels,
} from './lib/models';
import { fetchChatGPTModels } from './lib/providerClient';
import type { Preferences } from './lib/preferences';
import { greeting, loadPreferences, savePreferences } from './lib/preferences';
import { resolveProfileName } from './lib/profile';
import type { Project } from './lib/projects';
import { createProject, loadProjects, saveProjects, updateProject } from './lib/projects';
import type { Subscriptions } from './lib/subscriptions';
import { PROVIDERS, loadSubscriptions, saveSubscriptions } from './lib/subscriptions';
import type { BrowserState, Tab } from './lib/tabs';
import { createBrowserTab, createSideChat, updateSideChat } from './lib/tabs';
import { useChatGPT } from './lib/useChatGPT';
import { useClaude } from './lib/useClaude';
import { useSubscriptionAccount } from './lib/useSubscriptionAccount';
import type { LiveReply } from './lib/providerClient';
import { getTaskClient } from './lib/tasks';
import { applyTaskSnapshot, chatTarget, mergeTaskMessages, recoverInterruptedMessages } from './lib/taskProjection';
import type { TaskRequest, TaskResult, TaskSnapshot, TaskTarget } from './shared/tasks';
import { isActiveTask } from './shared/tasks';
import { TaskQueue } from './components/TaskQueue';
import { taskStateLabel } from './components/TasksPanel';
import { ScheduledView } from './components/ScheduledView';
import type { Schedule } from './lib/schedules';
import { createSchedule, dueSchedules, editSchedule, loadSchedules, markRan, saveSchedules, setPaused } from './lib/schedules';
import { buildReplyHistory, composeInstructions } from './lib/replyContext';
import { clearAllDrafts, clearDraft } from './lib/drafts';
import './components/Shell.css';

const SUGGESTIONS = [
  {
    title: 'Think it through',
    detail: 'Find a fresh perspective',
    prompt: 'Help me think through a decision. Ask me about the options and what matters most.',
  },
  {
    title: 'Make a plan',
    detail: 'Turn an idea into next steps',
    prompt: 'Help me make a practical plan. Start by asking what I want to accomplish.',
  },
  {
    title: 'Write something',
    detail: 'Find the right words',
    prompt: 'Help me write something clearly. Ask me about the audience and what I want to say.',
  },
  {
    title: 'Learn something',
    detail: 'Make a complex idea click',
    prompt: 'Help me understand a topic. Ask what I am learning and what I know so far.',
  },
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
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 768);
  const [notice, setNotice] = useState<{ text: string; undo?: () => void } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [settings, setSettings] = useState<SettingsSection | null>(null);
  const [subscriptions, setSubscriptions] = useState<Subscriptions>(loadSubscriptions);
  const chatgpt = useChatGPT();
  const claude = useClaude();
  const gemini = useSubscriptionAccount('gemini');
  const grok = useSubscriptionAccount('grok');
  const [taskClient] = useState(getTaskClient);
  const tasks = useSyncExternalStore(taskClient.subscribe, taskClient.getSnapshot, taskClient.getSnapshot);
  const [tasksReady, setTasksReady] = useState(false);
  const [schedules, setSchedules] = useState<Schedule[]>(loadSchedules);
  const [scheduledOpen, setScheduledOpen] = useState(false);
  const [peek, setPeek] = useState(false);
  const peekTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Leaving Home or the panel closes it after a short grace period, so the pointer can cross the gap.
  const showPeek = (show: boolean) => {
    clearTimeout(peekTimer.current);
    if (show) setPeek(true);
    else peekTimer.current = setTimeout(() => setPeek(false), 200);
  };
  const ignoredTargets = useRef(new Set<string>());
  const navigationEpoch = useRef(0);
  const taskFor = (kind: TaskTarget['kind'], id: string | null) => tasks.find((task) => task.target.kind === kind && task.target.id === id && isActiveTask(task));
  const targetKey = (target: TaskTarget) => `${target.kind}:${target.id}:${target.generation}`;
  const sideTarget = (id: string): TaskTarget => ({ kind: 'sidechat', id, generation: `side:${id}`, ephemeral: true });

  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [fullView, setFullView] = useState(false);
  const [panelVisible, setPanelVisible] = useState(true);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 8000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => subscribeToChatStorageErrors((text) => setNotice({ text })), []);
  useEffect(() => {
    let mounted = true;
    void taskClient.connect().then(() => {
      if (!mounted) return;
      setChats((current) => recoverInterruptedMessages(current, taskClient.getSnapshot()));
      setTasksReady(true);
    }).catch(() => setNotice({ text: 'Could not restore background tasks. Reopen Jarvis to reconnect.' }));
    return () => { mounted = false; };
  }, [taskClient]);
  useEffect(() => {
    if (!tasksReady) return;
    const visibleTasks = tasks.filter((task) => !ignoredTargets.current.has(targetKey(task.target)));
    setChats((current) => visibleTasks.reduce(applyTaskSnapshot, current));
    setTabs((current) => visibleTasks.reduce((next, task) => task.target.kind === 'sidechat'
      ? updateSideChat(next, task.target.id, (side) => ({ ...side, messages: mergeTaskMessages(side.messages, task) })) : next, current));
  }, [tasks, tasksReady]);

  const persistence = useRef<{ timer?: ReturnType<typeof setTimeout>; chats: Chat[]; tasks: TaskSnapshot[]; signature: string }>({ chats, tasks, signature: '' });
  persistence.current.chats = chats;
  persistence.current.tasks = tasks;
  useEffect(() => {
    if (!tasksReady) return;
    const state = persistence.current;
    const signature = JSON.stringify(chats.map((chat) => [chat.id, chat.title, chat.projectId, chat.pinned, chat.archived,
      chat.messages.map((message) => [message.id, message.role === 'user' ? message.content : '', message.delivery, message.outcome, message.feedback])]));
    const immediate = signature !== state.signature || !tasks.some(isActiveTask);
    state.signature = signature;
    const flush = () => {
      state.timer = undefined;
      const savedChats = state.chats;
      const savedTasks = state.tasks.filter((task) => !task.target.ephemeral && task.messages.length > 0 &&
        task.messages.every((message) => savedChats.find((chat) => chat.id === task.target.id)?.messages.some((saved) => saved.id === message.id && (saved.taskRevision ?? 0) >= task.revision)));
      void saveChats(savedChats).then(() => Promise.all(savedTasks.map((task) => taskClient.bridge.ack({ taskId: task.id, revision: task.revision })))).catch(() => {});
    };
    if (immediate) { clearTimeout(state.timer); flush(); }
    else if (!state.timer) state.timer = setTimeout(flush, 250);
  }, [chats, tasks, tasksReady, taskClient]);
  useEffect(() => () => { clearTimeout(persistence.current.timer); }, []);
  useEffect(() => saveProjects(projects), [projects]);
  useEffect(() => saveSchedules(schedules), [schedules]);
  useEffect(() => savePreferences(prefs), [prefs]);
  useEffect(() => saveSubscriptions(subscriptions), [subscriptions]);
  useResolvedTheme(prefs.theme);
  useEffect(() => {
    document.documentElement.classList.toggle('desktop-mac', isDesktop() && isMac());
  }, []);

  const activeChat = chats.find((c) => c.id === activeId) ?? null;
  const panelOpen = tabs.length > 0 && panelVisible;
  const activeProject = projects.find((p) => p.id === (activeChat ? activeChat.projectId : activeProjectId)) ?? null;
  const activeTask = taskFor('chat', activeId);
  const pending = !!activeTask;

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
  const claudeConnected = claude.state.phase === 'connected';
  const geminiConnected = gemini.state.phase === 'connected';
  const grokConnected = grok.state.phase === 'connected';
  const subscriptionCount = [chatgptConnected, claudeConnected, geminiConnected, grokConnected].filter(Boolean).length;
  const profileName = resolveProfileName(
    prefs.name,
    chatgpt.state.phase === 'connected' ? chatgpt.state : null,
    claude.state.phase === 'connected' ? claude.state : null,
    gemini.state.phase === 'connected' ? gemini.state : null,
    grok.state.phase === 'connected' ? grok.state : null,
  );
  // A saved plan is metadata, not proof of a connected account.
  const availableGroups = PROVIDERS.filter(
    (p) =>
      (p.id === 'openai' && chatgptConnected) ||
      (p.id === 'anthropic' && claudeConnected) ||
      (p.id === 'google' && geminiConnected) ||
      (p.id === 'xai' && grokConnected),
  ).map((p) => p.company);
  setAvailableGroups(availableGroups);
  // A model from a provider that isn't added falls back to Auto, once connection checks have settled.
  const connectionsLoading = [chatgpt, claude, gemini, grok].some((account) => account.state.phase === 'loading');
  const usingClaudePlan = claudeConnected && (isClaudeModel(model.modelId) || (model.modelId === AUTO_MODEL_ID && !chatgptConnected));
  const usingGeminiPlan = geminiConnected && (model.modelId === 'gemini-default' || (model.modelId === AUTO_MODEL_ID && !chatgptConnected && !claudeConnected));
  const usingGrokPlan = grokConnected && (model.modelId === 'grok-default' || (model.modelId === AUTO_MODEL_ID && !chatgptConnected && !claudeConnected && !geminiConnected));
  const otherPlanName = usingClaudePlan ? 'Claude' : usingGeminiPlan ? 'Gemini' : usingGrokPlan ? 'Grok' : null;
  const availableKey = availableGroups.join();
  useEffect(() => {
    if (connectionsLoading) return;
    setModel((m) => {
      const group = findModel(m.modelId)?.group;
      return m.modelId === AUTO_MODEL_ID || (group && availableGroups.includes(group)) ? m : { ...m, modelId: AUTO_MODEL_ID };
    });
  }, [connectionsLoading, availableKey]);
  /** Real provider for this conversation, or undefined to fall back to the placeholder stream. */
  const live = (
    history: Message[],
    conversationId: string,
    projectInstructions = activeProject?.instructions,
  ): LiveReply | undefined => {
    const instructions = composeInstructions(prefs.instructions, projectInstructions);
    const slug = chatgptSlug();
    if (slug) return { provider: 'chatgpt', slug, history, instructions };
    if (claudeConnected && (isClaudeModel(model.modelId) || model.modelId === AUTO_MODEL_ID)) {
      return {
        provider: 'claude',
        slug: model.modelId === AUTO_MODEL_ID ? getCatalog().find((m) => m.group === 'Anthropic')!.id : model.modelId,
        history,
        instructions,
        mode: model.claudeMode === 'code' ? 'code' : 'chat',
        reasoning: model.reasoning,
        conversationId,
      };
    }
    if (usingGeminiPlan) return { provider: 'gemini', slug: 'gemini-default', history, instructions };
    if (usingGrokPlan) return { provider: 'grok', slug: 'grok-default', history, instructions };
    return undefined;
  };
  const label = () => {
    const resolvedId =
      model.modelId === AUTO_MODEL_ID
        ? getCatalog().find((item) => availableGroups.includes(item.group))?.id
        : model.modelId;
    const { name, detail } = modelLabel(resolvedId ? { ...model, modelId: resolvedId } : model);
    return `${name} ${detail}`.trim();
  };

  /** Switches view; temporary chats are discarded once you leave them, as in ChatGPT. */
  const navigate = (chatId: string | null, projectId: string | null = null) => {
    navigationEpoch.current++;
    if (activeChat?.temporary && chatId !== activeId) {
      const target = chatTarget(activeChat);
      ignoredTargets.current.add(targetKey(target));
      void taskClient.bridge.forgetTarget(target).catch(() => {});
    }
    if (temporary || activeChat?.temporary) clearDraft(activeChat?.id ?? 'temporary', false);
    setChats((cs) => cs.filter((c) => !c.temporary || c.id === chatId));
    setActiveId(chatId);
    setActiveProjectId(projectId);
    setTemporary(false);
    setScheduledOpen(false);
    setPeek(false);
    if (window.innerWidth < 768) setSidebarOpen(false);
  };

  const makeRequest = (history: Message[], input: Message, target: TaskTarget, title: string, projectInstructions?: string, creation?: Chat, retryOf?: string): TaskRequest => {
    const provider = live([...history, input], target.id, projectInstructions ?? '');
    return {
      requestId: newId(), target, title, history, input,
      instructions: composeInstructions(prefs.instructions, projectInstructions),
      modelLabel: label(), provider: provider?.provider ?? 'preview', model: provider?.slug ?? model.modelId,
      ...(provider?.provider === 'claude' ? { mode: provider.mode, reasoning: provider.reasoning } : {}),
      ...(creation ? { creation } : {}), ...(retryOf ? { retryOf } : {}),
    };
  };
  const userMessage = (text: string, attachments: Attachment[]): Message => ({ id: newId(), role: 'user', content: text, ...(attachments.length ? { attachments } : {}) });
  const reportResult = (result: TaskResult) => { if (!result.ok) setNotice({ text: result.message }); };
  const stop = () => { if (activeTask) void taskClient.stop(activeTask.id).then(reportResult); };

  // New chat creation and prompt acceptance are one receipt from the task owner.
  const send = async (text: string, attachments: Attachment[]): Promise<TaskResult> => {
    const input = userMessage(text, attachments);
    const running = taskClient.getSnapshot().find((task) => task.target.kind === 'chat' && task.target.id === activeId && isActiveTask(task));
    if (running) return taskClient.queue({ taskId: running.id, entryId: newId(), message: input });
    const epoch = navigationEpoch.current;
    const chat = activeChat ?? createChat(Date.now(), {
      title: titleFrom(text) || 'New chat', taskGeneration: newId(),
      ...(activeProjectId ? { projectId: activeProjectId } : {}), ...(temporary ? { temporary: true } : {}),
    });
    const result = await taskClient.start(makeRequest(chat.messages, input, chatTarget(chat), chat.title, activeProject?.instructions, activeChat ? undefined : chat));
    if (result.ok) {
      setChats((current) => applyTaskSnapshot(current, result.task));
      if (!activeChat && epoch === navigationEpoch.current) setActiveId(chat.id);
    }
    return result;
  };

  // A scheduled run sends its prompt into the schedule's own conversation with the current model.
  const runSchedule = async (schedule: Schedule, manual = false) => {
    const now = Date.now();
    const update = (chatId?: string) => setSchedules((ss) => ss.map((s) => s.id !== schedule.id ? s
      : manual ? { ...s, lastRunAt: now, ...(chatId ? { chatId } : {}) } : markRan(s, now, chatId)));
    const existing = chats.find((c) => c.id === schedule.chatId);
    update();
    if (existing && taskFor('chat', existing.id)) {
      if (manual) setNotice({ text: `“${schedule.title}” is already running.` });
      return;
    }
    const chat = existing ?? createChat(now, { title: schedule.title, taskGeneration: newId() });
    const result = await taskClient.start(makeRequest(chat.messages, userMessage(schedule.prompt, []), chatTarget(chat), chat.title, undefined, existing ? undefined : chat));
    if (!result.ok) { setNotice({ text: `“${schedule.title}” could not run: ${result.message}` }); return; }
    setChats((current) => applyTaskSnapshot(current, result.task));
    update(chat.id);
  };
  const scheduler = useRef({ runSchedule, schedules });
  scheduler.current = { runSchedule, schedules };
  // Scheduled tasks run while Jarvis is open, once provider connections have settled.
  useEffect(() => {
    if (!tasksReady || connectionsLoading) return;
    const tick = () => { for (const s of dueSchedules(scheduler.current.schedules)) void scheduler.current.runSchedule(s); };
    tick();
    const timer = window.setInterval(tick, 30_000);
    return () => window.clearInterval(timer);
  }, [tasksReady, connectionsLoading]);

  const detachChatTasks = async (chatId: string) => {
    const ids = taskClient.getSnapshot().filter((task) => task.target.kind === 'chat' && task.target.id === chatId && !isActiveTask(task)).map((task) => task.id);
    await taskClient.bridge.detach(ids);
  };
  const editMessage = async (messageId: string, text: string) => {
    if (!activeChat || activeTask) return;
    const original = activeChat.messages.find((message) => message.id === messageId);
    if (!original) return;
    const before = activeChat.messages.slice(0, activeChat.messages.findIndex((message) => message.id === messageId));
    const input = userMessage(text, original.attachments ?? []);
    const error = validateSend(before, activeProject?.instructions, text, original.attachments ?? []);
    if (error) { setNotice({ text: error }); return; }
    await detachChatTasks(activeChat.id);
    const result = await taskClient.start(makeRequest(before, input, chatTarget(activeChat), activeChat.title, activeProject?.instructions));
    if (result.ok) setChats((current) => applyTaskSnapshot(truncateFrom(current, activeChat.id, messageId), result.task));
    else reportResult(result);
  };

  const validateSend = (
    history: Message[],
    instructions: string | undefined,
    text: string,
    attachments: Attachment[],
  ) => {
    try {
      const messages = buildReplyHistory(
        [...history, { id: 'draft', role: 'user', content: text, attachments }],
        composeInstructions(prefs.instructions, instructions),
      );
      if ((usingGeminiPlan || usingGrokPlan) && messages.some((message) => message.media?.length)) {
        return `${usingGeminiPlan ? 'Gemini' : 'Grok'} currently supports text attachments. Choose another model for images or PDFs.`;
      }
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : 'Could not prepare this message. Your draft is still here.';
    }
  };

  const regenerate = async (messageId: string) => {
    if (!activeChat || activeTask) return;
    const index = activeChat.messages.findIndex((message) => message.id === messageId);
    const promptIndex = activeChat.messages.slice(0, index).map((message) => message.role).lastIndexOf('user');
    const prompt = activeChat.messages[promptIndex];
    if (!prompt) return;
    const history = activeChat.messages.slice(0, promptIndex);
    await detachChatTasks(activeChat.id);
    const input = { ...prompt, taskId: undefined, attemptId: undefined, taskRevision: undefined, delivery: undefined };
    const result = await taskClient.start(makeRequest(history, input, chatTarget(activeChat), activeChat.title, activeProject?.instructions, undefined, activeChat.messages[index]?.taskId));
    if (result.ok) setChats((current) => applyTaskSnapshot(truncateFrom(current, activeChat.id, messageId), result.task));
    else reportResult(result);
  };

  const setFeedback = (messageId: string, feedback: Feedback | undefined) =>
    activeId && setChats((cs) => updateMessage(cs, activeId, messageId, { feedback }));

  const deleteChat = async (id: string) => {
    const deleted = chats.find((chat) => chat.id === id);
    if (!deleted) return;
    const target = chatTarget(deleted);
    ignoredTargets.current.add(targetKey(target));
    try { await taskClient.bridge.forgetTarget(target); }
    catch { ignoredTargets.current.delete(targetKey(target)); setNotice({ text: 'Could not stop this chat. Try deleting it again.' }); return; }
    clearDraft(id, !deleted.temporary);
    setChats((current) => current.filter((chat) => chat.id !== id));
    if (id === activeId) setActiveId(null);
    setNotice({ text: 'Chat deleted', undo: () => setChats((current) => current.some((chat) => chat.id === id) ? current : [...current, {
      ...recoverInterruptedMessages([deleted], [])[0], taskGeneration: newId(),
    }]) });
  };

  // The tab panel opens to the right of the chat; the history sidebar stays as it is.
  const showPanel = (visible: boolean) => setPanelVisible(visible);

  const exportChat = (id: string) => {
    const chat = chats.find((c) => c.id === id);
    if (chat) void saveTextFile(`${fileSlug(chat.title)}.md`, chatToMarkdown(chat), 'text/markdown');
  };

  const chatActions = {
    onRename: (id: string) => setRenamingId(id),
    onTogglePin: (id: string) => setChats((cs) => togglePin(cs, id)),
    onArchive: (id: string) => {
      setChats((cs) => updateChat(cs, id, { archived: true }));
      if (id === activeId) navigate(null);
      setNotice({ text: 'Chat archived', undo: () => setChats((cs) => updateChat(cs, id, { archived: false })) });
    },
    onDelete: deleteChat,
    onExport: exportChat,
    onMove: (id: string, projectId: string | undefined) => {
      setChats((cs) => updateChat(cs, id, { projectId }));
      setNotice({ text: projectId ? 'Chat moved to project' : 'Chat moved to Recents' });
    },
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

  const openSideChat = () => openTab(createSideChat(activeChat, activeProject?.instructions), false);

  // Replace a new-tab page with a side chat, as its "Side chat" tool does.
  const convertToSideChat = (id: string) => {
    const side = { ...createSideChat(activeChat, activeProject?.instructions), id };
    setTabs((ts) => ts.map((t) => (t.id === id ? side : t)));
  };

  const closeTab = (id: string) => {
    const target = sideTarget(id);
    ignoredTargets.current.add(targetKey(target));
    void taskClient.bridge.forgetTarget(target).catch(() => {});
    clearDraft(`side:${id}`, false);
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

  const sendSide = async (tabId: string, text: string, attachments: Attachment[]): Promise<TaskResult> => {
    const side = tabs.find((tab) => tab.id === tabId);
    if (side?.kind !== 'sidechat') return { ok: false, code: 'not_found', message: 'This side chat is no longer available.' };
    const input = userMessage(text, attachments);
    const running = taskFor('sidechat', tabId);
    if (running) return taskClient.queue({ taskId: running.id, entryId: newId(), message: input });
    return taskClient.start(makeRequest([...side.sidechat.context, ...side.sidechat.messages], input, sideTarget(tabId),
      side.sidechat.sourceTitle ? `Side chat: ${side.sidechat.sourceTitle}` : 'Side chat', side.sidechat.projectInstructions));
  };
  const stopSide = (id: string) => { const task = taskFor('sidechat', id); if (task) void taskClient.stop(task.id).then(reportResult); };
  const removeQueued = async (task: TaskSnapshot, entryId: string): Promise<TaskResult> => {
    const messageId = task.queue.find((entry) => entry.id === entryId)?.message.id;
    const result = await taskClient.removeQueued({ taskId: task.id, entryId });
    if (result.ok && messageId) {
      if (task.target.kind === 'chat') setChats((current) => current.map((chat) => chat.id === task.target.id ? { ...chat, messages: chat.messages.filter((message) => message.id !== messageId) } : chat));
      else setTabs((current) => updateSideChat(current, task.target.id, (side) => ({ ...side, messages: side.messages.filter((message) => message.id !== messageId) })));
    }
    return result;
  };
  const renderTaskQueue = (task: TaskSnapshot) => <TaskQueue key={task.id} task={task} onRemove={(entryId) => removeQueued(task, entryId)} onInterrupt={() => taskClient.interrupt(task.id)} />;
  const openTaskTarget = (target: TaskTarget) => {
    if (target.kind === 'chat') {
      if (!chats.some((chat) => chat.id === target.id)) { setNotice({ text: 'This conversation is no longer available.' }); return; }
      navigate(target.id);
      setFullView(false);
    } else {
      if (!tabs.some((tab) => tab.id === target.id)) { setNotice({ text: 'This side chat is no longer available.' }); return; }
      setActiveTabId(target.id);
      setPanelVisible(true);
    }
    const task = tasks.find((item) => targetKey(item.target) === targetKey(target));
    if (task) void taskClient.bridge.markRead(task.id).catch(() => {});
  };
  const openTaskRef = useRef(openTaskTarget);
  openTaskRef.current = openTaskTarget;
  useEffect(() => taskClient.bridge.onOpenTarget((target) => openTaskRef.current(target)), [taskClient]);
  useEffect(() => { if (tasksReady) void taskClient.bridge.ready().catch(() => {}); }, [tasksReady, taskClient]);
  useEffect(() => { void taskClient.bridge.setPreferences({ desktopTaskNotifications: prefs.desktopTaskNotifications }).catch(() => {}); }, [prefs.desktopTaskNotifications, taskClient]);
  useEffect(() => {
    const update = () => {
      const targets: TaskTarget[] = [];
      if (document.hasFocus() && document.visibilityState !== 'hidden') {
        if (activeChat && !(panelOpen && fullView)) targets.push(chatTarget(activeChat));
        const tab = tabs.find((item) => item.id === activeTabId);
        if (panelOpen && tab?.kind === 'sidechat') targets.push(sideTarget(tab.id));
      }
      void taskClient.bridge.setVisibleTargets(targets).catch(() => {});
      for (const task of tasks) if (task.unread && targets.some((target) => targetKey(target) === targetKey(task.target))) void taskClient.bridge.markRead(task.id).catch(() => {});
    };
    update();
    window.addEventListener('focus', update); window.addEventListener('blur', update); document.addEventListener('visibilitychange', update);
    return () => { window.removeEventListener('focus', update); window.removeEventListener('blur', update); document.removeEventListener('visibilitychange', update); };
  }, [activeId, activeTabId, panelOpen, fullView, tasks, taskClient]);
  const unreadTask = tasks.find((task) => task.unread && !isActiveTask(task));

  const runCommand = (c: DesktopCommand) => {
    if (document.querySelector('[aria-modal="true"]')) return;
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
      if (document.querySelector('[aria-modal="true"], [role="menu"]')) return;
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

  useEffect(() => {
    if (!sidebarOpen || window.innerWidth >= 768) return;
    const sidebar = document.querySelector<HTMLElement>('.sidebar');
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    sidebar?.querySelector<HTMLButtonElement>('button')?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (document.querySelector('[aria-modal="true"]')) return;
      if (event.key === 'Escape') setSidebarOpen(false);
      if (event.key === 'Tab') {
        const items = [...document.querySelectorAll<HTMLElement>('.navigation-rail button, .sidebar button, .sidebar input')].filter(
          (item) => item.getClientRects().length > 0,
        );
        const first = items[0];
        const last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      if (opener?.isConnected) opener.focus();
    };
  }, [sidebarOpen]);

  const leading = (
    <div className="leading-actions">
      <button
        className="icon-btn"
        title={`Toggle sidebar (${isMac() ? '⇧⌘S' : 'Ctrl ⇧ S'})`}
        aria-label="Toggle sidebar"
        aria-expanded={sidebarOpen}
        onClick={() => setSidebarOpen((open) => !open)}
      >
        <SidebarIcon />
      </button>
      <button className="icon-btn" title={`New chat (${isMac() ? '⇧⌘O' : 'Ctrl ⇧ O'})`} aria-label="New chat" onClick={() => navigate(null)}>
        <ComposeIcon />
      </button>
    </div>
  );

  const trailing = (
    <div className="trailing-actions">
      <NewTabMenu
        onNewTab={() => openTab(createBrowserTab(), false)}
        onNewTabFull={() => openTab(createBrowserTab(), true)}
        onSideChat={openSideChat}
        temporaryOn={temporary && !activeChat}
        onTemporaryChat={() => {
          // Turning it off only applies before the first message; otherwise start a fresh temporary chat.
          if (temporary && !activeChat) {
            clearDraft('temporary', false);
            setTemporary(false);
            return;
          }
          navigate(null);
          setTemporary(true);
        }}
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
    </div>
  );

  // Chat title bar: full width without the panel; the chat pane's own header beside it.
  const chatBar = (
    <>
      {activeProject && (
        <button className="crumb" onClick={() => navigate(null, activeProject.id)}>
          {activeProject.name}
          {activeChat && <span className="crumb-sep">/</span>}
        </button>
      )}
      <span className="topbar-title">{activeChat?.title ?? ''}</span>
      {(activeChat?.temporary || temporary) && (
        <span className="temp-pill">
          <TemporaryIcon />
          Temporary
        </span>
      )}
      <div className="spacer" />
      {activeChat && !activeChat.temporary && (
        <ChatMenu chat={activeChat} projects={projects} variant="topbar" {...chatActions} />
      )}
    </>
  );

  const emptyCopy = temporary
    ? { eyebrow: 'Temporary chat', title: 'Temporary Chat', placeholder: 'Ask anything — this chat won’t be saved' }
    : activeProject
      ? { eyebrow: 'Project', title: activeProject.name, placeholder: `New chat in ${activeProject.name}` }
      : { eyebrow: 'New conversation', title: greeting(prefs.name), placeholder: undefined };

  const history = (
    <Sidebar
      chats={chats}
      tasks={tasks}
      projects={projects}
      activeId={activeId}
      activeProjectId={activeProject?.id ?? null}
      renamingId={null}
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
      {...chatActions}
    />
  );

  return (
    <div className={`app${sidebarOpen ? '' : ' sidebar-closed'}`}>
      {/* Window title strip, like ChatGPT desktop: window buttons, then sidebar and new chat. */}
      <header className="titlebar drag-region">
        {leading}
        <div className="spacer" />
        {!scheduledOpen && trailing}
      </header>
      <NavigationRail
        userName={profileName}
        subscriptionCount={subscriptionCount}
        homeActive={!activeChat && !activeProject && !scheduledOpen}
        scheduledActive={scheduledOpen}
        historyOpen={sidebarOpen && !scheduledOpen}
        onHome={() => { showPanel(false); setFullView(false); navigate(null); }}
        onHomeHover={(hovering) => { if (!sidebarOpen) showPeek(hovering); }}
        onToggleHistory={() => {
          if (!scheduledOpen) { setSidebarOpen((value) => !value); return; }
          setScheduledOpen(false);
          setSidebarOpen(true);
        }}
        onScheduled={() => {
          setScheduledOpen(true);
          if (window.innerWidth < 768) setSidebarOpen(false);
        }}
        onSettings={() => setSettings('General')}
        onHelp={() => setSettings('Keyboard shortcuts')}
        logoutAccounts={[
          ...(chatgptConnected ? [{ id: 'chatgpt', label: 'ChatGPT', logout: chatgpt.signOut }] : []),
          ...(claudeConnected ? [{ id: 'claude', label: 'Claude Code', note: 'Also signs out Terminal', logout: async () => {
            if (!await claude.signOut()) throw new Error('Claude Code could not sign out.');
          } }] : []),
          ...(geminiConnected ? [{ id: 'gemini', label: 'Gemini', note: 'Also signs out the Gemini connection on this Mac', logout: async () => {
            if (!await gemini.signOut()) throw new Error('Gemini could not sign out.');
          } }] : []),
          ...(grokConnected ? [{ id: 'grok', label: 'Grok', logout: async () => {
            if (!await grok.signOut()) throw new Error('Grok could not sign out.');
          } }] : []),
        ]}
      />
      {sidebarOpen && !scheduledOpen && history}
      {peek && !sidebarOpen && (
        <div className="sidebar-peek" onMouseEnter={() => showPeek(true)} onMouseLeave={() => showPeek(false)}>
          {history}
        </div>
      )}
      <main className="main">
        {scheduledOpen ? (
          <ScheduledView
            schedules={schedules}
            onCreate={(draft) => {
              const schedule = createSchedule(draft);
              setSchedules((ss) => [...ss, schedule]);
              return schedule.id;
            }}
            onUpdate={(id, draft) => setSchedules((ss) => ss.map((s) => (s.id === id ? editSchedule(s, draft) : s)))}
            onPause={(id, paused) => setSchedules((ss) => ss.map((s) => (s.id === id ? setPaused(s, paused) : s)))}
            onDelete={(id) => setSchedules((ss) => ss.filter((s) => s.id !== id))}
            onRunNow={(id) => {
              const schedule = schedules.find((s) => s.id === id);
              if (schedule) void runSchedule(schedule, true);
            }}
            onOpenChat={(chatId) => {
              if (chats.some((c) => c.id === chatId)) navigate(chatId);
              else setNotice({ text: 'This conversation was deleted. It will be recreated on the next run.' });
            }}
          />
        ) : (<>
        {!panelOpen && <header className="topbar drag-region">{chatBar}</header>}
        <div className={`workspace${panelOpen ? ' split' : ''}`}>
          {!(panelOpen && fullView) && (
            <div className="chat-pane">
              {panelOpen && <header className="topbar drag-region">{chatBar}</header>}
              <ChatView
                key={activeChat?.id ?? (temporary ? 'temporary' : (activeProjectId ?? 'new'))}
                chat={activeChat}
                draftKey={activeChat?.id ?? (temporary ? 'temporary' : `new:${activeProjectId ?? 'home'}`)}
                persistDraft={!temporary && !activeChat?.temporary}
                pending={pending}
                streamingId={activeTask?.messages.filter((message) => message.role === 'assistant' && !message.outcome).at(-1)?.id}
                submitDisabled={!tasksReady}
                taskQueue={activeTask && renderTaskQueue(activeTask)}
                taskStatus={activeTask && taskStateLabel(activeTask)}
                model={model}
                onModelChange={setModel}
                onSend={send}
                validateSend={(text, attachments) =>
                  validateSend(activeChat?.messages ?? [], activeProject?.instructions, text, attachments)
                }
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
                banner={
                  temporary ? (
                    <div className="welcome-symbol">
                      <TemporaryIcon />
                    </div>
                  ) : undefined
                }
                composerNote={
                  usingChatGPTPlan ? (
                    <ChatGPTPlanNote />
                  ) : (
                    <div className="composer-context">
                      <span
                        className={`connection-dot${otherPlanName ? ' connected' : ''}`}
                      />
                      <span>
                        {otherPlanName
                          ? `Using your ${otherPlanName} plan`
                          : 'Preview mode'}
                      </span>
                      {!otherPlanName && (
                        <button onClick={() => setSettings('Subscriptions')}>Connect a plan</button>
                      )}
                      {activeProject?.instructions && (
                        <span className="context-instructions">Project instructions on</span>
                      )}
                    </div>
                  )
                }
              />
            </div>
          )}
          {panelOpen && (
            <TabPanel
              tabs={tabs}
              activeTabId={activeTabId}
              fullView={fullView}
              tasks={tasks}
              tasksReady={tasksReady}
              taskQueue={renderTaskQueue}
              model={model}
              onModelChange={setModel}
              onSelect={setActiveTabId}
              onClose={closeTab}
              onNewTab={() => openTab(createBrowserTab(), fullView)}
              onToggleFullView={() => setFullView((f) => !f)}
              onBrowserChange={setBrowser}
              onConvertToSideChat={convertToSideChat}
              onSideSend={sendSide}
              onSideStop={stopSide}
              validateSideSend={(id, text, attachments) => {
                const tab = tabs.find((item) => item.id === id);
                return tab?.kind === 'sidechat'
                  ? validateSend(
                      [...tab.sidechat.context, ...tab.sidechat.messages],
                      tab.sidechat.projectInstructions,
                      text,
                      attachments,
                    )
                  : 'This side chat is no longer available.';
              }}
            />
          )}
        </div>
        </>)}
      </main>
      {sidebarOpen && !scheduledOpen && (
        <button className="sidebar-scrim" aria-label="Close sidebar" onClick={() => setSidebarOpen(false)} />
      )}
      {unreadTask && <div className="task-notice" role="status"><div><strong>{unreadTask.title}</strong><span>{unreadTask.state === 'complete' ? 'Task complete' : 'Task needs attention'}</span></div><button className="task-action" onClick={() => openTaskTarget(unreadTask.target)}>Open</button><button className="icon-btn" aria-label="Dismiss task notification" onClick={() => void taskClient.bridge.markRead(unreadTask.id).catch(() => {})}><CloseIcon /></button></div>}
      {notice && (
        <div className="toast" role="status">
          <span>{notice.text}</span>
          {notice.undo && (
            <button
              onClick={() => {
                notice.undo?.();
                setNotice(null);
              }}
            >
              Undo
            </button>
          )}
          <button className="icon-btn" aria-label="Dismiss notification" onClick={() => setNotice(null)}>
            <CloseIcon />
          </button>
        </div>
      )}
      {renamingId && (
        <RenameDialog
          title="Rename chat"
          initialValue={chats.find((c) => c.id === renamingId)?.title ?? ''}
          onClose={() => setRenamingId(null)}
          onSave={(title) => {
            setChats((cs) => renameChat(cs, renamingId, title));
            setRenamingId(null);
          }}
        />
      )}
      {searchOpen && (
        <SearchDialog
          chats={chats}
          projects={projects}
          onSelect={(id) => navigate(id)}
          onNewChat={() => navigate(null)}
          onClose={() => setSearchOpen(false)}
        />
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
            void (async () => {
              try {
                const targets = chats.map(chatTarget);
                targets.forEach((target) => ignoredTargets.current.add(targetKey(target)));
                await Promise.all(targets.map((target) => taskClient.bridge.forgetTarget(target)));
                clearAllDrafts();
                setChats([]);
                navigate(null);
              } catch { setNotice({ text: 'Could not stop all tasks. Try deleting again.' }); }
            })();
          }}
          onExportAll={() =>
            void saveTextFile(
              'jarvis-chats.json',
              JSON.stringify(
                chats.filter((c) => !c.temporary),
                null,
                2,
              ),
              'application/json',
            )
          }
          onClose={() => setSettings(null)}
          chatgpt={chatgpt}
          claude={claude}
          gemini={gemini}
          grok={grok}
        />
      )}
      <ChatGPTWelcome account={chatgpt} />
    </div>
  );
}
