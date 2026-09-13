/**
 * HTML escaping shared by every renderer.
 *
 * This module deliberately imports nothing. The site bundle is built for the
 * browser, so a renderer helper cannot live beside server-only code that
 * reaches for `node:fs`.
 */
export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/gu,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character]!,
  );
}
