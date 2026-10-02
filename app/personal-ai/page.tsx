import { redirect } from "next/navigation";
import { authenticatedIdentity } from "@/lib/supabase/auth";

export const metadata = {
  title: "CoOperativeLocalAI",
  description: "Use your own PC-powered CoOperativeLocalAI from anywhere.",
};
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
