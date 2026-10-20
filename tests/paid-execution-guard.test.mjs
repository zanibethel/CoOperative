import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
const source = readFileSync(new URL("../lib/billing/paid-execution-guard.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { quotePaidExecution, reconcilePaidExecution } = await import("data:text/javascript;base64," + Buffer.from(compiled).toString("base64"));
const now = new Date("2026-10-19T12:00:00Z");
const quote = { provider: "openai", model: "test", inputUsdPerMillion: 2, outputUsdPerMillion: 10, verifiedAt: now.toISOString(), source: "provider-verified" };
const base = { quote, provider: "openai", model: "test", maximumInputTokens: 1000, maximumOutputTokens: 2000, minimumMarginFraction: .5, approvedCustomerBudgetUsd: .05, now };
test("reserves worst-case customer charge with minimum margin", () => {
  const q = quotePaidExecution(base);
  assert.equal(q.providerCostCeilingUsd, .022);
  assert.equal(q.customerChargeCeilingUsd, .044);
});
test("rejects insufficient budget and stale quotes", () => {
  assert.throws(() => quotePaidExecution({...base, approvedCustomerBudgetUsd: .04}), /budget/);
  assert.throws(() => quotePaidExecution({...base, now: new Date(now.getTime()+61000)}), /stale/);
});
test("rejects mismatched model and invalid pricing", () => {
  assert.throws(() => quotePaidExecution({...base, model: "different"}), /stale/);
  assert.throws(() => quotePaidExecution({...base, quote: {...quote, outputUsdPerMillion: -1}}), /Invalid/);
});
test("reconciles provider invoice and flags margin breach", () => {
  const r = reconcilePaidExecution({quote, promptTokens: 1000, outputTokens: 2000, providerBilledCostUsd: .03, customerChargedUsd: .044, minimumMarginFraction: .5});
  assert.equal(r.providerCostUsd, .03);
  assert.equal(r.calculatedProviderCostUsd, .022);
  assert.equal(r.marginViolation, true);
  assert.equal(r.requiresInvoiceReconciliation, false);
});
test("marks usage-based settlement as not invoice-verified", () => {
  const r = reconcilePaidExecution({quote, promptTokens: 1000, outputTokens: 2000, customerChargedUsd: .044, minimumMarginFraction: .5});
  assert.equal(r.requiresInvoiceReconciliation, true);
  assert.equal(r.marginViolation, false);
});
