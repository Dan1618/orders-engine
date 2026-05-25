import express from "express";
import eventsRouter from "./routes/events";
import ordersRouter from "./routes/orders";
import statsRouter from "./routes/stats";
import { hydrateDedup } from "./engine/eventEngine";

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ────────────────────────────────────────────────
app.use(express.json());

// ─── Routes ───────────────────────────────────────────────────
app.get("/", (_req, res) => {
  res.json({
    message: "🚀 Order Event Processing Engine",
    endpoints: {
      "POST /events": "Submit a batch of events",
      "GET /orders/:id": "Get order state, history & rejected events",
      "GET /stats": "Get processing statistics",
    },
  });
});

app.use("/events", eventsRouter);
app.use("/orders", ordersRouter);
app.use("/stats", statsRouter);

// ─── Startup ──────────────────────────────────────────────────
hydrateDedup();

app.listen(PORT, () => {
  console.log(`✅ Event Engine running at http://localhost:${PORT}`);
});