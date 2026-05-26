/**
 * In-memory store replacing Redis.
 * Supports TTL-based expiry, get/set/delete/pattern-delete.
 * Data is lost on server restart — suitable for dev and small-scale production.
 * For multi-instance production deployments, swap back to Redis or use a DB-backed store.
 */

const store = new Map(); // key → { value, expiresAt }

// Periodically evict expired keys (every 60 s)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.expiresAt && entry.expiresAt < now) {
      store.delete(key);
    }
  }
}, 60_000).unref();

/**
 * Set a value with optional TTL in seconds.
 */
const cacheSet = (key, value, ttl = 0) => {
  const expiresAt = ttl > 0 ? Date.now() + ttl * 1000 : null;
  store.set(key, { value: JSON.parse(JSON.stringify(value)), expiresAt });
  return true;
};

/**
 * Get a value. Returns null if missing or expired.
 */
const cacheGet = (key) => {
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.expiresAt && entry.expiresAt < Date.now()) {
    store.delete(key);
    return null;
  }
  return entry.value;
};

/**
 * Delete a single key.
 */
const cacheDel = (key) => {
  store.delete(key);
  return true;
};

/**
 * Delete all keys that start with a given prefix.
 */
const cacheDelPattern = (prefix) => {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
  return true;
};

/**
 * No-op connect — kept so callers don't need changing.
 */
const connectStore = () => {
  const { logger } = require('../utils/logger');
  logger.info('In-memory store ready (no Redis)');
};

module.exports = { connectStore, cacheSet, cacheGet, cacheDel, cacheDelPattern };
