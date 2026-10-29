function openPreviewAttempt({ request, updates, continuation }, emit) {
  let resolve;
  let timer;
  let stopped = false;
  const messages = [...(continuation?.messages ?? request.messages), ...updates];
  const text = `This is a preview reply. Connect ChatGPT or Claude in Settings for live answers.\n\nYou said: ${messages.filter((m) => m.role === 'user').at(-1)?.content ?? ''}`;
  const chunks = text.match(/\S+\s*/g) ?? [];
  let index = 0;
  const settled = new Promise((r) => { resolve = r; });
  const finish = (kind) => {
    clearTimeout(timer);
    resolve({ kind, continuation: { messages: [...messages, { role: 'assistant', content: chunks.slice(0, index).join('') }] } });
  };
  function tick() {
    if (stopped) return;
    if (index === chunks.length) { finish('complete'); return; }
    emit({ type: 'delta', text: chunks[index++] });
    timer = setTimeout(tick, 35);
  }
  timer = setTimeout(tick, 450);
  const stop = () => { stopped = true; finish('interrupted'); };
  return { settled, interrupt: stop, stop };
}
module.exports = { openPreviewAttempt };
