/**
 * Locale-aware formatters used across the client webapp. Centralised
 * here so a single import is the source of truth for "what does a date
 * look like in IT vs EN" — without this, pages had ~20 hardcoded
 * `toLocaleDateString("it-IT", …)` calls that ignored the user's
 * language preference.
 *
 * The `locale` argument is the BCP-47 tag returned by
 * `useI18n().locale` (e.g. "it-IT" or "en-US").
 */

export type DateStyle = "short" | "long" | "weekday-long" | "month-day";

export function formatDate(
  input: Date | string | number,
  locale = "it-IT",
  style: DateStyle = "long",
): string {
  const d = input instanceof Date ? input : new Date(input);
  if (isNaN(d.getTime())) return "";
  switch (style) {
    case "short":
      return d.toLocaleDateString(locale, {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    case "month-day":
      return d.toLocaleDateString(locale, {
        day: "numeric",
        month: "short",
      });
    case "weekday-long":
      return d.toLocaleDateString(locale, {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      });
    case "long":
    default:
      return d.toLocaleDateString(locale, {
        day: "numeric",
        month: "long",
        year: "numeric",
      });
  }
}

export function formatTime(
  input: Date | string | number,
  locale = "it-IT",
): string {
  const d = input instanceof Date ? input : new Date(input);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDateTime(
  input: Date | string | number,
  locale = "it-IT",
  dateStyle: DateStyle = "long",
): string {
  return `${formatDate(input, locale, dateStyle)} · ${formatTime(input, locale)}`;
}
