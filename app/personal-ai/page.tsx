import { redirect } from "next/navigation";
import { authenticatedIdentity } from "@/lib/supabase/auth";
import PersonalAiMobile from "./PersonalAiMobile";

export default async function PersonalAiPage() {
  const identity = await authenticatedIdentity();
  if (!identity) redirect("/login?next=/personal-ai");

  return (
    <main className="personal-ai-page">
      <PersonalAiMobile />
    </main>
  );
}
