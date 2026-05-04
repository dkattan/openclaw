import { describe, expect, it } from "vitest";
import { trimFinalReplyAgainstProgress } from "./progress-summary-final.js";

describe("trimFinalReplyAgainstProgress", () => {
  it("drops duplicated leading sentences already covered by progress updates", () => {
    expect(
      trimFinalReplyAgainstProgress(
        {
          text: "Inspecting payload dependencies to decide the safest fix. The actual change is a tiny import cleanup.",
        },
        ["Working: Inspecting payload dependencies to decide the safest fix."],
      ),
    ).toEqual({
      text: "The actual change is a tiny import cleanup.",
    });
  });

  it("drops fully repeated paragraphs that were already sent as progress", () => {
    expect(
      trimFinalReplyAgainstProgress(
        {
          text:
            "Inspect code, patch it, run tests.\n\n1. Inspect code\n2. Patch code\n3. Run tests\n\nI finished the patch and the tests are green.",
        },
        ["Inspect code, patch it, run tests.\n\n1. Inspect code\n2. Patch code\n3. Run tests"],
      ),
    ).toEqual({
      text: "I finished the patch and the tests are green.",
    });
  });

  it("falls back to Done when the whole final text was already sent and no media remains", () => {
    expect(
      trimFinalReplyAgainstProgress(
        {
          text: "Inspecting payload dependencies to decide the safest fix.",
        },
        ["Working: Inspecting payload dependencies to decide the safest fix."],
      ),
    ).toEqual({
      text: "Done.",
    });
  });
});
