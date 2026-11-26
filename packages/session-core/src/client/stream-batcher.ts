export interface StreamBatcher<T> {
  push(item: T): void;
  pushMany(items: readonly T[]): void;
  flush(): void;
  dispose(): void;
  pendingCount(): number;
}

/**
 * 16ms requestAnimationFrame-aligned stream batcher shared by Desktop and VS Code.
 * Falls back cleanly to setTimeout in non-browser/Node test environments.
 */
export function createStreamBatcher<T>(
  onFlush: (batch: T[]) => void,
  windowMs = 16
): StreamBatcher<T> {
  let queue: T[] = [];
  let rafId: number | null = null;
  let timerId: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const cancelScheduled = (): void => {
    if (rafId !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
  };

  const flush = (): void => {
    cancelScheduled();
    if (queue.length === 0) return;
    const batch = queue;
    queue = [];
    onFlush(batch);
  };

  const schedule = (): void => {
    if (disposed || rafId !== null || timerId !== null) return;
    if (windowMs <= 16 && typeof requestAnimationFrame === "function") {
      rafId = requestAnimationFrame(() => {
        rafId = null;
        flush();
      });
    } else {
      timerId = setTimeout(() => {
        timerId = null;
        flush();
      }, windowMs);
    }
  };

  return {
    push(item: T): void {
      if (disposed) return;
      queue.push(item);
      schedule();
    },
    pushMany(items: readonly T[]): void {
      if (disposed || items.length === 0) return;
      for (const item of items) {
        queue.push(item);
      }
      schedule();
    },
    flush,
    dispose(): void {
      disposed = true;
      cancelScheduled();
      queue = [];
    },
    pendingCount(): number {
      return queue.length;
    },
  };
}
