function createDomainLimiter() {
  const queues = new Map();

  function queueFor(url) {
    const origin = new URL(url).origin;
    if (!queues.has(origin)) queues.set(origin, { running: 0, pending: [] });
    return queues.get(origin);
  }

  function release(queue) {
    queue.running--;
    const next = queue.pending.shift();
    if (next) next();
  }

  async function run(url, concurrency, operation) {
    if (typeof operation !== "function") throw new TypeError("domain-limiter operation must be a function");
    const queue = queueFor(url);
    await new Promise((resolve) => {
      const start = () => {
        queue.running++;
        resolve();
      };
      if (queue.running < concurrency) start();
      else queue.pending.push(start);
    });

    try {
      return await operation();
    } finally {
      release(queue);
    }
  }

  return { run };
}

module.exports = { createDomainLimiter };
