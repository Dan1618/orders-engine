import { Router, Request, Response } from "express";
import { processBatch } from "../engine/eventEngine";

const router = Router();

/**
 * POST /events
 * Accepts an array of events (batch).
 */
router.post("/", async (req: Request, res: Response) => {
  const body = req.body;

  if (!body || (typeof body === "object" && Object.keys(body).length === 0 && !Array.isArray(body))) {
    res.status(400).json({ error: "Missing or empty request body." });
    return;
  }

  // Accept both a single event and an array
  const events: unknown[] = Array.isArray(body) ? body : [body];

  if (events.length === 0) {
    res.status(400).json({ error: "Empty event batch." });
    return;
  }

  const results = processBatch(events);

  res.status(200).json({
    processed: results.length,
    results,
  });
});

export default router;
