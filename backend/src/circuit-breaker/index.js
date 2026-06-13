const { logger } = require("../logger");

/**
 * Circuit Breaker Pattern for Redis/external services.
 *
 * States:
 *   CLOSED   → normal operation, requests flow through
 *   OPEN     → failing fast, requests rejected immediately
 *   HALF_OPEN → testing recovery with a single probe request
 *
 * Why this matters in production:
 *   Without this, if Redis dies, every API request hangs until timeout.
 *   With this, the circuit opens after N failures and fails fast (< 1ms),
 *   protecting the rest of the system and allowing Redis to recover.
 */
class CircuitBreaker {
  constructor(options = {}) {
    this.name = options.name || "default";
    this.failureThreshold = options.failureThreshold || 5;
    this.recoveryTimeout = options.recoveryTimeout || 30000; // 30s
    this.state = "CLOSED";
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.successCount = 0;
  }

  async call(fn) {
    if (this.state === "OPEN") {
      // Check if recovery window has passed
      if (Date.now() - this.lastFailureTime > this.recoveryTimeout) {
        this.state = "HALF_OPEN";
        logger.warn(`Circuit breaker [${this.name}] entering HALF_OPEN state`);
      } else {
        throw new Error(`Circuit breaker [${this.name}] is OPEN — failing fast`);
      }
    }

    try {
      const result = await fn();
      this._onSuccess();
      return result;
    } catch (err) {
      this._onFailure(err);
      throw err;
    }
  }

  _onSuccess() {
    this.failureCount = 0;
    if (this.state === "HALF_OPEN") {
      this.state = "CLOSED";
      logger.info(`Circuit breaker [${this.name}] recovered → CLOSED`);
    }
  }

  _onFailure(err) {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    logger.error(`Circuit breaker [${this.name}] failure ${this.failureCount}/${this.failureThreshold}`, {
      error: err.message,
    });

    if (this.failureCount >= this.failureThreshold) {
      this.state = "OPEN";
      logger.error(`Circuit breaker [${this.name}] OPENED — too many failures`);
    }
  }

  getState() {
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
    };
  }
}

// ── Singleton breakers for each external dependency ──
const redisBreaker = new CircuitBreaker({
  name: "redis",
  failureThreshold: 5,
  recoveryTimeout: 30000,
});

const groqBreaker = new CircuitBreaker({
  name: "groq",
  failureThreshold: 3,
  recoveryTimeout: 60000,
});

module.exports = { CircuitBreaker, redisBreaker, groqBreaker };
