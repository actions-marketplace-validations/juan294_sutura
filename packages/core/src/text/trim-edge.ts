export function trimTrailing(value: string, character: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === character) end -= 1;
  return value.slice(0, end);
}

export function trimEdges(value: string, character: string): string {
  let start = 0;
  while (start < value.length && value[start] === character) start += 1;
  return trimTrailing(value.slice(start), character);
}
