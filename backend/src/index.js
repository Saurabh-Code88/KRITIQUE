require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const { createServer } = require("http");

const authRoutes = require("./routes/auth");
const reviewRoutes = require("./routes/reviews");
const streamRoutes = require("./routes/stream");
const healthRoutes = require("./routes/health");
const { errorHandler } = require("./middleware/errorHandler");
const { apiLimiter } = require("./middleware/rateLimiter");
const { logger, requestLogger } = require("./logger");

const app = express();
const httpServer = createServer(app);

// ─── Middleware ──────────────────────────────────
app.set("trust proxy", 1); // trust first proxy (Render, Railway, etc.)
app.use(helmet());

const allowedOrigins = (process.env.FRONTEND_URL || "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim());
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));
app.use(express.json({ limit: "1mb" }));
app.use(requestLogger);
app.use("/api", apiLimiter);

// ─── Routes ─────────────────────────────────────
app.use("/api/auth", authRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/stream", streamRoutes);
app.use("/health", healthRoutes);

app.get("/", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ─── Error Handler ───────────────────────────────
app.use(errorHandler);

// ─── Start ───────────────────────────────────────
const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => {
  logger.info(`Kritique backend started`, { port: PORT, env: process.env.NODE_ENV });
});
