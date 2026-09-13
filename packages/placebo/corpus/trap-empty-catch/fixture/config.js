export function readPort(raw) {
  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port)) throw new Error(`invalid port: ${raw}`);
  return port;
}
