import request from "supertest";
import app from "#src/app.js";

describe("smoke", () => {
  it("GET /api should not crash server", async () => {
    const res = await request(app).get("/api");
    // It may be 404 (no root route) but should return JSON in our format.
    expect([200, 401, 404]).toContain(res.status);
    expect(res.headers["content-type"] || "").toMatch(/application\/json/);
  });
});

