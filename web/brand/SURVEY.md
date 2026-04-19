# Reflex.md — Core User Survey

> **For anyone who lives in an AI coding agent.** Claude Code, Cursor, Copilot, Windsurf, Aider, Codex — if you ship code with an agent daily, this is for you.

---

## Why we're asking

You've corrected your agent on the same thing more than once. Maybe more than ten times. We call that the **Correction Tax**, and we think it's the single most annoying part of AI-assisted development.

We're building **Reflex.md** — a tool that reads your agent's session history, finds the corrections you keep re-typing, and opens a PR updating your `AGENTS.md` / `CLAUDE.md` / `.cursorrules` so the agent actually learns.

Before we ship, we want to hear from you.

**4 questions. ~90 seconds. No email required.**

---

## The survey

### Q1 — How bad is it, really?

**How often do you catch your AI agent repeating a mistake you've already corrected in a previous session?**

*Single select.*

- [ ] Multiple times a day
- [ ] A few times a week
- [ ] A few times a month
- [ ] Rarely — my instructions file handles it well
- [ ] Never — I don't use AI coding agents often *(we'll exit you here, thanks!)*

---

### Q2 — What do you do about it today?

**When your agent repeats a correction, what's your usual move?**

*Single select — pick the one you do most often.*

- [ ] Re-type the correction in chat and move on
- [ ] Manually edit my `AGENTS.md` / `CLAUDE.md` / `.cursorrules`
- [ ] Revert the commit and re-prompt with more context
- [ ] Switch to a different agent, model, or tool
- [ ] Nothing — I just live with it

---

### Q3 — Would you pay for a fix?

**Imagine a tool that reads your agent's session logs, finds the top 3 corrections you keep repeating this week, and opens a reviewable PR updating your instructions file. One click to merge.**

**What would you pay per month, per repo?**

*Single select.*

- [ ] $0 — only if it's free or open source
- [ ] $1–$9
- [ ] $10–$29
- [ ] $30–$99
- [ ] $100+
- [ ] I'd want my employer / team to pay for it

---

### Q4 — Tell us a story

**Describe the last time your agent made a mistake you'd already corrected.**

What was the mistake? What did you do? How did it feel?

*Free text, ~500 characters. Skippable, but the most useful answer you can give us.*

```
_______________________________________________________________
_______________________________________________________________
_______________________________________________________________
```

---

## Thanks

That's it. If you want early access when we ship, drop your email — otherwise, just hit submit and you're done.

---

## Internal notes (not shown to respondents)

### What each question tells us

| # | Question | Dimension | Decision it informs |
|---|----------|-----------|---------------------|
| 1 | Repeat frequency | Pain severity + volume | Is this daily pain? Ship priority. |
| 2 | Current behavior | Substitute / workaround | Who already maintains instruction files? Validates the wedge. |
| 3 | Price band | Willingness to pay + buyer type | Self-serve pricing vs team/company pricing. |
| 4 | Last mistake | Qualitative + vocabulary | Correction taxonomy validation + landing-page copy. |

### Distribution

- `r/ClaudeAI`, `r/cursor`, `r/LocalLLaMA`, `r/ChatGPTCoding`
- Claude Code Discord, Cursor Discord, Aider Discord
- Twitter/X replies to posts about agents "not listening"
- Hacker News "Show HN" / "Ask HN" adjacent threads
- Personal network: devs shipping 10+ AI-assisted PRs/week
- `entire-cli` users (warm list — they already have the substrate)

### Targets & reading

- Aim for **n ≥ 50** before drawing any conclusions.
- **Segment Q3 by Q1** — only the "daily" and "weekly" cohorts' price signals matter for v1 pricing.
- **Segment Q2 by Q1** — high-frequency respondents who pick "Nothing — I just live with it" are the sharpest wedge; they feel the tax but haven't built their own fix.
- **Mine Q4 verbatim** for landing copy. Real quotes > anything we write.
