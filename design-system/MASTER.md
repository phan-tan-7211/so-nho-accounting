# So Nho Accounting — UI/UX Pro Max Design System

Source guidance: `nextlevelbuilder/ui-ux-pro-max-skill` (financial dashboard + mobile-first React guidance).

## Product character

- Product: Vietnamese micro-accounting PWA
- Primary device: Android phone, 360–430px viewport
- UX goal: fast daily bookkeeping with high trust and low cognitive load
- Visual direction: Minimalism / Swiss-style clarity with a restrained financial-dashboard treatment
- Avoid: crypto/neon styling, decorative gradients, excessive glass effects, dense desktop tables on mobile

## Core principles

1. Accounting clarity beats visual novelty.
2. One dominant primary action per screen.
3. Show business language in Vietnamese; avoid unnecessary debit/credit terminology in normal entry flows.
4. Use semantic status labels, not color alone.
5. Touch targets should be at least 44px and separated enough to avoid mis-taps.
6. Body text starts at 16px on mobile.
7. Bottom navigation has at most 5 destinations and respects device safe areas.
8. All icon-only controls require accessible names and visible focus states.
9. Respect `prefers-reduced-motion`.
10. Money figures use tabular numerals.

## Color system

Use semantic tokens only in components.

- `--color-bg`: #F5F7FB
- `--color-surface`: #FFFFFF
- `--color-surface-soft`: #F0F4FA
- `--color-text`: #152033
- `--color-text-muted`: #637083
- `--color-border`: #DDE3EC
- `--color-primary`: #0B5ED7
- `--color-primary-strong`: #0849A9
- `--color-primary-soft`: #E8F1FF
- `--color-success`: #16803D
- `--color-success-soft`: #EAF7EF
- `--color-danger`: #C93434
- `--color-danger-soft`: #FDECEC
- `--color-warning`: #9A6700
- `--color-warning-soft`: #FFF4D6

For finance screens, green/red must always be accompanied by text/icon context.

## Typography

- Font family: system UI stack for reliability and offline-first behavior.
- Display: 28/34, 700
- Screen title: 22/28, 700
- Section title: 18/24, 650
- Body: 16/24, 400
- Supporting text: 14/20, 400
- Label: 13/18, 600
- Money: 20/26, 700, `font-variant-numeric: tabular-nums`

## Spacing

Base spacing follows 4/8px rhythm:

- 4, 8, 12, 16, 20, 24, 32, 40
- Page horizontal padding: 16px at 360–430px
- Card padding: 16px
- Card radius: 16px
- Primary button height: 52px
- Standard touch control minimum height: 44px

## Elevation

Keep elevation quiet and consistent.

- Level 0: flat surface
- Level 1: `0 1px 2px rgba(17, 24, 39, 0.05)`
- Level 2: `0 8px 24px rgba(17, 24, 39, 0.08)`

Do not mix unrelated shadow styles.

## Navigation

Bottom navigation order:

1. Tổng quan
2. Giao dịch
3. `+` quick action
4. Sổ sách
5. Cài đặt

Rules:

- Fixed to bottom with safe-area padding.
- Active destination has icon + text emphasis.
- `+` is a visually dominant circular action but must still have an accessible label.
- Main content reserves enough bottom padding so navigation never obscures focus/content.

## Dashboard pattern

Priority order on mobile:

1. Current total cash/bank balance
2. Month income / expense summary
3. Quick actions: Thu, Chi, Chuyển tiền
4. Recent transactions
5. Secondary bookkeeping insights

Avoid large desktop-style charts in the first viewport. Use compact summary cards first.

## Forms

- Visible labels; never placeholder-only labels.
- Money amount is the first prominent field for Thu/Chi.
- Group VAT into a secondary section to reduce initial cognitive load.
- Validation message appears next to the field.
- Async submission disables the main button and provides immediate feedback.
- Destructive reversal/correction actions are visually separated from normal edit flows.

## Responsive rules

- Primary design widths: 360, 390, 430px.
- Must not horizontally scroll.
- At >=768px, center app content and allow a wider two-column dashboard where useful.
- Do not simply stretch mobile cards to full desktop width.

## Motion

- Motion is functional and short.
- Use opacity/transform rather than width/height animation.
- Disable or greatly reduce non-essential movement under `prefers-reduced-motion: reduce`.

## Accessibility checklist

- Contrast >=4.5:1 for normal text.
- Visible `:focus-visible` rings.
- Icon-only buttons have `aria-label`.
- Decorative SVG is `aria-hidden`.
- Touch controls >=44px.
- Do not encode transaction meaning by red/green alone.
- Content remains usable with enlarged text and at 360px width.

## UI delivery checklist

Before marking a UI phase done:

- Test 360px and 390x844 layouts.
- No horizontal overflow.
- Bottom navigation does not cover content or keyboard focus.
- Form labels and errors remain visible.
- Keyboard navigation has visible focus.
- Reduced-motion path exists.
- Run project tests, build, and lint.
