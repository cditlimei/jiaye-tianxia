import { partners } from './gameData';

/**
 * 府中小事：心事讲完后伴侣仍有戏份。每 30 日（第 8、38、68… 日）轮一位在府伴侣，
 * 从模板里按日期取一桩，两头都是正向：拿现钱 / 军令 / 给这位伴侣加 2 点属性。
 * 事件键 `minor:<模板id>:<伴侣id>`，与日历事件、心事共用 pendingChoice。
 */
export const MINOR_EVENT_CYCLE_DAYS = 30;
export const MINOR_EVENT_OFFSET_DAY = 8;
export const MINOR_BOOST_AMOUNT = 2;

export type MinorOptionKind = 'gold' | 'order' | 'boost';

export interface MinorTemplate {
  id: string;
  title: string;
  prompt: (name: string) => string;
  options: [
    { kind: MinorOptionKind; label: string; detail: (name: string, gold: number) => string; stat?: 'strength' | 'intelligence' | 'charisma' },
    { kind: MinorOptionKind; label: string; detail: (name: string, gold: number) => string; stat?: 'strength' | 'intelligence' | 'charisma' }
  ];
}

export const minorTemplates: MinorTemplate[] = [
  { id: 'feast', title: '寿宴', prompt: (n) => `${n}生辰将至，府中要不要操办？`, options: [
    { kind: 'gold', label: '从简', detail: (_n, g) => `省下宴资，入账 ${g.toLocaleString()} 金。` },
    { kind: 'boost', stat: 'charisma', label: '大办', detail: (n) => `宾客盈门，${n}声望 +2。` } ] },
  { id: 'ill', title: '偶感风寒', prompt: (n) => `${n}病了几日，药铺送来两味方子。`, options: [
    { kind: 'boost', stat: 'charisma', label: '亲自煎药', detail: (n) => `主公日夜照料，府中传为佳话，${n}声望 +2。` },
    { kind: 'order', label: '遣军医', detail: () => '军中医官来诊，顺手整饬营务，军令 +1。' } ] },
  { id: 'hunt', title: '春猎', prompt: (n) => `${n}想随主公去郊外打猎。`, options: [
    { kind: 'boost', stat: 'strength', label: '同去', detail: (n) => `驰马射雕，${n}武力 +2。` },
    { kind: 'gold', label: '猎物换钱', detail: (_n, g) => `猎物卖与集市，入账 ${g.toLocaleString()} 金。` } ] },
  { id: 'letter', title: '家书', prompt: (n) => `${n}娘家来信，托主公办一件小事。`, options: [
    { kind: 'gold', label: '收下谢礼', detail: (_n, g) => `事成后娘家送来谢礼 ${g.toLocaleString()} 金。` },
    { kind: 'boost', stat: 'charisma', label: '分文不取', detail: (n) => `乡里传为美谈，${n}声望 +2。` } ] },
  { id: 'garden', title: '修园', prompt: (n) => `${n}想在后园修一座小亭。`, options: [
    { kind: 'boost', stat: 'intelligence', label: '修亭读书', detail: (n) => `亭成后${n}常在此读书，智谋 +2。` },
    { kind: 'order', label: '练兵场', detail: () => '后园改作小校场，军令 +1。' } ] }
];

export function isMinorEventDay(day: number) {
  return day % MINOR_EVENT_CYCLE_DAYS === MINOR_EVENT_OFFSET_DAY;
}

/** 第 day 日轮到哪位伴侣、哪桩小事（按日期取，离线也可复算） */
export function minorEventFor(day: number, ownedPartnerIds: string[]) {
  if (!isMinorEventDay(day) || ownedPartnerIds.length === 0) return null;
  const round = Math.floor(day / MINOR_EVENT_CYCLE_DAYS);
  const partnerId = ownedPartnerIds[round % ownedPartnerIds.length];
  const template = minorTemplates[round % minorTemplates.length];
  return { key: `minor:${template.id}:${partnerId}`, template, partnerId };
}

/** 入参是去掉 `minor:` 前缀后的 `<模板id>:<伴侣id>` */
export function parseMinorKey(key: string) {
  const [templateId, partnerId] = key.split(':');
  const template = minorTemplates.find((item) => item.id === templateId);
  const partner = partners.find((item) => item.id === partnerId);
  return template && partner ? { template, partner } : null;
}

export const minorGoldValue = (dailyIncome: number) => dailyIncome * 2;
