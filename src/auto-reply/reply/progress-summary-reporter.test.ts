import { afterEach, describe, expect, it, vi } from "vitest";
import { createProgressSummaryReporter } from "./progress-summary-reporter.js";

describe("createProgressSummaryReporter", () => {
  const initialDelayMs = 6_000;
  const repeatDelayMs = 20_000;
  const visibleDeliveryCooldownMs = 10_000;
  const unchangedHeartbeatMs = 45_000;

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends the first progress summary after the initial silence window", async () => {
    vi.useFakeTimers();
    const send = vi.fn(async () => {});
    const reporter = createProgressSummaryReporter({
      send,
      initialDelayMs,
      repeatDelayMs,
      visibleDeliveryCooldownMs,
      unchangedHeartbeatMs,
    });

    reporter.noteProgress("Inspecting payload dependencies.");
    await vi.advanceTimersByTimeAsync(initialDelayMs - 1);
    expect(send).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("Inspecting payload dependencies.");

    reporter.dispose();
  });

  it("defers synthetic progress after real visible delivery", async () => {
    vi.useFakeTimers();
    const send = vi.fn(async () => {});
    const reporter = createProgressSummaryReporter({
      send,
      initialDelayMs,
      repeatDelayMs,
      visibleDeliveryCooldownMs,
      unchangedHeartbeatMs,
    });

    reporter.noteProgress("Reviewing config.");
    await vi.advanceTimersByTimeAsync(5_000);
    reporter.noteVisibleDelivery();
    await vi.advanceTimersByTimeAsync(visibleDeliveryCooldownMs - 1);
    expect(send).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("Reviewing config.");

    reporter.dispose();
  });

  it("anchors changed follow-up summaries to the last paced emit, not later visible delivery", async () => {
    vi.useFakeTimers();
    const send = vi.fn(async () => {});
    const reporter = createProgressSummaryReporter({
      send,
      initialDelayMs,
      repeatDelayMs,
      visibleDeliveryCooldownMs,
      unchangedHeartbeatMs,
    });

    reporter.noteProgress("Inspecting payload dependencies.");
    await vi.advanceTimersByTimeAsync(initialDelayMs);
    expect(send).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(9_000);
    reporter.noteVisibleDelivery();
    reporter.noteProgress("Running targeted tests.");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(send).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith("Running targeted tests.");

    reporter.dispose();
  });

  it("re-emits the same summary after the max stale heartbeat window", async () => {
    vi.useFakeTimers();
    const send = vi.fn(async () => {});
    const reporter = createProgressSummaryReporter({
      send,
      initialDelayMs,
      repeatDelayMs,
      visibleDeliveryCooldownMs,
      unchangedHeartbeatMs,
    });

    reporter.noteProgress("Reviewing long-running test output.");
    await vi.advanceTimersByTimeAsync(initialDelayMs);
    expect(send).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(unchangedHeartbeatMs - 1);
    expect(send).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenNthCalledWith(2, "Reviewing long-running test output.");

    reporter.dispose();
  });
});
