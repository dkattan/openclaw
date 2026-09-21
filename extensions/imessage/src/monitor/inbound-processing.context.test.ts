import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFreshIMessageReplyCacheForTest } from "../test-support/runtime.js";

type InboundProcessingModule = typeof import("./inbound-processing.js");
type InboundDecisionParams = Parameters<
  InboundProcessingModule["resolveIMessageInboundDecision"]
>[0];

let buildIMessageInboundContext: InboundProcessingModule["buildIMessageInboundContext"];
let resolveIMessageInboundDecision: InboundProcessingModule["resolveIMessageInboundDecision"];
const cfg = {} as OpenClawConfig;

beforeAll(async () => {
  await loadFreshIMessageReplyCacheForTest();
  ({ buildIMessageInboundContext, resolveIMessageInboundDecision } =
    await import("./inbound-processing.js"));
});

function resolveDecision(
  overrides: Omit<Partial<InboundDecisionParams>, "message"> & {
    message?: Partial<InboundDecisionParams["message"]>;
  } = {},
) {
  const { message: messageOverrides, ...restOverrides } = overrides;
  const message = {
    id: 42,
    sender: "+15555550123",
    text: "ok",
    is_from_me: false,
    is_group: false,
    ...messageOverrides,
  };
  const messageText = restOverrides.messageText ?? message.text ?? "";
  const bodyText = restOverrides.bodyText ?? messageText;
  return resolveIMessageInboundDecision({
    cfg,
    accountId: "default",
    opts: undefined,
    allowFrom: ["*"],
    groupAllowFrom: [],
    groupPolicy: "open",
    dmPolicy: "open",
    storeAllowFrom: [],
    historyLimit: 0,
    groupHistories: new Map(),
    echoCache: undefined,
    selfChatCache: undefined,
    isKnownFromMeMessageId: () => false,
    logVerbose: undefined,
    ...restOverrides,
    message,
    messageText,
    bodyText,
  });
}

describe("buildIMessageInboundContext presentation", () => {
  it("uses provider-resolved contact names for direct session and sender presentation", async () => {
    const message = {
      id: 12344,
      guid: "p:0/GUID-contact-name",
      sender: "+15555550123",
      sender_name: "Alice",
      chat_name: "",
      text: "Hello",
      is_from_me: false,
      is_group: false,
    };
    const decision = await resolveDecision({ message });
    expect(decision.kind).toBe("dispatch");
    if (decision.kind !== "dispatch") {
      return;
    }

    const { ctxPayload, fromLabel } = await buildIMessageInboundContext({
      cfg,
      accountService: undefined,
      decision,
      message,
      historyLimit: 0,
      groupHistories: new Map(),
    });

    expect(fromLabel).toBe("Alice id:+15555550123");
    expect(ctxPayload.ConversationLabel).toBe("Alice");
    expect(ctxPayload.SenderName).toBe("Alice");
  });

  it("keeps group route IDs out of named session presentation", async () => {
    const message = {
      id: 12345,
      guid: "p:0/GUID-group-name",
      chat_id: 13,
      chat_name: "Family",
      sender: "+15555550123",
      sender_name: "Alice",
      text: "Hello",
      is_from_me: false,
      is_group: true,
    };
    const decision = await resolveDecision({ message });
    expect(decision.kind).toBe("dispatch");
    if (decision.kind !== "dispatch") {
      return;
    }

    const { ctxPayload, fromLabel } = await buildIMessageInboundContext({
      cfg,
      accountService: undefined,
      decision,
      message,
      historyLimit: 0,
      groupHistories: new Map(),
    });

    expect(fromLabel).toBe("Family id:13");
    expect(ctxPayload.ConversationLabel).toBe("Family");
    expect(ctxPayload.GroupSubject).toBe("Family");
  });
});

describe("resolveIMessageInboundDecision command auth", () => {
  const resolveDmCommandDecision = (params: {
    messageId: number;
    storeAllowFrom: string[];
    dmPolicy?: "open" | "pairing" | "allowlist" | "disabled";
    allowFrom?: string[];
    text?: string;
  }) =>
    resolveDecision({
      message: {
        id: params.messageId,
        sender: "+15555550123",
        text: params.text ?? "/status",
        is_from_me: false,
        is_group: false,
      },
      allowFrom: params.allowFrom ?? [],
      dmPolicy: params.dmPolicy ?? "open",
      storeAllowFrom: params.storeAllowFrom,
    });

  it("does not auto-authorize DM commands in open mode without allowlists", async () => {
    const decision = await resolveDmCommandDecision({
      messageId: 100,
      storeAllowFrom: [],
    });

    expect(decision).toEqual({ kind: "drop", reason: "dmPolicy blocked" });
  });

  it("authorizes DM commands for senders in pairing-mode store allowlist", async () => {
    const decision = await resolveDmCommandDecision({
      messageId: 101,
      dmPolicy: "pairing",
      storeAllowFrom: ["+15555550123"],
    });

    expect(decision.kind).toBe("dispatch");
    if (decision.kind !== "dispatch") {
      return;
    }
    expect(decision.commandAuthorized).toBe(true);
    expect(decision.hasControlCommand).toBe(true);
  });

  it("marks authorized iMessage control commands as text command turns", async () => {
    const decision = await resolveDmCommandDecision({
      messageId: 102,
      dmPolicy: "pairing",
      storeAllowFrom: ["+15555550123"],
      text: "/new",
    });

    expect(decision.kind).toBe("dispatch");
    if (decision.kind !== "dispatch") {
      return;
    }

    const { ctxPayload } = await buildIMessageInboundContext({
      cfg,
      accountService: undefined,
      decision,
      message: {
        id: 102,
        guid: "p:0/GUID-command",
        sender: "+15555550123",
        text: "/new",
        is_from_me: false,
        is_group: false,
      },
      historyLimit: 0,
      groupHistories: new Map(),
    });

    expect(ctxPayload.CommandAuthorized).toBe(true);
    expect(ctxPayload.ConversationRoutePeerId).toBe("+15555550123");
    expect(ctxPayload.CommandSource).toBe("text");
    expect(ctxPayload.CommandTurn).toMatchObject({
      kind: "text-slash",
      source: "text",
      authorized: true,
      commandName: "new",
    });
  });

  it("does not mark authorized non-command iMessage DMs as text command turns", async () => {
    const decision = await resolveDmCommandDecision({
      messageId: 103,
      dmPolicy: "pairing",
      storeAllowFrom: ["+15555550123"],
      text: "hello there",
    });

    expect(decision.kind).toBe("dispatch");
    if (decision.kind !== "dispatch") {
      return;
    }
    expect(decision.commandAuthorized).toBe(true);
    expect(decision.hasControlCommand).toBe(false);

    const { ctxPayload } = await buildIMessageInboundContext({
      cfg,
      accountService: undefined,
      decision,
      message: {
        id: 103,
        guid: "p:0/GUID-non-command",
        sender: "+15555550123",
        text: "hello there",
        is_from_me: false,
        is_group: false,
      },
      historyLimit: 0,
      groupHistories: new Map(),
    });

    expect(ctxPayload.CommandAuthorized).toBe(true);
    expect(ctxPayload.CommandSource).toBeUndefined();
    expect(ctxPayload.CommandTurn).toMatchObject({
      kind: "normal",
      source: "message",
      commandName: undefined,
    });
  });
});

describe("describeReplyContext thread-root quote suppression", () => {
  it("drops the quoted body when it can only be the stale thread root, keeping ids", async () => {
    // iOS reply threads: reply_to_guid points at the direct parent bubble
    // while thread_originator_guid stays pinned to the root. imsg resolves
    // reply_to_text from the root first, so the payload body is the root's
    // text. Quoting that root on every turn re-anchored already-answered
    // asks (the 2026-09-18 duplicate-recap loop).
    const message = {
      id: 12350,
      guid: "p:0/GUID-thread-child",
      sender: "+15555550123",
      text: "and now something new",
      is_from_me: false,
      is_group: false,
      thread_originator_guid: "ROOT-GUID",
      reply_to_guid: "PARENT-GUID",
      reply_to_text: "Use immy MCP to check on the Claude session",
      reply_to_sender: "+15555550123",
    };
    const decision = await resolveDecision({ message });
    expect(decision.kind).toBe("dispatch");
    if (decision.kind !== "dispatch") {
      return;
    }
    expect(decision.replyContext?.body).toBe("");
    expect(decision.replyContext?.fullId).toBe("PARENT-GUID");
    expect(decision.replyContext?.id).toBe("PARENT-GUID");
  });

  it("keeps the quoted body when the direct parent IS the thread root", async () => {
    const message = {
      id: 12351,
      guid: "p:0/GUID-thread-first-reply",
      sender: "+15555550123",
      text: "answering the root",
      is_from_me: false,
      is_group: false,
      thread_originator_guid: "ROOT-GUID",
      reply_to_guid: "ROOT-GUID",
      reply_to_text: "Root ask body",
      reply_to_sender: "+15555550123",
    };
    const decision = await resolveDecision({ message });
    expect(decision.kind).toBe("dispatch");
    if (decision.kind !== "dispatch") {
      return;
    }
    expect(decision.replyContext?.body).toBe("Root ask body");
    expect(decision.replyContext?.fullId).toBe("ROOT-GUID");
  });

  it("keeps the quoted body when only reply_to_guid is present (no thread root)", async () => {
    const message = {
      id: 12352,
      guid: "p:0/GUID-plain-reply",
      sender: "+15555550123",
      text: "a plain reply",
      is_from_me: false,
      is_group: false,
      reply_to_guid: "PARENT-GUID",
      reply_to_text: "Parent body",
      reply_to_sender: "+15555550123",
    };
    const decision = await resolveDecision({ message });
    expect(decision.kind).toBe("dispatch");
    if (decision.kind !== "dispatch") {
      return;
    }
    expect(decision.replyContext?.body).toBe("Parent body");
    expect(decision.replyContext?.fullId).toBe("PARENT-GUID");
  });
});
