export function lineTotal(unitPrice, quantity, taxRate) {
  return unitPrice * quantity * (1 + taxRate);
}
