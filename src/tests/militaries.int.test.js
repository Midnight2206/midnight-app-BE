import request from "supertest";
import app from "#src/app.js";
import { seedSuperAdmin, cleanupSuperAdmin } from "#src/tests/helpers/seedAdmin.js";
import { canRunIntegration, logSkipIfNotRequested } from "#src/tests/helpers/canRunIntegration.js";

logSkipIfNotRequested();

const describeIntegration =
  process.env.RUN_INTEGRATION_TESTS === "1" ? describe : describe.skip;

describeIntegration("militaries smoke", () => {
  let admin;

  beforeAll(async () => {
    const ok = await canRunIntegration();
    if (!ok) {
      throw new Error(
        "Integration tests skipped: DB not available. Set RUN_INTEGRATION_TESTS=1 and ensure DB is running.",
      );
    }
    admin = await seedSuperAdmin();
  });

  afterAll(async () => {
    await cleanupSuperAdmin({ userId: admin?.userId });
  });

  it("GET /militaries/units returns 200", async () => {
    const agent = request.agent(app);

    const loginRes = await agent.post("/api/auth/login").send({
      identifier: admin.email,
      password: admin.password,
    });
    expect(loginRes.status).toBe(200);

    const res = await agent.get("/api/militaries/units");
    expect(res.status).toBe(200);
    expect(res.body?.success).toBe(true);
  });
});

