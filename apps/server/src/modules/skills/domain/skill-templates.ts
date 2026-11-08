/** A built-in skill a department can add with one click, then edit. */
export interface SkillTemplateDefinition {
  id: string;
  name: string;
  description: string;
  body: string;
}

export const SKILL_TEMPLATES: readonly SkillTemplateDefinition[] = [
  {
    id: 'write-tests',
    name: 'Viết test',
    description: 'Dùng khi viết hoặc sửa code có logic: thêm test tự động cho phần vừa làm.',
    body: `# Viết test

1. Tìm framework test dự án đang dùng (package.json, pyproject.toml, go.mod…) và cách chạy test.
2. Với mỗi hàm hoặc API vừa thêm/sửa: một test cho trường hợp đúng, một cho đầu vào sai, một cho biên.
3. Sửa lỗi thì viết test tái hiện lỗi trước, thấy test đỏ, rồi mới sửa.
4. Đặt tên test mô tả hành vi ("trả 401 khi sai mật khẩu"), không mô tả cách làm.
5. Chạy toàn bộ test trước khi báo xong; ghi số test đạt trong báo cáo.`,
  },
  {
    id: 'code-review',
    name: 'Review code',
    description: 'Dùng khi được giao duyệt hoặc tự kiểm tra code trước khi báo xong.',
    body: `# Review code

Đọc thay đổi theo thứ tự này, ghi rõ file:dòng cho mỗi vấn đề:

1. **Đúng chưa:** logic, trường hợp biên, lỗi null/undefined, xử lý lỗi, race condition.
2. **An toàn:** dữ liệu đầu vào được kiểm tra, không lộ khoá bí mật, không ghép chuỗi vào SQL/lệnh shell.
3. **Test:** phần logic mới có test; test có kiểm đúng hành vi.
4. **Dễ đọc:** tên rõ nghĩa, hàm làm một việc, không lặp code.

Chỉ nêu vấn đề có thật kèm cách sửa; không khen, không bắt lỗi định dạng mà công cụ format lo được.`,
  },
  {
    id: 'qa-test-cases',
    name: 'Viết kịch bản kiểm thử',
    description: 'Dùng khi cần lập hoặc chạy kịch bản kiểm thử cho một tính năng.',
    body: `# Viết kịch bản kiểm thử

Mỗi kịch bản một mục, đánh số TC-01, TC-02…:

- **Mục tiêu:** hành vi cần kiểm.
- **Tiền điều kiện:** dữ liệu, trạng thái cần có.
- **Các bước:** từng bước cụ thể, có thể làm lại.
- **Kết quả mong đợi:** điều quan sát được, không mơ hồ.

Phủ: luồng chính, đầu vào sai, giá trị biên, quyền truy cập, lỗi mạng/hết thời gian. Khi chạy kịch bản, ghi đạt/không đạt cho từng TC và bằng chứng (output, ảnh, log).`,
  },
  {
    id: 'conventional-commits',
    name: 'Commit theo chuẩn',
    description: 'Dùng khi viết thông điệp commit hoặc mô tả thay đổi.',
    body: `# Commit theo Conventional Commits

Dạng: \`<loại>(<phạm vi>): <mô tả ngắn, thì hiện tại>\`, tối đa 72 ký tự.

Loại: feat (tính năng), fix (sửa lỗi), refactor, test, docs, chore, perf, build, ci.

- Mỗi commit một thay đổi có nghĩa; không gộp sửa lỗi với refactor.
- Thân commit (nếu cần) giải thích **vì sao**, không kể lại diff.
- Thay đổi phá tương thích: thêm \`!\` sau loại và dòng \`BREAKING CHANGE:\`.`,
  },
  {
    id: 'api-docs',
    name: 'Viết tài liệu API',
    description: 'Dùng khi thêm hoặc đổi endpoint, cần cập nhật tài liệu cho người dùng API.',
    body: `# Viết tài liệu API

Với mỗi endpoint:

- Phương thức và đường dẫn, mô tả một câu.
- Tham số (path, query, body): tên, kiểu, bắt buộc hay không, ràng buộc.
- Phản hồi thành công: mã HTTP và ví dụ JSON thật.
- Lỗi có thể gặp: mã HTTP, mã lỗi, khi nào xảy ra.
- Ví dụ gọi bằng curl.

Giữ tài liệu cạnh code (README hoặc docs/) và cập nhật cùng commit với thay đổi.`,
  },
];
