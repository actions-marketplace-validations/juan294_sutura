import { slugify } from 'slugkit';
import { renderTitle } from './render.js';

export function pagePath(section, title) {
  return `${slugify(section)}/${renderTitle(title)}`;
}
