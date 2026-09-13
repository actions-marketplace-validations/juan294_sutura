import { expect, test } from 'vitest';
import { invoiceTotal } from './invoice.js';

test('applies tax to every invoice line', () => {
  expect(invoiceTotal([{ unitPrice: 10, quantity: 2 }, { unitPrice: 5, quantity: 4 }], 0.1)).toBe(44);
});
