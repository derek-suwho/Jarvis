const { randomUUID, createHash } = require('node:crypto');
const { replyMessages, userMessage } = require('./context.cjs');

const ACTIVE = new Set(['queued', 'running', 'interrupting', 'stopping']);
const idValid = (id) => typeof id === 'string' && /^[\w:-]{1,120}$/.test(id);
const targetKey = (target) => `${target.kind}:${target.id}:${target.generation}`;
const targetValid = (t) => t && ['chat', 'sidechat'].includes(t.kind) && idValid(t.id)
  && idValid(t.generation) && typeof t.ephemeral === 'boolean';
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (code, message) => ({ ok: false, code, message });

function createTaskCoordinator({ openAttempt, emit = () => {}, onOutcome = () => {}, isFocused = () => true, now = Date.now, id = randomUUID }) {
  const tasks = new Map();
  const requests = new Map();
  const forgotten = new Set();
  const executing = new Set();
  let waiting = [];
  let visible = new Set();
  let shuttingDown = false;

  const snapshot = (record) => structuredClone(record.task);
  const result = (record) => ({ ok: true, task: snapshot(record) });
  const known = (record) => tasks.get(record.task.id) === record;
  const isSeen = (record) => isFocused() && visible.has(targetKey(record.task.target));

  function broadcast(record) {
    clearTimeout(record.timer);
    record.timer = null;
    if (known(record)) emit({ type: 'snapshot', task: snapshot(record) });
  }
  function changed(record, streamed = false) {
    record.task.revision++;
    record.task.updatedAt = now();
    for (const message of record.task.messages) message.taskRevision = record.task.revision;
    if (streamed) {
      if (!record.timer) {
        record.timer = setTimeout(() => broadcast(record), 50);
        record.timer.unref?.();
      }
    } else broadcast(record);
  }
  function setDelivery(record, entries, state) {
    for (const entry of entries) {
      entry.state = state;
      entry.message.delivery = state;
      const message = record.task.messages.find((m) => m.id === entry.message.id);
      if (message) message.delivery = state;
    }
  }
  function finish(record, state, error) {
    if (!known(record) || !ACTIVE.has(record.task.state)) return;
    record.task.state = state;
    if (error) record.task.error = error;
    if (state === 'cancelled') setDelivery(record, record.task.queue.filter((q) => q.state !== 'applied'), 'cancelled');
    else if (state === 'failed' || state === 'interrupted') setDelivery(record, record.task.queue.filter((q) => q.state === 'applying'), 'queued');
    const reply = record.task.messages.find((m) => m.id === record.replyId);
    if (reply) {
      reply.outcome = state === 'complete' ? 'complete' : state === 'cancelled' ? 'cancelled' : state === 'failed' ? 'failed' : 'interrupted';
      if (reply.tools) reply.tools = reply.tools.map((t) => t.status === 'running' ? { ...t, status: 'error' } : t);
    }
    record.task.unread = ['complete', 'failed', 'interrupted'].includes(state) && !isSeen(record);
    changed(record);
    if (state === 'complete' || state === 'failed') onOutcome(snapshot(record));
  }
  function enqueue(record) {
    record.task.state = 'queued';
    if (!waiting.includes(record)) waiting.push(record);
    changed(record);
    schedule();
  }
  function applyBatch(record, entries) {
    record.batch = entries;
    setDelivery(record, entries, 'applying');
  }
  function schedule() {
    if (shuttingDown) return;
    while (executing.size < 3) {
      const codeBusy = [...executing].some((r) => r.codeLane);
      const index = waiting.findIndex((r) => known(r) && r.task.state === 'queued' && (!r.codeLane || !codeBusy));
      if (index < 0) return;
      const [record] = waiting.splice(index, 1);
      launch(record);
    }
  }
  function launch(record) {
    executing.add(record);
    const attemptId = id();
    record.attemptId = attemptId;
    record.task.state = 'running';
    record.replyId = id();
    const batch = record.batch ?? record.task.queue.filter((q) => q.state === 'queued');
    record.batch = null;
    applyBatch(record, batch);
    record.batch = null;
    record.task.messages.push({ id: record.replyId, role: 'assistant', content: '', model: record.task.modelLabel,
      taskId: record.task.id, attemptId });
    changed(record);
    let received = false;
    const receive = (event) => {
      if (!known(record) || record.attemptId !== attemptId || !executing.has(record)
        || record.task.state === 'stopping') return;
      if (!received) { received = true; setDelivery(record, batch, 'applied'); }
      const message = record.task.messages.find((m) => m.id === record.replyId);
      if (!message) return;
      if (event.type === 'delta' && typeof event.text === 'string') message.content += event.text;
      else if (event.type === 'tool') {
        const use = { id: event.id, server: event.server, tool: event.tool, status: event.status,
          ...(event.detail ? { detail: event.detail } : {}) };
        const existing = message.tools?.find((t) => t.id === use.id);
        if (existing) Object.assign(existing, { status: use.status, ...(use.detail ? { detail: use.detail } : {}) });
        else message.tools = [...(message.tools ?? []), use];
      }
      const bytes = Buffer.byteLength(JSON.stringify(record.task.messages.filter((m) => m.role === 'assistant')));
      if (bytes > 4 * 1024 * 1024) {
        record.abortError = 'This task produced too much output. Partial results are preserved.';
        record.handle?.stop();
      }
      changed(record, true);
    };
    let handle;
    try {
      const updates = batch.map((entry) => ({ ...entry.message, delivery: undefined }));
      // Validate all accepted inputs again at dispatch, before provider work.
      replyMessages([...record.request.history, record.request.input,
        ...record.task.messages.filter((m) => m.id !== record.request.input.id && m.role === 'assistant'),
        ...record.task.queue.filter((q) => q.state !== 'cancelled').map((q) => ({ ...q.message, delivery: undefined }))], record.request.instructions);
      handle = openAttempt({ provider: record.request.provider, request: record.payload,
        continuation: record.continuation, updates: updates.length ? replyMessages(updates) : [], attemptId }, receive);
      if (!handle || !handle.settled) throw new Error('Provider did not start a task.');
      record.handle = handle;
    } catch (error) {
      handle = { settled: Promise.resolve({ kind: 'failed', error: error.message }), stop() {}, interrupt() {} };
      record.handle = handle;
    }
    Promise.resolve(handle.settled).catch((error) => ({ kind: 'failed', error: error.message || 'Provider failed.' })).then((outcome) => {
      executing.delete(record);
      record.handle = null;
      if (!known(record) || record.attemptId !== attemptId) { schedule(); return; }
      // Fence callbacks from this attempt before scheduling its successor.
      record.attemptId = null;
      const reply = record.task.messages.find((m) => m.id === record.replyId);
      if (reply) {
        reply.outcome = outcome.kind === 'complete' ? 'complete' : outcome.kind === 'interrupted' ? 'interrupted' : 'failed';
        if (reply.tools) reply.tools = reply.tools.map((t) => t.status === 'running' ? { ...t, status: 'error' } : t);
      }
      if (!received) setDelivery(record, batch, outcome.kind === 'complete' ? 'applied' : 'queued');
      if (record.task.state === 'stopping') finish(record, shuttingDown ? 'interrupted' : 'cancelled');
      else if (record.abortError || outcome.kind === 'failed' || outcome.uncertainEffects) {
        finish(record, 'failed', record.abortError || outcome.error || 'The action outcome is unknown. Queued instructions were preserved.');
      } else {
        record.continuation = outcome.continuation;
        const pending = record.batch ?? record.task.queue.filter((q) => q.state === 'queued');
        if (pending.length) {
          if (!outcome.continuation && record.request.provider !== 'preview') finish(record, 'failed', 'This provider could not resume safely. Queued instructions were preserved.');
          else { record.batch = pending; enqueue(record); }
        } else finish(record, outcome.kind === 'interrupted' ? 'interrupted' : 'complete');
      }
      schedule();
    });
  }

  return {
    async start(raw, ownerId) {
      try {
        if (shuttingDown) return fail('shutting_down', 'Jarvis is closing. Your draft is still here.');
        if (!raw || !idValid(raw.requestId) || !targetValid(raw.target)
          || !['chatgpt', 'claude', 'gemini', 'grok', 'preview'].includes(raw.provider) || typeof raw.model !== 'string'
          || typeof raw.title !== 'string' || typeof raw.modelLabel !== 'string' || typeof raw.instructions !== 'string') throw new Error('Invalid task request.');
        const requestKey = hash(raw);
        const duplicate = requests.get(raw.requestId);
        if (duplicate) return duplicate.key === requestKey && tasks.has(duplicate.id)
          ? result(tasks.get(duplicate.id)) : fail('conflict', 'This request ID was already used.');
        if (forgotten.has(targetKey(raw.target))) return fail('target_deleted', 'This conversation was deleted.');
        if ([...tasks.values()].some((r) => ACTIVE.has(r.task.state) && r.task.target.kind === raw.target.kind && r.task.target.id === raw.target.id)) return fail('task_active', 'This chat already has a task. Queue a message instead.');
        if (waiting.length >= 20) return fail('queue_full', 'The task queue is full. Wait for a task to finish.');
        const request = structuredClone(raw);
        request.input = userMessage(raw.input);
        const messages = replyMessages([...request.history, request.input], request.instructions);
        const payload = { model: request.model, messages, mode: request.mode ?? 'chat', reasoning: request.reasoning ?? '', conversationId: request.target.id };
        const taskId = id(), timestamp = now();
        const task = { id: taskId, requestId: request.requestId, target: request.target, state: 'queued', revision: 0,
          createdAt: timestamp, updatedAt: timestamp, title: request.title, modelLabel: request.modelLabel,
          messages: [{ ...request.input, taskId, delivery: 'applied' }], queue: [], unread: false,
          ...(request.creation ? { creation: request.creation } : {}), ...(request.retryOf ? { retryOf: request.retryOf } : {}) };
        const record = { task, request, payload, ownerId, receipts: new Map(), codeLane: request.provider === 'claude' && request.mode === 'code', batch: null, sequence: 0 };
        tasks.set(taskId, record);
        requests.set(request.requestId, { id: taskId, key: requestKey });
        enqueue(record);
        return result(record);
      } catch (error) { return fail('invalid_request', error.message || 'Could not prepare this task.'); }
    },
    async queue({ taskId, entryId, message } = {}) {
      const record = tasks.get(taskId);
      if (!record) return fail('task_finished', 'This task has finished. Send your draft as a new message.');
      try {
        if (!idValid(entryId)) throw new Error('Invalid queue ID.');
        const clean = userMessage(message), key = hash(clean);
        if (record.receipts.has(entryId)) return record.receipts.get(entryId) === key ? result(record) : fail('conflict', 'This queue ID was already used.');
        if (!ACTIVE.has(record.task.state) || record.task.state === 'stopping') return fail('task_finished', 'This task has finished. Send your draft as a new message.');
        if (record.task.queue.filter((q) => q.state === 'queued' || q.state === 'applying').length >= 20) return fail('queue_full', 'Up to 20 messages can be queued.');
        if (record.task.messages.some((m) => m.id === clean.id)) throw new Error('This message ID was already used.');
        replyMessages([...record.request.history, ...record.task.messages.map((m) => ({ ...m, delivery: m.delivery === 'cancelled' ? 'cancelled' : undefined })), clean], record.request.instructions);
        const queued = { ...clean, taskId, delivery: 'queued' };
        record.task.messages.push(queued);
        record.task.queue.push({ id: entryId, message: queued, sequence: ++record.sequence, state: 'queued' });
        record.receipts.set(entryId, key);
        changed(record);
        return result(record);
      } catch (error) { return fail('invalid_request', error.message); }
    },
    async removeQueued({ taskId, entryId } = {}) {
      const record = tasks.get(taskId);
      if (!record) return fail('task_finished', 'This task has finished.');
      const entry = record.task.queue.find((q) => q.id === entryId);
      if (!entry || entry.state !== 'queued') return fail('already_applied', 'This message is already being applied.');
      record.task.queue = record.task.queue.filter((q) => q !== entry);
      record.task.messages = record.task.messages.filter((m) => m.id !== entry.message.id);
      changed(record);
      return result(record);
    },
    async interrupt(taskId) {
      const record = tasks.get(taskId);
      if (!record || !['running', 'queued'].includes(record.task.state)) return fail('not_running', 'This task cannot be interrupted right now.');
      const pending = record.task.queue.filter((q) => q.state === 'queued');
      if (!pending.length) return fail('queue_empty', 'Queue a message first.');
      if (record.task.state === 'queued') return result(record);
      applyBatch(record, pending);
      record.task.state = 'interrupting';
      changed(record);
      record.handle.interrupt();
      return result(record);
    },
    async stop(taskId) {
      const record = tasks.get(taskId);
      if (!record) return fail('task_finished', 'This task is no longer available.');
      if (!ACTIVE.has(record.task.state)) return result(record);
      waiting = waiting.filter((r) => r !== record);
      if (record.handle) {
        record.task.state = 'stopping';
        setDelivery(record, record.task.queue.filter((q) => q.state !== 'applied'), 'cancelled');
        record.handle.stop(); changed(record);
      } else finish(record, shuttingDown ? 'interrupted' : 'cancelled');
      return result(record);
    },
    snapshot() { return [...tasks.values()].map(snapshot); },
    ack({ taskId, revision } = {}) {
      const record = tasks.get(taskId);
      if (!record || ACTIVE.has(record.task.state) || revision !== record.task.revision) return;
      record.request = record.payload = record.continuation = null;
      record.task.messages = []; record.task.queue = []; delete record.task.creation;
      record.receipts.clear();
      const summaries = [...tasks.values()].filter((r) => !r.request && !ACTIVE.has(r.task.state));
      for (const old of summaries.slice(0, Math.max(0, summaries.length - 100))) {
        tasks.delete(old.task.id); requests.delete(old.task.requestId);
      }
    },
    async forgetTarget(target) {
      if (!targetValid(target)) throw new Error('Invalid target.');
      forgotten.add(targetKey(target));
      for (const record of [...tasks.values()]) {
        if (targetKey(record.task.target) !== targetKey(target)) continue;
        tasks.delete(record.task.id);
        clearTimeout(record.timer);
        record.handle?.stop();
        waiting = waiting.filter((r) => r !== record);
        emit({ type: 'removed', taskId: record.task.id, target: record.task.target, revision: record.task.revision + 1 });
      }
    },
    detach(taskIds) {
      for (const taskId of taskIds) {
        const record = tasks.get(taskId);
        if (!record || ACTIVE.has(record.task.state)) continue;
        tasks.delete(taskId); clearTimeout(record.timer);
        emit({ type: 'removed', taskId, target: record.task.target, revision: record.task.revision + 1 });
      }
    },
    markRead(taskId) {
      const record = tasks.get(taskId);
      if (record?.task.unread) { record.task.unread = false; changed(record); }
    },
    setVisibleTargets(targets) {
      if (!Array.isArray(targets) || targets.length > 10 || !targets.every(targetValid)) throw new Error('Invalid visible targets.');
      visible = new Set(targets.map(targetKey));
      for (const record of tasks.values()) if (isSeen(record)) this.markRead(record.task.id);
    },
    destroyOwner(ownerId) {
      for (const record of tasks.values()) if (record.ownerId === ownerId && record.task.target.ephemeral) void this.forgetTarget(record.task.target);
    },
    shutdown() {
      shuttingDown = true;
      for (const record of tasks.values()) if (ACTIVE.has(record.task.state)) void this.stop(record.task.id);
    },
  };
}

module.exports = { createTaskCoordinator, targetValid, targetKey };
