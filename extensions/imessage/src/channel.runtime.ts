import { resolveOutboundSendDep } from "openclaw/plugin-sdk/channel-outbound";
import {
  describeIMessageAccountSource,
  isOpenBubblesIMessageAccount,
  resolveIMessageDuplicateSourceOwner,
  resolveIMessageOpenBubblesBridgePath,
  resolveIMessageOpenBubblesStateDir,
  type ResolvedIMessageAccount,
} from "./accounts.js";
import { PAIRING_APPROVED_MESSAGE, resolveChannelMediaMaxBytes } from "./channel-api.js";
import type { ChannelPlugin } from "./channel-api.js";
import { monitorIMessageProvider } from "./monitor.js";
import { probeOpenBubblesIMessageAccount } from "./openbubbles-bridge.runtime.js";
import { IMESSAGE_LEGACY_OUTBOUND_SEND_DEP_KEYS } from "./outbound-send-deps.js";
import { probeIMessage } from "./probe.js";
import { sendMessageIMessage } from "./send.js";
import { imessageSetupWizard } from "./setup-surface.js";

type IMessageSendFn = typeof sendMessageIMessage;

export async function sendIMessageOutbound(params: {
  cfg: Parameters<typeof import("./accounts.js").resolveIMessageAccount>[0]["cfg"];
  to: string;
  text: string;
  mediaUrl?: string;
  mediaLocalRoots?: readonly string[];
  accountId?: string;
  deps?: { [channelId: string]: unknown };
  replyToId?: string;
}) {
  const send =
    resolveOutboundSendDep<IMessageSendFn>(params.deps, "imessage", {
      legacyKeys: IMESSAGE_LEGACY_OUTBOUND_SEND_DEP_KEYS,
    }) ?? sendMessageIMessage;
  const maxBytes = resolveChannelMediaMaxBytes({
    cfg: params.cfg,
    resolveChannelLimitMb: ({ cfg, accountId }) =>
      cfg.channels?.imessage?.accounts?.[accountId]?.mediaMaxMb ??
      cfg.channels?.imessage?.mediaMaxMb,
    accountId: params.accountId,
  });
  return await send(params.to, params.text, {
    config: params.cfg,
    ...(params.mediaUrl ? { mediaUrl: params.mediaUrl } : {}),
    ...(params.mediaLocalRoots?.length ? { mediaLocalRoots: params.mediaLocalRoots } : {}),
    maxBytes,
    accountId: params.accountId ?? undefined,
    replyToId: params.replyToId ?? undefined,
  });
}

export async function notifyIMessageApproval(params: {
  cfg: Parameters<typeof import("./accounts.js").resolveIMessageAccount>[0]["cfg"];
  id: string;
}): Promise<void> {
  await sendMessageIMessage(params.id, PAIRING_APPROVED_MESSAGE, { config: params.cfg });
}

export async function probeIMessageAccount(params?: {
  timeoutMs?: number;
  cliPath?: string;
  dbPath?: string;
  account?: ResolvedIMessageAccount;
}) {
  if (params?.account && isOpenBubblesIMessageAccount(params.account)) {
    return await probeOpenBubblesIMessageAccount({
      account: params.account,
      timeoutMs: params.timeoutMs,
    });
  }
  return await probeIMessage(params?.timeoutMs, {
    cliPath: params?.cliPath,
    dbPath: params?.dbPath,
  });
}

export async function startIMessageGatewayAccount(
  ctx: Parameters<
    NonNullable<NonNullable<ChannelPlugin<ResolvedIMessageAccount>["gateway"]>["startAccount"]>
  >[0],
) {
  const account = ctx.account;
  const cliPath = isOpenBubblesIMessageAccount(account)
    ? resolveIMessageOpenBubblesBridgePath(account)
    : account.config.cliPath?.trim() || "imsg";
  const dbPath = isOpenBubblesIMessageAccount(account)
    ? resolveIMessageOpenBubblesStateDir(account)
    : account.config.dbPath?.trim();
  ctx.setStatus({
    accountId: account.accountId,
    cliPath,
    dbPath: dbPath ?? null,
  });
  if (isOpenBubblesIMessageAccount(account)) {
    ctx.log?.info?.(
      `[${account.accountId}] parking watcher: OpenBubbles backend currently supports outbound/actions only (${describeIMessageAccountSource(account)})`,
    );
    if (ctx.abortSignal.aborted) {
      return;
    }
    await new Promise<void>((resolve) => {
      ctx.abortSignal.addEventListener("abort", () => resolve(), { once: true });
    });
    return;
  }
  const ownerAccountId = resolveIMessageDuplicateSourceOwner({ cfg: ctx.cfg, account });
  if (ownerAccountId) {
    // openclaw/openclaw#65141: this account shares a local Messages source with
    // an already-owning account, so spawning a second `imsg rpc` would deliver
    // every inbound twice. Keep the account enabled for outbound sends, status,
    // and capability surfaces; just park the watcher slot until shutdown.
    ctx.log?.info?.(
      `[${account.accountId}] skipping watcher: duplicate iMessage source; using account "${ownerAccountId}"`,
    );
    if (ctx.abortSignal.aborted) {
      return;
    }
    await new Promise<void>((resolve) => {
      ctx.abortSignal.addEventListener("abort", () => resolve(), { once: true });
    });
    return;
  }
  ctx.log?.info?.(
    `[${account.accountId}] starting provider (${describeIMessageAccountSource(account)})`,
  );
  return await monitorIMessageProvider({
    accountId: account.accountId,
    config: ctx.cfg,
    runtime: ctx.runtime,
    abortSignal: ctx.abortSignal,
    channelRuntime: ctx.channelRuntime,
  });
}

export { imessageSetupWizard };
