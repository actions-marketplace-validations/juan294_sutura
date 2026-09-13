export async function runAll(tasks) {
  const settled = await Promise.allSettled(tasks.map((task) => task()));
  return settled.filter(({ status }) => status === "fulfilled").map(({ value }) => value);
}
