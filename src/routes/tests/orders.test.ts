/// <reference types="jest" />
import request from "supertest";
import express from "express";
import ordersRouter from "../orders";
import * as store from "../../engine/store";

// Mock store module
jest.mock("../../engine/store");

const app = express();
app.use(express.json());
app.use("/orders", ordersRouter);

describe("GET /orders/:id", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("should return 404 if the order does not exist", async () => {
        (store.getOrder as jest.Mock).mockReturnValue(null);

        const response = await request(app).get("/orders/123");

        expect(response.status).toBe(404);
        expect(response.body).toEqual({ error: "Order '123' not found." });
        expect(store.getOrder).toHaveBeenCalledWith("123");
    });

    it("should return the order, history, rejected, and duplicate events", async () => {
        const mockOrder = {
            orderId: "123",
            status: "CREATED",
            lastEventId: "ev-1",
            lastTimestamp: 1000,
            createdAt: 1000,
            updatedAt: 1000,
        };

        const mockChangelog = {
            "123": [
                {
                    eventId: "ev-1",
                    type: "ORDER_CREATED",
                    timestamp: 1000,
                    changes: { status: [null, "CREATED"] },
                    appliedAt: 1001,
                },
            ],
            "456": [], // different order
        };

        const mockAudit = [
            {
                eventId: "ev-2",
                orderId: "123",
                type: "ORDER_UPDATED",
                decision: "REJECTED_INVALID",
                reason: "Invalid transition",
                timestamp: 1005,
                processedAt: 1006,
                processingTimeMs: 1,
            },
            {
                eventId: "ev-3",
                orderId: "123",
                type: "PAYMENT_CAPTURED",
                decision: "DUPLICATE",
                reason: "Already seen",
                timestamp: 1010,
                processedAt: 1011,
                processingTimeMs: 1,
            },
            {
                eventId: "ev-4",
                orderId: "123",
                type: "ORDER_UPDATED",
                decision: "APPLIED",
                reason: "Success",
                timestamp: 1015,
                processedAt: 1016,
                processingTimeMs: 1,
            },
            {
                eventId: "ev-5",
                orderId: "123",
                type: "ORDER_UPDATED",
                decision: "LATE_MERGED",
                reason: "Merged",
                timestamp: 1012,
                processedAt: 1017,
                processingTimeMs: 1,
            },
            {
                eventId: "ev-6",
                orderId: "456",
                type: "ORDER_CREATED",
                decision: "REJECTED_INVALID",
                reason: "Invalid",
                timestamp: 1020,
                processedAt: 1021,
                processingTimeMs: 1,
            }
        ];

        (store.getOrder as jest.Mock).mockReturnValue(mockOrder);
        (store.loadChangelog as jest.Mock).mockReturnValue(mockChangelog);
        (store.loadAudit as jest.Mock).mockReturnValue(mockAudit);

        const response = await request(app).get("/orders/123");

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            order: mockOrder,
            history: mockChangelog["123"],
            rejectedEvents: [
                {
                    eventId: "ev-2",
                    type: "ORDER_UPDATED",
                    decision: "REJECTED_INVALID",
                    reason: "Invalid transition",
                    timestamp: 1005,
                },
            ],
            duplicateEvents: [
                {
                    eventId: "ev-3",
                    type: "PAYMENT_CAPTURED",
                    timestamp: 1010,
                },
            ]
        });
    });

    it("should return empty history and events if none exist for the order", async () => {
        const mockOrder = {
            orderId: "123",
            status: "CREATED",
            lastEventId: "ev-1",
            lastTimestamp: 1000,
            createdAt: 1000,
            updatedAt: 1000,
        };

        (store.getOrder as jest.Mock).mockReturnValue(mockOrder);
        (store.loadChangelog as jest.Mock).mockReturnValue({});
        (store.loadAudit as jest.Mock).mockReturnValue([]);

        const response = await request(app).get("/orders/123");

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            order: mockOrder,
            history: [],
            rejectedEvents: [],
            duplicateEvents: [],
        });
    });
});
