import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthCard, AuthHeading, AuthShell } from "@/components/auth/auth-shell";
import { RegistrationSteps } from "@/components/auth/registration-steps";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@/lib/auth/password";
import { currentUser, dbServer } from "@/lib/db/server";
import { PasswordForm } from "../forms";

export const metadata: Metadata = { title: "Buat kata sandi" };

export default async function SetPasswordPage() {
  const user = await currentUser();
  if (!user || user.isAnonymous) redirect("/masuk");
  if (user.hasPassword) redirect("/");
  // Same choice as setPasswordAction makes next: invited staff continue to their invitation.
  const { data: invites } = await (await dbServer()).rpc("my_invitations");
  const journey = (invites ?? []).length > 0 ? "staf" : "gerai";
  return (
    <AuthShell>
      <AuthCard>
        <RegistrationSteps journey={journey} current="sandi" />
        <AuthHeading
          title="Buat kata sandi"
          description="Email Anda sudah terverifikasi. Kata sandi ini dipakai untuk masuk ke GeraiExpress berikutnya — bukan kata sandi Mengantar."
        />
        <PasswordForm minLength={MIN_PASSWORD_LENGTH} maxLength={MAX_PASSWORD_LENGTH} />
      </AuthCard>
    </AuthShell>
  );
}
