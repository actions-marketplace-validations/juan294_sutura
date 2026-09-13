import { price } from 'pricer';

export function checkoutTotal(base, rate) {
  return price(base, rate);
}
