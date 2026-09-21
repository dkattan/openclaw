import path from "node:path";
import { createDeferred } from "openclaw/plugin-sdk/extension-shared";
import { closeOpenClawStateDatabaseForTest } from "openclaw/plugin-sdk/plugin-state-test-runtime";
import {
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
  type OpenClawConfig,
} from "openclaw/plugin-sdk/runtime-config-snapshot";
import type { waitForTransportReady } from "openclaw/plugin-sdk/transport-ready-runtime";
import { expect, it, vi } from "vitest";
import { IMessageRpcClient, createIMessageRpcClient } from "./client.js";
import { monitorIMessageProvider } from "./monitor.js";
import { resolveIMessageInboundDecision } from "./monitor/inbound-processing.js";
import type { IMessagePayload } from "./monitor/types.js";
import { getIMessageRuntime } from "./runtime.js";
import { installIMessageStateRuntimeForTest } from "./test-support/runtime.js";

vi.mock("openclaw/plugin-sdk/transport-ready-runtime", () => ({
  waitForTransportReady: vi.fn<typeof waitForTransportReady>(async () => {}),
}));
vi.mock("./client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./client.js")>()),
  createIMessageRpcClient: vi.fn<typeof createIMessageRpcClient>(),
}));
vi.mock("./monitor/inbound-processing.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./monitor/inbound-processing.js")>()),
  resolveIMessageInboundDecision: vi.fn<typeof resolveIMessageInboundDecision>(async () => ({
    kind: "drop",
    reason: "dmPolicy disabled",
  })),
}));

it("batches iMessage text and attachments with live delay changes on the attached RPC client", async () => {
  installIMessageStateRuntimeForTest();
  const cfg: OpenClawConfig = {
    channels: {
      imessage: {
        dbPath: path.join(getIMessageRuntime().state.resolveStateDir(), "absent-chat.db"),
        dmPolicy: "disabled",
      },
    },
    messages: { inbound: { debounceMs: 0 } },
  };
  setRuntimeConfigSnapshot(cfg, cfg);
  const ready = createDeferred<void>();
  const closed = createDeferred<void>();
  const client = new IMessageRpcClient();
  vi.spyOn(client, "request").mockResolvedValue({ subscription: 1 });
  vi.spyOn(client, "waitForClose").mockImplementation(() => closed.promise);
  vi.spyOn(client, "stop").mockImplementation(async () => closed.resolve());
  let notify: NonNullable<Parameters<typeof createIMessageRpcClient>[0]>["onNotification"];
  vi.mocked(createIMessageRpcClient).mockImplementation(async (options) => {
    notify = options?.onNotification;
    return client;
  });
  const abort = new AbortController();
  const monitor = monitorIMessageProvider({
    config: cfg,
    abortSignal: abort.signal,
    runtime: { log: vi.fn(), error: vi.fn(), exit: vi.fn() },
    statusSink: (patch) => {
      if (patch.connected) {
        ready.resolve();
      }
    },
  });
  let sequence = 0;
  const enqueue = (text: string, extra: Partial<IMessagePayload> = {}) => {
    sequence += 1;
    notify?.({
      method: "message",
      params: {
        message: {
          id: sequence,
          guid: `debounce-${sequence}`,
          chat_id: 123,
          sender: "+15555550101",
          text,
          created_at: new Date().toISOString(),
          is_from_me: false,
          is_group: false,
          ...extra,
        },
      },
    });
  };
  const bodies = () =>
    vi.mocked(resolveIMessageInboundDecision).mock.calls.map(([params]) => params.message.text);
  const publish = (debounceMs: number) => {
    const current = { ...cfg, messages: { inbound: { byChannel: { imessage: debounceMs } } } };
    setRuntimeConfigSnapshot(current, current);
  };
  try {
    await Promise.race([ready.promise, monitor]);
    enqueue("immediate");
    await vi.waitFor(() => expect(bodies()).toEqual(["immediate"]));
    publish(500);
    const started = performance.now();
    enqueue("first");
    enqueue("second");
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
    expect(bodies()).toEqual(["immediate"]);
    await vi.waitFor(() => expect(bodies()).toEqual(["immediate", "first second"]));
    const delayedElapsedMs = performance.now() - started;
    const attachment = {
      original_path: "/Users/test/Library/Messages/Attachments/photo.png",
      mime_type: "image/png",
      missing: false,
    };
    for (const imageFirst of [true, false]) {
      publish(7000);
      const before = bodies();
      const caption = imageFirst ? "describe this image" : "inspect this screenshot";
      const first = imageFirst ? { text: "", attachments: [attachment] } : { text: caption };
      const second = imageFirst ? { text: caption } : { text: "", attachments: [attachment] };
      const batchStarted = performance.now();
      enqueue(first.text, first);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(bodies()).toEqual(before);
      await new Promise((resolve) => setTimeout(resolve, 3400));
      const lastArrival = performance.now();
      enqueue(second.text, second);
      // Past the first message's deadline, but still inside the second one's window.
      await new Promise((resolve) => setTimeout(resolve, 3750));
      expect(bodies()).toEqual(before);
      await vi.waitFor(() => expect(bodies()).toEqual([...before, caption]), { timeout: 5000 });
      expect(performance.now() - lastArrival).toBeGreaterThanOrEqual(6950);
      const combined = vi.mocked(resolveIMessageInboundDecision).mock.lastCall?.[0].message;
      expect(combined?.attachments).toEqual([attachment]);
      expect(combined?.guid).toBe(`debounce-${sequence - 1}`);
      console.log(
        "IMESSAGE_MEDIA_DEBOUNCE_PROOF " +
          JSON.stringify({
            imageFirst,
            debounceMs: 7000,
            elapsedMs: performance.now() - batchStarted,
            dispatches: bodies().length - before.length,
            attachments: combined?.attachments?.length,
          }),
      );
    }
    const beforeCommand = bodies();
    enqueue("/stop", { attachments: [attachment] });
    await vi.waitFor(() => expect(bodies()).toEqual([...beforeCommand, "/stop"]));
    publish(0);
    const beforeDisable = bodies();
    enqueue("after disable", { attachments: [attachment] });
    await vi.waitFor(() => expect(bodies()).toEqual([...beforeDisable, "after disable"]));
    console.log(
      "MONITOR_DEBOUNCE_PROOF " +
        JSON.stringify({
          channel: "imessage",
          pid: process.pid,
          clock: "real",
          delaysMs: [0, 500, 0],
          delayedElapsedMs,
          bodies: bodies(),
          clientsCreated: vi.mocked(createIMessageRpcClient).mock.calls.length,
        }),
    );
    expect(createIMessageRpcClient).toHaveBeenCalledTimes(1);
  } finally {
    abort.abort();
    await monitor;
    clearRuntimeConfigSnapshot();
    closeOpenClawStateDatabaseForTest();
    vi.restoreAllMocks();
  }
}, 35000);
