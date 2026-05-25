/// <reference types="jest" />
import request from "supertest";
import express from "express";
import eventsRouter from "../events";
import * as eventEngine from "../../engine/eventEngine";

// Mock the eventEngine module (processBatch)
jest.mock("../../engine/eventEngine");

const app = express();
app.use(express.json());
app.use("/events", eventsRouter);

function makeEvent(overrides: Record<string, unknown> = {}) {
    return {
        eventId: "ev-1",
        orderId: "order-1",
        type: "ORDER_CREATED",
        timestamp: 1000,
        payload: { amount: 100 },
        ...overrides,
    };
}

function makeResult(overrides: Record<string, unknown> = {}) {
    return {
        eventId: "ev-1",
        orderId: "order-1",
        decision: "APPLIED",
        reason: "Order created successfully.",
        ...overrides,
    };
}

describe("POST /events", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("should process a single-element batch and return 200", async () => {
        const event = makeEvent();
        const result = makeResult();

        (eventEngine.processBatch as jest.Mock).mockReturnValue([result]);

        const response = await request(app)
            .post("/events")
            .send([event]);

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            processed: 1,
            results: [result],
        });
        expect(eventEngine.processBatch).toHaveBeenCalledTimes(1);
        expect(eventEngine.processBatch).toHaveBeenCalledWith([event]);
    });

    it("should process a multi-element batch and return all results", async () => {
        const events = [
            makeEvent({ eventId: "ev-1", orderId: "order-1" }),
            makeEvent({ eventId: "ev-2", orderId: "order-1", type: "ORDER_UPDATED", timestamp: 2000, payload: { shippingAddress: "Main St 1" } }),
            makeEvent({ eventId: "ev-3", orderId: "order-2" }),
        ];

        const results = [
            makeResult({ eventId: "ev-1", orderId: "order-1" }),
            makeResult({ eventId: "ev-2", orderId: "order-1", decision: "APPLIED", reason: "Transition CREATED → UPDATED applied." }),
            makeResult({ eventId: "ev-3", orderId: "order-2" }),
        ];

        (eventEngine.processBatch as jest.Mock).mockReturnValue(results);

        const response = await request(app)
            .post("/events")
            .send(events);

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            processed: 3,
            results,
        });
        expect(eventEngine.processBatch).toHaveBeenCalledWith(events);
    });

    it("should wrap a single (non-array) event into an array", async () => {
        const event = makeEvent();
        const result = makeResult();

        (eventEngine.processBatch as jest.Mock).mockReturnValue([result]);

        const response = await request(app)
            .post("/events")
            .send(event); // NOT an array

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            processed: 1,
            results: [result],
        });
        // The route should have wrapped the single object into [event]
        expect(eventEngine.processBatch).toHaveBeenCalledWith([event]);
    });

    it("should return 400 for an empty batch", async () => {
        const response = await request(app)
            .post("/events")
            .send([]);

        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error: "Empty event batch." });
        expect(eventEngine.processBatch).not.toHaveBeenCalled();
    });

    it("should return 200 even if some events are rejected or duplicated", async () => {
        const events = [
            makeEvent({ eventId: "ev-1" }),
            makeEvent({ eventId: "ev-2", type: "PAYMENT_CAPTURED", timestamp: 500 }),
            makeEvent({ eventId: "ev-1" }), // duplicate
        ];

        const results = [
            makeResult({ eventId: "ev-1", decision: "APPLIED" }),
            makeResult({ eventId: "ev-2", decision: "REJECTED_TRANSITION", reason: "Transition CREATED → PAID is not allowed." }),
            makeResult({ eventId: "ev-1", decision: "DUPLICATE", reason: "Event 'ev-1' already processed." }),
        ];

        (eventEngine.processBatch as jest.Mock).mockReturnValue(results);

        const response = await request(app)
            .post("/events")
            .send(events);

        expect(response.status).toBe(200);
        expect(response.body.processed).toBe(3);
        expect(response.body.results).toHaveLength(3);
        expect(response.body.results[0].decision).toBe("APPLIED");
        expect(response.body.results[1].decision).toBe("REJECTED_TRANSITION");
        expect(response.body.results[2].decision).toBe("DUPLICATE");
    });

    it("should return 200 with REJECTED_INVALID for structurally invalid events in the batch", async () => {
        const events = [
            makeEvent({ eventId: "ev-1" }),
            { notAnEvent: true }, // invalid
        ];

        const results = [
            makeResult({ eventId: "ev-1", decision: "APPLIED" }),
            makeResult({ eventId: "UNKNOWN", orderId: "UNKNOWN", decision: "REJECTED_INVALID", reason: "Validation failed." }),
        ];

        (eventEngine.processBatch as jest.Mock).mockReturnValue(results);

        const response = await request(app)
            .post("/events")
            .send(events);

        expect(response.status).toBe(200);
        expect(response.body.processed).toBe(2);
        expect(response.body.results[1].decision).toBe("REJECTED_INVALID");
    });

    it("should pass the raw events array to processBatch without mutation", async () => {
        const events = [
            makeEvent({ eventId: "ev-a", payload: { amount: 200, customerNote: "Rush order" } }),
            makeEvent({ eventId: "ev-b", orderId: "order-2", payload: { shippingAddress: "456 Elm St" } }),
        ];

        (eventEngine.processBatch as jest.Mock).mockReturnValue([
            makeResult({ eventId: "ev-a" }),
            makeResult({ eventId: "ev-b", orderId: "order-2" }),
        ]);

        await request(app)
            .post("/events")
            .send(events);

        const passedArg = (eventEngine.processBatch as jest.Mock).mock.calls[0][0];
        expect(passedArg).toEqual(events);
    });

    it("should return 500 if processBatch throws an unexpected error", async () => {
        (eventEngine.processBatch as jest.Mock).mockImplementation(() => {
            throw new Error("Disk full");
        });

        const response = await request(app)
            .post("/events")
            .send([makeEvent()]);

        // Express default error handling returns 500
        expect(response.status).toBeGreaterThanOrEqual(500);
    });

    it("should handle requests with correct Content-Type header", async () => {
        const event = makeEvent();
        (eventEngine.processBatch as jest.Mock).mockReturnValue([makeResult()]);

        const response = await request(app)
            .post("/events")
            .set("Content-Type", "application/json")
            .send(JSON.stringify([event]));

        expect(response.status).toBe(200);
        expect(response.body.processed).toBe(1);
    });

    it("should handle a large batch of events", async () => {
        const eventCount = 50;
        const events = Array.from({ length: eventCount }, (_, i) =>
            makeEvent({ eventId: `ev-${i}`, timestamp: 1000 + i })
        );

        const results = events.map((e) =>
            makeResult({ eventId: (e as Record<string, unknown>).eventId as string })
        );

        (eventEngine.processBatch as jest.Mock).mockReturnValue(results);

        const response = await request(app)
            .post("/events")
            .send(events);

        expect(response.status).toBe(200);
        expect(response.body.processed).toBe(eventCount);
        expect(response.body.results).toHaveLength(eventCount);
    });
});