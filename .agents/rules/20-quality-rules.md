---
trigger: always_on
---

# Quality Rules

## Baseline Before Refactor

- inspect `git status`
- inspect `git diff`
- chạy existing tests
- chạy build
- xác định lỗi cũ và lỗi mới

Không sửa unrelated code.

## Required Quality Gates

- TypeScript errors = 0
- `npm test` = PASS
- `npm run build` = PASS
- `npm run lint` = PASS nếu có

Không báo PASS nếu chưa chạy command.

## TypeScript

Không disable:

- `strict`
- `noImplicitAny`

Không dùng bừa:

- `any`
- `@ts-ignore`
- `@ts-expect-error`

## Accounting Tests

Phải có regression tests cho:

- transfer
- capital contribution
- sale paid immediately
- credit sale
- customer payment
- purchase credit
- supplier payment
- customer refund
- supplier refund
- VAT
- reversal
- period lock
- opening balance migration
- migration idempotency

## Database Migration

Sau Dexie schema change:

- test migration
- preserve existing user records
- không reset DB phá dữ liệu
- verify legacy balance preservation
- verify migration idempotency
- verify malformed legacy handling

## Backup / Restore

Backup phải có schema version.

Restore flow:

```text
parse
→ Zod validate
→ detect schema version
→ migrate supported version
→ preview
→ explicit confirmation
→ restore
→ validate result
```

Không silent overwrite.

## UI Quality

Kiểm tra mobile:

- 360px
- 390x844
- no horizontal overflow
- touch targets hợp lý
- form labels rõ
- modal usable
- keyboard không che controls quan trọng
- bottom navigation safe

## PWA

Chỉ claim offline sau khi test production build:

1. build production
2. load online
3. cache app shell
4. chuyển offline
5. reload
6. app vẫn mở

## Claims

Không claim:

- full TT58 compliance nếu chưa verify
- B01/B02 complete nếu chưa đủ dữ liệu
- unsupported books complete
- WCAG AAA nếu chưa verify đầy đủ
- local-only = tuyệt đối không leak dữ liệu

## Phase Completion

Một phase chỉ complete khi:

- scope hoàn thành
- tests pass
- build pass
- migration risk được report
- không tự chạy phase tiếp theo nếu prompt yêu cầu STOP
