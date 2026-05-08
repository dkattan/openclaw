import type { ReplyPayload } from "../reply-payload.js";

function normalizeProgressText(text: string): string {
  return text
    .replace(/^(?:still\s+working|working)\s*:\s*/i, "")
    .replace(/[_*`>#-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function splitSentences(text: string): string[] {
  const sentences = text
    .split(/(?<=[.!?])\s+/u)
    .map((part) => part.trim())
    .filter(Boolean);
  return sentences.length > 0 ? sentences : [text.trim()];
}

function tokenize(text: string): string[] {
  return text
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function isCoveredByProgress(candidate: string, progressTexts: string[]): boolean {
  const normalizedCandidate = normalizeProgressText(candidate);
  if (normalizedCandidate.length < 24) {
    return false;
  }
  const candidateTokens = new Set(tokenize(normalizedCandidate));
  for (const progressText of progressTexts) {
    const normalizedProgress = normalizeProgressText(progressText);
    if (!normalizedProgress) {
      continue;
    }
    if (
      normalizedProgress.includes(normalizedCandidate) ||
      (normalizedCandidate.includes(normalizedProgress) &&
        normalizedProgress.length >= Math.min(80, Math.floor(normalizedCandidate.length * 0.7)))
    ) {
      return true;
    }
    if (candidateTokens.size < 5) {
      continue;
    }
    const progressTokens = new Set(tokenize(normalizedProgress));
    let shared = 0;
    for (const token of candidateTokens) {
      if (progressTokens.has(token)) {
        shared += 1;
      }
    }
    if (shared / candidateTokens.size >= 0.8) {
      return true;
    }
  }
  return false;
}

export function trimFinalReplyAgainstProgress(
  payload: ReplyPayload,
  sentProgressTexts: string[],
): ReplyPayload {
  const text = payload.text?.trim();
  if (
    !text ||
    sentProgressTexts.length === 0 ||
    payload.isError ||
    payload.isReasoning ||
    text.includes("```")
  ) {
    return payload;
  }

  const paragraphs = splitParagraphs(text);
  if (paragraphs.length > 1) {
    const filteredParagraphs = paragraphs.filter(
      (paragraph) => !isCoveredByProgress(paragraph, sentProgressTexts),
    );
    if (filteredParagraphs.length > 0 && filteredParagraphs.length < paragraphs.length) {
      return { ...payload, text: filteredParagraphs.join("\n\n") };
    }
  }

  const sentences = splitSentences(text);
  let firstNovelSentence = 0;
  while (
    firstNovelSentence < sentences.length &&
    isCoveredByProgress(sentences[firstNovelSentence] ?? "", sentProgressTexts)
  ) {
    firstNovelSentence += 1;
  }
  if (firstNovelSentence === 0) {
    return payload;
  }
  const remainingText = sentences.slice(firstNovelSentence).join(" ").trim();
  if (remainingText) {
    return { ...payload, text: remainingText };
  }
  return {
    ...payload,
    text:
      payload.mediaUrl || (payload.mediaUrls?.length ?? 0) > 0 || payload.audioAsVoice
        ? undefined
        : "Done.",
  };
}
