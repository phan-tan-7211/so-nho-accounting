---
trigger: always_on
---

# V1 Scope — TT58 Only

V1 của project chỉ hỗ trợ **Thông tư 58/2026/TT-BTC**.

## Đối tượng sử dụng

Cho phép:

- `MICRO_ENTERPRISE` — doanh nghiệp siêu nhỏ, đối tượng áp dụng chính của TT58.
- `HOUSEHOLD_BUSINESS` — hộ kinh doanh chỉ khi người dùng chủ động lựa chọn áp dụng TT58.
- `INDIVIDUAL_BUSINESS` — cá nhân kinh doanh chỉ khi người dùng chủ động lựa chọn áp dụng TT58.

Đối với HKD/CNKD, không được mô tả TT58 là chế độ mặc định. UI phải nói rõ đây là **lựa chọn tự nguyện áp dụng TT58**.

## Ngoài phạm vi V1

Không thêm hoặc khôi phục selector/chế độ cho:

- TT152/2025
- TT133/2016
- TT132/2018
- SME mode
- chế độ kế toán khác

Nếu có dữ liệu cấu hình legacy thuộc chế độ ngoài TT58:

- không tự động convert sang TT58
- không xóa silent
- giữ dữ liệu cho đến khi người dùng xác nhận hồ sơ TT58 mới

## Ngày áp dụng trong app

TT58 có hiệu lực từ `2026-07-01` và áp dụng cho năm tài chính bắt đầu từ ngày hoặc sau ngày này.

App không được cho cấu hình `dataStartDate` trước `2026-07-01` cho hồ sơ TT58.

## Tax Profile

Không tự đoán phương pháp thuế.

Hai chiều cấu hình bắt buộc để xác định bộ sổ:

- VAT: `PERCENT_ON_REVENUE` hoặc `DEDUCTION`
- Thuế thu nhập: `PERCENT_ON_REVENUE` hoặc `TAXABLE_INCOME`

Tên thuế thu nhập trên UI:

- DNSN: Thuế TNDN
- HKD/CNKD: Thuế TNCN

Cho phép trạng thái explicit `UNCONFIGURED`. Chỉ đánh dấu `taxProfileConfigured = true` khi cả hai phương pháp đã được người dùng lựa chọn.

## Book Mapping

Mapping V1:

- VAT `% doanh thu` + thuế thu nhập `% doanh thu` → `S1-DNSN`
- VAT `% doanh thu` + thuế thu nhập `thu nhập tính thuế` → `S2a-DNSN`, `S2b-DNSN`, `S2c-DNSN`, `S2d-DNSN`
- VAT `khấu trừ` + thuế thu nhập `% doanh thu` → `S3a-DNSN`, `S3b-DNSN`
- VAT `khấu trừ` + thuế thu nhập `thu nhập tính thuế` → `S2b-DNSN`, `S2c-DNSN`, `S2d-DNSN`, `S3b-DNSN`

Mapping chỉ xác định **sổ cần áp dụng**, không đồng nghĩa sổ đã được implement.

## Compliance Claims

Không claim:

- full TT58 compliance
- một sổ/báo cáo đã hoàn chỉnh
- nghĩa vụ thuế đã được tính đúng hoàn toàn

cho đến khi projection, validation và regression tests tương ứng đã hoàn tất.
