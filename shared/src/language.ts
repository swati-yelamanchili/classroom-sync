const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  hi: 'Hindi',
  ta: 'Tamil',
  te: 'Telugu',
  mr: 'Marathi',
  kn: 'Kannada',
  ml: 'Malayalam',
  bn: 'Bengali',
  gu: 'Gujarati',
  pa: 'Punjabi',
  or: 'Odia',
  ur: 'Urdu',
};

/** "ta" or "ta-IN" -> "Tamil"; unknown tags are returned as given. */
export function languageName(tag: string | null | undefined): string | null {
  if (!tag) return null;
  return LANGUAGE_NAMES[tag.toLowerCase().split('-')[0]!] ?? tag;
}
