import { partners } from './gameData';
import type { GameState } from '../types';

/**
 * 伴侣上牌桌：每位伴侣一招牌桌技能，随行时生效。
 * 等级完全由心事推导（入府一重、了却第一段心事 +1、第二段 +1、良缘 +1，封顶三重），老存档读进来自动有等级。
 * 设计红线：不改对手的行动、不偷对手的牌；不和郡特权重复；倍数仍封顶 8；三重单局净期望不超过 +15%（scripts/doudizhu-partner-sim.mjs 校准）。
 */
export type SkillKind = 'passive' | 'active' | 'choice' | 'settle';
export type SkillPhase = 'deal' | 'bidding' | 'playing' | 'settle';
export type SkillLevel = 1 | 2 | 3;

export interface PartnerSkill {
  partnerId: string;
  name: string;
  kind: SkillKind;
  phase: SkillPhase;
  /** 每局可发动次数，0 = 被动（自动生效） */
  uses: [number, number, number];
  /** 张数 / 系数等，含义见各技能 */
  values: [number, number, number];
  /** 玩家可见的三级说明 */
  levelText: [string, string, string];
}

export const SKILL_LEVEL_NAME: Record<SkillLevel, string> = { 1: '一重', 2: '二重', 3: '三重' };

/** 祝融：每手长牌型加的缴获 */
export const ZHURONG_STEP = 0.05;
/** 小乔三重：加倍后失手只按这个倍率付（一二重按 ×2） */
export const XIAOQIAO_SOFT_LOSS = 1.5;
/**
 * 小乔「赤壁」加倍是对赌：平时失手只付缴获两成（LOSS_PENALTY_RATE），加倍后失手再乘这个数（×10 = 付缴获两倍）。
 * 胜负都只 ×2 的话，平时「赢拿全额、失手付两成」不对称，笨玩家一律加倍净期望 +60%~+114%（partner-sim 实测），远超 +15% 合格线；
 * ×5（付全额）时初级场三重只在当地主时加倍仍 +32%，×10 才压到 +15% 内：要牌力很强（胜率约八成）才值得加倍
 */
export const XIAOQIAO_LOSS_RATE = 10;
/**
 * 小乔「赤壁」加倍后的失手系数（乘在不加倍的失手倍数上）。
 * 赌注跟着「加倍实际多赢了多少」走：gain = 加倍后赢牌倍数 / 不加倍赢牌倍数（1~2）。
 * 正常 gain=2，一二重付 ×2×XIAOQIAO_LOSS_RATE、三重付 ×1.5×XIAOQIAO_LOSS_RATE；
 * 倍数已被封顶 8（或巴郡保底）吃掉、加倍多赢不到时，失手也不加付，不会出现「赢不多、失手付 ×10」
 */
export function xiaoqiaoLossFactor(level: number, gain: number) {
  const full = XIAOQIAO_LOSS_RATE * (level >= 3 ? XIAOQIAO_SOFT_LOSS : 2);
  return 1 + (full - 1) * Math.max(0, Math.min(1, gain - 1));
}
/** 糜夫人与汝南相乘后，失手最少也付这么多 */
export const MIFUREN_MIN_PAY = 0.3;
/** 糜夫人：失手且最终倍数达到这个数才返还军令 */
export const MIFUREN_REFUND_MULTIPLIER = 4;

export const partnerSkills: Record<string, PartnerSkill> = {
  diaochan: {
    partnerId: 'diaochan', name: '闭月', kind: 'passive', phase: 'deal',
    uses: [0, 0, 0], values: [2, 3, 4],
    levelText: ['开局探得上家最大 2 张牌', '开局探得上家最大 3 张牌', '开局探得上家最大 4 张牌']
  },
  huangyueying: {
    partnerId: 'huangyueying', name: '木牛流马', kind: 'active', phase: 'bidding',
    // values：先翻开几张底牌（0 = 盲换）；翻开多张时换其中最大的。原设计三重「换 2 次」实测 +15.4%，改为翻 2 张挑大的
    uses: [1, 1, 1], values: [0, 1, 2],
    levelText: ['叫地主时拿 1 张手牌与 1 张底牌盲换，换来的牌亮出', '叫地主时先翻开 1 张底牌，再决定拿哪张手牌换它', '叫地主时先翻开 2 张底牌，拿手牌换其中大的那张']
  },
  zhenji: {
    partnerId: 'zhenji', name: '洛神', kind: 'active', phase: 'bidding',
    // values：重发后多看几张底牌。原设计三重「重发 2 次」实测 +17.4%，改为重发 1 次、多看 2 张
    uses: [1, 1, 1], values: [0, 1, 2],
    levelText: ['自己叫地主之前，可整桌重新发牌一次', '重发一次，重发后多看 1 张底牌', '重发一次，重发后多看 2 张底牌']
  },
  xiaoqiao: {
    partnerId: 'xiaoqiao', name: '赤壁', kind: 'choice', phase: 'bidding',
    // values：加倍时的倍率（胜负一并乘）
    uses: [1, 1, 1], values: [2, 2, 2],
    // 「缴获 ×4」是地主 ×1 时的数；农民半份、汝南减半照算，牌桌上按当前倍数现算现显示；倍数已到 ×8 不弹
    levelText: ['当上地主可「加倍」对赌：胜得双倍，失手按平时 20 倍付（地主 ×1 即付缴获 ×4）', '当地主、当农民都可加倍对赌：胜得双倍，失手按平时 20 倍付', '地主、农民都可加倍；失手只按平时 15 倍付（地主 ×1 即付缴获 ×3）']
  },
  sunshangxiang: {
    partnerId: 'sunshangxiang', name: '枭姬', kind: 'passive', phase: 'playing',
    // values：你打出的炸弹、王炸翻几倍（平时 ×2）。原设计「前 N 个 ×4」实测 +41%（第二个炸弹极少，三级没差别），改按倍率分级
    uses: [0, 0, 0], values: [2.25, 2.5, 2.75],
    levelText: ['你打出的炸弹、王炸翻 ×2.25（平时 ×2，仍封顶 ×8）', '你打出的炸弹、王炸翻 ×2.5', '你打出的炸弹、王炸翻 ×2.75']
  },
  daqiao: {
    partnerId: 'daqiao', name: '同心', kind: 'passive', phase: 'deal',
    // values：当农民时亮出队友几张（17 = 整手）
    uses: [0, 0, 0], values: [3, 20, 20],
    levelText: ['当农民时亮出队友最大 3 张牌', '当农民时亮出队友整手牌', '当农民亮出队友整手；当地主探下家最大 2 张']
  },
  caiwenji: {
    partnerId: 'caiwenji', name: '胡笳辨音', kind: 'passive', phase: 'playing',
    uses: [0, 0, 0], values: [1, 2, 3],
    levelText: ['显示两家尚余：炸弹 · 王 · 2 各几张', '按家分开显示炸弹 · 王 · 2', '按家分开显示，某家剩 2 张及以下时亮出他的牌']
  },
  bulianshi: {
    partnerId: 'bulianshi', name: '问计', kind: 'active', phase: 'playing',
    uses: [2, 3, 5], values: [0, 0, 0],
    levelText: ['选好牌后「问计」：下家、上家各自压不压得过，每局 2 次', '每局可问计 3 次', '每局可问计 5 次']
  },
  mifuren: {
    partnerId: 'mifuren', name: '舍身', kind: 'settle', phase: 'settle',
    // values：失手少付的比例；攻郡未克退还的军资比例见 MIFUREN_STAKE_REFUND；倍数到 MIFUREN_REFUND_MULTIPLIER 才返还军令
    uses: [0, 0, 0], values: [0, 0.2, 0.35],
    levelText: [`失手倍数到 ×${MIFUREN_REFUND_MULTIPLIER} 时返还本局军令；攻郡未克退还一成军资`, '失手少付 20%，×4 起返还军令；攻郡未克退还 15% 军资', '失手少付 35%（与汝南相乘最少付三成），×4 起返还军令；攻郡未克退还 20% 军资']
  },
  zhurong: {
    partnerId: 'zhurong', name: '烈火', kind: 'settle', phase: 'playing',
    // values：赢牌缴获加成上限
    uses: [0, 0, 0], values: [0.1, 0.15, 0.2],
    levelText: ['每打出一手 5 张以上的顺子、连对或飞机，赢牌缴获 +5%，最多 +10%', '长牌型每手赢牌缴获 +5%，最多 +15%', '长牌型每手赢牌缴获 +5%，最多 +20%']
  }
};

/** 糜夫人：攻郡未克退还的军资比例 */
export const MIFUREN_STAKE_REFUND: [number, number, number] = [0.1, 0.15, 0.2];
export function findPartnerSkill(id: string | null | undefined) {
  return id ? partnerSkills[id] ?? null : null;
}

type LevelSlice = Pick<GameState, 'ownedPartnerIds' | 'resolvedPartnerEvents' | 'selectedLordId'>;

/** 技能等级：没入府为 0；入府一重，两段心事各 +1，良缘再 +1，封顶三重 */
export function partnerSkillLevel(id: string, s: LevelSlice): 0 | SkillLevel {
  if (!s.ownedPartnerIds.includes(id)) return 0;
  let lv = 1 + (s.resolvedPartnerEvents[id] ? 1 : 0) + (s.resolvedPartnerEvents[`${id}#2`] ? 1 : 0);
  if (partners.find((p) => p.id === id)?.bestMatchLordId === s.selectedLordId) lv += 1;
  return Math.min(3, lv) as SkillLevel;
}

/** 默认随行：已招到的良缘伴侣 > 第一位入府的 > 无 */
export function defaultEscort(s: Pick<GameState, 'ownedPartnerIds' | 'selectedLordId'>): string | null {
  const best = s.ownedPartnerIds.find((id) => partners.find((p) => p.id === id)?.bestMatchLordId === s.selectedLordId);
  return best ?? s.ownedPartnerIds[0] ?? null;
}

/** 测试开关：jiaye-escort=<伴侣 id> 强制指定随行伴侣（没入府也按一重算） */
export const ESCORT_OVERRIDE_KEY = 'jiaye-escort';
function escortOverride(): string | null {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(ESCORT_OVERRIDE_KEY) : null;
    return raw && partnerSkills[raw] ? raw : null;
  } catch {
    return null;
  }
}

/** 当前随行：存档里选的（须已入府），否则默认 */
export function currentEscortId(s: Pick<GameState, 'ownedPartnerIds' | 'selectedLordId' | 'escortPartnerId'>): string | null {
  const forced = escortOverride();
  if (forced) return forced;
  return s.escortPartnerId && s.ownedPartnerIds.includes(s.escortPartnerId) ? s.escortPartnerId : defaultEscort(s);
}

export interface EscortInfo {
  id: string;
  name: string;
  imagePath: string;
  level: SkillLevel;
}

/** 牌桌用的随行信息（开局冻结） */
export function escortInfoFor(s: Pick<GameState, 'ownedPartnerIds' | 'selectedLordId' | 'escortPartnerId' | 'resolvedPartnerEvents'>): EscortInfo | null {
  const id = currentEscortId(s);
  const partner = partners.find((p) => p.id === id);
  if (!id || !partner || !partnerSkills[id]) return null;
  const level = Math.max(1, partnerSkillLevel(id, s.ownedPartnerIds.includes(id) ? s : { ...s, ownedPartnerIds: [...s.ownedPartnerIds, id] })) as SkillLevel;
  return { id, name: partner.name, imagePath: partner.imagePath, level };
}

/** 「貂蝉·闭月」 */
export function skillTitle(id: string) {
  const partner = partners.find((p) => p.id === id);
  const skill = partnerSkills[id];
  return partner && skill ? `${partner.name}·${skill.name}` : '';
}

/** 心事了却后升级的说明：「貂蝉「闭月」升至二重：开局探得上家最大 3 张牌」；不再升级返回空串 */
export function skillUpgradeCopy(id: string, from: number) {
  const partner = partners.find((p) => p.id === id);
  const skill = partnerSkills[id];
  if (!partner || !skill || from < 1 || from >= 3) return '';
  const to = (from + 1) as SkillLevel;
  return `${partner.name}「${skill.name}」升至${SKILL_LEVEL_NAME[to]}：${skill.levelText[to - 1]}`;
}
