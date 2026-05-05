import { afterEach, describe, expect, it, vi } from "vitest";
import { createProgressSummaryReporter } from "./progress-summary-reporter.js";

describe("createProgressSummaryReporter", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends the first progress summary after the initial silence window", async () => {
    vi.useFakeTimers();
    const send = vi.fn(async () => {});
    const reporter = createProgressSummaryReporter({
      send,
      initialDelayMs: 10_000,
      repeatDelayMs: 60_000,
    });

    reporter.noteProgress("Inspecting payload dependencies.");
    await vi.advanceTimersByTimeAsync(9_999);
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
      initialDelayMs: 10_000,
      repeatDelayMs: 60_000,
    });

    reporter.noteProgress("Reviewing config.");
    await vi.advanceTimersByTimeAsync(5_000);
    reporter.noteVisibleDelivery();
    await vi.advanceTimersByTimeAsync(9_000);
    expect(send).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(51_000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("Reviewing config.");

    reporter.dispose();
  });

  it("only sends changed follow-up summaries after the repeat silence window", async () => {
    vi.useFakeTimers();
    const send = vi.fn(async () => {});
    const reporter = createProgressSummaryReporter({
      send,
      initialDelayMs: 10_000,
      repeatDelayMs: 60_000,
    });

    reporter.noteProgress("Inspecting payload dependencies.");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(send).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(send).toHaveBeenCalledTimes(1);

    reporter.noteProgress("Running targeted tests.");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith("Running targeted tests.");

    reporter.dispose();
  });
});
