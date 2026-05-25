import fs from "fs";
import path from "path";
import type {
  StateStore,
  ChangelogStore,
  AuditStore,
  AuditEntry,
  ChangelogEntry,
  OrderState,
} from "../types";

const DATA_DIR = path.resolve(__dirname, "../data");

const STATE_FILE = path.join(DATA_DIR, "state.json");
const CHANGELOG_FILE = path.join(DATA_DIR, "changelog.json");
const AUDIT_FILE = path.join(DATA_DIR, "audit.json");

// ─── Helpers ───────────────────────────────────────────────────

function readJSON<T>(filePath: string, fallback: T): T {
  try {
    const raw = fs.readFileSync(filePath, "utf-8").trim();
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJSON<T>(filePath: string, data: T): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

// ─── State ─────────────────────────────────────────────────────

export function loadState(): StateStore {
  return readJSON<StateStore>(STATE_FILE, {});
}

export function saveState(state: StateStore): void {
  writeJSON(STATE_FILE, state);
}

export function getOrder(orderId: string): OrderState | undefined {
  const state = loadState();
  return state[orderId];
}

export function setOrder(order: OrderState): void {
  const state = loadState();
  state[order.orderId] = order;
  saveState(state);
}

// ─── Changelog ─────────────────────────────────────────────────

export function loadChangelog(): ChangelogStore {
  return readJSON<ChangelogStore>(CHANGELOG_FILE, {});
}

export function saveChangelog(cl: ChangelogStore): void {
  writeJSON(CHANGELOG_FILE, cl);
}

export function appendChangelog(
  orderId: string,
  entry: ChangelogEntry
): void {
  const cl = loadChangelog();
  if (!cl[orderId]) {
    cl[orderId] = [];
  }
  cl[orderId]!.push(entry);
  saveChangelog(cl);
}

// ─── Audit ─────────────────────────────────────────────────────

export function loadAudit(): AuditStore {
  return readJSON<AuditStore>(AUDIT_FILE, []);
}

export function saveAudit(audit: AuditStore): void {
  writeJSON(AUDIT_FILE, audit);
}

export function appendAudit(entry: AuditEntry): void {
  const audit = loadAudit();
  audit.push(entry);
  saveAudit(audit);
}
