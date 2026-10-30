const router = require("express").Router();
const jwt = require("jsonwebtoken");
const { redisSub, reviewChannel } = require("../lib/queue");
const prisma = require("../lib/prisma");

/**
 * GET /api/stream/:reviewId?token=<jwt>
 *
 * Server-Sent Events endpoint.
 * - Auth via query param token (SSE can't set headers in browser)
 * - Subscribes to Redis pub/sub channel for the review
 * - Streams AI tokens as SSE events to the client
 * - Sends DONE or ERROR event to close the connection
 */
router.get("/:reviewId", async (req, res, next) => {
  // ── Auth via query param (SSE limitation) ─────
  const token = req.query.token;
  if (!token) {
    return res.status(401).json({ error: "Missing token" });
  }

  let user;
  try {
    user = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }

  const { reviewId } = req.params;

  // Verify review belongs to user
  const channel = reviewChannel(reviewId);
  let subscriber;
  let heartbeat;
  let cleaningUp = false;

  const sendEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const cleanup = () => {
    if (cleaningUp) return;
    cleaningUp = true;

    clearInterval(heartbeat);
    if (subscriber) {
      subscriber.unsubscribe(channel).catch((err) => {
        console.error("SSE unsubscribe failed:", err);
      });
      subscriber.quit().catch((err) => {
        console.error("SSE subscriber shutdown failed:", err);
      });
    }
    if (!res.writableEnded) {
      res.end();
    }
  };

  try {
    const review = await prisma.review.findFirst({
      where: { id: reviewId, userId: user.id },
    });
    if (!review) {
      return res.status(404).json({ error: "Review not found" });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    if (review.status === "COMPLETED") {
      sendEvent({ type: "snapshot", text: review.result || "" });
      sendEvent({ type: "done" });
      return res.end();
    }

    if (review.status === "FAILED") {
      sendEvent({ type: "error", message: "AI review failed. Please try again." });
      return res.end();
    }

    subscriber = redisSub.duplicate();
    res.on("close", cleanup);
    subscriber.on("message", (ch, message) => {
      if (ch !== channel || cleaningUp) return;
      try {
        const data = JSON.parse(message);
        sendEvent(data);
        if (data.type === "done" || data.type === "error") {
          cleanup();
        }
      } catch (err) {
        console.error("SSE message handling failed:", err);
      }
    });
    subscriber.on("error", (err) => {
      console.error("SSE Redis subscriber error:", err);
      if (!res.writableEnded) {
        sendEvent({ type: "error", message: "Review stream unavailable. Please refresh." });
      }
      cleanup();
    });

    await subscriber.subscribe(channel);

    if (cleaningUp) return;

    heartbeat = setInterval(() => {
      if (!res.writableEnded) {
        res.write(": heartbeat\n\n");
      }
    }, 15000);

    // Recheck after subscribing so completion during setup cannot be missed.
    const currentReview = await prisma.review.findFirst({
      where: { id: reviewId, userId: user.id },
      select: { status: true, result: true },
    });
    if (cleaningUp || res.writableEnded) return;
    if (!currentReview) {
      sendEvent({ type: "error", message: "Review not found." });
      cleanup();
      return;
    }

    if (currentReview.status === "COMPLETED") {
      sendEvent({ type: "snapshot", text: currentReview.result || "" });
      sendEvent({ type: "done" });
      cleanup();
    } else if (currentReview.status === "FAILED") {
      sendEvent({ type: "error", message: "AI review failed. Please try again." });
      cleanup();
    }
  } catch (err) {
    if (res.headersSent) {
      console.error("SSE connection setup failed:", err);
      if (!res.writableEnded) {
        sendEvent({ type: "error", message: "Review stream unavailable. Please refresh." });
      }
      cleanup();
    } else {
      next(err);
    }
  }
});

module.exports = router;
