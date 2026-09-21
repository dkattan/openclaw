/**
 * Normalizes outbound message text to suppress duplicate send actions.
 */
import { normalizeLowercaseStringOrEmpty } from "@openclaw/normalization-core/string-coerce";

const MIN_DUPLICATE_TEXT_LENGTH = 10;
const MIN_SUBSTRING_DUPLICATE_RATIO = 0.5;
// Paraphrased re-sends ("quick recap" vs "recap:") share most content words
// without either text containing the other. A token-overlap fallback catches
// those where the substring check cannot, e.g. a final reply re-stating a
// message-tool send on the same route (2026-09-18 duplicate recaps). Scoring
// is a symmetric Dice coefficient over whitespace tokens; the bar sits well
// above unrelated messages sharing a greeting or a PR link.
const MIN_TOKEN_OVERLAP_RATIO = 0.6;

/**
 * Normalize text for duplicate comparison.
 * - Trims whitespace
 * - Lowercases
 * - Strips emoji (Emoji_Presentation and Extended_Pictographic)
 * - Collapses multiple spaces to single space
 */
export function normalizeTextForComparison(text: string): string {
  return normalizeLowercaseStringOrEmpty(text)
    .replace(/\p{Emoji_Presentation}|\p{Extended_Pictographic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Compare already-normalized message text against prior sends. */
export function isMessagingToolDuplicateNormalized(
  normalized: string,
  normalizedSentTexts: string[],
): boolean {
  if (normalizedSentTexts.length === 0) {
    return false;
  }
  if (!normalized || normalized.length < MIN_DUPLICATE_TEXT_LENGTH) {
    return false;
  }
  return normalizedSentTexts.some((normalizedSent) => {
    if (!normalizedSent || normalizedSent.length < MIN_DUPLICATE_TEXT_LENGTH) {
      return false;
    }
    if (normalized.includes(normalizedSent)) {
      return normalizedSent.length >= normalized.length * MIN_SUBSTRING_DUPLICATE_RATIO;
    }
    if (
      normalizedSent.includes(normalized) &&
      normalized.length >= normalizedSent.length * MIN_SUBSTRING_DUPLICATE_RATIO
    ) {
      return true;
    }
    return tokenOverlapRatio(normalized, normalizedSent) >= MIN_TOKEN_OVERLAP_RATIO;
  });
}

/** Dice coefficient over whitespace tokens of already-normalized texts. */
function tokenOverlapRatio(left: string, right: string): number {
  const stripTrailingPunctuation = (token: string) => token.replace(/[\p{P}]+$/u, "");
  const leftTokens = left.split(" ").filter(Boolean).map(stripTrailingPunctuation).filter(Boolean);
  const rightTokens = right
    .split(" ")
    .filter(Boolean)
    .map(stripTrailingPunctuation)
    .filter(Boolean);
  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return 0;
  }
  const rightCounts = new Map<string, number>();
  for (const token of rightTokens) {
    rightCounts.set(token, (rightCounts.get(token) ?? 0) + 1);
  }
  let shared = 0;
  for (const token of leftTokens) {
    const remaining = rightCounts.get(token) ?? 0;
    if (remaining > 0) {
      shared += 1;
      rightCounts.set(token, remaining - 1);
    }
  }
  return (2 * shared) / (leftTokens.length + rightTokens.length);
}

/** Return true when raw message text duplicates a prior sent message. */
export function isMessagingToolDuplicate(text: string, sentTexts: string[]): boolean {
  if (sentTexts.length === 0) {
    return false;
  }
  const normalized = normalizeTextForComparison(text);
  if (!normalized || normalized.length < MIN_DUPLICATE_TEXT_LENGTH) {
    return false;
  }
  return sentTexts.some((sentText) =>
    isMessagingToolDuplicateNormalized(normalized, [normalizeTextForComparison(sentText)]),
  );
}

export function resolveCurrentSourceMessagingToolPartial(
  state: {
    currentSourceMessagingToolHeldPartial?: string;
    currentSourceMessagingToolSentTextsNormalized: string[];
  },
  params: {
    evtType: "text_delta" | "text_start" | "text_end";
    text: string;
    visibleDelta: string;
  },
): { hold: boolean; text: string } {
  const held = state.currentSourceMessagingToolHeldPartial;
  const text =
    held && params.evtType === "text_delta" && !params.text.startsWith(held)
      ? `${held}${params.visibleDelta || params.text}`
      : params.text;
  const normalized = state.currentSourceMessagingToolSentTextsNormalized.length
    ? normalizeTextForComparison(text)
    : "";
  if (!normalized) {
    state.currentSourceMessagingToolHeldPartial = undefined;
    return { hold: false, text };
  }
  // A confirmed current-source tool send already made this prefix visible.
  // Hold it until the assistant either repeats the sent text or diverges with new content.
  const hold = state.currentSourceMessagingToolSentTextsNormalized.some(
    (sentText) => sentText === normalized || sentText.startsWith(normalized),
  );
  state.currentSourceMessagingToolHeldPartial = hold ? text : undefined;
  return { hold, text };
}
