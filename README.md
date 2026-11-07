# AI Team (aimanagement)

Nền tảng điều phối nhiều agent AI theo phòng ban, chạy hoàn toàn trên máy của bạn.
Agent dùng Claude Code, Codex (bằng tài khoản đã đăng nhập) hoặc Custom API.

## Cài đặt và chạy

Cần Node LTS đã vá bảo mật: 22.23.4+, 24.22.1+ hoặc 26.12.1+ ([tải Node](https://nodejs.org/en/download)).

```
npm i -g aimanagement
aimanagement
```

Lệnh mở trình duyệt tại `http://127.0.0.1:7419` (cổng bận thì tự dùng cổng trống kế tiếp, URL thật
được in ra). Không cần tải mã nguồn: gói đã có sẵn server bundle và giao diện tĩnh, không có
dependency nào phải cài thêm.

```
aimanagement --port 8080      # chọn cổng khác
aimanagement --no-open        # không tự mở trình duyệt
aimanagement doctor           # kiểm tra node, git, Claude Code, Codex
```

- Dữ liệu và log nằm ở `~/.aiteam` (đổi bằng biến `AITEAM_HOME`); cổng ưu tiên đổi bằng `AITEAM_PORT`.
- Server chỉ nghe `127.0.0.1`; chỉ trình duyệt mở bằng liên kết lệnh in ra mới vào được.
- Agent chạy bằng Claude Code hoặc Codex cần CLI tương ứng đã cài và đăng nhập (`aimanagement doctor`).
- Cập nhật: `npm i -g aimanagement@latest`. Gỡ: `npm rm -g aimanagement` (dữ liệu ở `~/.aiteam` vẫn giữ).

## Phát triển

```
npm install
npm run build
node bin/aiteam.mjs          # như lệnh aimanagement, chạy từ mã nguồn
npm run lint && npm test     # kiểm tra
npm run test:smoke           # chạy thử bản build
npm pack                     # tạo gói .tgz (tự build và chạy thử trước)
```

Quy tắc code: [CLAUDE.md](CLAUDE.md).

- [Kế hoạch thực hiện](docs/IMPLEMENTATION_PLAN.md)
- [Kế hoạch mapping giao diện](docs/UI_MAPPING.md)
- [Giao diện mẫu tương tác](docs/design/aiteam-ui.html) (tải về rồi mở bằng trình duyệt)

Công nghệ: NestJS, Next.js, SQLite (`node:sqlite`). Giấy phép: [MIT](LICENSE).
