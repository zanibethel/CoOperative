import { redirect } from "next/navigation";

import { canAccessMainCooperative } from "@/lib/ai/main-cooperative-access";
import { authenticatedIdentity } from "@/lib/supabase/auth";

export default async function ModelsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const identity = await authenticatedIdentity();
  if (!identity) redirect("/login?next=/models");
  if (!(await canAccessMainCooperative(identity.userId))) {
    redirect("/personal-ai");
  }

  return children;
}
