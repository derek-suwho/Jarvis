import type { ProviderId } from '../../src/shared/contracts';
import type { RetrievalQuery, RunRecord } from '../../src/shared/domain';
import type { SubscriptionAdapter } from '../providers/types';
import type { Database } from '../storage/database';
import type { MemoryStore } from '../storage/memory';
import { abortError } from '../providers/stream';
import { extractMemory } from './extract';
export const CONTEXT_WAIT_MS = 10_000;
export type MemoryQueueDependencies = {
  db: Database;
  memory: MemoryStore;
  getAdapter: (providerId: ProviderId) => SubscriptionAdapter;
};
export function createMemoryQueue({
  memory,
  getAdapter,
}: MemoryQueueDependencies) {
  let stopped = false,
    worker: Promise<void> | null = null,
    active: AbortController | null = null;
  let activeChatId: string | null = null;
  const cancelledChats = new Set<string>();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  function start() {
    if (stopped || worker) return;
    worker = (async () => {
      while (!stopped) {
        const job = memory.claimNext([...cancelledChats]);
        if (!job) break;
        active = new AbortController();
        activeChatId = job.chatId;
        try {
          const input = memory.extractionInput(job.id);
          if (input) {
            const result = await extractMemory(
              input,
              getAdapter(job.model.providerId),
              job.model,
              active.signal,
            );
            if (!stopped) memory.apply(job.id, result);
          }
        } catch (error) {
          memory.failJob(
            job.id,
            error instanceof Error ? error.message : 'Extraction failed',
          );
        } finally {
          active = null;
          activeChatId = null;
          notify();
        }
      }
    })().finally(() => {
      worker = null;
      notify();
    });
  }
  return {
    enqueue(run: RunRecord): void {
      memory.enqueue(run);
      start();
    },
    resume(): void {
      if (worker) return;
      stopped = false;
      memory.resumeJobs();
      start();
    },
    async drainForContext(
      query: RetrievalQuery,
      signal: AbortSignal,
    ): Promise<{ updating: boolean }> {
      if (signal.aborted) throw abortError(signal);
      // One retry opportunity per new context request, never from the worker loop.
      if (!stopped) memory.retryForContext(query);
      start();
      const relevant = () => memory.pendingEvidence(query).length > 0;
      if (!relevant()) return { updating: false };
      return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          listeners.delete(check);
          signal.removeEventListener('abort', cancel);
          if (error) reject(error);
          else resolve({ updating: relevant() });
        };
        const check = () => {
          if (!relevant()) finish();
        };
        const cancel = () => finish(abortError(signal));
        const timer = setTimeout(() => finish(), CONTEXT_WAIT_MS);
        listeners.add(check);
        signal.addEventListener('abort', cancel, { once: true });
        check();
      });
    },
    async cancelChat(chatId: string): Promise<void> {
      // Used before deletion: suppress future claims before yielding to any async work.
      cancelledChats.add(chatId);
      if (activeChatId !== chatId) return;
      active?.abort(new Error('Chat extraction aborted'));
      await new Promise<void>((resolve) => {
        const settled = () => {
          if (activeChatId !== chatId) {
            listeners.delete(settled);
            resolve();
          }
        };
        listeners.add(settled);
        settled();
      });
    },
    async stop(): Promise<void> {
      stopped = true;
      active?.abort(new Error('Memory queue aborted'));
      await worker;
      notify();
    },
  };
}
export type MemoryQueue = ReturnType<typeof createMemoryQueue>;
