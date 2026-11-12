# Danh sách model thật của Claude Code và Codex

Ngày: 2026-11-12. Nhánh `feat/live-model-catalog` (tách từ `feat/engine-quota`).

## Vì sao

Chủ dự án thấy danh sách model khi chọn engine cho agent không đúng: Claude chỉ có 4 tên ngắn viết cứng
(`opus/sonnet/haiku/fable`, không biết là bản nào), Codex thiếu GPT-6.1-Sol. Mục tiêu: danh sách lấy từ
chính CLI đang cài, model mới hiện ra mà không cần phát hành aiteam, và biết khi nào CLI đã cũ.

## Nguyên nhân đã kiểm (2026-11-12, máy chủ dự án)

- Codex: server OpenAI chỉ trả model mà phiên bản CLI chạy được. Codex 0.155.1 không có `gpt-6.1-sol`,
  `gpt-6.1-terra`; Codex 0.167.2 có. Cập nhật CLI là điều kiện cần.
- Máy có nhiều bản `codex` trên PATH. Shell chọn theo thứ tự thư mục (`C:\nvm4w\nodejs\codex.cmd`,
  0.167.2) còn aiteam tìm `.exe` trên cả PATH trước (`hermes\bin\codex.exe`, 0.155.1) — app chạy bản khác
  terminal.
- Claude Code: `claude -p --input-format stream-json --output-format stream-json` nhận
  `{"type":"control_request","request_id":…,"request":{"subtype":"initialize"}}` và trả
  `control_response` có `models: [{value, resolvedModel, displayName, description, …}]` (0 token, không có
  lượt nào). Đủ tên ngắn kèm bản thật (`fable` → Fable 5.2) và các bản cố định (Fable 5.1, Opus 4.8, …).
- Codex `app-server` có `model/list` (`{data:[{id, model, displayName, description, isDefault, hidden}],
nextCursor}`): API chính thức, thay cho `codex debug models` (lệnh gỡ lỗi, ~450 KB).

## Quyết định của chủ dự án

- Đọc danh sách thật từ CLI cho Claude và Codex (Antigravity giữ `agy models`).
- Đọc lại khi mở form, có nút ↻.
- Báo CLI cũ bằng cách hỏi npm registry (mỗi ngày tối đa 1 lần), chỉ đọc số phiên bản.
- Cập nhật Codex trên máy ngay (đã làm: `npm i -g @openai/codex@latest` → 0.167.2 trong `C:\nvm4w\nodejs`).

## Thiết kế

1. **Tìm CLI theo thứ tự PATH (Windows):** duyệt từng thư mục theo thứ tự; trong mỗi thư mục thử `.exe`
   rồi `.cmd` (shim npm chạy bằng Node hiện tại như cũ). Thư mục đầu tiên có lệnh thắng — giống shell.
2. **Claude (`CliClaudeModelCatalog`):** chạy `claude -p --input-format stream-json --output-format
stream-json --verbose --setting-sources "" --settings {"disableAllHooks":true} --strict-mcp-config` ở
   `<data>/quota-probe/`, không shell, giữ stdin mở, gửi một dòng `initialize`, chờ `control_response` có
   đúng `request_id`, rồi kill cả cây. Timeout 20 s. Chỉ đọc `models` (parse zod); bỏ `default` (form đã có
   lựa chọn "mặc định của engine"); không bao giờ log `account` hay stdout thô. Tên ngắn (value ≠
   resolvedModel) xếp trước: nhãn "Fable 5.2", ghi chú "fable · luôn là bản mới nhất · <mô tả>"; bản cố
   định sau: nhãn displayName, ghi chú mô tả. Lọc bằng `modelNameSchema`, tối đa 30. Đọc lỗi → 4 tên ngắn
   viết cứng như cũ kèm `problem`.
3. **Codex (`CliCodexModelCatalog`):** `codex app-server`, `initialize` → `initialized` →
   `model/list {includeHidden:false}`, theo `nextCursor` tối đa 5 trang, kill cây khi xong. Model
   `isDefault` ghi chú thêm "mặc định của Codex". Giữ lọc tên an toàn, cắt nhãn/ghi chú.
4. **Bộ nhớ đệm:** 60 s mỗi engine (thay 10 phút), gộp lần đọc đang chạy; `?refresh=1` bỏ qua bộ nhớ đệm
   (vẫn gộp lần đọc đang chạy). Đọc lỗi mà đã có danh sách cũ → trả danh sách cũ kèm `problem`.
5. **CLI cũ (`NpmRegistryCliReleaseReader`):** `GET https://registry.npmjs.org/<gói>/latest`
   (`@anthropic-ai/claude-code`, `@openai/codex`), từ chối redirect, timeout 10 s, đọc tối đa 1 MiB, zod
   `{version}`, nhớ 24 giờ (lỗi nhớ 1 giờ, không báo). Phiên bản đang cài lấy từ `<cli> --version` (số
   `x.y.z` đầu tiên). Bản cài nhỏ hơn bản mới nhất → `cliUpdate: {installedVersion, latestVersion,
updateCommand}`; lệnh gợi ý: Claude `claude update`, Codex `npm i -g @openai/codex@latest`. Không gửi
   gì ngoài tên gói.
6. **API:** `GET /api/local-engines/:engine/models[?refresh=1]` trả thêm `cliUpdate` (null khi không biết
   hoặc đã mới nhất; Antigravity luôn null).
7. **Giao diện:** form chọn model và thẻ engine (Cài đặt API) có nút ↻ đọc lại; dòng gợi ý khi CLI cũ
   ("Có Codex 0.167.2 (máy đang 0.155.1) — chạy `npm i -g @openai/codex@latest` để thấy model mới").
8. **Test:** fixture thật đã làm sạch cho `initialize` của Claude và `model/list` của Codex; regression
   test cho thứ tự PATH; test bộ nhớ đệm/refresh/danh sách cũ khi lỗi; e2e không bao giờ chạy CLI thật
   hay gọi mạng (adapter giả trong `localEngineAdaptersOverride`).

## Ngoài phạm vi

- Antigravity (không có gói npm; `agy update` riêng).
- Tự cập nhật CLI từ app.
