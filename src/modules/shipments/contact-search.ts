// SUP-24 / T-051: the server-side contact filter of the intake pickers (?kontak=). Pure, so the
// PostgREST filter text it builds is testable without a request.
//
// Only characters that break the `or=(...)` filter grammar or act as wildcards are removed: the
// separator `,`, the group parentheses, the wildcards `%` `_` `*`, the escape `\` and control
// characters. Quotes, apostrophes, colons and dots are legitimate in names (O'Brien) and are kept.
// A typed phone number is normalized the way stored numbers are (draft.normalizePhone: +62 -> 0)
// before it is matched, so "+62 812-3456-7890" finds "081234567890".

const FILTER_BREAKERS = /[,()%_*\\\u0000-\u001f\u007f]/g;
const PHONE_LIKE = /^\+?[0-9\s().-]+$/;

export type ContactSearch = {
  // The cleaned text shown back to the user; empty means no filter.
  text: string;
  // The value of `.or(...)`, or null when there is nothing to filter by.
  filter: string | null;
};

export function contactSearch(raw: string): ContactSearch {
  const text = raw.replace(FILTER_BREAKERS, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  if (!text) return { text: "", filter: null };
  const clauses = [`name.ilike.%${text}%`, `phone.ilike.%${text}%`];
  if (PHONE_LIKE.test(text)) {
    const digits = text.replace(/\D/g, "");
    if (digits.length >= 3) {
      // Typed +62 / 62 prefix -> the local 0 form; the 62 form is matched too (numbers saved as 62...).
      const local = digits.startsWith("62") ? `0${digits.slice(2)}` : digits;
      const international = local.startsWith("0") ? `62${local.slice(1)}` : null;
      for (const variant of [local, international]) {
        if (variant && !clauses.includes(`phone.ilike.%${variant}%`)) clauses.push(`phone.ilike.%${variant}%`);
      }
    }
  }
  return { text, filter: clauses.join(",") };
}
