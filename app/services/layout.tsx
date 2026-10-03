import { redirect } from "next/navigation";
import { authenticatedIdentity } from "@/lib/supabase/auth";
import { canAccessMainCooperative } from "@/lib/ai/main-cooperative-access";

export default async function MainCooperativeAreaLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const identity = await authenticatedIdentity();
  if (!identity) redirect("/login?next=/services");
  if (!(await canAccessMainCooperative(identity.userId))) redirect("/personal-ai");

  return children;
}
