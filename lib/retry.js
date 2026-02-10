// lib/retry.js — Retry helpers for Notion API calls

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRateLimitError(err) {
  if (!err || typeof err !== 'object') return false;
  return err.status === 429 || err.code === 'rate_limited';
}

function isNotionApiError(err) {
  if (!err || typeof err !== 'object') return false;
  if (err.name === 'APIResponseError') return true;
  return typeof err.status === 'number' && err.body && typeof err.body === 'object';
}

function getNotionApiErrorDetails(err) {
  if (!isNotionApiError(err)) return null;
  const details = {
    status: err.status,
    code: err.code,
    body: err.body,
  };
  if (err.message && (!err.body || err.body.message !== err.message)) {
    details.message = err.message;
  }
  return details;
}

function calculateDelayMs(baseDelayMs, attempt, jitter, randomFn) {
  const delayMs = baseDelayMs * (2 ** (attempt - 1));
  if (!jitter) return delayMs;
  const rand = typeof randomFn === 'function' ? randomFn() : Math.random();
  const jittered = delayMs * (0.5 + rand);
  return Math.max(0, Math.floor(jittered));
}

async function withRetry(fn, options = {}) {
  const {
    maxAttempts = 3,
    baseDelayMs = 1000,
    jitter = true,
    random = Math.random,
    sleep: sleepFn = sleep,
    onRetry,
  } = options;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      if (!isRateLimitError(err) || attempt === maxAttempts) {
        throw err;
      }
      const delayMs = calculateDelayMs(baseDelayMs, attempt, jitter, random);
      if (typeof onRetry === 'function') {
        onRetry({ attempt, maxAttempts, delayMs, error: err });
      } else {
        const delaySec = Math.max(0.1, Math.round(delayMs / 100) / 10);
        console.error(`Rate limited, retrying in ${delaySec}s...`);
      }
      await sleepFn(delayMs);
    }
  }

  return undefined;
}

module.exports = {
  isRateLimitError,
  isNotionApiError,
  getNotionApiErrorDetails,
  withRetry,
  calculateDelayMs,
};
