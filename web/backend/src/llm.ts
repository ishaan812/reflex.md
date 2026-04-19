import { GoogleGenAI, Type } from "@google/genai";
import { z } from "zod";
import type {
  CorrectionCluster,
  ProposedEdit,
  ReasoningItem,
} from "./types.js";

// Primary default was `gemini-3.1-flash`, which 404s at the time of writing —
// PLAN_V1.md documents this. Default to the known-good 2.5-flash so we don't
// pay a failed-call latency tax on every request. Override with GEMINI_MODEL.
const PRIMARY = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const FALLBACKS = ["gemini-1.5-flash"];

const SYSTEM_PROMPT = `You are Reflex.md's instruction optimizer.
Your job: propose minimal, high-signal edits to an AGENTS.md / CLAUDE.md file
so an AI coding agent makes fewer of the mistakes shown in the evidence.

RULES:
1. Never propose source-code changes. Only edit the target markdown file.
2. Every new or changed rule must cite at least one checkpoint ID from the evidence.
3. Prefer rewriting an existing weak rule over adding a new one.
4. Do not delete section headers without replacement.
5. Keep the tone of the existing file; match its header style.
6. Output STRICT JSON matching the schema. No prose outside JSON.`;

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    afterText: { type: Type.STRING },
    reasoning: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          rule: { type: Type.STRING },
          checkpointIds: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          evidenceText: { type: Type.STRING },
        },
        required: ["rule", "checkpointIds", "evidenceText"],
      },
    },
  },
  required: ["afterText", "reasoning"],
};

// Runtime schema mirroring RESPONSE_SCHEMA. Used to reject malformed LLM
// output before it reaches the PR renderer.
const ReasoningItemZ = z.object({
  rule: z.string().min(1),
  checkpointIds: z.array(z.string()),
  evidenceText: z.string(),
});

const OptimizerResponseZ = z.object({
  afterText: z.string().min(1),
  reasoning: z.array(ReasoningItemZ).default([]),
});

export interface OptimizeInput {
  targetFile: string;
  currentText: string;
  clusters: CorrectionCluster[];
  evidenceSessions: Array<{
    checkpointId: string;
    strategy: string;
    samplePrompts: string[];
  }>;
}

export async function optimizeInstructionFile(
  input: OptimizeInput,
): Promise<ProposedEdit> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");
  const ai = new GoogleGenAI({ apiKey });

  const userPrompt = buildUserPrompt(input);
  const models = [PRIMARY, ...FALLBACKS.filter((m) => m !== PRIMARY)];
  const validCheckpointIds = new Set(
    input.evidenceSessions.map((s) => s.checkpointId),
  );

  let lastErr: unknown;
  for (const model of models) {
    try {
      const resp = await ai.models.generateContent({
        model,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
          temperature: 0.2,
        },
        contents: userPrompt,
      });
      const text = (resp as any).text ?? "";
      if (!text) throw new Error(`model ${model} returned empty text`);
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch (e) {
        throw new Error(
          `model ${model} returned non-JSON: ${(e as Error).message}`,
        );
      }
      const parseResult = OptimizerResponseZ.safeParse(json);
      if (!parseResult.success) {
        throw new Error(
          `model ${model} schema validation failed: ${parseResult.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ")}`,
        );
      }
      const parsed = parseResult.data;

      // Enforce SYSTEM_PROMPT rule #2: every reasoning item must cite at
      // least one evidence checkpoint. Filter out hallucinated citations
      // and drop items that cite none of the real evidence.
      const reasoning: ReasoningItem[] = parsed.reasoning
        .map((r) => ({
          rule: r.rule,
          checkpointIds: r.checkpointIds.filter((id) =>
            validCheckpointIds.has(id),
          ),
          evidenceText: r.evidenceText,
        }))
        .filter((r) => r.checkpointIds.length > 0);
      const droppedCount = parsed.reasoning.length - reasoning.length;
      if (droppedCount > 0) {
        console.warn(
          `[llm] dropped ${droppedCount} reasoning item(s) with no valid checkpoint citation (model=${model})`,
        );
      }

      console.log(`[llm] optimized via ${model}`);
      return {
        targetFile: input.targetFile,
        afterText: parsed.afterText,
        reasoning,
      };
    } catch (e) {
      console.warn(
        `[llm] model ${model} failed: ${(e as Error).message}`,
      );
      lastErr = e;
    }
  }
  throw new Error(
    `all Gemini models failed: ${(lastErr as Error)?.message ?? "unknown"}`,
  );
}

function buildUserPrompt(input: OptimizeInput): string {
  return [
    `CURRENT ${input.targetFile}:`,
    "---",
    input.currentText || "(file does not exist yet; create a concise AGENTS.md from scratch)",
    "---",
    "",
    "TOP CORRECTION CLUSTERS (highest-signal first):",
    JSON.stringify(input.clusters, null, 2),
    "",
    "EVIDENCE SESSIONS (checkpointId → sample user prompts):",
    JSON.stringify(input.evidenceSessions, null, 2),
    "",
    `Produce the optimized ${input.targetFile} per the response schema.`,
    "Remember: every new/changed rule must cite at least one checkpointId from the evidence above.",
  ].join("\n");
}
