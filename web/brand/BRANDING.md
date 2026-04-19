# Branding

## Name

**Reflex.md**

- The period is part of the name. Treat it as a single token — don't break across lines.
- GitHub App handle: `reflex-md` (GitHub handles don't allow periods; the display name does).
- Domain target: `reflex.md` (the `.md` ccTLD for Moldova doubles as a markdown pun; Reflex lives in markdown files).

## Tagline — options

Pick one for the landing page; the others can live in secondary copy.

1. **"Instructions that learn from your mistakes."** *(recommended — plainspoken, mechanism-revealing)*
2. "Stop re-typing corrections. Ship a PR instead."
3. "Your `AGENTS.md`, written by the mistakes your agents made."
4. "Self-healing instructions for AI-assisted repos."

## Voice & tone

- **Direct. Dry. Engineer-to-engineer.** No marketing froth, no "unlock the power of AI".
- Use concrete nouns: *correction*, *retry*, *revert*, *prompt*, *token*. Not *friction*, *pain point*, *synergy* — unless the metric literally has that name ("Friction Quotient").
- Weight examples over abstractions. If a sentence can be replaced by a `diff` block or a JSON snippet, replace it.
- **Name the enemy:** the Correction Tax. Use the phrase liberally in landing copy.
- Never talk down to the user. They run `entire-cli`. They know what a shadow branch is.

## Don't

- Don't personify the product ("Reflex thinks you should…"). It proposes; the user decides.
- Don't claim "AI that writes itself." We generate small, auditable edits with citations.
- Don't use emoji in product copy (fine in chat, fine here in brand docs' asides — not on the surface).
- Don't describe Reflex as a "dashboard." Every screen drives toward a PR.

## Visual tokens (deferred — Phase 2)

Ship Phase 1 in monochrome + one accent. Full visual system lives in Phase 2.

- **Accent (working):** a deep red for corrections / friction. (`#B91C1C`-ish; tune against the shadcn defaults.)
- **Neutrals:** shadcn's `zinc` ramp. No custom palette until after MVP.
- **Type:** system UI + a mono face (JetBrains Mono or Geist Mono) for transcript content. No custom type in MVP.
- **Iconography:** lucide-react. No custom icons in MVP.

## Logo placeholder

A cursor caret `│` next to a checkmark `✓`, both in the accent red, on a zinc-950 background. Ship an SVG placeholder; revisit in Phase 2.

## Naming internals

- The shadow branch is always **`entire/checkpoints/v1`**. Never shorten to "the entire branch" in copy (ambiguous with "entire" = "whole").
- A single run is a **session**. A session lives inside a **checkpoint**. A group of related corrections across sessions is a **cluster**.
- The thing we propose is an **instruction update**, not a "suggestion" or a "fix".
- A PR we opened is a **Reflex PR**. Branch name pattern: `reflex/update-<targetFile>-<shortAnalysisId>`.

Terms have one-line definitions in [`GLOSSARY.md`](./GLOSSARY.md).
