"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  CREATORHUB_MOBILE_VERIFICATION,
  effectiveHourlyRateCents,
  workOrderMatchesProfile,
  type WorkerProfile,
} from "@/lib/human-executor/contracts";
import styles from "./work.module.css";

type Stage = "profile" | "offer" | "working" | "complete";

const STORAGE_KEY = "cooperative-human-executor-demo-v1";

const DEFAULT_PROFILE: WorkerProfile = {
  displayName: "",
  skills: ["Mobile testing"],
  devices: ["iPhone"],
  locationMode: "remote",
  minimumHourlyRateCents: 2500,
  preferredTaskMinutes: 30,
  blockedCategories: [],
  notificationsEnabled: true,
};

function dollars(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export default function WorkPage() {
  const order = CREATORHUB_MOBILE_VERIFICATION;
  const [stage, setStage] = useState<Stage>("profile");
  const [profile, setProfile] = useState<WorkerProfile>(DEFAULT_PROFILE);
  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [helpOpen, setHelpOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let frame: number | null = null;
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved) as { profile?: WorkerProfile };
      if (!parsed.profile) return;

      frame = window.requestAnimationFrame(() => {
        setProfile(parsed.profile as WorkerProfile);
        setStage("offer");
      });
    } catch {
      // Demo state is disposable; invalid local data should never block the worker.
    }

    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, []);

  const hourlyRateCents = useMemo(
    () => effectiveHourlyRateCents(order.compensationCents, order.estimatedMinutes),
    [order],
  );
  const matches = useMemo(
    () => workOrderMatchesProfile(profile, order),
    [profile, order],
  );
  const step = order.steps[stepIndex];
  const progress = Math.round(((stepIndex + 1) / order.steps.length) * 100);

  function saveProfile(event: FormEvent) {
    event.preventDefault();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ profile }));
    setStage("offer");
  }

  function acceptWork() {
    setStepIndex(0);
    setAnswers({});
    setHelpOpen(false);
    setStage("working");
  }

  function recordAnswer(value: string) {
    setAnswers((current) => ({ ...current, [step.id]: value }));
  }

  function continueWork() {
    if (!answers[step.id]) return;
    if (stepIndex === order.steps.length - 1) {
      setStage("complete");
      return;
    }
    setStepIndex((current) => current + 1);
    setHelpOpen(false);
  }

  function resetDemo() {
    window.localStorage.removeItem(STORAGE_KEY);
    setProfile(DEFAULT_PROFILE);
    setStage("profile");
    setStepIndex(0);
    setAnswers({});
    setHelpOpen(false);
  }

  return (
    <main className={styles.shell}>
      <header className={styles.topbar}>
        <Link href="/" className={styles.brand}>CO/OPERATIVE</Link>
        <span className={styles.badge}>Human Executor · Preview</span>
      </header>

      {stage === "profile" ? (
        <section className={styles.screen}>
          <div className={styles.eyebrow}>Set up once</div>
          <h1>Work that fits you.</h1>
          <p className={styles.lead}>
            Tell CoOperative the kind of work you want, what you can use, and the
            minimum value your time should earn. No bidding or proposals.
          </p>

          <form className={styles.form} onSubmit={saveProfile}>
            <label>
              <span>Your name</span>
              <input
                required
                maxLength={80}
                placeholder="Zac"
                value={profile.displayName}
                onChange={(event) =>
                  setProfile((current) => ({
                    ...current,
                    displayName: event.target.value,
                  }))
                }
              />
            </label>

            <div className={styles.twoCol}>
              <label>
                <span>Minimum effective hourly rate</span>
                <div className={styles.moneyField}>
                  <b>$</b>
                  <input
                    type="number"
                    min="0"
                    max="1000"
                    step="1"
                    value={profile.minimumHourlyRateCents / 100}
                    onChange={(event) =>
                      setProfile((current) => ({
                        ...current,
                        minimumHourlyRateCents:
                          Math.max(0, Number(event.target.value) || 0) * 100,
                      }))
                    }
                  />
                </div>
              </label>
              <label>
                <span>Preferred task length</span>
                <select
                  value={profile.preferredTaskMinutes}
                  onChange={(event) =>
                    setProfile((current) => ({
                      ...current,
                      preferredTaskMinutes: Number(event.target.value),
                    }))
                  }
                >
                  <option value={10}>About 10 minutes</option>
                  <option value={30}>Up to 30 minutes</option>
                  <option value={60}>Up to 1 hour</option>
                  <option value={120}>Up to 2 hours</option>
                </select>
              </label>
            </div>

            <fieldset className={styles.fieldset}>
              <legend>Devices you can use</legend>
              <label className={styles.checkRow}>
                <input
                  type="checkbox"
                  checked={profile.devices.includes("iPhone")}
                  onChange={(event) =>
                    setProfile((current) => ({
                      ...current,
                      devices: event.target.checked
                        ? Array.from(new Set([...current.devices, "iPhone"]))
                        : current.devices.filter((device) => device !== "iPhone"),
                    }))
                  }
                />
                <span>iPhone</span>
              </label>
              <label className={styles.checkRow}>
                <input
                  type="checkbox"
                  checked={profile.devices.includes("Computer")}
                  onChange={(event) =>
                    setProfile((current) => ({
                      ...current,
                      devices: event.target.checked
                        ? Array.from(new Set([...current.devices, "Computer"]))
                        : current.devices.filter((device) => device !== "Computer"),
                    }))
                  }
                />
                <span>Computer</span>
              </label>
            </fieldset>

            <label className={styles.checkRow}>
              <input
                type="checkbox"
                checked={profile.notificationsEnabled}
                onChange={(event) =>
                  setProfile((current) => ({
                    ...current,
                    notificationsEnabled: event.target.checked,
                  }))
                }
              />
              <span>Notify me when matching work becomes available</span>
            </label>

            <button className={styles.primary} type="submit">
              Save work preferences
            </button>
            <p className={styles.finePrint}>
              Preview only. Profile data is stored on this device until the reviewed
              workforce database/RLS change is approved.
            </p>
          </form>
        </section>
      ) : null}

      {stage === "offer" ? (
        <section className={styles.screen}>
          <div className={styles.eyebrow}>Matching work</div>
          <h1>{matches ? "This fits your preferences." : "This one does not match yet."}</h1>
          <article className={styles.offerCard}>
            <div className={styles.offerTop}>
              <div>
                <span className={styles.kicker}>Remote · iPhone</span>
                <h2>{order.title}</h2>
              </div>
              <strong className={styles.pay}>{dollars(order.compensationCents)}</strong>
            </div>
            <p>{order.summary}</p>
            <div className={styles.metrics}>
              <div><span>Estimated</span><strong>{order.estimatedMinutes} min</strong></div>
              <div><span>Effective rate</span><strong>{dollars(hourlyRateCents)}/hr</strong></div>
              <div><span>Deadline</span><strong>{order.deadlineLabel}</strong></div>
            </div>
            <div className={styles.requirements}>
              {order.requirements.map((requirement) => (
                <span key={requirement}>✓ {requirement}</span>
              ))}
            </div>
          </article>

          {!matches ? (
            <div className={styles.notice}>
              This demo requires an iPhone and pays an effective {dollars(hourlyRateCents)}/hr.
              Update your profile rather than accepting work outside your preferences.
            </div>
          ) : null}

          <div className={styles.actions}>
            <button
              className={styles.primary}
              type="button"
              disabled={!matches}
              onClick={acceptWork}
            >
              Accept {dollars(order.compensationCents)} task
            </button>
            <button className={styles.secondary} type="button" onClick={() => setStage("profile")}>
              Edit preferences
            </button>
          </div>
        </section>
      ) : null}

      {stage === "working" && step ? (
        <section className={styles.taskScreen}>
          <div className={styles.taskHeader}>
            <div>
              <div className={styles.eyebrow}>Step {stepIndex + 1} of {order.steps.length}</div>
              <h1>{step.title}</h1>
            </div>
            <strong className={styles.pay}>{dollars(order.compensationCents)}</strong>
          </div>

          <div className={styles.progressTrack} aria-label={"Progress " + progress + "%"}>
            <div className={styles.progressBar} style={{ width: progress + "%" }} />
          </div>

          <article className={styles.instructionCard}>
            <p>{step.instruction}</p>

            {step.inputKind === "open_link" && step.externalUrl ? (
              <a
                className={styles.primaryLink}
                href={step.externalUrl}
                target="_blank"
                rel="noreferrer"
                onClick={() => recordAnswer("opened")}
              >
                Open CreatorHub
              </a>
            ) : null}

            {step.inputKind === "yes_no" ? (
              <div className={styles.choiceGrid}>
                <button
                  type="button"
                  className={answers[step.id] === "yes" ? styles.choiceActive : styles.choice}
                  onClick={() => recordAnswer("yes")}
                >
                  Yes
                </button>
                <button
                  type="button"
                  className={answers[step.id] === "no" ? styles.choiceActive : styles.choice}
                  onClick={() => recordAnswer("no")}
                >
                  No
                </button>
              </div>
            ) : null}

            {step.inputKind === "confirm" ? (
              <button
                type="button"
                className={answers[step.id] ? styles.choiceActive : styles.choice}
                onClick={() => recordAnswer("confirmed")}
              >
                Screenshot saved
              </button>
            ) : null}

            {step.inputKind === "text" ? (
              <textarea
                rows={4}
                placeholder="One short note is enough."
                value={answers[step.id] ?? ""}
                onChange={(event) => recordAnswer(event.target.value)}
              />
            ) : null}

            <button
              type="button"
              className={styles.help}
              onClick={() => setHelpOpen((current) => !current)}
            >
              {helpOpen ? "Hide help" : "Need help?"}
            </button>
            {helpOpen ? <div className={styles.helpBox}>{step.helpText}</div> : null}
          </article>

          <div className={styles.stickyActions}>
            {stepIndex > 0 ? (
              <button
                className={styles.secondary}
                type="button"
                onClick={() => {
                  setStepIndex((current) => Math.max(0, current - 1));
                  setHelpOpen(false);
                }}
              >
                Back
              </button>
            ) : null}
            <button
              className={styles.primary}
              type="button"
              disabled={!answers[step.id]?.trim()}
              onClick={continueWork}
            >
              {stepIndex === order.steps.length - 1 ? "Submit work" : "Continue"}
            </button>
          </div>
        </section>
      ) : null}

      {stage === "complete" ? (
        <section className={styles.completeScreen}>
          <div className={styles.successMark}>✓</div>
          <div className={styles.eyebrow}>Work complete</div>
          <h1>{dollars(order.compensationCents)} earned.</h1>
          <p className={styles.lead}>
            CoOperative accepted the demo work and created a test earnings record.
            No invoice, customer follow-up, or payout request is needed from the worker.
          </p>

          <article className={styles.earningsCard}>
            <div><span>Available</span><strong>{dollars(order.compensationCents)}</strong></div>
            <div><span>Status</span><strong>Test earnings</strong></div>
            <div><span>Payout</span><strong>Not connected yet</strong></div>
          </article>

          <div className={styles.notice}>
            Real payouts stay disabled until the workforce schema, identity/RLS model,
            payment provider flow, and dispute handling are reviewed.
          </div>

          <button className={styles.secondary} type="button" onClick={resetDemo}>
            Reset demo
          </button>
        </section>
      ) : null}
    </main>
  );
}
