const express = require("express");
const jwt = require("jsonwebtoken");
const request = require("supertest");

jest.mock("../src/lib/prisma", () => ({
  review: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
  },
}));

jest.mock("../src/lib/queue", () => ({
  reviewQueue: {
    add: jest.fn(),
  },
}));

const prisma = require("../src/lib/prisma");
const { reviewQueue } = require("../src/lib/queue");
const reviewRoutes = require("../src/routes/reviews");

const app = express();
app.use(express.json());
app.use("/api/reviews", reviewRoutes);

process.env.JWT_SECRET = "test_secret_that_is_long_enough_32ch";

const authHeader = () =>
  `Bearer ${jwt.sign({ id: "user-1" }, process.env.JWT_SECRET)}`;

describe("/api/reviews", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("creates a review and enqueues it", async () => {
    prisma.review.create.mockResolvedValue({
      id: "review-1",
      status: "PENDING",
    });
    reviewQueue.add.mockResolvedValue({});

    const response = await request(app)
      .post("/api/reviews")
      .set("Authorization", authHeader())
      .send({
        title: "Review title",
        code: "const value = 42;",
        language: "javascript",
      })
      .expect(202);

    expect(response.body).toMatchObject({
      reviewId: "review-1",
      status: "PENDING",
    });
    expect(prisma.review.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user-1",
          title: "Review title",
          language: "javascript",
          status: "PENDING",
        }),
      })
    );
    expect(reviewQueue.add).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewId: "review-1",
        code: "const value = 42;",
        language: "javascript",
      }),
      { jobId: "review-1" }
    );
  });

  test("rejects invalid review input", async () => {
    const response = await request(app)
      .post("/api/reviews")
      .set("Authorization", authHeader())
      .send({ title: "", code: "short", language: "unknown" })
      .expect(400);

    expect(response.body.error).toBeDefined();
    expect(prisma.review.create).not.toHaveBeenCalled();
  });

  test("lists only the authenticated user's reviews", async () => {
    prisma.review.findMany.mockResolvedValue([{ id: "review-1" }]);

    const response = await request(app)
      .get("/api/reviews")
      .set("Authorization", authHeader())
      .expect(200);

    expect(response.body.reviews).toEqual([{ id: "review-1" }]);
    expect(prisma.review.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user-1" } })
    );
  });

  test("returns an owned review and hides reviews belonging to others", async () => {
    prisma.review.findFirst
      .mockResolvedValueOnce({ id: "review-1", userId: "user-1" })
      .mockResolvedValueOnce(null);

    const owned = await request(app)
      .get("/api/reviews/review-1")
      .set("Authorization", authHeader())
      .expect(200);
    expect(owned.body.review.id).toBe("review-1");

    const missing = await request(app)
      .get("/api/reviews/other-review")
      .set("Authorization", authHeader())
      .expect(404);
    expect(missing.body.error).toBe("Review not found");
  });
});
