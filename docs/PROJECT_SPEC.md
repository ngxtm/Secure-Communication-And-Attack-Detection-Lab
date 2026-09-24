# Secure Communication & Attack Detection Lab — MVP Specification

- Phiên bản: 1.4
- Cập nhật: 2026-09-24
- Trạng thái: Đặc tả MVP đã thống nhất
- Mục đích: Project mô phỏng phục vụ học tập và thuyết trình môn Network Security

## 1. Tóm tắt

Secure Communication & Attack Detection Lab là một ứng dụng web cho phép Alice gửi file cho Bob, quan sát các lớp bảo vệ dữ liệu, chạy những tình huống tấn công có kiểm soát trong lab riêng và xem kết quả trên security dashboard.

Project minh họa riêng biệt:

- TLS bảo vệ kết nối giữa client và server.
- AES-256-GCM bảo vệ nội dung file.
- RSA-OAEP bọc AES key cho người nhận.
- Argon2id bảo vệ password đã lưu.
- Hash và HMAC minh họa các mức kiểm tra integrity.
- Replay protection, brute-force detection và rate limiting minh họa việc phát hiện request lặp hoặc bất thường.

Đây là lab giáo dục, không phải thiết kế production-ready. Các thuật toán được gọi qua thư viện chuẩn; project không tự cài đặt primitive mật mã.

## 2. Mục tiêu và phạm vi

### Mục tiêu

1. Cho thấy dữ liệu mẫu có thể đọc được trong HTTP thử nghiệm và được bảo vệ khi dùng HTTPS.
2. Gửi file sao cho API chỉ nhận và lưu envelope đã mã hóa; Bob giải mã ở client.
3. Phát hiện sửa đổi ciphertext bằng AES-GCM authentication tag.
4. Phân biệt hash thường, HMAC và mã hóa.
5. Phát hiện request replay, đăng nhập sai liên tục và request rate vượt ngưỡng.
6. Ghi security events đã loại bỏ bí mật và hiển thị chúng trên dashboard.

### Ngoài phạm vi MVP

- Dùng cho dữ liệu thật hoặc triển khai production.
- Bảo vệ thiết bị client đã bị xâm nhập, private key bị lấy cắp hoặc password bị lộ.
- Chống DoS trên Internet hoặc phát lưu lượng lớn.
- Xây dựng IDS phân tích packet/network ở mức đầy đủ.
- Khôi phục private key sau khi mất hoặc đồng bộ private key giữa thiết bị.
- Chữ ký số và bằng chứng non-repudiation của người gửi.
- Chạy malware thật.

## 3. Threat model

### Tài sản cần bảo vệ

- Nội dung file trước và sau giải mã.
- Password, session cookie và private key.
- Tính toàn vẹn và tính mới của file/request.
- Security events và dữ liệu người dùng.

### Năng lực của attacker trong lab

- Nghe lén một luồng HTTP thử nghiệm có dữ liệu giả.
- Sửa hoặc gửi lại một envelope/request đã ghi nhận trong lab.
- Thử đăng nhập nhiều lần bằng thông tin giả.
- Gửi request tới demo endpoint trong giới hạn của simulator.

### Giả định và giới hạn

- Alice và Bob chạy client trên thiết bị đáng tin cậy; client không bị malware chiếm quyền.
- Private key của người nhận chỉ tồn tại ở client.
- Public key của Bob được xác minh bằng fingerprint qua một kênh độc lập trong quá trình setup demo.
- Backend lưu được metadata như sender, recipient, thời gian và kích thước envelope; nội dung file và tên file nằm trong payload mã hóa.
- HTTP plaintext chỉ dùng cho chuỗi giả trên mạng nội bộ của Docker Compose; không gửi password, session hay file thật qua HTTP.
- TLS là bắt buộc cho luồng ứng dụng thông thường. Cùng một Docker Compose stack được dùng khi chạy local và khi deploy lên Dokploy; khác biệt chỉ nằm ở cấu hình runtime như domain, HTTPS và secrets.

## 4. Kiến trúc

    Alice / Bob Web Client
             │
             │ HTTPS
             ▼
      Backend API
      ├── Authentication
      ├── File Transfer
      ├── Replay Guard
      ├── Rate Limiting
      └── Security Event Logging
           │                 │
           ▼                 ▼
       PostgreSQL       Detection Rules
                              │
                              ▼
                       Security Dashboard

    Attack Simulator ─────────► Backend API

MVP dùng một backend với các module nội bộ; chưa tách thành microservices. Attack Simulator là giao diện điều khiển các request thử nghiệm có giới hạn. Detection Rules xử lý application-level events do backend và client báo về; đây không phải packet-level network IDS.

Dự án dùng một Docker Compose stack duy nhất gồm Next.js, NestJS và PostgreSQL. Chạy local hoặc deploy lên Dokploy đều dùng cùng định nghĩa stack, cùng schema và cùng Prisma migration flow; mỗi nơi chỉ có một PostgreSQL service riêng của lần chạy đó. NestJS kết nối PostgreSQL qua mạng nội bộ Docker. Không tách backend thành microservices hoặc duy trì cấu hình triển khai thứ hai.

### Thành phần

- **Web Client:** đăng nhập, tạo/nhận envelope, giải mã file, báo kết quả giải mã.
- **Backend API:** kiểm tra session, phân phối public key, lưu envelope, chặn replay, rate limit và ghi event.
- **PostgreSQL:** lưu người dùng, public key/fingerprint, envelope metadata, replay IDs và security events; database chạy trong Docker Compose.
- **Detection Rules:** đếm event theo cửa sổ thời gian, kích hoạt cooldown hoặc rate limit.
- **Dashboard:** hiển thị trạng thái, event counts và lịch sử cảnh báo.
- **Attack Simulator:** giao diện scenario trong ứng dụng, gửi tamper, replay, brute-force và bounded flood tới API của chính stack; yêu cầu tài khoản lab và tuân theo giới hạn cố định. Không cần service attacker riêng.

## 5. Luồng mã hóa và gửi file

### Setup khóa

1. Client của Bob tạo cặp RSA-OAEP key.
2. Bob đăng ký public key với API; private key không được gửi lên server.
3. Client của Alice lấy public key và xác minh fingerprint qua kênh độc lập trong lab.
4. MVP giữ private key trong bộ nhớ của client cho phiên demo. Refresh hoặc đóng tab có thể làm mất key và khiến file demo không giải mã được.

### Gửi file

1. Client của Alice tạo AES-256 key ngẫu nhiên và nonce mới cho lần mã hóa này.
2. Client mã hóa nội dung file cùng tên file bằng AES-256-GCM. Dữ liệu xác định envelope, gồm phiên bản, file ID, sender ID và recipient ID, được đưa vào AAD.
3. Client bọc AES key bằng public key của Bob với RSA-OAEP và SHA-256.
4. Client gửi envelope qua HTTPS.
5. API xác thực session và quyền gửi, kiểm tra file ID/request ID chưa được dùng, rồi lưu ciphertext, wrapped key và metadata.
6. Client của Bob lấy envelope, dùng private key mở AES key rồi giải mã. Nếu ciphertext hoặc tag bị sửa, bước giải mã phải thất bại.

Envelope khái niệm:

    {
      version,
      file_id,
      sender_id,
      recipient_id,
      encrypted_payload,
      wrapped_aes_key,
      nonce,
      request_id
    }

Trong Web Crypto API, AES-GCM ciphertext trả về có authentication tag gắn kèm. Implementation phải ghi rõ cách serialize ciphertext và tag; không tự bỏ tag.

RSA-OAEP trong project là mô hình giáo dục để bọc một AES key. TLS 1.3 là lớp bảo vệ kết nối riêng và không dùng đúng flow RSA key-wrap này. Tài liệu tham chiếu: [RFC 8017](https://www.rfc-editor.org/rfc/rfc8017.html), [RFC 8446](https://www.rfc-editor.org/rfc/rfc8446.html), [NIST SP 800-38D](https://csrc.nist.gov/pubs/sp/800/38/d/final).

## 6. Authentication và session

- Password được hash bằng Argon2id với salt riêng cho từng password, thông qua thư viện đã được duy trì.
- Không lưu plaintext password, không dùng MD5/SHA-256 nhanh để lưu password.
- Sau login, server tạo session opaque; cookie dùng HttpOnly, SameSite và Secure khi kết nối HTTPS.
- Session có thời hạn, logout thu hồi session.
- Ngưỡng mặc định cho demo: 5 lần login sai trong 60 giây cho cùng tài khoản hoặc nguồn thử nghiệm; sau đó cooldown 60 giây. Các giá trị cần cấu hình để dễ trình diễn.
- Chi tiết triển khai theo [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).

Login xác nhận tài khoản/session ở mức ứng dụng. RSA encryption bằng public key của Bob không xác nhận Alice là người gửi. Chữ ký số RSA-PSS có thể bổ sung như phần mở rộng.

## 7. Hash và HMAC demo

Màn hình Crypto Concepts có thể nhận một file mẫu và hiển thị:

- MD5 digest.
- SHA-256 digest.
- HMAC-SHA256 với demo key được tạo cho lab.

Nội dung giải thích:

- Digest SHA-256 chỉ giúp so sánh nội dung nếu digest tham chiếu được bảo vệ; attacker có thể thay file và tính lại digest thường.
- HMAC dùng secret key chung để xác minh message authentication.
- MD5 không phù hợp ở nơi cần collision resistance. Có thể dùng cặp collision dựng sẵn để minh họa; không cần triển khai công cụ tạo collision.
- AES-GCM đã cung cấp tag để kiểm tra ciphertext của luồng gửi file; không thêm HMAC thứ hai vào cùng luồng chỉ để kiểm tra sửa đổi.

Tham chiếu: [RFC 2104 - HMAC](https://www.rfc-editor.org/rfc/rfc2104.html), [RFC 6151 - MD5 security considerations](https://www.rfc-editor.org/rfc/rfc6151.html).

## 8. Replay protection

Mỗi thao tác gửi file có request ID ngẫu nhiên. Server lưu duy nhất cặp user/session và request ID trong thời hạn session. Nếu request đã dùng được gửi lại, server trả 409 REPLAY_DETECTED, không tạo thêm file và ghi security event. File ID cũng có ràng buộc duy nhất để ngăn tạo bản trùng trong database.

AES-GCM nonce và request ID có mục đích khác nhau:

- Nonce bảo đảm yêu cầu của AES-GCM; không được tái sử dụng với cùng key.
- Request ID hỗ trợ phát hiện thao tác ứng dụng bị gửi lại.

Simulator replay một request hợp lệ đã ghi nhận trong lab. Đây là mô phỏng replay ở application layer; TLS bảo vệ record ở transport layer, còn replay guard bảo vệ thao tác nghiệp vụ.

## 9. Attack Simulator và detection rules

| Kịch bản | Hành động | Kết quả kỳ vọng |
|---|---|---|
| HTTP plaintext demo | Gửi chuỗi giả qua lab endpoint | Wireshark có thể đọc payload |
| HTTPS demo | Gửi cùng chuỗi giả qua TLS | Packet capture không đọc được payload ứng dụng |
| Tamper | Sửa ciphertext hoặc tag của envelope | Client không giải mã; event được đánh dấu là client-reported |
| Replay | Gửi lại request ID đã dùng | API trả 409, không tạo file trùng, ghi REPLAY_BLOCKED |
| Brute-force | Gửi password giả liên tiếp | Cooldown/rate limit và AUTH_LOCKED |
| Bounded flood | Gửi request tới demo endpoint theo tốc độ giới hạn | API trả 429 khi vượt ngưỡng; ghi RATE_LIMITED |

Giới hạn simulator: tối đa 10 request/giây và 100 request mỗi lần chạy; chỉ gửi tới API của chính project, không nhận URL đích tùy ý. Scenario cần phiên lab đã đăng nhập và dùng payload giả. Ngưỡng rate limit mặc định cho demo: hơn 20 request trong 5 giây từ cùng nguồn thì cooldown 30 giây.

Tamper xảy ra ở client/envelope mô phỏng. Vì backend không có AES key, backend không tự xác nhận tag của file. Event giải mã thất bại do client gửi lên được đánh dấu là client-reported, không xem là bằng chứng độc lập do server xác minh.

## 10. Security events và dashboard

### Event tối thiểu

- AUTH_LOGIN_SUCCESS
- AUTH_LOGIN_FAILED
- AUTH_LOCKED
- FILE_ENVELOPE_STORED
- FILE_REPLAY_BLOCKED
- FILE_DECRYPTION_FAILED_REPORTED
- RATE_LIMITED
- HASH_DEMO_RUN
- HMAC_DEMO_RUN

### Trường event

- event_id
- event_type
- occurred_at
- actor_id nếu có
- source hoặc scenario
- severity
- details đã lọc

Không ghi password, session token, private key, file plaintext hoặc HMAC secret vào database/log. Dashboard hiển thị tổng event theo thời gian, lần đăng nhập sai, request bị chặn, replay bị từ chối và client báo lỗi giải mã.

## 11. API đề xuất

| Method | Endpoint | Mục đích |
|---|---|---|
| POST | /api/auth/login | Đăng nhập |
| POST | /api/auth/logout | Thu hồi session |
| GET | /api/users/{user_id}/public-key | Lấy public key và fingerprint |
| POST | /api/files | Gửi envelope đã mã hóa |
| GET | /api/files/{file_id} | Bob lấy envelope |
| GET | /api/security/events | Dashboard đọc event, yêu cầu quyền phù hợp |
| POST | /api/lab/scenarios/{scenario} | Chạy scenario trong lab mode |

Tài liệu API được phục vụ bằng Swagger UI tại /docs; bản OpenAPI JSON có thể tải tại /docs-json. Route có thể cấu hình trong NestJS.

Các endpoint dưới /api/lab chỉ cho tài khoản lab/admin đã đăng nhập, áp dụng hard limit và chỉ nhắm tới API của project. Không cho phép chọn host/URL ngoài hoặc tạo flood không giới hạn. Demo HTTP plaintext chỉ nhận chuỗi giả trên mạng nội bộ Docker Compose; không dùng endpoint này cho đăng nhập hay truyền file.

## 12. Tiêu chí hoàn thành MVP

1. Alice gửi file mẫu; Bob giải mã và nhận đúng nội dung.
2. API/database chỉ lưu ciphertext, wrapped AES key và metadata đã nêu; không lưu plaintext file.
3. Sửa ciphertext/tag làm giải mã thất bại.
4. Gửi lại request ID bị từ chối và không tạo envelope trùng.
5. Password lưu bằng Argon2id; đủ số lần login sai sẽ kích hoạt cooldown.
6. Bounded flood kích hoạt rate limit và trả HTTP 429.
7. Dashboard hiển thị các event tạo bởi từng scenario.
8. Packet capture của HTTP lab demo đọc được chuỗi giả; packet capture HTTPS không đọc được payload ứng dụng.
9. Log không chứa password, session token, private key hoặc plaintext file.

## 13. Kế hoạch thực hiện

### Giai đoạn 1 — Skeleton và Authentication

- Khởi tạo frontend Next.js, backend NestJS và PostgreSQL bằng Docker Compose.
- Dùng Prisma ORM 8, lấy các gói mới nhất tương thích tại thời điểm scaffold.
- Dùng một Docker Compose definition, một Prisma schema và một migration flow; không tạo cấu hình hoặc quy trình database riêng cho local và Dokploy.
- Frontend và backend dùng TypeScript; API dùng REST JSON và được mô tả bằng OpenAPI.
- Tạo user seed cho Alice/Bob.
- Hoàn thành Argon2id, session và login event.

### Giai đoạn 2 — Secure file transfer

- Tạo/gắn public key của Bob và hiển thị fingerprint.
- Hoàn thành mã hóa AES-GCM phía client và bọc AES key bằng RSA-OAEP.
- Lưu và tải envelope; kiểm tra tamper trên client.

### Giai đoạn 3 — Attack simulation và dashboard

- Thêm replay guard, brute-force cooldown và bounded rate limiting.
- Thêm scenario controls cùng security events.
- Tạo dashboard tổng hợp kết quả.

### Giai đoạn 4 — Deploy và ổn định trên Dokploy

- Dùng chính Docker Compose definition của project để deploy Next.js, NestJS và PostgreSQL lên Dokploy; không tạo stack hoặc luồng migration riêng.
- Cấu hình domain, HTTPS và secrets trong Dokploy; NestJS kết nối PostgreSQL qua mạng nội bộ Docker.
- Giữ PostgreSQL không publish port ra Internet và bật persistent volume. Thiết lập backup PostgreSQL định kỳ, rồi thử restore một lần.
- Giữ các lab scenarios sau đăng nhập lab/admin với hard limit; không cho phép target bên ngoài hoặc flood không giới hạn.
- Kiểm tra health endpoint, migration status, luồng gửi/nhận file và các scenario chính sau deploy.

### Giai đoạn 5 — Chuẩn bị thuyết trình

- Rehearse theo kịch bản demo ở mục 14.
- Chuẩn bị sơ đồ kiến trúc, luồng mã hóa và bảng “attack → defense → observed result”.
- Nêu rõ giới hạn lab và phân biệt TLS, encryption, integrity, authentication và replay protection.

## 14. Kịch bản trình bày chính

1. Dùng chuỗi giả để so sánh HTTP và HTTPS qua packet capture.
2. Alice gửi file đã mã hóa cho Bob; giải thích AES-GCM và RSA-OAEP.
3. Sửa envelope; Bob không giải mã được vì authentication tag sai.
4. Phát lại request; server phát hiện request ID đã dùng.
5. Chạy login brute-force và bounded flood; quan sát cooldown, HTTP 429 và dashboard.
6. Kết thúc bằng so sánh SHA-256/HMAC và nhấn mạnh hash thường không xác thực người gửi.

## 15. Stack triển khai

- Frontend: Next.js với React và TypeScript.
- Backend: NestJS với TypeScript trên Node.js.
- API: REST JSON; contract theo chuẩn OpenAPI, được NestJS tạo qua @nestjs/swagger và hiển thị/thử bằng Swagger UI tại /docs.
- Database: một PostgreSQL service trong Docker Compose của mỗi lần chạy; cùng schema và migration flow ở local hoặc trên Dokploy.
- ORM: Prisma ORM 8 mới nhất, gồm CLI prisma và PostgreSQL package @prisma/orm-postgres; các package được phát hành riêng nên lấy latest của từng package và commit lockfile để cố định bộ phiên bản đã chọn.
- Trạng thái phát hành: tại ngày 2026-09-24, Prisma ORM 8 vẫn là release candidate; project chủ động chọn bản mới nhất theo yêu cầu, nên cần theo dõi thay đổi API và migration trước khi nâng cấp. Tham khảo [Prisma ORM release status](https://www.prisma.io/docs/orm/release-status).
- Mã hóa phía client: Web Crypto API hoặc thư viện chuẩn được duy trì.
- Password hashing: Argon2id qua thư viện phù hợp.
- Runtime và hosting: một Docker Compose stack duy nhất, dùng để chạy local và deploy lên Dokploy trên server hiện có; không cần thêm dịch vụ cloud của Prisma.
- Kết nối database: NestJS dùng DATABASE_URL trỏ tới service PostgreSQL qua mạng nội bộ Docker. Dùng một luồng cấu hình/migration; secrets runtime được đặt trong Dokploy khi deploy. Không publish port PostgreSQL ra Internet.
- Packet observation: Wireshark, nếu thời gian cho phép.
- Không tự viết thuật toán mã hóa, hash, HMAC hoặc RSA.

