import type {
  OrderEvent,
  OrderState,
  AuditDecision,
  AuditEntry,
  EventPayload,
} from "../types";
import { validateEvent, castEvent } from "./validator";
import {
  isTransitionAllowed,
  resolveNewStatus,
  isTerminal,
  eventToStatus,
} from "./stateMachine";
import {
  loadAudit,
  appendAudit,
  appendChangelog,
  getOrder,
  setOrder,
} from "./store";

// ─── In-memory set for fast dedup (also backed by audit log) ──

const processedEventIds = new Set<string>();

/** Hydrate the dedup set from persisted audit on startup. */
export function hydrateDedup(): void {
  const audit = loadAudit();
  for (const entry of audit) {
    processedEventIds.add(entry.eventId);
  }
}

// ─── Processing result for a single event ──────────────────────

export interface ProcessingResult {
  eventId: string;
  orderId: string;
  decision: AuditDecision;
  reason: string;
}

// ─── Process a batch of events ─────────────────────────────────

export function processBatch(
  events: unknown[]
): ProcessingResult[] {
  return events.map((raw) => processSingle(raw));
}

// ─── Process a single event ───────────────────────────────────

function processSingle(raw: unknown): ProcessingResult {
  const startTime = Date.now();

  // 1. Validate structure
  const validation = validateEvent(raw);
  if (!validation.valid) {
    const partialId =
      raw && typeof raw === "object"
        ? (raw as Record<string, unknown>)["eventId"]
        : undefined;
    const partialOrderId =
      raw && typeof raw === "object"
        ? (raw as Record<string, unknown>)["orderId"]
        : undefined;

    const entry = makeAudit(
      String(partialId ?? "UNKNOWN"),
      String(partialOrderId ?? "UNKNOWN"),
      "UNKNOWN",
      "REJECTED_INVALID",
      validation.reason ?? "Validation failed.",
      0,
      startTime
    );
    appendAudit(entry);
    return toResult(entry);
  }

  const event = castEvent(raw);

  // 2. Deduplication
  if (processedEventIds.has(event.eventId)) {
    const entry = makeAudit(
      event.eventId,
      event.orderId,
      event.type,
      "DUPLICATE",
      `Event '${event.eventId}' already processed.`,
      event.timestamp,
      startTime
    );
    appendAudit(entry);
    return toResult(entry);
  }

  // 3. Fetch current state
  const currentOrder = getOrder(event.orderId);

  // 4. ORDER_CREATED on new order → create it
  if (!currentOrder) {
    if (event.type !== "ORDER_CREATED") {
      const entry = makeAudit(
        event.eventId,
        event.orderId,
        event.type,
        "REJECTED_INVALID",
        `Order '${event.orderId}' does not exist. First event must be ORDER_CREATED.`,
        event.timestamp,
        startTime
      );
      appendAudit(entry);
      markProcessed(event.eventId);
      return toResult(entry);
    }

    return applyCreation(event, startTime);
  }

  // 5. ORDER_CREATED for existing order → reject (duplicate creation)
  if (event.type === "ORDER_CREATED") {
    const entry = makeAudit(
      event.eventId,
      event.orderId,
      event.type,
      "REJECTED_INVALID",
      `Order '${event.orderId}' already exists. Cannot create again.`,
      event.timestamp,
      startTime
    );
    appendAudit(entry);
    markProcessed(event.eventId);
    return toResult(entry);
  }

  // 6. Check for out-of-order event
  if (event.timestamp < currentOrder.lastTimestamp) {
    return handleLateEvent(event, currentOrder, startTime);
  }

  // 7. Check state transition
  if (!isTransitionAllowed(currentOrder.status, event.type)) {
    const entry = makeAudit(
      event.eventId,
      event.orderId,
      event.type,
      "REJECTED_TRANSITION",
      `Transition ${currentOrder.status} → ${eventToStatus(event.type)} is not allowed.`,
      event.timestamp,
      startTime
    );
    appendAudit(entry);
    markProcessed(event.eventId);
    return toResult(entry);
  }

  // 8. Apply event
  return applyUpdate(event, currentOrder, startTime);
}

// ─── Apply ORDER_CREATED ──────────────────────────────────────

function applyCreation(
  event: OrderEvent,
  startTime: number
): ProcessingResult {
  const now = Date.now();

  const newOrder: OrderState = {
    orderId: event.orderId,
    status: "CREATED",
    lastEventId: event.eventId,
    lastTimestamp: event.timestamp,
    createdAt: event.timestamp,
    updatedAt: event.timestamp,
    ...mergePayloadFields({}, event.payload),
  };

  setOrder(newOrder);

  const changes = diffPayload({}, event.payload);
  changes["status"] = [null, "CREATED"];

  appendChangelog(event.orderId, {
    eventId: event.eventId,
    type: event.type,
    timestamp: event.timestamp,
    changes,
    appliedAt: now,
  });

  const entry = makeAudit(
    event.eventId,
    event.orderId,
    event.type,
    "APPLIED",
    "Order created successfully.",
    event.timestamp,
    startTime
  );
  appendAudit(entry);
  markProcessed(event.eventId);

  return toResult(entry);
}

// ─── Apply a normal (in-order) event update ───────────────────

function applyUpdate(
  event: OrderEvent,
  currentOrder: OrderState,
  startTime: number
): ProcessingResult {
  const now = Date.now();
  const newStatus = resolveNewStatus(currentOrder.status, event.type);

  const oldFields = extractPayloadFields(currentOrder);
  const mergedFields = mergePayloadFields(oldFields, event.payload);

  const updatedOrder: OrderState = {
    ...currentOrder,
    ...mergedFields,
    status: newStatus,
    lastEventId: event.eventId,
    lastTimestamp: event.timestamp,
    updatedAt: event.timestamp,
  };

  setOrder(updatedOrder);

  const changes = diffPayload(oldFields, event.payload);
  changes["status"] = [currentOrder.status, newStatus];

  appendChangelog(event.orderId, {
    eventId: event.eventId,
    type: event.type,
    timestamp: event.timestamp,
    changes,
    appliedAt: now,
  });

  const entry = makeAudit(
    event.eventId,
    event.orderId,
    event.type,
    "APPLIED",
    `Transition ${currentOrder.status} → ${newStatus} applied.`,
    event.timestamp,
    startTime
  );
  appendAudit(entry);
  markProcessed(event.eventId);

  return toResult(entry);
}

// ─── Handle late (out-of-order) events ────────────────────────

function handleLateEvent(
  event: OrderEvent,
  currentOrder: OrderState,
  startTime: number
): ProcessingResult {
  // Terminal states → always reject late events
  if (isTerminal(currentOrder.status)) {
    const entry = makeAudit(
      event.eventId,
      event.orderId,
      event.type,
      "LATE_REJECTED",
      `Order is in terminal state '${currentOrder.status}'. Late event rejected.`,
      event.timestamp,
      startTime
    );
    appendAudit(entry);
    markProcessed(event.eventId);
    return toResult(entry);
  }

  // Check if transition would be allowed
  if (!isTransitionAllowed(currentOrder.status, event.type)) {
    const entry = makeAudit(
      event.eventId,
      event.orderId,
      event.type,
      "LATE_REJECTED",
      `Late event: transition ${currentOrder.status} → ${eventToStatus(event.type)} not allowed.`,
      event.timestamp,
      startTime
    );
    appendAudit(entry);
    markProcessed(event.eventId);
    return toResult(entry);
  }

  // Try to merge non-conflicting payload fields
  const oldFields = extractPayloadFields(currentOrder);
  const conflicts = findConflicts(oldFields, event.payload);

  if (conflicts.length > 0) {
    const entry = makeAudit(
      event.eventId,
      event.orderId,
      event.type,
      "LATE_REJECTED",
      `Late event has conflicting fields: ${conflicts.join(", ")}. Rejected to preserve newer data.`,
      event.timestamp,
      startTime
    );
    appendAudit(entry);
    markProcessed(event.eventId);
    return toResult(entry);
  }

  // No conflicts → merge partial data (but don't change status from late event)
  const now = Date.now();
  const mergedFields = mergePayloadFields(oldFields, event.payload);

  const updatedOrder: OrderState = {
    ...currentOrder,
    ...mergedFields,
    // Keep the current (newer) status – don't regress
    updatedAt: now,
  };

  setOrder(updatedOrder);

  const changes = diffPayload(oldFields, event.payload);

  appendChangelog(event.orderId, {
    eventId: event.eventId,
    type: event.type,
    timestamp: event.timestamp,
    changes,
    appliedAt: now,
  });

  const entry = makeAudit(
    event.eventId,
    event.orderId,
    event.type,
    "LATE_MERGED",
    "Late event merged (non-conflicting partial fields only, status preserved).",
    event.timestamp,
    startTime
  );
  appendAudit(entry);
  markProcessed(event.eventId);

  return toResult(entry);
}

// ─── Payload helpers ──────────────────────────────────────────

const SYSTEM_FIELDS = new Set([
  "orderId",
  "status",
  "lastEventId",
  "lastTimestamp",
  "createdAt",
  "updatedAt",
]);

function extractPayloadFields(
  order: OrderState
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(order)) {
    if (!SYSTEM_FIELDS.has(key)) {
      result[key] = value;
    }
  }
  return result;
}

function mergePayloadFields(
  current: Record<string, unknown>,
  incoming: EventPayload
): Record<string, unknown> {
  const result = { ...current };
  for (const [key, value] of Object.entries(incoming)) {
    if (key !== "status" && value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

function diffPayload(
  oldFields: Record<string, unknown>,
  incoming: EventPayload
): Record<string, [unknown, unknown]> {
  const diff: Record<string, [unknown, unknown]> = {};
  for (const [key, newVal] of Object.entries(incoming)) {
    if (key === "status") continue;
    const oldVal =
      oldFields[key] !== undefined ? oldFields[key] : null;
    if (oldVal !== newVal) {
      diff[key] = [oldVal, newVal];
    }
  }
  return diff;
}

function findConflicts(
  current: Record<string, unknown>,
  incoming: EventPayload
): string[] {
  const conflicts: string[] = [];
  for (const [key, newVal] of Object.entries(incoming)) {
    if (key === "status") continue;
    const oldVal = current[key];
    if (
      oldVal !== undefined &&
      oldVal !== null &&
      newVal !== undefined &&
      oldVal !== newVal
    ) {
      conflicts.push(key);
    }
  }
  return conflicts;
}

// ─── Utility helpers ──────────────────────────────────────────

function markProcessed(eventId: string): void {
  processedEventIds.add(eventId);
}

function makeAudit(
  eventId: string,
  orderId: string,
  type: string,
  decision: AuditDecision,
  reason: string,
  timestamp: number,
  startTime: number
): AuditEntry {
  return {
    eventId,
    orderId,
    type,
    decision,
    reason,
    timestamp,
    processedAt: Date.now(),
    processingTimeMs: Date.now() - startTime,
  };
}

function toResult(entry: AuditEntry): ProcessingResult {
  return {
    eventId: entry.eventId,
    orderId: entry.orderId,
    decision: entry.decision,
    reason: entry.reason,
  };
}
