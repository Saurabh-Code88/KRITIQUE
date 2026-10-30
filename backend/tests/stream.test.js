const EventEmitter = require("events");
const express = require("express");
const jwt = require("jsonwebtoken");
const request = require("supertest");

jest.mock("../src/lib/prisma", () => ({
  review: {
    findFirst: jest.fn(),
  },
}));

jest.mock("../src/lib/queue", () => ({
  redisSub: {
    duplicate: jest.fn(),
  },
  reviewChannel: (reviewId) => `review:stream:${reviewId}`,
}));

const prisma = require("../src/lib/prisma");
const { redisSub } = require("../src/lib/queue");
const streamRoutes = require("../src/routes/stream");

const app = express();
app.use("/api/stream", streamRoutes);

process.env.JWT_SECRET = "test_secret_that_is_long_enough_32ch";

describe("GET /api/stream/:reviewId", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("replays the saved result when the review completes during subscription", async () => {
    const subscriber = new EventEmitter();
    subscriber.subscribe = jest.fn().mockResolvedValue(1);
    subscriber.unsubscribe = jest.fn().mockResolvedValue(1);
    subscriber.quit = jest.fn().mockResolvedValue("OK");
    redisSub.duplicate.mockReturnValue(subscriber);
    prisma.review.findFirst
      .mockResolvedValueOnce({ id: "review-1", status: "PROCESSING", result: null })
      .mockResolvedValueOnce({ status: "COMPLETED", result: "Full saved review" });

    const token = jwt.sign({ id: "user-1" }, process.env.JWT_SECRET);
    const response = await request(app)
      .get(`/api/stream/review-1?token=${encodeURIComponent(token)}`)
      .expect(200);

    expect(response.headers["content-type"]).toMatch(/text\/event-stream/);
    expect(response.text).toContain(
      'data: {"type":"snapshot","text":"Full saved review"}'
    );
    expect(response.text).toContain('data: {"type":"done"}');
    expect(subscriber.subscribe).toHaveBeenCalledWith("review:stream:review-1");
    expect(prisma.review.findFirst).toHaveBeenCalledTimes(2);
  });
});
