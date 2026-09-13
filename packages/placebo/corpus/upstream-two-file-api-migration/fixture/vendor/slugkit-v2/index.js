export function slugify(text, options) {
  if (!options || typeof options.separator !== 'string') {
    throw new TypeError('slugify(text, options) requires options.separator in slugkit 2');
  }
  return text.toLowerCase().replaceAll(' ', options.separator);
}
