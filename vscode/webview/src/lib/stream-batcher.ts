export interface StreamBatcher<T> {
  push: (item: T) => void;
  flushNow: () => void;
  dispose: () => void;
}

const DEFAULT_BATCH_WINDOW_MS = 16;

export function createStreamBatcher<T>(
  onFlush: (items: T[]) => void,
  windowMs: number = DEFAULT_BATCH_WINDOW_MS,
): StreamBatcher<T> {
  let queue: T[] = [];
  let timerId: ReturnType<typeof setTimeout> | null = null;
  let rafId: number | null = null;
  let disposed = false;

  const clearScheduled = () => {
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
    if (rafId !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  };

  const flushNow = () => {
    clearScheduled();
    if (disposed || queue.length === 0) return;
    const batch = queue;
    queue = [];
    onFlush(batch);
  };

  const scheduleFlush = () => {
    if (timerId !== null || rafId !== null) return;
    const clampedWindow = Math.max(16, Math.min(33, windowMs));
    timerId = setTimeout(() => {
      timerId = null;
      if (typeof requestAnimationFrame === "function") {
        rafId = requestAnimationFrame(() => {
          rafId = null;
          flushNow();
        });
      } else {
        flushNow();
      }
    }, clampedWindow);
  };

  const push = (item: T) => {
    if (disposed) return;
    queue.push(item);
    scheduleFlush();
  };

  const dispose = () => {
    disposed = true;
    clearScheduled();
    queue = [];
  };

  return {
    push,
    flushNow,
    dispose,
  };
}
