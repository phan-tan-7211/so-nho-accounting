---
trigger: always_on
---

# Project Core Rules

Project: Vietnamese Micro Accounting PWA.

## Core Stack

- React
- TypeScript
- Vite
- Dexie + IndexedDB
- Zod
- Vitest
- PWA
- Local-first
- Mobile-first, ưu tiên viewport 360–430px

Không đưa vào V1 nếu chưa có yêu cầu rõ ràng:

- Next.js
- Firebase
- Supabase
- PostgreSQL
- backend server
- Docker
- Android Studio
- Android SDK
- Capacitor
- cloud sync
- multi-user authentication

## Architecture Principles

Không rebuild project từ đầu.

Trước khi sửa kiến trúc:

1. Đọc implementation hiện tại.
2. Kiểm tra `git status` và `git diff`.
3. Xác định behavior đang hoạt động.
4. Bảo toàn dữ liệu người dùng.
5. Ưu tiên migration/backward compatibility thay vì xóa dữ liệu.

Accounting correctness quan trọng hơn UI convenience.

Transaction đại diện cho một economic/business event, không chỉ là cash movement.

Không được giả định:

- cash received = revenue
- cash paid = expense

Không expose Debit/Credit trực tiếp trong form nhập liệu thông thường.

## Source of Truth

Transaction là nguồn dữ liệu nghiệp vụ chính.

Balances, books và reports phải được derive/project từ transaction/effects.

Không dùng `account.balance` làm accounting source of truth.

Không tạo duplicate business transaction chỉ để phục vụ report.

## Transaction Lifecycle

Các trạng thái chính:

- DRAFT
- POSTED
- REVERSED

DRAFT:

- có thể edit
- có thể delete

POSTED:

- không hard delete
- không silent overwrite
- correction phải thông qua reversal hoặc adjustment
- phải bảo toàn audit history

REVERSED:

- transaction gốc vẫn tồn tại
- reversal phải liên kết với transaction gốc

## Period Lock

Transaction trong kỳ đã LOCKED không được sửa trực tiếp.

Không:

- post transaction mới vào kỳ locked
- edit posted transaction trong kỳ locked
- delete posted transaction trong kỳ locked
- post reversal vào kỳ locked

Correction có thể được tạo trong kỳ OPEN phù hợp với accounting policy.

## Master Data

Account, Category, Partner chưa từng được reference:

- có thể hard delete nếu an toàn

Nếu đã từng được historical transaction reference:

- không hard delete
- archive/deactivate
- vẫn phải resolve được trong lịch sử

Không bao giờ xóa historical transactions chỉ để xóa account/category/partner.

## Money

Tiền VND persisted phải là integer.

Không rải logic rounding trong UI.

Các calculation quan trọng như VAT phải được centralized và deterministic.

## Git Safety

NEVER run without explicit user approval:

- `git clean`
- `git clean -fd`
- `git reset`
- `git reset --hard`
- `git restore`
- `git restore .`
- `git checkout -- .`
- command xóa untracked files
- command revert toàn bộ working tree
- command xóa dữ liệu project

Trước bất kỳ destructive Git operation nào:

STOP và hỏi user.

Không tự động rollback cả repository.

Không overwrite unrelated user changes.

## TypeScript Safety

Không tắt:

- `strict`
- `noImplicitAny`

chỉ để build pass.

Không dùng bừa:

- `any`
- `@ts-ignore`
- `@ts-expect-error`

để che lỗi implementation.

## Quality Gate

Trước khi hoàn thành một phase:

- `npm test`
- `npm run build`
- `npm run lint` nếu project có script lint

Không tuyên bố phase hoàn thành nếu test/build đang fail do thay đổi của phase đó.

## Language

UI hướng tới người dùng Việt Nam:

- UI copy ưu tiên tiếng Việt
- code identifiers ưu tiên English
- tránh terminology kế toán kỹ thuật không cần thiết trong form nhập liệu