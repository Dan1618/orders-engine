import type { OrderEvent, EventType } from "../types";
import { VALID_EVENT_TYPES } from "../types";

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Validates the structural correctness of an incoming event.
 * Does NOT check business rules – that's the engine's job.
 */
export function validateEvent(event: unknown): ValidationResult {

  console.log('ev', event)

  if (!event || typeof event !== "object") {
    return { valid: false, reason: "Event must be a non-null object." };
  }

  const e = event as Record<string, unknown>;

  if (typeof e["eventId"] !== "string" || e["eventId"] === "") {
    return { valid: false, reason: "Missing or invalid 'eventId'." };
  }

  if (typeof e["orderId"] !== "string" || e["orderId"] === "") {
    return { valid: false, reason: "Missing or invalid 'orderId'." };
  }

  if (
    typeof e["type"] !== "string" ||
    !VALID_EVENT_TYPES.includes(e["type"] as EventType)
  ) {
    return {
      valid: false,
      reason: `Invalid event type '${String(e["type"])}'. Allowed: ${VALID_EVENT_TYPES.join(", ")}.`,
    };
  }

  if (typeof e["timestamp"] !== "number" || e["timestamp"] <= 0) {
    return { valid: false, reason: "Missing or invalid 'timestamp'." };
  }

  if (!e["payload"] || typeof e["payload"] !== "object") {
    return { valid: false, reason: "Missing or invalid 'payload'." };
  }

  return { valid: true };
}

/**
 * Casts a validated raw object to OrderEvent.
 */
export function castEvent(raw: unknown): OrderEvent {
  return raw as OrderEvent;
}
