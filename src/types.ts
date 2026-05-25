// ─── Event Types ───────────────────────────────────────────────

export type EventType =
  | "ORDER_CREATED"
  | "ORDER_UPDATED"
  | "PAYMENT_CAPTURED"
  | "ORDER_CANCELLED"
  | "REFUND_ISSUED";

export const VALID_EVENT_TYPES: EventType[] = [
  "ORDER_CREATED",
  "ORDER_UPDATED",
  "PAYMENT_CAPTURED",
  "ORDER_CANCELLED",
  "REFUND_ISSUED",
];

export interface EventPayload {
  status?: string;
  amount?: number;
  shippingAddress?: string;
  customerNote?: string;
  [key: string]: unknown;
}

export interface OrderEvent {
  eventId: string;
  orderId: string;
  type: EventType;
  timestamp: number;
  payload: EventPayload;
}

// ─── Order State ───────────────────────────────────────────────

export type OrderStatus =
  | "CREATED"
  | "UPDATED"
  | "PAID"
  | "CANCELLED"
  | "REFUNDED";

export interface OrderState {
  orderId: string;
  status: OrderStatus;
  amount?: number;
  shippingAddress?: string;
  customerNote?: string;
  lastEventId: string;
  lastTimestamp: number;
  createdAt: number;
  updatedAt: number;
  [key: string]: unknown;
}

// ─── Changelog ─────────────────────────────────────────────────

export interface ChangelogEntry {
  eventId: string;
  type: EventType;
  timestamp: number;
  changes: Record<string, [unknown, unknown]>; // [oldVal, newVal]
  appliedAt: number;
}

// ─── Audit ─────────────────────────────────────────────────────

export type AuditDecision =
  | "APPLIED"
  | "DUPLICATE"
  | "REJECTED_INVALID"
  | "REJECTED_TRANSITION"
  | "LATE_REJECTED"
  | "LATE_MERGED";

export interface AuditEntry {
  eventId: string;
  orderId: string;
  type: string;
  decision: AuditDecision;
  reason: string;
  timestamp: number;
  processedAt: number;
  processingTimeMs: number;
}

// ─── Stats ─────────────────────────────────────────────────────

export interface Stats {
  totalProcessed: number;
  applied: number;
  rejected: number;
  duplicates: number;
  lateMerged: number;
  averageProcessingTimeMs: number;
}

// ─── Store types ───────────────────────────────────────────────

export type StateStore = Record<string, OrderState>;
export type ChangelogStore = Record<string, ChangelogEntry[]>;
export type AuditStore = AuditEntry[];
