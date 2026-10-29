import { PartnerSellerOnboardingFields, type PartnerOnboardingStatus } from "./client-forms";
import { configuredPartnerDocuments } from "./partner-config";

export { PartnerIdForm, RemoveSellerKeyForm, SellerKeyForm, type PartnerOnboardingStatus } from "./client-forms";

// Resolve public document links on the server; configuration access never enters the client graph.
export function PartnerSellerOnboardingForm({ onboarding }: { onboarding: PartnerOnboardingStatus }) {
  return <PartnerSellerOnboardingFields onboarding={onboarding} documents={configuredPartnerDocuments()} />;
}
