export function label(names: Map<string, string>, id: string): string {
  return names.get(id) ?? "unknown";
}
