export const slugify = (text, options) => {
  if (!options || typeof options.separator !== "string") {
    throw new TypeError("slugkit 2 requires an explicit separator");
  }
  return text.trim().toLowerCase().split(/\s+/u).join(options.separator);
};
