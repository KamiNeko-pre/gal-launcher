const test = require("node:test");
const assert = require("node:assert/strict");

const { createDomainLimiter } = require("./domain-limiter.cjs");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test("holds a domain token until the asynchronous operation settles", async () => {
  const limiter = createDomainLimiter();
  const first = deferred();
  const started = [];

  const firstRun = limiter.run("https://covers.example.test/a", 1, async () => {
    started.push("first");
    await first.promise;
  });
  const secondRun = limiter.run("https://covers.example.test/b", 1, async () => {
    started.push("second");
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, ["first"]);
  first.resolve();
  await Promise.all([firstRun, secondRun]);
  assert.deepEqual(started, ["first", "second"]);
});

test("releases a failed operation so queued work can continue", async () => {
  const limiter = createDomainLimiter();
  const started = [];

  const failed = limiter.run("https://covers.example.test/a", 1, async () => {
    started.push("failed");
    throw new Error("upstream unavailable");
  });
  const next = limiter.run("https://covers.example.test/b", 1, async () => {
    started.push("next");
    return "ok";
  });

  await assert.rejects(failed, /upstream unavailable/);
  assert.equal(await next, "ok");
  assert.deepEqual(started, ["failed", "next"]);
});

test("does not serialize independent origins", async () => {
  const limiter = createDomainLimiter();
  const first = deferred();
  const started = [];

  const held = limiter.run("https://covers.example.test/a", 1, async () => {
    started.push("covers");
    await first.promise;
  });
  const independent = limiter.run("https://metadata.example.test/a", 1, async () => {
    started.push("metadata");
  });

  await independent;
  assert.deepEqual(started, ["covers", "metadata"]);
  first.resolve();
  await held;
});
