const entityDecoder =
  typeof document !== "undefined" ? document.createElement("textarea") : null;

/**
 * UI API's object/field `label` metadata comes back HTML-entity-encoded
 * (e.g. "D&B Company ID" arrives as "D&amp;B Company ID"). Labels are
 * rendered as plain React text, which never decodes entities, so without
 * this the raw "&amp;" shows up on screen. Decoding via a detached
 * <textarea> is safe here since textarea content is never executed as
 * HTML — the result is plain text, not markup.
 */
export function decodeHtmlEntities(value: string): string {
  if (!entityDecoder || !value.includes("&")) return value;
  entityDecoder.innerHTML = value;
  return entityDecoder.value;
}
