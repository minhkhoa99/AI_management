/** Screen sizes for the preview tab (CSS pixels, portrait). */
export type DeviceKind = 'phone' | 'tablet' | 'laptop' | 'desktop' | 'custom';

export interface PreviewDevice {
  id: string;
  name: string;
  width: number;
  height: number;
  kind: DeviceKind;
}

export const CUSTOM_DEVICE_ID = 'custom';

export const DEVICE_GROUPS: Array<{ label: string; devices: PreviewDevice[] }> = [
  {
    label: 'Điện thoại',
    devices: [
      ['iphonese', 'iPhone SE', 375, 667],
      ['iphone13mini', 'iPhone 13 mini', 375, 812],
      ['iphone15', 'iPhone 15 / 15 Pro', 393, 852],
      ['iphone15max', 'iPhone 15 Pro Max', 430, 932],
      ['galaxys24', 'Samsung Galaxy S24', 360, 780],
      ['galaxys24u', 'Samsung Galaxy S24 Ultra', 384, 824],
      ['pixel8', 'Google Pixel 8', 412, 915],
      ['redmi13', 'Xiaomi Redmi Note 13', 393, 873],
      ['fold5', 'Galaxy Z Fold5 (gập)', 344, 882],
      ['android320', 'Android màn nhỏ', 320, 640],
    ].map(toDevice('phone')),
  },
  {
    label: 'Máy tính bảng',
    devices: [
      ['ipadmini', 'iPad mini', 744, 1133],
      ['ipadair', 'iPad Air 11"', 820, 1180],
      ['ipadpro11', 'iPad Pro 11"', 834, 1194],
      ['ipadpro13', 'iPad Pro 13"', 1024, 1366],
      ['tabs9', 'Galaxy Tab S9', 800, 1280],
      ['surface9', 'Surface Pro 9', 912, 1368],
      ['fold5open', 'Galaxy Z Fold5 (mở)', 690, 829],
    ].map(toDevice('tablet')),
  },
  {
    label: 'Laptop',
    devices: [
      ['laptop1280', 'Laptop nhỏ', 1280, 800],
      ['laptop1366', 'Laptop HD', 1366, 768],
      ['mba13', 'MacBook Air 13"', 1470, 956],
      ['mbp14', 'MacBook Pro 14"', 1512, 982],
      ['laptopfhd', 'Laptop Full HD (125%)', 1536, 864],
      ['mbp16', 'MacBook Pro 16"', 1728, 1117],
    ].map(toDevice('laptop')),
  },
  {
    label: 'Màn hình rời',
    devices: [
      ['fhd', 'Full HD', 1920, 1080],
      ['imac24', 'iMac 24"', 2048, 1152],
      ['qhd', '2K QHD', 2560, 1440],
      ['uw', 'Ultrawide', 3440, 1440],
      ['uhd', '4K (100%)', 3840, 2160],
    ].map(toDevice('desktop')),
  },
];

export const ALL_DEVICES: PreviewDevice[] = DEVICE_GROUPS.flatMap((group) => group.devices);
export const DEFAULT_DEVICE_ID = 'iphone15';
export const CUSTOM_SIZE_LIMITS = {
  minWidth: 240,
  maxWidth: 3840,
  minHeight: 320,
  maxHeight: 2400,
};

function toDevice(kind: DeviceKind) {
  return ([id, name, width, height]: Array<string | number>): PreviewDevice => ({
    id: String(id),
    name: String(name),
    width: Number(width),
    height: Number(height),
    kind,
  });
}

/** Tailwind-style breakpoint names, the ones most front-end code is written against. */
export function describeBreakpoint(width: number): string {
  if (width < 640) return 'xs (< 640)';
  if (width < 768) return 'sm (≥ 640)';
  if (width < 1024) return 'md (≥ 768)';
  if (width < 1280) return 'lg (≥ 1024)';
  if (width < 1536) return 'xl (≥ 1280)';
  return '2xl (≥ 1536)';
}

/** A custom size picks the frame by width. */
export function guessDeviceKind(width: number): DeviceKind {
  if (width < 600) return 'phone';
  if (width < 1024) return 'tablet';
  return 'laptop';
}
