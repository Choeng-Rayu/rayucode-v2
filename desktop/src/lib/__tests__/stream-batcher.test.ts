import { describe, expect, it, vi } from "vitest"

import { createStreamBatcher } from "../stream-batcher"

describe("createStreamBatcher", () => {
  it("coalesces multiple pushes within one frame into a single flush", () => {
    vi.useFakeTimers()
    const flushed: string[][] = []
    const batcher = createStreamBatcher<string>((items) => flushed.push(items))

    batcher.push("a")
    batcher.push("b")
    batcher.push("c")

    expect(flushed).toHaveLength(0)
    vi.advanceTimersByTime(20)
    expect(flushed).toEqual([["a", "b", "c"]])

    batcher.dispose()
    vi.useRealTimers()
  })

  it("supports immediate flushNow and ignores pushes after dispose", () => {
    vi.useFakeTimers()
    const flushed: number[][] = []
    const batcher = createStreamBatcher<number>((items) => flushed.push(items))

    batcher.push(1)
    batcher.push(2)
    batcher.flushNow()
    expect(flushed).toEqual([[1, 2]])

    batcher.dispose()
    batcher.push(3)
    vi.advanceTimersByTime(30)
    expect(flushed).toEqual([[1, 2]])
    vi.useRealTimers()
  })
})
