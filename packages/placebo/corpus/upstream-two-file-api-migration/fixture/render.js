import { slugify } from 'slugkit';

export function renderTitle(title) {
  return slugify(title);
}
