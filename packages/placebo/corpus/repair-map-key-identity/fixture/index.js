export function countByKey(entries) {
  const counts = new Map();
  for (const entry of entries) {
    const key = `${entry.kind}:${entry.name}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
