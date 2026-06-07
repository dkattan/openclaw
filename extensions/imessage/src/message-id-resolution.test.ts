import { describe, expect, it } from "vitest";
import { resolveIMessageReplyTargetGuid } from "./message-id-resolution.js";

describe("resolveIMessageReplyTargetGuid", () => {
  it("falls back to chat.db lookup when a numeric reply target is not in the cache", () => {
    const resolved = resolveIMessageReplyTargetGuid({
      messageId: "9001",
      dbPath: "/tmp/chat.db",
      resolveMessageIdImpl: () => "9001",
      resolveGuidFromChatDbImpl: () => "p:0/db-guid",
    });

    expect(resolved).toBe("p:0/db-guid");
  });
});
