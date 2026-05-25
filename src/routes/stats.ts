import { Router, Request, Response } from "express";
import { loadAudit } from "../engine/store";
import type { Stats } from "../types";

const router = Router();

/**
 * GET /stats
 * Returns aggregate statistics about processed events.
 */
router.get("/", (_req: Request, res: Response) => {
  const audit = loadAudit();

  let applied = 0;
  let rejected = 0;
  let duplicates = 0;
  let lateMerged = 0;
  let totalProcessingTime = 0;

  for (const entry of audit) {
    totalProcessingTime += entry.processingTimeMs;

    switch (entry.decision) {
      case "APPLIED":
        applied++;
        break;
      case "DUPLICATE":
        duplicates++;
        break;
      case "LATE_MERGED":
        lateMerged++;
        break;
      case "REJECTED_INVALID":
      case "REJECTED_TRANSITION":
      case "LATE_REJECTED":
        rejected++;
        break;
    }
  }

  const stats: Stats = {
    totalProcessed: audit.length,
    applied,
    rejected,
    duplicates,
    lateMerged,
    averageProcessingTimeMs:
      audit.length > 0 ? totalProcessingTime / audit.length : 0,
  };

  res.status(200).json(stats);
});

export default router;
