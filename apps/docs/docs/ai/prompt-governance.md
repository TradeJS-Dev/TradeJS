---
title: AI Prompt Governance
---

Treat prompts as versioned runtime artifacts.

## Versioning

- Store prompt changes in code with clear commit history.
- Use explicit changelog notes for behavior-affecting updates.

## Validation

- Evaluate new prompt variants on historical signal samples.
- Compare quality distribution and approval rate shifts.
- Check direction consistency and false reject/accept patterns.

## Safety Controls

- Keep strategy direction constraints explicit in prompt logic.
- Avoid vague instructions that allow unsupported behavior.
- Gate rollout by environment (staging before production).

## Operational Discipline

- Never change prompt and risk parameters blindly in one step.
- Keep rollback-ready previous prompt variant.
