export interface NavigationItem {
  href: string;
  label: string;
  /** Heading shown in the top bar when this screen is open. */
  screenTitle: string;
  screenSubtitle: string;
  /** SVG path ("d" attribute) on a 24×24 stroke icon, copied from the design mockup. */
  iconPath: string;
}

export const NAVIGATION_ITEMS: readonly NavigationItem[] = [
  {
    href: '/',
    label: 'Tổng quan',
    screenTitle: 'Tổng quan',
    screenSubtitle: 'Toàn cảnh agent, task và chi phí của các phòng ban',
    iconPath: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  },
  {
    href: '/org/',
    label: 'Sơ đồ tổ chức',
    screenTitle: 'Sơ đồ tổ chức',
    screenSubtitle: 'Phân cấp, bật tắt agent và chọn bộ não cho từng vị trí',
    iconPath: 'M9 2h6v5H9zM2 17h6v5H2zM16 17h6v5h-6zM12 7v5M5 17v-3h14v3',
  },
  {
    href: '/workflows/',
    label: 'Quy trình',
    screenTitle: 'Quy trình',
    screenSubtitle: 'Các bước mỗi phòng phải tuân theo và điều kiện để sang bước sau',
    iconPath: 'M3 5h6v5H3zM15 14h6v5h-6zM9 7.5h3a2 2 0 0 1 2 2v5a2 2 0 0 0 2 2',
  },
  {
    href: '/skills/',
    label: 'Skill',
    screenTitle: 'Skill',
    screenSubtitle: 'Kỹ năng của từng phòng ban và agent nào được dùng',
    iconPath: 'M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8-4.3-4.1 5.9-.9z',
  },
  {
    href: '/tasks/',
    label: 'Task',
    screenTitle: 'Task',
    screenSubtitle: 'Mọi task đang chạy qua các phòng ban',
    iconPath: 'M4 4h4v16H4zM10 4h4v10h-4zM16 4h4v13h-4z',
  },
  {
    href: '/monitor/',
    label: 'Theo dõi trực tiếp',
    screenTitle: 'Theo dõi trực tiếp',
    screenSubtitle: 'Xem agent làm việc theo thời gian thực',
    iconPath: 'M3 12h4l3-7 4 14 3-7h4',
  },
  {
    href: '/settings/',
    label: 'Cài đặt API',
    screenTitle: 'Cài đặt API',
    screenSubtitle: 'Kết nối OpenAI-compatible hoặc Anthropic API cho agent dùng Custom API',
    iconPath:
      'M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6zM12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1',
  },
];

function normalizePathname(pathname: string): string {
  return pathname.endsWith('/') ? pathname : `${pathname}/`;
}

export function findNavigationItemForPath(pathname: string): NavigationItem {
  const normalizedPathname = normalizePathname(pathname);
  const exactMatch = NAVIGATION_ITEMS.find((item) => item.href === normalizedPathname);
  const fallback = NAVIGATION_ITEMS[0];
  if (fallback === undefined) {
    throw new Error('NAVIGATION_ITEMS must not be empty');
  }
  return exactMatch ?? fallback;
}
