# AGENTS.md

Guidance for AI coding agents (Claude Code, Codex, etc.) working in this repo.

## Project

YaJai (ยาใจ) is a student project: an ESP32 pill dispenser + mobile app + LINE bot that escalates missed doses
to family. Source of truth for behaviour and dimensions: `YaJai_Project_Proposal_v1.0.pdf` (kept outside the repo).
The team is three M.4 students and a teacher with no tech background; the software advisor owns the software side.

## Layout

- `apps/web-prototype` — React 19 + TypeScript (strict) + Vite + three.js. Team-facing prototype web.
- `packages/*` — shared code (not created yet). Planned: Firebase contract types, round/escalation logic.

## Conventions

- Package manager: pnpm workspaces. Run `pnpm build` before committing; it typechecks every app.
- UI copy is Thai. Keep it plain and friendly; the audience is students and their teacher.
- Fonts: `Inter Variable` for Latin, `Anuphan` for Thai glyphs (Inter has no Thai). Both come from @fontsource.
- Colours: teal `#0E6A65`, warm cream background `#F6F2EA`, orange `#E07A2F` for state/selection, sun `#F2C14E`.
- 3D scene units: 1 unit = 10 mm. Body is 22 × 15 × 22 units (220 × 220 × 150 mm).
- Part data (names, specs, pins, roles) lives only in `src/exploded/parts.ts`. ESP32 pin numbers must match
  section 8.4 of the proposal.
- Keep the scene light enough for phones: avoid `transmission` materials and post-processing passes.
- Respect `prefers-reduced-motion` (DeviceScene shortens tweens and disables auto-rotate).
- Debug: open the page with `?debug` to get the scene instance on `window.__yajai`.
