import { Router, Request, Response } from "express";
import { getOrder } from "../engine/store";
import { loadChangelog, loadAudit } from "../engine/store";

const router = Router();

/**
 * GET /orders/:id
 * Returns current state, change history, and rejected events for an order.
 */
router.get("/:id", (req: Request<{ id: string }>, res: Response) => {
  const orderId = req.params.id;

  const order = getOrder(orderId);
  if (!order) {
    res.status(404).json({ error: `Order '${orderId}' not found.` });
    return;
  }

  const changelog = loadChangelog();
  const history = changelog[orderId] ?? [];

  const audit = loadAudit();
  const rejected = audit.filter(
    (a) =>
      a.orderId === orderId &&
      a.decision !== "APPLIED" &&
      a.decision !== "DUPLICATE" &&
      a.decision !== "LATE_MERGED"
  );

  const duplicates = audit.filter(
    (a) => a.orderId === orderId && a.decision === "DUPLICATE"
  );

  res.status(200).json({
    order,
    history,
    rejectedEvents: rejected.map((r) => ({
      eventId: r.eventId,
      type: r.type,
      decision: r.decision,
      reason: r.reason,
      timestamp: r.timestamp,
    })),
    duplicateEvents: duplicates.map((d) => ({
      eventId: d.eventId,
      type: d.type,
      timestamp: d.timestamp,
    })),
  });
});

export default router;
