import type { EventType, OrderStatus } from "../types";

// ─── Event type → resulting status ─────────────────────────────

const EVENT_TO_STATUS: Record<EventType, OrderStatus> = {
  ORDER_CREATED: "CREATED",
  ORDER_UPDATED: "UPDATED",
  PAYMENT_CAPTURED: "PAID",
  ORDER_CANCELLED: "CANCELLED",
  REFUND_ISSUED: "REFUNDED",
};

export function eventToStatus(eventType: EventType): OrderStatus {
  return EVENT_TO_STATUS[eventType];
}

// ─── Allowed transitions ──────────────────────────────────────
// Key = current status, Value = set of statuses that can be reached.
// Special handling: ORDER_UPDATED on a PAID order keeps status as PAID.

const TRANSITIONS: Record<OrderStatus, Set<OrderStatus>> = {
  CREATED: new Set(["UPDATED", "PAID", "CANCELLED"]),
  UPDATED: new Set(["UPDATED", "PAID", "CANCELLED"]),
  PAID: new Set(["REFUNDED"]),
  CANCELLED: new Set(), // terminal
  REFUNDED: new Set(), // terminal
};

/**
 * Returns true if the transition is allowed.
 *
 * Special rule: ORDER_UPDATED on a PAID order is allowed
 * (partial update like shipping address) but the status stays PAID.
 */
export function isTransitionAllowed(
  currentStatus: OrderStatus,
  eventType: EventType
): boolean {
  const targetStatus = eventToStatus(eventType);

  // Special: ORDER_UPDATED on PAID → partial update, status stays PAID
  if (currentStatus === "PAID" && eventType === "ORDER_UPDATED") {
    return true;
  }

  return TRANSITIONS[currentStatus].has(targetStatus);
}

/**
 * Determines the new status after applying an event.
 * ORDER_UPDATED on PAID keeps status as PAID.
 */
export function resolveNewStatus(
  currentStatus: OrderStatus,
  eventType: EventType
): OrderStatus {
  if (currentStatus === "PAID" && eventType === "ORDER_UPDATED") {
    return "PAID";
  }
  return eventToStatus(eventType);
}

/**
 * Returns true if the status is terminal (no further transitions allowed).
 */
export function isTerminal(status: OrderStatus): boolean {
  return status === "CANCELLED" || status === "REFUNDED";
}
