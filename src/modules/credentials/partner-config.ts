import "server-only";
import { partnerConsentDocuments } from "@/lib/mengantar/partner-onboarding";
import { config } from "@/lib/config";

// PR-20: no placeholder versions or guessed provider-policy URLs, including in the sandbox.
export function configuredPartnerDocuments() {
  return partnerConsentDocuments({
    termsVersion: config("PARTNER_TERMS_VERSION"),
    privacyVersion: config("PARTNER_PRIVACY_VERSION"),
    termsUrl: config("PARTNER_TERMS_URL"),
    privacyUrl: config("PARTNER_PRIVACY_URL"),
  });
}
