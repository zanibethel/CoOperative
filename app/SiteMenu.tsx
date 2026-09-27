"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const menuItems = [
  { href: "/", label: "Home", detail: "CoOperative overview" },
  { href: "/console", label: "Mission Control", detail: "Tasks, approvals, reports, and Ask CoOperative" },
  { href: "/console/projects", label: "Linked Projects", detail: "CreatorHub, provider bootstrap, secrets, and integrations" },
  { href: "/work", label: "Human Work", detail: "Worker profile, matching, guided tasks, and earnings preview" },
  { href: "/services", label: "Services", detail: "Capabilities and automation map" },
  { href: "/intake", label: "Mission Briefing", detail: "Add structured project and business context" },
] as const;

export default function SiteMenu() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");

  return (
    <>
      <button
        className="site-menu-trigger"
        type="button"
        aria-label={open ? "Close navigation menu" : "Open navigation menu"}
        aria-expanded={open}
        aria-controls="site-menu-panel"
        onClick={() => setOpen((current) => !current)}
      >
        <span />
        <span />
        <span />
      </button>

      {open ? (
        <div className="site-menu-layer">
          <button
            className="site-menu-backdrop"
            type="button"
            aria-label="Close navigation menu"
            onClick={() => setOpen(false)}
          />
          <aside
            id="site-menu-panel"
            className="site-menu-panel"
            aria-label="CoOperative navigation"
          >
            <div className="site-menu-head">
              <div>
                <div className="eyebrow">Navigation</div>
                <strong>CO/OPERATIVE</strong>
              </div>
              <button
                className="site-menu-close"
                type="button"
                aria-label="Close navigation menu"
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </div>

            <nav className="site-menu-links">
              {menuItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={isActive(item.href) ? "site-menu-link active" : "site-menu-link"}
                  aria-current={isActive(item.href) ? "page" : undefined}
                  onClick={() => setOpen(false)}
                >
                  <strong>{item.label}</strong>
                  <span>{item.detail}</span>
                </Link>
              ))}
            </nav>

            <div className="site-menu-tip">
              <strong>Provider setup lives in Linked Projects.</strong>
              <span>Use it for CreatorHub → Eromify, Instagram, and secure environment setup.</span>
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}
