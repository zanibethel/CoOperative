"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setMessage("");

    const supabase = createClient();

    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setMessage(error.message);
        setLoading(false);
        return;
      }

      router.push("/onboarding");
      router.refresh();
      return;
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/onboarding`,
      },
    });

    if (error) {
      setMessage(error.message);
      setLoading(false);
      return;
    }

    if (data.session) {
      router.push("/onboarding");
      router.refresh();
      return;
    }

    setMessage("Account created. Check your email to confirm your account, then return here to sign in.");
    setLoading(false);
  }

  return (
    <main className="shell">
      <nav className="nav">
        <Link href="/" className="brand">CO/OPERATIVE</Link>
        <div className="badge">Secure Access</div>
      </nav>

      <section className="hero compact-hero">
        <div className="eyebrow">Mission Control</div>
        <h1>{mode === "login" ? "Welcome back." : "Create your operator account."}</h1>
        <p>Your account keeps each business workspace and its operating data isolated behind Supabase Auth and Row Level Security.</p>
      </section>

      <form className="form" onSubmit={submit}>
        <div className="field">
          <label>Email</label>
          <input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        </div>
        <div className="field">
          <label>Password</label>
          <input type="password" required minLength={8} autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} />
        </div>
        <button className="primary" disabled={loading}>
          {loading ? "Working…" : mode === "login" ? "Sign in" : "Create account"}
        </button>
        {message ? <div className="error">{message}</div> : null}
        <button type="button" className="secondary" onClick={() => { setMode(mode === "login" ? "signup" : "login"); setMessage(""); }}>
          {mode === "login" ? "Need an account? Sign up" : "Already have an account? Sign in"}
        </button>
      </form>
    </main>
  );
}
