import { describe, it, expect } from "vitest";
import {
  buildStableAgentPrompt,
  buildVariableEvidenceBlock,
  buildAgentWorkPrompt,
  assembleFullPrompt,
  computeHash,
} from "./cacheFriendlyPromptBuilder.js";
import type { CacheFriendlyPromptConfig } from "./cacheFriendlyPromptBuilder.js";
import type { AgentLesson } from "@msl/domain";

// ── Helpers ────────────────────────────────────────────────────────────────

const plasticovConfig: CacheFriendlyPromptConfig = {
  sellerId: "plasticov-mlc",
  agentId: "product-ads-profitability",
  accountContext: "Plasticov SPA — profit goal: 40%, risk level: low",
  recentMemory: "Last session: 2 observations, 1 proposal approved.",
  evidence: "3 unanswered questions (aging 12h), 1 new reputation signal.",
  openQuestions: "Q1: Should we increase prices? Q2: Is supplier delay a risk?",
  outputSchema: '{"observations": [...], "noMutationExecuted": true}',
};

const maustianConfig: CacheFriendlyPromptConfig = {
  ...plasticovConfig,
  sellerId: "maustian-mlc",
  accountContext: "Maustian SPA — profit goal: 50%, risk level: medium",
};

const sampleLessons: AgentLesson[] = [
  {
    lessonId: "l1",
    sellerId: "plasticov-mlc",
    agentId: "product-ads-profitability",
    sessionId: "s1",
    lesson: "Don't adjust prices on Friday — ML runs on weekends",
    transferable: true,
    learnedAt: "2026-07-01T10:00:00Z",
  },
  {
    lessonId: "l2",
    sellerId: "plasticov-mlc",
    agentId: "product-ads-profitability",
    sessionId: "s2",
    lesson: "Competitor 'DistriPlast' often undercuts by 5% on Mondays",
    transferable: true,
    learnedAt: "2026-07-02T10:00:00Z",
  },
  {
    lessonId: "l3",
    sellerId: "plasticov-mlc",
    agentId: "product-ads-profitability",
    sessionId: "s3",
    lesson: "Plasticov ships slow — factor 2-day delay in all time estimates",
    transferable: false,
    learnedAt: "2026-07-03T10:00:00Z",
  },
];

// ── Stable prefix ──────────────────────────────────────────────────────────

describe("buildStableAgentPrompt", () => {
  it("produces deterministic output for same config", () => {
    const p1 = buildStableAgentPrompt(plasticovConfig);
    const p2 = buildStableAgentPrompt(plasticovConfig);
    expect(p1).toBe(p2);
  });

  it("includes safety policy and write prohibition", () => {
    const prompt = buildStableAgentPrompt(plasticovConfig);
    expect(prompt).toContain("WRITE PROHIBITION");
    expect(prompt).toContain("noMutationExecuted");
  });

  it("includes account context", () => {
    const prompt = buildStableAgentPrompt(plasticovConfig);
    expect(prompt).toContain("Plasticov SPA");
    expect(prompt).toContain("profit goal: 40%");
  });

  it("includes recent memory", () => {
    const prompt = buildStableAgentPrompt(plasticovConfig);
    expect(prompt).toContain("Last session: 2 observations");
  });

  it("differs per seller even with same agent", () => {
    const p1 = buildStableAgentPrompt(plasticovConfig);
    const p2 = buildStableAgentPrompt(maustianConfig);
    expect(p1).not.toBe(p2);
    expect(p1).toContain("Plasticov");
    expect(p2).toContain("Maustian");
  });

  it("changes when account context changes", () => {
    const before = buildStableAgentPrompt(plasticovConfig);
    const after = buildStableAgentPrompt({
      ...plasticovConfig,
      accountContext: "Plasticov SPA — profit goal: 45%, risk level: low",
    });
    expect(before).not.toBe(after);
  });

  it("includes transferable lessons (max 3)", () => {
    const prompt = buildStableAgentPrompt({
      ...plasticovConfig,
      lessons: sampleLessons,
    });
    expect(prompt).toContain("Lessons Learned");
    expect(prompt).toContain("Don't adjust prices on Friday");
    expect(prompt).toContain("Competitor 'DistriPlast'");
    // Non-transferable lesson should NOT appear
    expect(prompt).not.toContain("Plasticov ships slow");
  });

  it("handles empty lessons array gracefully", () => {
    const prompt = buildStableAgentPrompt({
      ...plasticovConfig,
      lessons: [],
    });
    expect(prompt).not.toContain("Lessons Learned");
  });

  it("handles undefined lessons", () => {
    const prompt = buildStableAgentPrompt(plasticovConfig);
    expect(prompt).not.toContain("Lessons Learned");
  });
});

// ── Variable evidence ──────────────────────────────────────────────────────

describe("buildVariableEvidenceBlock", () => {
  it("includes evidence and open questions", () => {
    const block = buildVariableEvidenceBlock(plasticovConfig);
    expect(block).toContain("3 unanswered questions");
    expect(block).toContain("Should we increase prices?");
  });

  it("includes output schema", () => {
    const block = buildVariableEvidenceBlock(plasticovConfig);
    expect(block).toContain("Expected Output");
    expect(block).toContain("noMutationExecuted");
  });

  it("differs with new evidence", () => {
    const b1 = buildVariableEvidenceBlock(plasticovConfig);
    const b2 = buildVariableEvidenceBlock({
      ...plasticovConfig,
      evidence: "5 unanswered questions (aging 24h).",
    });
    expect(b1).not.toBe(b2);
  });

  it("handles empty evidence gracefully", () => {
    const block = buildVariableEvidenceBlock({ ...plasticovConfig, evidence: "" });
    expect(block).toContain("No new evidence");
  });

  it("handles empty questions gracefully", () => {
    const block = buildVariableEvidenceBlock({ ...plasticovConfig, openQuestions: "" });
    expect(block).toContain("No pending questions");
  });
});

// ── Full prompt assembly ───────────────────────────────────────────────────

describe("buildAgentWorkPrompt", () => {
  it("returns stablePrefix, variableEvidence, and both hashes", () => {
    const result = buildAgentWorkPrompt(plasticovConfig);
    expect(result.stablePrefix.length).toBeGreaterThan(100);
    expect(result.variableEvidence.length).toBeGreaterThan(50);
    expect(result.stablePromptHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.evidenceHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("stablePromptHash is consistent for same config", () => {
    const r1 = buildAgentWorkPrompt(plasticovConfig);
    const r2 = buildAgentWorkPrompt(plasticovConfig);
    expect(r1.stablePromptHash).toBe(r2.stablePromptHash);
  });

  it("stablePromptHash changes with account context change", () => {
    const r1 = buildAgentWorkPrompt(plasticovConfig);
    const r2 = buildAgentWorkPrompt({ ...plasticovConfig, accountContext: "Different context." });
    expect(r1.stablePromptHash).not.toBe(r2.stablePromptHash);
  });

  it("evidenceHash changes with new evidence", () => {
    const r1 = buildAgentWorkPrompt(plasticovConfig);
    const r2 = buildAgentWorkPrompt({ ...plasticovConfig, evidence: "New evidence here." });
    expect(r1.evidenceHash).not.toBe(r2.evidenceHash);
  });

  it("seller A and B produce different stablePromptHash", () => {
    const r1 = buildAgentWorkPrompt(plasticovConfig);
    const r2 = buildAgentWorkPrompt(maustianConfig);
    expect(r1.stablePromptHash).not.toBe(r2.stablePromptHash);
  });
});

// ── Full prompt assembly ───────────────────────────────────────────────────

describe("assembleFullPrompt", () => {
  it("assembles stable prefix and variable evidence with cache break separator", () => {
    const prompt = assembleFullPrompt(plasticovConfig);
    expect(prompt).toContain("---");
    expect(prompt).toContain("Plasticov SPA");
    expect(prompt).toContain("3 unanswered questions");
    // Stable part comes before variable part
    const stableIdx = prompt.indexOf("Plasticov");
    const varIdx = prompt.indexOf("3 unanswered questions");
    expect(stableIdx).toBeLessThan(varIdx);
  });
});

// ── Hashing ────────────────────────────────────────────────────────────────

describe("computeHash", () => {
  it("produces deterministic SHA-256", () => {
    expect(computeHash("hello")).toBe(computeHash("hello"));
  });

  it("produces 64-char hex", () => {
    expect(computeHash("test")).toMatch(/^[a-f0-9]{64}$/);
  });

  it("differs for different inputs", () => {
    expect(computeHash("hello")).not.toBe(computeHash("world"));
  });
});
