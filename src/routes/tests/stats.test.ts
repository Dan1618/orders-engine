/// <reference types="jest" />
import request from "supertest";
import express from "express";
import statsRouter from "../stats";
import * as store from "../../engine/store";
import type { AuditEntry } from "../../types";

jest.mock("../../engine/store");

const app = express();
app.use(express.json());
app.use("/stats", statsRouter);

describe("GET /stats", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("should return zeros when there is no audit data", async () => {
        (store.loadAudit as jest.Mock).mockReturnValue([]);

        const response = await request(app).get("/stats");

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            totalProcessed: 0,
            applied: 0,
            rejected: 0,
            duplicates: 0,
            lateMerged: 0,
            averageProcessingTimeMs: 0,
        });
        expect(store.loadAudit).toHaveBeenCalled();
    });

    it("should aggregate stats correctly for various audit entries", async () => {
        const mockAudit: Partial<AuditEntry>[] = [
            { decision: "APPLIED", processingTimeMs: 10 },
            { decision: "APPLIED", processingTimeMs: 15 },
            { decision: "REJECTED_INVALID", processingTimeMs: 5 },
            { decision: "REJECTED_TRANSITION", processingTimeMs: 5 },
            { decision: "LATE_REJECTED", processingTimeMs: 5 },
            { decision: "DUPLICATE", processingTimeMs: 2 },
            { decision: "DUPLICATE", processingTimeMs: 3 },
            { decision: "LATE_MERGED", processingTimeMs: 20 },
        ];

        (store.loadAudit as jest.Mock).mockReturnValue(mockAudit);

        const response = await request(app).get("/stats");

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            totalProcessed: 8,
            applied: 2,
            rejected: 3, // REJECTED_INVALID + REJECTED_TRANSITION + LATE_REJECTED
            duplicates: 2,
            lateMerged: 1,
            averageProcessingTimeMs: 65 / 8, // 8.125
        });
    });

    it("should calculate average processing time accurately", async () => {
        const mockAudit: Partial<AuditEntry>[] = [
            { decision: "APPLIED", processingTimeMs: 100 },
            { decision: "DUPLICATE", processingTimeMs: 50 },
        ];

        (store.loadAudit as jest.Mock).mockReturnValue(mockAudit);

        const response = await request(app).get("/stats");

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            totalProcessed: 2,
            applied: 1,
            rejected: 0,
            duplicates: 1,
            lateMerged: 0,
            averageProcessingTimeMs: 75,
        });
    });
});
