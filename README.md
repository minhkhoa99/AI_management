# AI Team (aiteam)

Nền tảng điều phối nhiều agent AI theo phòng ban, chạy hoàn toàn trên máy của bạn.
Agent dùng Claude Code, Codex (bằng tài khoản đã đăng nhập) hoặc Custom API.

Trạng thái: Giai đoạn 0 (nền móng): khung server, giao diện tĩnh, lệnh `aiteam`.

Yêu cầu Node LTS đã vá bảo mật: 22.23.4+, 24.22.1+ hoặc 26.12.1+.

```
npm install
npm run build
node bin/aiteam.mjs          # mở http://127.0.0.1:4321 kèm token phiên
node bin/aiteam.mjs doctor   # kiểm tra node, git, claude, codex
```

Phát triển: `npm run lint`, `npm test`, `npm run test:smoke` (sau khi build). Quy tắc code: [CLAUDE.md](CLAUDE.md).

- [Kế hoạch thực hiện](docs/IMPLEMENTATION_PLAN.md)
- [Kế hoạch mapping giao diện](docs/UI_MAPPING.md)
- [Giao diện mẫu tương tác](docs/design/aiteam-ui.html) (tải về rồi mở bằng trình duyệt)

Công nghệ: NestJS, Next.js, SQLite. Mục tiêu sử dụng:

```
npm i -g aiteam
aiteam
```
