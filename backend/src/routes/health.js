const router = require("express").Router();
const prisma = require("../lib/prisma");
const { redis, reviewQueue } = require("../lib/queue");
const { redisBreaker, groqBreaker } = require("../circuit-breaker");
const { logger } = require("../logger");

const startTime = Date.now();

/**
 * GET /health
 * Liveness probe — just confirms the process is alive.
 * Used by Docker / Kubernetes for container health checks.
 */
router.get("/", (req, res) => {
  res.json({ status: "ok", uptime_ms: Date.now() - startTime });
});

/**
 * GET /health/ready
 * Readiness probe — confirms ALL dependencies are reachable.
 * Returns 503 if any critical dependency is down.
 * Used by load balancers to decide if traffic should be routed here.
 */
router.get("/ready", async (req, res) => {
  const checks = {};
  let allHealthy = true;

  // ── PostgreSQL check ──────────────────────────
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.postgres = { status: "healthy" };
  } catch (err) {
    checks.postgres = { status: "unhealthy", error: err.message };
    allHealthy = false;
    logger.error("Health check: PostgreSQL unreachable", { error: err.message });
  }

  // ── Redis check ───────────────────────────────
  try {
    const pong = await redis.ping();
    checks.redis = { status: pong === "PONG" ? "healthy" : "unhealthy" };
    if (pong !== "PONG") allHealthy = false;
  } catch (err) {
    checks.redis = { status: "unhealthy", error: err.message };
    allHealthy = false;
    logger.error("Health check: Redis unreachable", { error: err.message });
  }

  // ── Bull queue check ──────────────────────────
  try {
    const counts = await reviewQueue.getJobCounts();
    checks.queue = {
      status: "healthy",
      waiting: counts.waiting,
      active: counts.active,
      failed: counts.failed,
    };
  } catch (err) {
    checks.queue = { status: "unhealthy", error: err.message };
    allHealthy = false;
  }

  // ── Circuit breaker states ────────────────────
  checks.circuit_breakers = {
    redis: redisBreaker.getState(),
    groq: groqBreaker.getState(),
  };

  const status = allHealthy ? 200 : 503;
  res.status(status).json({
    status: allHealthy ? "ready" : "degraded",
    uptime_ms: Date.now() - startTime,
    timestamp: new Date().toISOString(),
    checks,
  });
});

/**
 * GET /health/metrics
 * Application-level metrics. In production you'd push these to
 * Prometheus/Grafana/Datadog — this endpoint is the scrape target.
 */
router.get("/metrics", async (req, res) => {
  try {
    const [userCount, reviewStats, queueCounts] = await Promise.all([
      prisma.user.count(),
      prisma.review.groupBy({
        by: ["status"],
        _count: { id: true },
      }),
      reviewQueue.getJobCounts(),
    ]);

    const reviewsByStatus = Object.fromEntries(
      reviewStats.map((r) => [r.status.toLowerCase(), r._count.id])
    );

    res.json({
      timestamp: new Date().toISOString(),
      uptime_ms: Date.now() - startTime,
      users: { total: userCount },
      reviews: {
        ...reviewsByStatus,
        total: Object.values(reviewsByStatus).reduce((a, b) => a + b, 0),
      },
      queue: queueCounts,
      circuit_breakers: {
        redis: redisBreaker.getState().state,
        groq: groqBreaker.getState().state,
      },
      memory: {
        heap_used_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        heap_total_mb: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
        rss_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      },
      node_version: process.version,
    });
  } catch (err) {
    logger.error("Metrics endpoint failed", { error: err.message });
    res.status(500).json({ error: "Failed to collect metrics" });
  }
});

module.exports = router;
