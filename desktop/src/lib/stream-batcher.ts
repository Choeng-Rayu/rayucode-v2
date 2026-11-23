export interface StreamBatcher<T> {
  push: (item: T) => void
  flushNow: () => void
  dispose: () => void
}

const DEFAULT_BATCH_WINDOW_MS = 16

export function createStreamBatcher<T>(
  onFlush: (items: T[]) => void,
  windowMs: number = DEFAULT_BATCH_WINDOW_MS
): StreamBatcher<T> {
  let queue: T[] = []
  let timerId: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  const clearScheduled = () => {
    if (timerId !== null) {
      clearTimeout(timerId)
      timerId = null
    }
  }

  const flushNow = () => {
    clearScheduled()
    if (disposed || queue.length === 0) return
    const batch = queue
    queue = []
    onFlush(batch)
  }

  const push = (item: T) => {
    if (disposed) return
    queue.push(item)
    if (timerId === null) {
      timerId = setTimeout(flushNow, windowMs)
    }
  }

  const dispose = () => {
    disposed = true
    clearScheduled()
    queue = []
  }

  return {
    push,
    flushNow,
    dispose,
  }
}
