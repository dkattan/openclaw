import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import {
  createAccountScopedConversationBindingManager,
  resetAccountScopedConversationBindingsForTests,
} from "./account-scoped-conversation-bindings.js";
import { __testing, getSessionBindingService } from "./session-binding-service.js";

type StoredTargetKind = "session" | "subagent";

const TEST_STATE_KEY = Symbol("openclaw.accountScopedConversationBindings.test");

function createManager(cfg: OpenClawConfig = {} as OpenClawConfig) {
  return createAccountScopedConversationBindingManager<StoredTargetKind>({
    channel: "imessage",
    cfg,
    stateKey: TEST_STATE_KEY,
    accountId: "default",
    toStoredTargetKind: (raw) => raw,
    toSessionBindingTargetKind: (raw) => raw,
  });
}

function resolveConversation(params: { conversationId: string; parentConversationId?: string }) {
  return getSessionBindingService().resolveByConversation({
    channel: "imessage",
    accountId: "default",
    conversationId: params.conversationId,
    ...(params.parentConversationId ? { parentConversationId: params.parentConversationId } : {}),
  });
}

describe("account-scoped conversation bindings", () => {
  let previousStateDir: string | undefined;
  let testStateDir = "";

  beforeEach(async () => {
    previousStateDir = process.env.OPENCLAW_STATE_DIR;
    testStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-account-scoped-bindings-"));
    process.env.OPENCLAW_STATE_DIR = testStateDir;
    resetAccountScopedConversationBindingsForTests({ stateKey: TEST_STATE_KEY });
    __testing.resetSessionBindingAdaptersForTests();
  });

  afterEach(async () => {
    resetAccountScopedConversationBindingsForTests({ stateKey: TEST_STATE_KEY });
    __testing.resetSessionBindingAdaptersForTests();
    if (previousStateDir == null) {
      delete process.env.OPENCLAW_STATE_DIR;
    } else {
      process.env.OPENCLAW_STATE_DIR = previousStateDir;
    }
    await fs.rm(testStateDir, { recursive: true, force: true });
  });

  it("recovers a single child thread from the parent conversation", () => {
    const manager = createManager();
    manager.bindConversation({
      conversationId: "thread-1",
      parentConversationId: "chat-1",
      targetKind: "session",
      targetSessionKey: "agent:main:bluebubbles:direct:+15043825603",
      metadata: {
        label: "thread-1",
      },
    });

    expect(resolveConversation({ conversationId: "chat-1" })).toMatchObject({
      bindingId: "default:thread-1",
      targetSessionKey: "agent:main:bluebubbles:direct:+15043825603",
      conversation: {
        channel: "imessage",
        accountId: "default",
        conversationId: "thread-1",
        parentConversationId: "chat-1",
      },
      metadata: expect.objectContaining({
        label: "thread-1",
      }),
    });
  });

  it("prefers a direct parent binding over child-thread recovery", () => {
    const manager = createManager();
    manager.bindConversation({
      conversationId: "thread-1",
      parentConversationId: "chat-1",
      targetKind: "session",
      targetSessionKey: "agent:main:bluebubbles:direct:+15043825603",
    });
    manager.bindConversation({
      conversationId: "chat-1",
      targetKind: "session",
      targetSessionKey: "agent:main:bluebubbles:direct:+15043825603:parent",
      metadata: {
        label: "parent-chat",
      },
    });

    expect(resolveConversation({ conversationId: "chat-1" })).toMatchObject({
      bindingId: "default:chat-1",
      targetSessionKey: "agent:main:bluebubbles:direct:+15043825603:parent",
      conversation: {
        channel: "imessage",
        accountId: "default",
        conversationId: "chat-1",
      },
      metadata: expect.objectContaining({
        label: "parent-chat",
      }),
    });
  });

  it("does not guess when multiple child threads are active under the same parent", () => {
    const manager = createManager();
    manager.bindConversation({
      conversationId: "thread-1",
      parentConversationId: "chat-1",
      targetKind: "session",
      targetSessionKey: "agent:main:bluebubbles:direct:+15043825603:one",
    });
    manager.bindConversation({
      conversationId: "thread-2",
      parentConversationId: "chat-1",
      targetKind: "session",
      targetSessionKey: "agent:main:bluebubbles:direct:+15043825603:two",
    });

    expect(resolveConversation({ conversationId: "chat-1" })).toBeNull();
  });

  it("reloads persisted child-thread bindings after the in-memory cache is cleared", () => {
    const manager = createManager();
    manager.bindConversation({
      conversationId: "thread-1",
      parentConversationId: "chat-1",
      targetKind: "session",
      targetSessionKey: "agent:main:bluebubbles:direct:+15043825603",
      metadata: {
        label: "thread-1",
      },
    });

    resetAccountScopedConversationBindingsForTests({ stateKey: TEST_STATE_KEY });
    __testing.resetSessionBindingAdaptersForTests();

    createManager();

    expect(resolveConversation({ conversationId: "chat-1" })).toMatchObject({
      bindingId: "default:thread-1",
      targetSessionKey: "agent:main:bluebubbles:direct:+15043825603",
      conversation: {
        channel: "imessage",
        accountId: "default",
        conversationId: "thread-1",
        parentConversationId: "chat-1",
      },
      metadata: expect.objectContaining({
        label: "thread-1",
      }),
    });
  });
});
