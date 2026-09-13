export function firstWord(sentence: string): string {
  const [word] = sentence.split(" ");
  return word ?? "";
}
