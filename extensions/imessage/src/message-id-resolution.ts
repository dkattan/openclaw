import { constants, accessSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { normalizeOptionalString } from "openclaw/plugin-sdk/string-coerce-runtime";
import { resolveIMessageMessageId } from "./monitor-reply-cache.js";

const require = createRequire(import.meta.url);
const sshWrapperCliPathCache = new Map<string, boolean>();

function safeHomeDir(): string | undefined {
  const home = process.env.HOME?.trim();
  if (home) {
    return home;
  }
  try {
    return os.homedir().trim() || undefined;
  } catch {
    return undefined;
  }
}

function expandCliPathForInspection(cliPath: string): string {
  if (!cliPath.startsWith("~")) {
    return cliPath;
  }
  const home = safeHomeDir();
  return home ? cliPath.replace(/^~(?=$|[\\/])/, home) : cliPath;
}

function isSshIMessageCliWrapper(cliPath: string): boolean {
  if (cliPath === "imsg") {
    return false;
  }
  const cached = sshWrapperCliPathCache.get(cliPath);
  if (cached !== undefined) {
    return cached;
  }
  let detected = false;
  try {
    const content = readFileSync(expandCliPathForInspection(cliPath), "utf8");
    detected = /\bssh\b[\s\S]*\bimsg\b/u.test(content);
  } catch {
    detected = false;
  }
  sshWrapperCliPathCache.set(cliPath, detected);
  return detected;
}

function isLocalIMessageCliPath(params: { cliPath: string; remoteHost?: string }): boolean {
  const cliPath = params.cliPath.trim();
  if (params.remoteHost?.trim() || isSshIMessageCliWrapper(cliPath)) {
    return false;
  }
  return cliPath === "imsg" || path.basename(cliPath) === "imsg";
}

export function resolveChatDbLookupPath(params: {
  cliPath: string;
  dbPath?: string;
  remoteHost?: string;
}): string | undefined {
  const configured = params.dbPath?.trim();
  if (configured) {
    return configured;
  }
  if (!isLocalIMessageCliPath({ cliPath: params.cliPath, remoteHost: params.remoteHost })) {
    return undefined;
  }
  const home = safeHomeDir();
  return home ? path.join(home, "Library", "Messages", "chat.db") : undefined;
}

export function isNumericMessageRowId(value: string | null | undefined): value is string {
  return typeof value === "string" && /^\d+$/.test(value.trim());
}

export function normalizeResolvedMessageGuid(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed && !isNumericMessageRowId(trimmed) ? trimmed : null;
}

export function loadNodeSqlite(): typeof import("node:sqlite") | null {
  try {
    return require("node:sqlite") as typeof import("node:sqlite");
  } catch {
    return null;
  }
}

export function canResolveLatestSentMessageGuidFromChatDb(dbPath?: string): boolean {
  const normalizedDbPath = dbPath?.trim();
  if (!normalizedDbPath || !loadNodeSqlite()) {
    return false;
  }
  try {
    accessSync(normalizedDbPath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveMessageGuidFromChatDb(params: {
  dbPath?: string;
  messageId: string;
}): string | null {
  const dbPath = params.dbPath?.trim();
  const messageId = params.messageId.trim();
  if (!dbPath || !isNumericMessageRowId(messageId)) {
    return null;
  }
  const sqlite = loadNodeSqlite();
  if (!sqlite) {
    return null;
  }
  let db: import("node:sqlite").DatabaseSync | null = null;
  try {
    db = new sqlite.DatabaseSync(dbPath, { readOnly: true });
    const row = db.prepare("SELECT guid FROM message WHERE ROWID = ?").get(messageId) as
      | { guid?: unknown }
      | undefined;
    return normalizeResolvedMessageGuid(row?.guid);
  } catch {
    return null;
  } finally {
    try {
      db?.close();
    } catch {
      // best-effort cleanup
    }
  }
}

export function resolveIMessageReplyTargetGuid(params: {
  messageId?: string;
  dbPath?: string;
  resolveMessageIdImpl?: typeof resolveIMessageMessageId;
  resolveGuidFromChatDbImpl?: typeof resolveMessageGuidFromChatDb;
}): string | undefined {
  const messageId = normalizeOptionalString(params.messageId);
  if (!messageId) {
    return undefined;
  }

  const cachedResolved = normalizeResolvedMessageGuid(
    (params.resolveMessageIdImpl ?? resolveIMessageMessageId)(messageId),
  );
  if (cachedResolved) {
    return cachedResolved;
  }
  if (!isNumericMessageRowId(messageId)) {
    return messageId;
  }
  return (
    normalizeResolvedMessageGuid(
      (params.resolveGuidFromChatDbImpl ?? resolveMessageGuidFromChatDb)({
        dbPath: params.dbPath,
        messageId,
      }),
    ) ?? undefined
  );
}
