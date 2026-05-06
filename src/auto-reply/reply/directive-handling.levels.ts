import {
  normalizeProgressMode,
  type ElevatedLevel,
  type ProgressMode,
  type ReasoningLevel,
  type ThinkLevel,
  type VerboseLevel,
} from "../thinking.js";

export async function resolveCurrentDirectiveLevels(params: {
  sessionEntry?: {
    thinkingLevel?: unknown;
    fastMode?: unknown;
    progressMode?: unknown;
    verboseLevel?: unknown;
    reasoningLevel?: unknown;
    elevatedLevel?: unknown;
  };
  agentEntry?: {
    fastModeDefault?: unknown;
    reasoningDefault?: unknown;
  };
  agentCfg?: {
    thinkingDefault?: unknown;
    verboseDefault?: unknown;
    reasoningDefault?: unknown;
    elevatedDefault?: unknown;
  };
  resolveDefaultThinkingLevel: () => Promise<ThinkLevel | undefined>;
}): Promise<{
  currentThinkLevel: ThinkLevel | undefined;
  currentFastMode: boolean | undefined;
  currentProgressMode: ProgressMode;
  currentVerboseLevel: VerboseLevel | undefined;
  currentReasoningLevel: ReasoningLevel;
  currentElevatedLevel: ElevatedLevel | undefined;
}> {
  const resolvedDefaultThinkLevel =
    (params.sessionEntry?.thinkingLevel as ThinkLevel | undefined) ??
    (await params.resolveDefaultThinkingLevel()) ??
    (params.agentCfg?.thinkingDefault as ThinkLevel | undefined);
  const currentThinkLevel = resolvedDefaultThinkLevel;
  const currentFastMode =
    typeof params.sessionEntry?.fastMode === "boolean"
      ? params.sessionEntry.fastMode
      : typeof params.agentEntry?.fastModeDefault === "boolean"
        ? params.agentEntry.fastModeDefault
        : undefined;
  const currentProgressMode =
    normalizeProgressMode(
      typeof params.sessionEntry?.progressMode === "string"
        ? params.sessionEntry.progressMode
        : undefined,
    ) ?? "native";
  const currentVerboseLevel =
    (params.sessionEntry?.verboseLevel as VerboseLevel | undefined) ??
    (params.agentCfg?.verboseDefault as VerboseLevel | undefined);
  const currentReasoningLevel =
    (params.sessionEntry?.reasoningLevel as ReasoningLevel | undefined) ??
    (params.agentEntry?.reasoningDefault as ReasoningLevel | undefined) ??
    (params.agentCfg?.reasoningDefault as ReasoningLevel | undefined) ??
    "off";
  const currentElevatedLevel =
    (params.sessionEntry?.elevatedLevel as ElevatedLevel | undefined) ??
    (params.agentCfg?.elevatedDefault as ElevatedLevel | undefined);
  return {
    currentThinkLevel,
    currentFastMode,
    currentProgressMode,
    currentVerboseLevel,
    currentReasoningLevel,
    currentElevatedLevel,
  };
}
