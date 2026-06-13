require("dotenv").config();
const Bull = require("bull");
const Redis = require("ioredis");
const Groq = require("groq-sdk");
const { PrismaClient } = require("@prisma/client");
const { buildReviewPrompt } = require("./prompt");

const prisma = new PrismaClient();
console.log("💎 Prisma client initialized");
const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
console.log(`📡 Using Redis URL: ${redisUrl}`);
const redisClientOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
};

const buildBullRedisConfig = () => {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    tls: url.protocol === "rediss:" ? {} : undefined,
    ...redisClientOptions,
  };
};

// ─── Redis publisher (separate from subscriber) ──
const redisPublisher = new Redis(redisUrl, redisClientOptions);
redisPublisher.on("connect", () => console.log("✅ Redis Publisher connected"));
redisPublisher.on("error", (err) => console.error("❌ Redis Publisher error:", err));

// ─── Groq setup ──────────────────────────────────
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
console.log(`🤖 Using Groq model: ${GROQ_MODEL}`);

// ─── Bull Queue (same config as backend) ─────────
const reviewQueue = new Bull("review-queue", {
  redis: buildBullRedisConfig(),
});
console.log("🐃 Bull Queue initialized, connecting...");

const reviewChannel = (reviewId) => `review:stream:${reviewId}`;

/**
 * Publish a message to the SSE Redis channel
 */
const publish = async (reviewId, data) => {
  await redisPublisher.publish(
    reviewChannel(reviewId),
    JSON.stringify(data)
  );
};

/**
 * Process a single review job
 */
const processReview = async (job) => {
  const { reviewId, code, language } = job.data;
  const startTime = Date.now();

  console.log(`⚙️  Processing review ${reviewId} [${language}]`);

  // Mark as PROCESSING in DB
  await prisma.review.update({
    where: { id: reviewId },
    data: { status: "PROCESSING" },
  });

  let fullResult = "";

  try {
    const { system, user } = buildReviewPrompt(code, language);

    // ── Stream from Groq ─────────────────────────
    // System message: review rules, format, persona (highest instruction priority)
    // User message: the code to review + language checklist
    const stream = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      stream: true,
      temperature: 0.3,
      max_tokens: 8192,
    });

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content || "";
      if (text) {
        fullResult += text;
        // Publish each token chunk to Redis → SSE clients receive it live
        await publish(reviewId, { type: "token", text });
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✅ Review ${reviewId} completed in ${duration}s`);

    // ── Save completed result to DB ──────────────
    await prisma.review.update({
      where: { id: reviewId },
      data: { status: "COMPLETED", result: fullResult },
    });

    // ── Signal stream is done ────────────────────
    await publish(reviewId, { type: "done", duration });
  } catch (err) {
    console.error(`❌ Review ${reviewId} failed:`, err.message);

    await prisma.review.update({
      where: { id: reviewId },
      data: { status: "FAILED" },
    });

    await publish(reviewId, {
      type: "error",
      message: "AI review failed. Please try again.",
    });

    throw err; // Let Bull handle retry logic
  }
};

// ─── Register job processor ──────────────────────
reviewQueue.process(1, processReview); // concurrency = 1 to control API rate

// ─── Queue event listeners ───────────────────────
reviewQueue.on("ready", () => {
  console.log("🔄 Kritique worker ready — listening for review jobs...");
});

reviewQueue.on("error", (err) => {
  console.error("❌ Queue error:", err.message);
});

reviewQueue.on("failed", (job, err) => {
  console.error(`Job ${job.id} failed after all retries: ${err.message}`);
});

reviewQueue.on("stalled", (job) => {
  console.warn(`Job ${job.id} stalled — will be retried`);
});

// ─── Graceful shutdown ───────────────────────────
const shutdown = async () => {
  console.log("Shutting down worker...");
  await reviewQueue.close();
  await prisma.$disconnect();
  redisPublisher.quit();
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
