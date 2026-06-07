import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/account-id";
import {
  createAccountListHelpers,
  normalizeAccountId,
  resolveMergedAccountConfig,
  type OpenClawConfig,
} from "openclaw/plugin-sdk/account-resolution";
import { normalizeOptionalString } from "openclaw/plugin-sdk/string-coerce-runtime";
import type { IMessageAccountConfig } from "./account-types.js";

export type ResolvedIMessageAccount = {
  accountId: string;
  enabled: boolean;
  name?: string;
  config: IMessageAccountConfig;
  configured: boolean;
};

export const DEFAULT_OPENBUBBLES_IMESSAGE_BRIDGE_PATH = "openbubbles-imessage-bridge";

const { listAccountIds, resolveDefaultAccountId } = createAccountListHelpers("imessage", {
  implicitDefaultAccount: {
    channelKeys: ["backend", "cliPath", "dbPath", "openbubbles"],
  },
});
export const listIMessageAccountIds = listAccountIds;
export const resolveDefaultIMessageAccountId = resolveDefaultAccountId;

function mergeIMessageAccountConfig(cfg: OpenClawConfig, accountId: string): IMessageAccountConfig {
  return resolveMergedAccountConfig<IMessageAccountConfig>({
    channelConfig: cfg.channels?.imessage as IMessageAccountConfig | undefined,
    accounts: cfg.channels?.imessage?.accounts as
      | Record<string, Partial<IMessageAccountConfig>>
      | undefined,
    accountId,
  });
}

function resolveIMessageBackendFromConfig(config: IMessageAccountConfig): "imsg" | "openbubbles" {
  return config.backend === "openbubbles" ? "openbubbles" : "imsg";
}

export function resolveIMessageBackend(account: Pick<ResolvedIMessageAccount, "config">): "imsg" | "openbubbles" {
  return resolveIMessageBackendFromConfig(account.config);
}

export function isOpenBubblesIMessageAccount(account: Pick<ResolvedIMessageAccount, "config">): boolean {
  return resolveIMessageBackend(account) === "openbubbles";
}

export function resolveIMessageOpenBubblesStateDir(
  account: Pick<ResolvedIMessageAccount, "config">,
): string | undefined {
  return normalizeOptionalString(account.config.openbubbles?.stateDir);
}

export function resolveIMessageOpenBubblesBridgePath(
  account: Pick<ResolvedIMessageAccount, "config">,
): string {
  return (
    normalizeOptionalString(account.config.openbubbles?.bridgePath) ??
    DEFAULT_OPENBUBBLES_IMESSAGE_BRIDGE_PATH
  );
}

export function resolveIMessageAccount(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
}): ResolvedIMessageAccount {
  const accountId = normalizeAccountId(
    params.accountId ?? resolveDefaultIMessageAccountId(params.cfg),
  );
  const baseEnabled = params.cfg.channels?.imessage?.enabled !== false;
  const merged = mergeIMessageAccountConfig(params.cfg, accountId);
  const accountEnabled = merged.enabled !== false;
  const openbubblesStateDir = normalizeOptionalString(merged.openbubbles?.stateDir);
  const openbubblesBridgePath = normalizeOptionalString(merged.openbubbles?.bridgePath);
  const configured = Boolean(
    (resolveIMessageBackendFromConfig(merged) === "openbubbles" &&
      (openbubblesStateDir || openbubblesBridgePath)) ||
    merged.cliPath?.trim() ||
    merged.dbPath?.trim() ||
    merged.service ||
    merged.region?.trim() ||
    (merged.allowFrom && merged.allowFrom.length > 0) ||
    (merged.groupAllowFrom && merged.groupAllowFrom.length > 0) ||
    merged.dmPolicy ||
    merged.groupPolicy ||
    typeof merged.includeAttachments === "boolean" ||
    (merged.attachmentRoots && merged.attachmentRoots.length > 0) ||
    (merged.remoteAttachmentRoots && merged.remoteAttachmentRoots.length > 0) ||
    typeof merged.mediaMaxMb === "number" ||
    typeof merged.textChunkLimit === "number" ||
    (merged.groups && Object.keys(merged.groups).length > 0),
  );
  return {
    accountId,
    enabled: baseEnabled && accountEnabled,
    name: normalizeOptionalString(merged.name),
    config: merged,
    configured,
  };
}

function normalizeIMessageCliPath(value: string | undefined | null): string {
  return value?.trim() || "imsg";
}

function normalizeIMessageDbPath(value: string | undefined | null): string {
  return value?.trim() ?? "";
}

export function describeIMessageAccountSource(account: Pick<ResolvedIMessageAccount, "config">): string {
  if (isOpenBubblesIMessageAccount(account)) {
    const bridgePath = resolveIMessageOpenBubblesBridgePath(account);
    const stateDir = resolveIMessageOpenBubblesStateDir(account);
    return stateDir
      ? `backend=openbubbles, stateDir=${stateDir}, bridgePath=${bridgePath}`
      : `backend=openbubbles, bridgePath=${bridgePath}`;
  }
  const cliPath = normalizeIMessageCliPath(account.config.cliPath);
  const dbPath = normalizeIMessageDbPath(account.config.dbPath);
  return dbPath ? `backend=imsg, cliPath=${cliPath}, dbPath=${dbPath}` : `backend=imsg, cliPath=${cliPath}`;
}

// Stable signature for the local Messages backend an iMessage account targets.
// Two enabled accounts that share a signature watch the same source, which
// caused duplicate inbound handling in openclaw/openclaw#65141.
export function resolveIMessageAccountSourceSignature(account: ResolvedIMessageAccount): string {
  if (isOpenBubblesIMessageAccount(account)) {
    const stateDir = resolveIMessageOpenBubblesStateDir(account);
    return JSON.stringify([
      "openbubbles",
      stateDir || "",
      stateDir ? "" : resolveIMessageOpenBubblesBridgePath(account),
    ]);
  }
  return JSON.stringify([
    "imsg",
    normalizeIMessageCliPath(account.config.cliPath),
    normalizeIMessageDbPath(account.config.dbPath),
  ]);
}

function resolveIMessageAccountSourceOwner(params: {
  cfg: OpenClawConfig;
  signature: string;
}): string | undefined {
  // Prefer an explicit named account over the implicit "default" so that
  // bindings tied to the named account keep working (openclaw/openclaw#65141).
  let defaultOwner: string | undefined;
  for (const candidateAccountId of listIMessageAccountIds(params.cfg)) {
    const candidate = resolveIMessageAccount({
      cfg: params.cfg,
      accountId: candidateAccountId,
    });
    if (!candidate.enabled) {
      continue;
    }
    if (resolveIMessageAccountSourceSignature(candidate) !== params.signature) {
      continue;
    }
    if (candidate.accountId === DEFAULT_ACCOUNT_ID) {
      defaultOwner ??= candidate.accountId;
      continue;
    }
    return candidate.accountId;
  }
  return defaultOwner;
}

/**
 * Returns the owner account id when `account` is an enabled duplicate of
 * another enabled account that targets the same local Messages source. Used
 * by the iMessage gateway lifecycle to skip starting redundant `imsg rpc`
 * watchers (openclaw/openclaw#65141) without otherwise marking the duplicate
 * disabled — outbound selection, status surfaces, and capability listings
 * keep treating both accounts normally.
 */
export function resolveIMessageDuplicateSourceOwner(params: {
  cfg: OpenClawConfig;
  account: ResolvedIMessageAccount;
}): string | undefined {
  if (!params.account.enabled) {
    return undefined;
  }
  const owner = resolveIMessageAccountSourceOwner({
    cfg: params.cfg,
    signature: resolveIMessageAccountSourceSignature(params.account),
  });
  return owner && owner !== params.account.accountId ? owner : undefined;
}

export function listEnabledIMessageAccounts(cfg: OpenClawConfig): ResolvedIMessageAccount[] {
  return listIMessageAccountIds(cfg)
    .map((accountId) => resolveIMessageAccount({ cfg, accountId }))
    .filter((account) => account.enabled);
}

export function collectIMessageDuplicateAccountSourceWarnings(params: {
  cfg: OpenClawConfig;
}): string[] {
  const groups = new Map<string, ResolvedIMessageAccount[]>();
  for (const accountId of listIMessageAccountIds(params.cfg)) {
    const account = resolveIMessageAccount({ cfg: params.cfg, accountId });
    if (!account.enabled) {
      continue;
    }
    const signature = resolveIMessageAccountSourceSignature(account);
    const existing = groups.get(signature);
    if (existing) {
      existing.push(account);
    } else {
      groups.set(signature, [account]);
    }
  }
  const warnings: string[] = [];
  for (const collisions of groups.values()) {
    if (collisions.length < 2) {
      continue;
    }
    const ownerId = resolveIMessageAccountSourceOwner({
      cfg: params.cfg,
      signature: resolveIMessageAccountSourceSignature(collisions[0]),
    });
    const owner = collisions.find((a) => a.accountId === ownerId) ?? collisions[0];
    const duplicates = collisions.filter((a) => a.accountId !== owner.accountId);
    const dupIds = duplicates.map((a) => `"${a.accountId}"`).join(", ");
    warnings.push(
      `- channels.imessage: accounts "${owner.accountId}" and ${dupIds} watch the same local Messages source (${describeIMessageAccountSource(owner)}). OpenClaw runs one watcher (owner: "${owner.accountId}") and idles the duplicate; the other accounts stay enabled for outbound sends and status. Inbound messages arrive tagged with accountId="${owner.accountId}", so bindings pinned to ${dupIds} should be re-pointed at "${owner.accountId}" (or set "enabled": false on "${owner.accountId}" to flip ownership). Set "enabled": false on the unused duplicates to silence this warning.`,
    );
  }
  return warnings;
}
