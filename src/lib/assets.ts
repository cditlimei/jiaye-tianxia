export const RAW_BASE = 'https://raw.githubusercontent.com/cditlimei/jiaye-tianxia/main';
const OPTIMIZED_ASSET_VERSION = '20260501a';

interface OptimizedImageConfig {
  prefix: string;
  folder: string;
  extension: 'jpg' | 'png';
  widths: number[];
}

const OPTIMIZED_IMAGE_CONFIGS: OptimizedImageConfig[] = [
  { prefix: 'assets/lords/', folder: 'lords', extension: 'jpg', widths: [160, 320, 640] },
  { prefix: 'assets/partners/', folder: 'partners', extension: 'jpg', widths: [320, 640] },
  { prefix: 'assets/homes/', folder: 'homes', extension: 'jpg', widths: [640, 960] },
  { prefix: 'assets/weapons/', folder: 'weapons', extension: 'png', widths: [256, 512] },
  { prefix: 'assets/ui/', folder: 'ui', extension: 'png', widths: [256, 512] }
];

export function rawUrl(path: string) {
  return `${RAW_BASE}/${path}`;
}

export function imageUrl(path: string, width: number) {
  return optimizedImageUrl(path, width);
}

export function mediaUrl(path: string) {
  if (isImagePath(path)) {
    return optimizedImageUrl(path, 512);
  }

  return rawUrl(path);
}

export function optimizedImageUrl(path: string, width: number) {
  const config = OPTIMIZED_IMAGE_CONFIGS.find((item) => path.startsWith(item.prefix));
  if (!config) {
    return rawUrl(path);
  }

  const targetWidth = Math.ceil(width * devicePixelRatio());
  const bucket = config.widths.find((candidate) => candidate >= targetWidth) ?? config.widths[config.widths.length - 1];
  const fileName = path.split('/').pop()?.replace(/\.[^.]+$/, '');

  if (!fileName) {
    return rawUrl(path);
  }

  return publicUrl(`optimized/${config.folder}/${fileName}-${bucket}.${config.extension}?v=${OPTIMIZED_ASSET_VERSION}`);
}

export function preloadImages(paths: string[], width: number) {
  if (typeof window === 'undefined') {
    return;
  }

  for (const path of [...new Set(paths)]) {
    const image = new Image();
    image.decoding = 'async';
    image.src = optimizedImageUrl(path, width);
  }
}

function publicUrl(path: string) {
  const base = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
  return `${base}${path}`;
}

function devicePixelRatio() {
  if (typeof window === 'undefined') {
    return 1;
  }

  return Math.min(window.devicePixelRatio || 1, 2);
}

function isImagePath(path: string) {
  return /\.(png|jpe?g|webp|avif)$/i.test(path);
}
