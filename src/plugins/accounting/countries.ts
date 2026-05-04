// Country utilities for the accounting plugin.
//
// The book's country (ISO 3166-1 alpha-2) identifies the tax
// jurisdiction the book is kept under. The Accounting role uses it
// to give country-aware advice — Japanese T-number under
// インボイス制度, EU VAT ID, UK VAT, GSTIN, ABN, etc.
//
// Curated against the supported currency list and the tax-regime
// guidance in `src/config/roles.ts` (Accounting role prompt).
// Intl.DisplayNames provides the localized human name at render
// time, so this stays a flat list of codes.

/** ISO 3166-1 alpha-2 country codes shown in the book country
 *  dropdown. Curated to cover every jurisdiction the Accounting role
 *  has explicit tax-registration advice for, plus the major economies
 *  represented in `SUPPORTED_CURRENCY_CODES`. */
export const SUPPORTED_COUNTRY_CODES = [
  "US",
  "JP",
  "GB",
  "CA",
  "AU",
  "NZ",
  "DE",
  "FR",
  "IT",
  "ES",
  "NL",
  "BE",
  "AT",
  "IE",
  "PT",
  "FI",
  "SE",
  "DK",
  "PL",
  "CH",
  "NO",
  "CN",
  "KR",
  "TW",
  "HK",
  "SG",
  "IN",
  "BR",
  "MX",
] as const;

export type SupportedCountryCode = (typeof SUPPORTED_COUNTRY_CODES)[number];

/** EU member states as of 2026. Used by the role-prompt advice path
 *  to recommend a VAT identification number when the book country is
 *  in the EU. */
export const EU_COUNTRY_CODES: ReadonlySet<string> = new Set([
  "AT",
  "BE",
  "BG",
  "CY",
  "CZ",
  "DE",
  "DK",
  "EE",
  "ES",
  "FI",
  "FR",
  "GR",
  "HR",
  "HU",
  "IE",
  "IT",
  "LT",
  "LU",
  "LV",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SE",
  "SI",
  "SK",
]);

/** Localized human name for a country code. Falls back to the code
 *  itself if the runtime can't resolve the name. */
export function localizedCountryName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Runtime guard for `BookSummary.country`. The type is the union
 *  `SupportedCountryCode`, but every entry point that takes user /
 *  LLM input arrives as raw `string` (form submit, JSON-RPC body),
 *  so the service layer narrows here before persisting. */
export function isSupportedCountryCode(value: unknown): value is SupportedCountryCode {
  return typeof value === "string" && (SUPPORTED_COUNTRY_CODES as readonly string[]).includes(value);
}

/** Whether the supplier's tax-registration ID (T-number / VAT ID /
 *  GSTIN / ABN / …) is required, recommended, or unused for a given
 *  jurisdiction. Drives the JournalEntryForm amber-border warning
 *  when the user picks a 14xx / 24xx account but leaves the field
 *  blank. The form never blocks submit on this — the warning is a
 *  nudge, not a gate.
 *
 *  Mirrors the country-by-country guidance in the Accounting role
 *  prompt at `src/config/roles.ts` ("Country-aware tax behaviour"
 *  section). Keep them in sync; drift here means the LLM and the
 *  form give contradictory advice. */
export type TaxRegistrationRequirement = "required" | "recommended" | "none";

export const TAX_REGISTRATION_REQUIREMENT: Record<SupportedCountryCode, TaxRegistrationRequirement> = {
  // Explicitly required by the role prompt.
  JP: "required",
  GB: "required",
  DE: "required",
  FR: "required",
  IT: "required",
  ES: "required",
  NL: "required",
  BE: "required",
  AT: "required",
  IE: "required",
  PT: "required",
  FI: "required",
  SE: "required",
  DK: "required",
  PL: "required",
  IN: "required",
  AU: "required",
  NZ: "required",
  CA: "required",
  // Explicitly excluded by the role prompt — US has no federal
  // sales-tax registration; sales tax is per-state.
  US: "none",
  // "Other countries" bucket — the prompt asks for the equivalent
  // local registration number but doesn't make it a hard rule.
  CH: "recommended",
  NO: "recommended",
  CN: "recommended",
  KR: "recommended",
  TW: "recommended",
  HK: "recommended",
  SG: "recommended",
  BR: "recommended",
  MX: "recommended",
};

/** Tax-registration requirement for the book's country. Defaults
 *  to "recommended" when the country is unset — if the user picked
 *  a tax-related account, something tax-related is happening, so
 *  the amber nudge is appropriate even before the book's country
 *  has been configured. */
export function taxRegistrationRequirement(country: SupportedCountryCode | undefined): TaxRegistrationRequirement {
  if (!country) return "recommended";
  return TAX_REGISTRATION_REQUIREMENT[country];
}
