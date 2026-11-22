/**
 * A text cut to a bound without splitting a character. A cut inside a surrogate pair leaves a lone surrogate, which JSON
 * writes as an escape PostgreSQL refuses, with the whole request that carries it. Both cuts give a well-formed text (a lone
 * surrogate already there becomes the replacement character) and keep whole characters only.
 */

/** At most `units` UTF-16 code units: what a JavaScript length, or a zod `max`, counts. */
export function cutToCodeUnits(value: string, units: number): string {
  const text = value.toWellFormed();
  if (text.length <= units) return text;
  const last = text.charCodeAt(units - 1);
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? units - 1 : units);
}

/** At most `chars` characters (code points): what PostgreSQL's char_length counts. */
export function cutToCharacters(value: string, chars: number): string {
  const text = value.toWellFormed();
  if (text.length <= chars) return text;
  const characters = Array.from(text);
  return characters.length <= chars ? text : characters.slice(0, chars).join("");
}
