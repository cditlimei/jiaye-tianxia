export const RAW_BASE = 'https://raw.githubusercontent.com/cditlimei/jiaye-tianxia/main';
const WSRV_BASE = 'https://wsrv.nl/?url=';

export function rawUrl(path: string) {
  return `${RAW_BASE}/${path}`;
}

export function wsrvUrl(path: string, width: number) {
  const source = encodeURIComponent(rawUrl(path));
  return `${WSRV_BASE}${source}&w=${width}&output=webp&q=75`;
}

export function mediaUrl(path: string) {
  return rawUrl(path);
}

