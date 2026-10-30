const express = require("express");
const request = require("supertest");

jest.mock("../src/lib/prisma", () => ({
  $queryRaw: jest.fn(),
  user: { count: jest.fn() },
  review: { groupBy: jest.fn() },
}));

jest.mock("../src/lib/queue", () => ({
  redis: { ping: jest.fn() },
  reviewQueue: { getJobCounts: jest.fn() },
}));

jest.mock("../src/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const prisma = require("../src/lib/prisma");
const { redis, reviewQueue } = require("../src/lib/queue");
const healthRoutes = require("../src/routes/health");

const app = express();
app.use("/health", healthRoutes);

describe("/health", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("returns a liveness response", async () => {
    const response = await request(app).get("/health").expect(200);
    expect(response.body.status).toBe("ok");
    expect(response.body.uptime_ms).toEqual(expect.any(Number));
  });

  test("reports readiness when all dependencies respond", async () => {
    prisma.$queryRaw.mockResolvedValue([{ "?column?": 1 }]);
    redis.ping.mockResolvedValue("PONG");
    reviewQueue.getJobCounts.mockResolvedValue({
      waiting: 1,
      active: 0,
      failed: 0,
    });

    const response = await request(app).get("/health/ready").expect(200);
    expect(response.body.status).toBe("ready");
    expect(response.body.checks.postgres.status).toBe("healthy");
    expect(response.body.checks.redis.status).toBe("healthy");
    expect(response.body.checks.queue.waiting).toBe(1);
  });

  test("returns degraded readiness when a dependency fails", async () => {
    prisma.$queryRaw.mockRejectedValue(new Error("database unavailable"));
    redis.ping.mockResolvedValue("PONG");
    reviewQueue.getJobCounts.mockResolvedValue({
      waiting: 0,
      active: 0,
      failed: 0,
    });

    const response = await request(app).get("/health/ready").expect(503);
    expect(response.body.status).toBe("degraded");
    expect(response.body.checks.postgres.status).toBe("unhealthy");
  });

  test("reports application metrics", async () => {
    prisma.user.count.mockResolvedValue(2);
    prisma.review.groupBy.mockResolvedValue([
      { status: "COMPLETED", _count: { id: 3 } },
      { status: "FAILED", _count: { id: 1 } },
    ]);
    reviewQueue.getJobCounts.mockResolvedValue({ waiting: 0, active: 1 });

    const response = await request(app).get("/health/metrics").expect(200);
    expect(response.body.users.total).toBe(2);
    expect(response.body.reviews).toMatchObject({
      completed: 3,
      failed: 1,
      total: 4,
    });
    expect(response.body.queue.active).toBe(1);
  });

  test("reports a metrics collection failure", async () => {
    prisma.user.count.mockRejectedValue(new Error("database unavailable"));

    const response = await request(app).get("/health/metrics").expect(500);
    expect(response.body.error).toBe("Failed to collect metrics");
  });
});
