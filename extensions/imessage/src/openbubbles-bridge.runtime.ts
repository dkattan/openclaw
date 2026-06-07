import type { IMessageService } from "./targets.js";
import { detectBinary } from "openclaw/plugin-sdk/setup";
import { runCommandWithTimeout } from "openclaw/plugin-sdk/process-runtime";
import { resolveUserPath } from "openclaw/plugin-sdk/text-utility-runtime";
import { DEFAULT_IMESSAGE_PROBE_TIMEOUT_MS } from "./constants.js";
import type { IMessageProbe } from "./probe.js";
import {
  resolveIMessageOpenBubblesBridgePath,
  resolveIMessageOpenBubblesStateDir,
  type ResolvedIMessageAccount,
} from "./accounts.js";

type OpenBubblesBridgeCommand = "probe" | "send" | "edit" | "unsend";

type OpenBubblesBridgeTargetPayload = {
  rawTarget: string;
  service?: IMessageService;
};

export type OpenBubblesBridgeSendPayload = OpenBubblesBridgeTargetPayload & {
  text: string;
  mediaFilePath?: string;
  replyToId?: string;
  region?: string;
  formatting?: unknown;
};

export type OpenBubblesBridgeEditPayload = OpenBubblesBridgeTargetPayload & {
  messageId: string;
  text: string;
  partIndex?: number;
  backwardsCompatMessage?: string;
};

export type OpenBubblesBridgeUnsendPayload = OpenBubblesBridgeTargetPayload & {
  messageId: string;
  partIndex?: number;
};

type OpenBubblesBridgeProbePayload = Record<string, never>;

type OpenBubblesBridgeResult = Record<string, unknown>;

type OpenBubblesBridgeRunParams = {
  account: Pick<ResolvedIMessageAccount, "accountId" | "config">;
  command: OpenBubblesBridgeCommand;
  payload:
    | OpenBubblesBridgeProbePayload
    | OpenBubblesBridgeSendPayload
    | OpenBubblesBridgeEditPayload
    | OpenBubblesBridgeUnsendPayload;
  timeoutMs?: number;
};

type OpenBubblesBridgeResolvedConfig = {
  bridgePath: string;
  stateDir: string;
  timeoutMs: number;
};

type JsonPayloadParseResult = {
  payload: OpenBubblesBridgeResult | null;
  firstLineSnippet?: string;
};

function parseBridgePayload(output: string): JsonPayloadParseResult {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines.toReversed()) {
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return { payload: parsed as OpenBubblesBridgeResult };
      }
    } catch {
      // Continue scanning earlier JSONL records.
    }
  }
  return { payload: null, firstLineSnippet: lines[0]?.slice(0, 160) };
}

function resolveOpenBubblesBridgeConfig(
  account: Pick<ResolvedIMessageAccount, "accountId" | "config">,
  timeoutMs?: number,
): OpenBubblesBridgeResolvedConfig {
  const stateDir = resolveIMessageOpenBubblesStateDir(account);
  if (!stateDir) {
    throw new Error(
      `iMessage account "${account.accountId}" uses backend=openbubbles but does not set openbubbles.stateDir.`,
    );
  }
  return {
    bridgePath: resolveUserPath(resolveIMessageOpenBubblesBridgePath(account)),
    stateDir: resolveUserPath(stateDir),
    timeoutMs: timeoutMs ?? account.config.probeTimeoutMs ?? DEFAULT_IMESSAGE_PROBE_TIMEOUT_MS,
  };
}

export function isOpenBubblesBridgeSuccess(result: OpenBubblesBridgeResult | null | undefined): boolean {
  if (!result) {
    return false;
  }
  if (result.ok === false || result.success === false) {
    return false;
  }
  const error = typeof result.error === "string" ? result.error.trim() : "";
  return !error;
}

export function resolveOpenBubblesBridgeError(
  result: OpenBubblesBridgeResult | null | undefined,
  fallback: string,
): string {
  if (!result) {
    return fallback;
  }
  return typeof result.error === "string" && result.error.trim() ? result.error.trim() : fallback;
}

export async function runOpenBubblesBridgeCommand<TResult extends OpenBubblesBridgeResult>(
  params: OpenBubblesBridgeRunParams,
): Promise<TResult> {
  const resolved = resolveOpenBubblesBridgeConfig(params.account, params.timeoutMs);
  const result = await runCommandWithTimeout(
    [resolved.bridgePath, params.command, "--state-dir", resolved.stateDir],
    {
      timeoutMs: resolved.timeoutMs,
      input: JSON.stringify(params.payload),
      maxOutputBytes: 1024 * 1024,
    },
  );
  const stdoutParsed = parseBridgePayload(result.stdout);
  const stderrParsed = parseBridgePayload(result.stderr);
  const payload = stdoutParsed.payload ?? stderrParsed.payload;
  if (payload) {
    if (
      result.code !== 0 &&
      typeof payload.error !== "string" &&
      typeof payload.message !== "string"
    ) {
      payload.error = `OpenBubbles bridge exited with code ${String(result.code)}`;
    }
    return payload as TResult;
  }
  const snippet = stdoutParsed.firstLineSnippet ?? stderrParsed.firstLineSnippet;
  throw new Error(
    `OpenBubbles bridge ${params.command} returned no JSON` +
      (snippet ? ` (first line: "${snippet}")` : ""),
  );
}

export async function probeOpenBubblesIMessageAccount(params: {
  account: Pick<ResolvedIMessageAccount, "accountId" | "config">;
  timeoutMs?: number;
}): Promise<IMessageProbe> {
  let resolved: OpenBubblesBridgeResolvedConfig;
  try {
    resolved = resolveOpenBubblesBridgeConfig(params.account, params.timeoutMs);
  } catch (error) {
    return { ok: false, error: String(error) };
  }
  const detected = await detectBinary(resolved.bridgePath);
  if (!detected) {
    return { ok: false, error: `OpenBubbles bridge not found (${resolved.bridgePath})` };
  }
  try {
    const result = await runOpenBubblesBridgeCommand<OpenBubblesBridgeResult>({
      account: params.account,
      command: "probe",
      payload: {},
      timeoutMs: resolved.timeoutMs,
    });
    return isOpenBubblesBridgeSuccess(result)
      ? { ok: true }
      : {
          ok: false,
          error: resolveOpenBubblesBridgeError(result, "OpenBubbles probe failed"),
        };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}
