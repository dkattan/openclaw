import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionEntry } from "../../config/sessions.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import type { CommandContext } from "./commands-types.js";
import { parseInlineDirectives } from "./directive-handling.parse.js";
import { applyInlineDirectiveOverrides, formatModelOverrideResetEvent } from "./get-reply-directives-apply.js";

const mocks = vi.hoisted(() => ({
  handleDirectiveOnly: vi.fn(),
  resolveCurrentDirectiveLevels: vi.fn(),
}));

vi.mock("./directive-handling.impl.js", () => ({
  handleDirectiveOnly: (...args: unknown[]) => mocks.handleDirectiveOnly(...args),
}));

vi.mock("./directive-handling.levels.js", () => ({
  resolveCurrentDirectiveLevels: (...args: unknown[]) => mocks.resolveCurrentDirectiveLevels(...args),
}));

function makeSessionEntry(overrides: Partial<SessionEntry> = {}): SessionEntry {
  return {
    sessionId: "session-id",
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeCommandContext(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    surface: "imessage",
    channel: "bluebubbles",
    ownerList: [],
    senderIsOwner: true,
    isAuthorizedSender: true,
    rawBodyNormalized: "/progress paced",
    commandBodyNormalized: "/progress paced",
    ...overrides,
  };
}

function makeTypingController() {
  return {
    onReplyStart: async () => {},
    startTypingLoop: async () => {},
    startTypingOnText: async () => {},
    refreshTypingTtl: () => {},
    isActive: () => false,
    markRunComplete: () => {},
    markDispatchIdle: () => {},
    cleanup: vi.fn(),
  };
}

function createConfig(): OpenClawConfig {
  return {
    commands: { text: true },
    agents: { defaults: {} },
  } as OpenClawConfig;
}

describe("formatModelOverrideResetEvent", () => {
  it("names the rejected model override and allowlist recovery path", () => {
    expect(
      formatModelOverrideResetEvent({
        rejectedRef: "ollama/Gemma4-26b-a4-it-gguf",
        initialModelLabel: "github-copilot/gpt-4o",
      }),
    ).toBe(
      "Model override ollama/Gemma4-26b-a4-it-gguf is not allowed for this agent; reverted to github-copilot/gpt-4o. Add ollama/Gemma4-26b-a4-it-gguf to agents.defaults.models or pick an allowed model with /model list.",
    );
  });

  it("keeps the legacy generic message when the rejected ref is unknown", () => {
    expect(
      formatModelOverrideResetEvent({
        initialModelLabel: "github-copilot/gpt-4o",
      }),
    ).toBe("Model override not allowed for this agent; reverted to github-copilot/gpt-4o.");
  });
});

describe("applyInlineDirectiveOverrides", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveCurrentDirectiveLevels.mockResolvedValue({
      currentThinkLevel: "off",
      currentFastMode: false,
      currentProgressMode: "native",
      currentVerboseLevel: "off",
      currentReasoningLevel: "off",
      currentElevatedLevel: "off",
    });
    mocks.handleDirectiveOnly.mockResolvedValue({
      text: "⚙️ Progress updates set to paced.",
    });
  });

  it("handles directive-only progress commands", async () => {
    const cfg = createConfig();
    const sessionEntry = makeSessionEntry();
    const typing = makeTypingController();

    const result = await applyInlineDirectiveOverrides({
      ctx: {
        Surface: "imessage",
        Provider: "bluebubbles",
        GatewayClientScopes: [],
      },
      cfg,
      agentId: "main",
      agentDir: "/tmp/agent",
      workspaceDir: "/tmp/workspace",
      agentCfg: cfg.agents?.defaults,
      sessionEntry,
      sessionStore: { "agent:main:imessage:user": sessionEntry },
      sessionKey: "agent:main:imessage:user",
      storePath: undefined,
      sessionScope: undefined,
      isGroup: false,
      allowTextCommands: true,
      command: makeCommandContext(),
      directives: parseInlineDirectives("/progress paced"),
      messageProviderKey: "bluebubbles",
      elevatedEnabled: false,
      elevatedAllowed: false,
      elevatedFailures: [],
      defaultProvider: "openai",
      defaultModel: "gpt-4o",
      aliasIndex: { byAlias: new Map(), byKey: new Map() },
      provider: "openai",
      model: "gpt-4o",
      modelState: {
        allowedModelKeys: new Set(),
        allowedModelCatalog: [],
        resetModelOverride: false,
        resetModelOverrideRef: undefined,
        resolveDefaultThinkingLevel: async () => "off",
        resolveThinkingCatalog: async () => [],
      },
      initialModelLabel: "openai/gpt-4o",
      formatModelSwitchEvent: (label) => label,
      resolvedElevatedLevel: "off",
      defaultActivation: () => "mention",
      contextTokens: 0,
      typing,
    });

    expect(result).toEqual({
      kind: "reply",
      reply: { text: "⚙️ Progress updates set to paced." },
    });
    expect(mocks.handleDirectiveOnly).toHaveBeenCalledOnce();
    expect(typing.cleanup).toHaveBeenCalledOnce();
  });
});
