import { slugify } from './vendor/slugkit.js';

export const titleSlug = (title) => slugify(title, { separator: '-' });
