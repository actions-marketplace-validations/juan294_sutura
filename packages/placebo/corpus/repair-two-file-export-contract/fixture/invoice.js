import { lineTotal } from './totals.js';

export function invoiceTotal(lines, taxRate) {
  return lines.reduce((sum, line) => sum + lineTotal(line.unitPrice, line.quantity, taxRate), 0);
}
