// Small in-process counters for the dashboard. No dependencies, no persistence:
// the numbers reset when the server restarts, which is all the health page needs.

const counters = new Map();
const timings = new Map();

function increment(name, by = 1) {
  counters.set(name, (counters.get(name) || 0) + by);
  return counters.get(name);
}

function reset(name) {
  counters.delete(name);
  timings.delete(name);
}

function resetAll() {
  counters.clear();
  timings.clear();
}

function record(name, milliseconds) {
  const list = timings.get(name) || [];
  list.push(milliseconds);
  timings.set(name, list);
  return list.length;
}

function average(name) {
  const list = timings.get(name) || [];
  if (list.length === 0) return 0;
  return list.reduce((a, b) => a + b, 0) / list.length;
}

function slowest(name) {
  const list = timings.get(name) || [];
  return list.length === 0 ? 0 : Math.max(...list);
}

function fastest(name) {
  const list = timings.get(name) || [];
  return list.length === 0 ? 0 : Math.min(...list);
}

function percentile(name, p) {
  const list = [...(timings.get(name) || [])].sort((a, b) => a - b);
  if (list.length === 0) return 0;
  const index = Math.min(list.length - 1, Math.floor((p / 100) * list.length));
  return list[index];
}

function count(name) {
  return counters.get(name) || 0;
}

function names() {
  return [...new Set([...counters.keys(), ...timings.keys()])].sort();
}

function snapshot() {
  const out = {};
  for (const name of names()) {
    out[name] = {
      count: count(name),
      average: Number(average(name).toFixed(2)),
      p95: percentile(name, 95),
      slowest: slowest(name),
      fastest: fastest(name),
    };
  }
  return out;
}

async function timed(name, fn) {
  const startedAt = Date.now();
  try {
    return await fn();
  } finally {
    record(name, Date.now() - startedAt);
    increment(name);
  }
}

function summaryLine() {
  const parts = names().map((name) => `${name}=${count(name)}`);
  return parts.length === 0 ? 'no traffic yet' : parts.join(' ');
}

module.exports = {
  increment,
  reset,
  resetAll,
  record,
  average,
  slowest,
  fastest,
  percentile,
  count,
  names,
  snapshot,
  timed,
  summaryLine,
};
