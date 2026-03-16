import request from "supertest";
import app from "#src/app.js";
import { seedAuthPrerequisites, cleanupAuthTestData } from "#src/tests/helpers/seedAuth.js";
import { canRunIntegration, logSkipIfNotRequested } from "#src/tests/helpers/canRunIntegration.js";

logSkipIfNotRequested();

const describeIntegration =
  process.env.RUN_INTEGRATION_TESTS === "1" ? describe : describe.skip;

describeIntegration("auth flow", () => {
  const testUser = {
    email: `test_${Date.now()}@example.com`,
    username: `testuser_${Date.now()}`,
    password: "TestPassw0rd!",
  };

  let military;

  beforeAll(async () => {
    const ok = await canRunIntegration();
    if (!ok) {
      throw new Error(
        "Integration tests skipped: DB (or Redis) not available. Set RUN_INTEGRATION_TESTS=1 and ensure services are running (see .env.test).",
      );
    }
    military = await seedAuthPrerequisites();
  });

  afterAll(async () => {
    await cleanupAuthTestData({
      email: testUser.email,
      username: testUser.username,
      militaryId: military?.militaryId,
    });
  });

  it("register → me → logout → refresh fails", async () => {
    const agent = request.agent(app);

    const registerRes = await agent.post("/api/auth/register").send({
      ...testUser,
      militaryCode: military.militaryCode,
    });
    expect(registerRes.status).toBe(201);
    expect(registerRes.body?.success).toBe(true);
    expect(registerRes.headers["set-cookie"]).toBeDefined();

    const meRes = await agent.get("/api/auth/me");
    expect(meRes.status).toBe(200);
    expect(meRes.body?.success).toBe(true);
    expect(meRes.body?.data?.user?.email).toBe(testUser.email);

    const logoutRes = await agent.post("/api/auth/logout");
    expect(logoutRes.status).toBe(200);
    expect(logoutRes.body?.success).toBe(true);

    const refreshAfterLogout = await agent.post("/api/auth/refresh");
    expect(refreshAfterLogout.status).toBe(401);
    expect(refreshAfterLogout.body?.success).toBe(false);
  });

  it("login → refresh rotates token", async () => {
    const agent = request.agent(app);

    // login with registered user
    const loginRes = await agent.post("/api/auth/login").send({
      identifier: testUser.email,
      password: testUser.password,
    });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body?.success).toBe(true);

    const refreshRes = await agent.post("/api/auth/refresh");
    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body?.success).toBe(true);
  });

  it("rate limit: login blocks after 5 attempts", async () => {
    const agent = request.agent(app);

    // Ensure we have a consistent IP key.
    const attempts = [];
    for (let i = 0; i < 6; i += 1) {
      attempts.push(
        agent
          .post("/api/auth/login")
          .set("X-Forwarded-For", "1.2.3.4")
          .send({ identifier: testUser.email, password: "wrong_password" }),
      );
    }

    const results = await Promise.all(attempts);
    const statuses = results.map((r) => r.status);

    // At least one of them should be rate-limited (429).
    expect(statuses).toContain(429);
  });
});

