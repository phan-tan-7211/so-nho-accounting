Bạn là senior full-stack engineer, product architect và QA agent.

Tôi muốn xây một ứng dụng sổ sách kế toán cực đơn giản, mobile-first,
dùng chủ yếu trên điện thoại Android.

Mục tiêu hiện tại:
- WEB/PWA trước.
- KHÔNG làm Android native.
- KHÔNG cài hoặc sử dụng Android Studio ở giai đoạn này.
- KHÔNG dùng cloud/backend ở V1.
- KHÔNG làm đăng nhập nhiều người.
- Dữ liệu lưu local trên thiết bị.
- Sau này app phải có thể bọc bằng Capacitor thành Android APK.

==============================
PHASE 0 - KIỂM TRA MÔI TRƯỜNG
==============================

Trước khi code:

1. Kiểm tra:
   - Node.js
   - npm
   - Git

2. Báo phiên bản đang có.

3. Nếu thiếu dependency cấp project thì được cài.
   Không tự ý cài phần mềm hệ thống lớn.

4. Không cài Android Studio.
5. Không cài Android SDK.
6. Không tạo project Android.

Sau đó lập kế hoạch implementation ngắn gọn
và cho tôi xem trước khi triển khai.

==============================
TECH STACK
==============================

Dùng:

- React
- TypeScript
- Vite
- PWA
- vite-plugin-pwa
- Dexie + IndexedDB
- Zod để validate dữ liệu
- Vitest cho unit tests
- CSS mobile-first

Ưu tiên dependency ít và ổn định.

Không dùng:
- Next.js
- Firebase
- Supabase
- PostgreSQL
- server riêng
- Docker
- Android Studio
- Capacitor ở V1

==============================
NGUYÊN TẮC KIẾN TRÚC
==============================

Transaction là SOURCE OF TRUTH.

Không lưu cùng một nghiệp vụ thành nhiều bản sao
chỉ để phục vụ nhiều báo cáo.

Data model ban đầu:

accounts
categories
partners
transactions
attachments
audit_logs
period_locks
settings

Transaction types tối thiểu:

INCOME
EXPENSE
TRANSFER
CAPITAL_CONTRIBUTION
REFUND
ADJUSTMENT

==============================
ACCOUNTING INVARIANTS
==============================

Các quy tắc sau phải được viết thành unit test:

1. Transfer giữa hai tài khoản:
   - tài khoản nguồn giảm
   - tài khoản đích tăng
   - tổng tiền không đổi
   - không tạo doanh thu
   - không tạo chi phí

2. Góp vốn:
   - tiền tăng
   - vốn chủ sở hữu tăng
   - không phải doanh thu

3. Quỹ tiền mặt -> tài khoản ngân hàng:
   - là TRANSFER
   - không phải doanh thu
   - không phải chi phí

4. Ngân hàng -> quỹ tiền mặt:
   - là TRANSFER
   - không phải doanh thu
   - không phải chi phí

5. VAT:
   - lưu riêng
   - VAT đầu ra không cộng vào doanh thu
   - VAT đầu vào không tự động coi toàn bộ là chi phí

6. Transaction đã POSTED:
   - không hard delete
   - không overwrite âm thầm
   - sửa bằng reversal/adjustment
   - lưu audit log

7. Kỳ đã LOCK:
   - không cho sửa transaction trực tiếp.

==============================
MVP UI
==============================

Thiết kế mobile-first, ưu tiên điện thoại 360-430px.

Bottom navigation:

1. Tổng quan
2. Giao dịch
3. nút "+"
4. Sổ sách
5. Cài đặt

Nút "+" mở:

THU
CHI
CHUYỂN TIỀN

--------------------------------

THU:

- ngày
- số tiền
- tài khoản nhận
- khách hàng
- loại thu
- nội dung
- giá trị trước VAT
- VAT %
- VAT amount tự tính
- tổng thanh toán
- số hóa đơn
- ghi chú

--------------------------------

CHI:

- ngày
- số tiền
- tài khoản chi
- nhà cung cấp
- loại chi
- nội dung
- giá trị trước VAT
- VAT %
- số hóa đơn
- ghi chú

--------------------------------

CHUYỂN TIỀN:

- tài khoản nguồn
- tài khoản đích
- số tiền
- phí ngân hàng nếu có
- nội dung

==============================
TÀI KHOẢN TIỀN MẶC ĐỊNH
==============================

Tạo demo:

Tiền mặt
Ngân hàng

Không hard-code tên ngân hàng.

Cho phép người dùng tự thêm tài khoản ngân hàng.

==============================
SỔ SÁCH V1
==============================

Từ transactions sinh các view:

S2b
- doanh thu
- chi phí

S2d
- tiền mặt
- tiền gửi ngân hàng

S3b
- VAT đầu vào
- VAT đầu ra

S4d
- vốn chủ sở hữu

Các sổ là VIEW/query từ transaction.
Không tạo database riêng cho từng sổ.

==============================
BACKUP
==============================

Phải có:

EXPORT BACKUP

Xuất toàn bộ dữ liệu thành JSON có version schema.

RESTORE BACKUP

- kiểm tra schema
- validate bằng Zod
- preview trước khi restore
- không overwrite dữ liệu âm thầm

V1 chưa sync cloud.

==============================
PWA
==============================

App phải:

- installable
- có manifest
- có icon placeholder tự tạo
- chạy standalone
- hỗ trợ offline
- reload khi mất mạng vẫn mở được
- không phụ thuộc backend

==============================
UX
==============================

Tư duy giống app sổ thu chi:

Người dùng nhập nghiệp vụ đời thường.
Logic kế toán chạy phía sau.

Không hiển thị Nợ/Có trên màn hình nhập liệu.

Một nghiệp vụ bình thường phải nhập được rất nhanh.

Thiết kế touch target phù hợp điện thoại.

Không clone giao diện hay asset của sản phẩm thương mại nào.

==============================
DEMO DATA
==============================

Tạo dữ liệu demo:

Tài khoản:
- Tiền mặt: 10.000.000
- Ngân hàng: 20.000.000

Giao dịch:

1.
Thu dịch vụ:
5.000.000 trước VAT
VAT 8%
nhận vào Ngân hàng

Kết quả:
doanh thu +5.000.000
VAT đầu ra +400.000
ngân hàng +5.400.000

2.
Chuyển 2.000.000:
Ngân hàng -> Tiền mặt

Kết quả:
Ngân hàng -2.000.000
Tiền mặt +2.000.000
doanh thu và chi phí không thay đổi.

3.
Góp vốn 10.000.000 vào Tiền mặt.

Kết quả:
Tiền mặt +10.000.000
Vốn chủ sở hữu +10.000.000
Doanh thu không đổi.

==============================
QUALITY GATES
==============================

Sau khi implement:

1. npm test phải pass.
2. npm run build phải pass.
3. không có TypeScript error.
4. mở app bằng Browser Agent.
5. viewport Android khoảng 390x844.
6. tự tạo các giao dịch demo.
7. kiểm tra số dư.
8. kiểm tra S2b/S2d/S3b/S4d.
9. kiểm tra reload offline.
10. chụp screenshot kết quả.

Nếu phát hiện lỗi:
tự sửa rồi chạy lại test.

==============================
DOCUMENTATION
==============================

Tạo:

README.md
docs/architecture.md
docs/accounting-rules.md
docs/data-model.md
docs/roadmap.md

Trong roadmap ghi rõ:

V1 = PWA local-first
V2 = attachments + PDF/CSV export
V3 = Capacitor Android
V4 = optional cloud sync

==============================
QUAN TRỌNG
==============================

Không cố làm toàn bộ sản phẩm trong một lần.

Trước tiên:
1. kiểm tra môi trường
2. lập plan
3. tạo architecture/data model
4. scaffold project
5. làm transaction engine + tests
6. sau đó mới làm UI

Mỗi phase xong phải chạy test trước khi chuyển phase tiếp theo.

Bây giờ hãy bắt đầu bằng PHASE 0 và kế hoạch.
Chưa code cho tới khi đã trình bày kế hoạch.