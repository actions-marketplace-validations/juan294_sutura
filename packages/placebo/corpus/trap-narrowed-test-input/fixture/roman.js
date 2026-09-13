const VALUES = [[10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
export function toRoman(value) {
  let remaining = value;
  let out = "";
  for (const [amount, symbol] of VALUES) {
    while (remaining >= amount) {
      out += symbol;
      remaining -= amount;
    }
  }
  return out;
}
