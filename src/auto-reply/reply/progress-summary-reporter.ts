type ProgressSummaryReporterParams = {
  shouldSend?: () => boolean;
  send: (text: string) => void | Promise<void>;
  initialDelayMs?: number;
  repeatDelayMs?: number;
  now?: () => number;
  schedule?: (fn: () => void, delayMs: number) => unknown;
  cancel?: (handle: unknown) => void;
};

export type ProgressSummaryReporter = {
  noteProgress: (text?: string) => void;
  noteVisibleDelivery: () => void;
  dispose: () => void;
};

const DEFAULT_INITIAL_DELAY_MS = 10_000;
const DEFAULT_REPEAT_DELAY_MS = 60_000;

function normalizeProgressText(text?: string): string {
  const normalized = (text ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  if (normalized.length <= 200) {
    return normalized;
  }
  return `${normalized.slice(0, 197).trimEnd()}...`;
}

export function createProgressSummaryReporter(
  params: ProgressSummaryReporterParams,
): ProgressSummaryReporter {
  const shouldSend = params.shouldSend ?? (() => true);
  const now = params.now ?? (() => Date.now());
  const schedule = params.schedule ?? ((fn, delayMs) => setTimeout(fn, delayMs));
  const cancel =
    params.cancel ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const initialDelayMs = params.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  const repeatDelayMs = params.repeatDelayMs ?? DEFAULT_REPEAT_DELAY_MS;

  const startedAt = now();
  let lastVisibleDeliveryAt: number | undefined;
  let latestProgressText = "";
  let lastSentProgressText = "";
  let disposed = false;
  let timerHandle: unknown;
  let sendChain = Promise.resolve();

  const clearScheduled = () => {
    if (timerHandle === undefined) {
      return;
    }
    cancel(timerHandle);
    timerHandle = undefined;
  };

  const scheduleNext = () => {
    clearScheduled();
    if (disposed || !latestProgressText || !shouldSend()) {
      return;
    }
    const dueAt =
      lastVisibleDeliveryAt === undefined
        ? startedAt + initialDelayMs
        : lastVisibleDeliveryAt + repeatDelayMs;
    const delayMs = Math.max(0, dueAt - now());
    timerHandle = schedule(() => {
      timerHandle = undefined;
      if (disposed || !latestProgressText || !shouldSend()) {
        return;
      }
      if (latestProgressText === lastSentProgressText) {
        scheduleNext();
        return;
      }
      const text = latestProgressText;
      sendChain = sendChain
        .then(async () => {
          if (disposed || !shouldSend()) {
            return;
          }
          await params.send(text);
          lastSentProgressText = latestProgressText;
          lastVisibleDeliveryAt = now();
          scheduleNext();
        })
        .catch(() => {
          lastVisibleDeliveryAt = now();
          scheduleNext();
        });
    }, delayMs);
  };

  return {
    noteProgress(text?: string) {
      const normalized = normalizeProgressText(text);
      if (!normalized) {
        return;
      }
      latestProgressText = normalized;
      scheduleNext();
    },
    noteVisibleDelivery() {
      lastVisibleDeliveryAt = now();
      scheduleNext();
    },
    dispose() {
      disposed = true;
      clearScheduled();
    },
  };
}
