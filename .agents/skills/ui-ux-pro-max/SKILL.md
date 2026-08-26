---
name: ui-ux-pro-max
description: UI/UX design intelligence for this accounting PWA. Use when designing, building, reviewing, or fixing interfaces, components, accessibility, responsive behavior, typography, color, interaction, forms, navigation, and dashboards.
---

# UI UX Pro Max — Project Integration

This project uses the methodology from:

- Upstream: `nextlevelbuilder/ui-ux-pro-max-skill`
- Integrated against CLI version: `ui-ux-pro-max-cli@2.5.0`
- Platform mode: Universal / Agent Standard (`.agents/skills/`)

## Required project context

Before UI work, read:

1. `design-system/MASTER.md`
2. `.agents/rules/00-project-rules.md`
3. `.agents/rules/20-quality-rules.md`

For accounting-sensitive UI, also read `.agents/rules/10-accounting-tt58.md`.

## Upstream full-skill install

The full searchable UI UX Pro Max dataset/scripts should not be vendored manually into this application repository.

Install/update the official Universal skill locally with:

```bash
npm run uiux:init
```

Equivalent official command:

```bash
npm exec --yes --package ui-ux-pro-max-cli -- uipro init --ai universal
```

This installs the upstream skill into `.agents/skills/ui-ux-pro-max` using its official CLI templates.

## Project application rules

- Treat this product as a financial/accounting dashboard, not a crypto product.
- Prefer minimal, trustworthy, data-clear UI over decorative effects.
- Design mobile-first for 360–430px.
- Bottom navigation must remain at 5 destinations or fewer.
- Normal touch targets should be at least 44px.
- Body text should be at least 16px on mobile.
- Use semantic color tokens; never rely on red/green alone for meaning.
- Use SVG icons rather than emoji icons.
- Icon-only controls require accessible names.
- Visible focus states are required.
- Respect `prefers-reduced-motion`.
- Use tabular numerals for money/data.
- Keep core accounting terminology understandable in Vietnamese.
- Do not expose debit/credit in routine data-entry UX unless explicitly required.

## Design-system persistence

`design-system/MASTER.md` is the project-level source of truth for visual tokens, component behavior, navigation, forms, responsiveness, motion, and accessibility.

If a page later needs an intentional exception, add:

`design-system/pages/<page-name>.md`

Page rules override `MASTER.md` only for that page.
