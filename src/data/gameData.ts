export type Camp = 'wei' | 'shu' | 'wu' | 'qun';
export type Rarity = 'common' | 'epic' | 'legendary';

export interface Lord {
  id: string;
  name: string;
  title: string;
  camp: Camp;
  strength: number;
  intelligence: number;
  charisma: number;
  description: string;
  imagePath: string;
}

export interface Partner {
  id: string;
  name: string;
  description: string;
  bonus: {
    strength?: number;
    intelligence?: number;
    charisma?: number;
  };
  bestMatchLordId: string;
  recruitCost: number;
  imagePath: string;
}

export interface Weapon {
  id: string;
  name: string;
  rarity: Rarity;
  price: number;
  strengthBonus: number;
  themeColor: string;
  bestMatchLordId: string | null;
  imagePath: string;
  videoPath: string;
  sfxPath: string;
}

export interface HomeLevel {
  level: number;
  name: string;
  upgradeCost: number;
  dailyIncome: number;
  imagePath: string;
}

export interface Enemy {
  id: string;
  name: string;
  power: number;
  rewardGold: number;
  description: string;
}

export const CAMP_META: Record<Camp, { name: string; color: string; softColor: string }> = {
  wei: { name: '魏', color: '#6EA7D8', softColor: 'rgba(110, 167, 216, 0.16)' },
  shu: { name: '蜀', color: '#4DBB7D', softColor: 'rgba(77, 187, 125, 0.16)' },
  wu: { name: '吴', color: '#CC5549', softColor: 'rgba(204, 85, 73, 0.18)' },
  qun: { name: '群', color: '#C9783D', softColor: 'rgba(201, 120, 61, 0.18)' }
};

export const lords: Lord[] = [
  {
    id: 'caocao',
    name: '曹操',
    title: '魏武雄主',
    camp: 'wei',
    strength: 82,
    intelligence: 94,
    charisma: 88,
    description: '挟天子以令诸侯，善用权谋与军政统筹，家业扩张速度稳健。',
    imagePath: 'assets/lords/lord_caocao.png'
  },
  {
    id: 'liubei',
    name: '刘备',
    title: '仁德昭烈',
    camp: 'shu',
    strength: 72,
    intelligence: 82,
    charisma: 96,
    description: '以仁义聚众，擅长招揽贤才，伴侣与家臣收益更为突出。',
    imagePath: 'assets/lords/lord_liubei.png'
  },
  {
    id: 'sunquan',
    name: '孙权',
    title: '江东之主',
    camp: 'wu',
    strength: 76,
    intelligence: 86,
    charisma: 90,
    description: '坐拥江东基业，经营与水陆军备并重，适合稳定推进。',
    imagePath: 'assets/lords/lord_sunquan.png'
  },
  {
    id: 'guanyu',
    name: '关羽',
    title: '武圣云长',
    camp: 'shu',
    strength: 98,
    intelligence: 74,
    charisma: 84,
    description: '忠义冠世，武力极高，装备专属兵器后讨伐能力大幅提升。',
    imagePath: 'assets/lords/lord_guanyu.png'
  },
  {
    id: 'zhangfei',
    name: '张飞',
    title: '燕人猛将',
    camp: 'shu',
    strength: 96,
    intelligence: 58,
    charisma: 76,
    description: '勇猛刚烈，前期战斗压制力强，适合快速通过低阶敌军。',
    imagePath: 'assets/lords/lord_zhangfei.png'
  },
  {
    id: 'zhaoyun',
    name: '赵云',
    title: '常山龙胆',
    camp: 'shu',
    strength: 94,
    intelligence: 78,
    charisma: 88,
    description: '攻守均衡，单骑突围能力强，战斗中的稳定性极佳。',
    imagePath: 'assets/lords/lord_zhaoyun.png'
  },
  {
    id: 'zhugeliang',
    name: '诸葛亮',
    title: '卧龙军师',
    camp: 'shu',
    strength: 58,
    intelligence: 100,
    charisma: 92,
    description: '智计无双，擅长经营规划，伴侣智力加成可放大后期收益。',
    imagePath: 'assets/lords/lord_zhugeliang.png'
  },
  {
    id: 'zhouyu',
    name: '周瑜',
    title: '江左美周郎',
    camp: 'wu',
    strength: 78,
    intelligence: 96,
    charisma: 94,
    description: '军略与风仪并重，适合以智谋和魅力推动家业成长。',
    imagePath: 'assets/lords/lord_zhouyu.png'
  },
  {
    id: 'simayi',
    name: '司马懿',
    title: '鹰视狼顾',
    camp: 'wei',
    strength: 70,
    intelligence: 98,
    charisma: 82,
    description: '深谋远虑，擅长后发制人，后期战力与经营收益兼具。',
    imagePath: 'assets/lords/lord_simayi.png'
  },
  {
    id: 'lvbu',
    name: '吕布',
    title: '飞将无双',
    camp: 'qun',
    strength: 105,
    intelligence: 52,
    charisma: 80,
    description: '天下骁勇之最，初始武力独步乱世，但经营需要更多补足。',
    imagePath: 'assets/lords/lord_lvbu.png'
  }
];

export const partners: Partner[] = [
  {
    id: 'zhenji',
    name: '甄姬',
    description: '洛水风华，能为家业带来沉稳的智谋与声望。',
    bonus: { intelligence: 18, charisma: 12 },
    bestMatchLordId: 'caocao',
    recruitCost: 800,
    imagePath: 'assets/partners/partner_zhenji.png'
  },
  {
    id: 'sunshangxiang',
    name: '孙尚香',
    description: '弓腰姬英姿飒爽，提升武力与人望。',
    bonus: { strength: 16, charisma: 10 },
    bestMatchLordId: 'liubei',
    recruitCost: 800,
    imagePath: 'assets/partners/partner_sunshangxiang.png'
  },
  {
    id: 'daqiao',
    name: '大乔',
    description: '江东国色，擅长稳固名望与盟友关系。',
    bonus: { intelligence: 10, charisma: 18 },
    bestMatchLordId: 'sunquan',
    recruitCost: 800,
    imagePath: 'assets/partners/partner_daqiao.png'
  },
  {
    id: 'xiaoqiao',
    name: '小乔',
    description: '灵秀清婉，能强化军心与谋略。',
    bonus: { intelligence: 16, charisma: 14 },
    bestMatchLordId: 'zhouyu',
    recruitCost: 800,
    imagePath: 'assets/partners/partner_xiaoqiao.png'
  },
  {
    id: 'huangyueying',
    name: '黄月英',
    description: '机巧通玄，擅长提升智谋与器械效率。',
    bonus: { intelligence: 24 },
    bestMatchLordId: 'zhugeliang',
    recruitCost: 800,
    imagePath: 'assets/partners/partner_huangyueying.png'
  },
  {
    id: 'diaochan',
    name: '貂蝉',
    description: '倾国之姿，可显著提升魅力与战前气势。',
    bonus: { strength: 8, charisma: 22 },
    bestMatchLordId: 'lvbu',
    recruitCost: 800,
    imagePath: 'assets/partners/partner_diaochan.png'
  },
  {
    id: 'caiwenji',
    name: '蔡文姬',
    description: '才情温雅，能补足智谋并安定内政。',
    bonus: { intelligence: 18, charisma: 8 },
    bestMatchLordId: 'simayi',
    recruitCost: 800,
    imagePath: 'assets/partners/partner_caiwenji.png'
  },
  {
    id: 'mifuren',
    name: '糜夫人',
    description: '端庄坚韧，增强家业凝聚与忠义声望。',
    bonus: { strength: 8, charisma: 16 },
    bestMatchLordId: 'liubei',
    recruitCost: 800,
    imagePath: 'assets/partners/partner_mifuren.png'
  },
  {
    id: 'zhurong',
    name: '祝融',
    description: '南中烈火，带来强势武力与战斗胆魄。',
    bonus: { strength: 20, charisma: 6 },
    bestMatchLordId: 'zhangfei',
    recruitCost: 800,
    imagePath: 'assets/partners/partner_zhurong.png'
  },
  {
    id: 'bulianshi',
    name: '步练师',
    description: '温婉而有谋度，适合稳固后宅与江东政务。',
    bonus: { intelligence: 12, charisma: 16 },
    bestMatchLordId: 'sunquan',
    recruitCost: 800,
    imagePath: 'assets/partners/partner_bulianshi.png'
  }
];

export const weapons: Weapon[] = [
  {
    id: 'xuanjian',
    name: '玄铁剑',
    rarity: 'common',
    price: 0,
    strengthBonus: 18,
    themeColor: '#C9CED6',
    bestMatchLordId: null,
    imagePath: 'assets/weapons/weapon_effect_jian_normal.png',
    videoPath: 'assets/weapons/weapon_effect_jian_normal.mp4',
    sfxPath: 'audio/sfx/sfx_weapon_jian.mp3'
  },
  {
    id: 'qinggang',
    name: '青釭剑',
    rarity: 'epic',
    price: 1500,
    strengthBonus: 36,
    themeColor: '#8AB8FF',
    bestMatchLordId: 'caocao',
    imagePath: 'assets/weapons/weapon_effect_jian.png',
    videoPath: 'assets/weapons/weapon_effect_jian.mp4',
    sfxPath: 'audio/sfx/sfx_weapon_jian.mp3'
  },
  {
    id: 'qinglong',
    name: '青龙偃月刀',
    rarity: 'legendary',
    price: 5000,
    strengthBonus: 48,
    themeColor: '#D4A843',
    bestMatchLordId: 'guanyu',
    imagePath: 'assets/weapons/weapon_effect_dao.png',
    videoPath: 'assets/weapons/weapon_effect_dao.mp4',
    sfxPath: 'audio/sfx/sfx_weapon_dao.mp3'
  },
  {
    id: 'fangtian',
    name: '方天画戟',
    rarity: 'legendary',
    price: 5000,
    strengthBonus: 55,
    themeColor: '#E16A4E',
    bestMatchLordId: 'lvbu',
    imagePath: 'assets/weapons/weapon_effect_ji.png',
    videoPath: 'assets/weapons/weapon_effect_ji.mp4',
    sfxPath: 'audio/sfx/sfx_weapon_ji.mp3'
  },
  {
    id: 'shuanggu',
    name: '雌雄双股剑',
    rarity: 'epic',
    price: 1500,
    strengthBonus: 34,
    themeColor: '#B88CFF',
    bestMatchLordId: 'liubei',
    imagePath: 'assets/weapons/weapon_effect_shuangjian.png',
    videoPath: 'assets/weapons/weapon_effect_shuangjian.mp4',
    sfxPath: 'audio/sfx/sfx_weapon_jian.mp3'
  }
];

// 江东水战：比智谋（主公 + 伴侣智谋 + 宅邸），门槛高于陆战，缴获约为同档陆战的 1.25 倍
export const navalEnemies: Enemy[] = [
  { id: 'river-pirates', name: '江上水贼', power: 40, rewardGold: 625, description: '劫掠商船的乌合之众' },
  { id: 'naval-captain', name: '水军校尉', power: 90, rewardGold: 1500, description: '操练有素的巡江水军' },
  { id: 'tower-ship-commander', name: '楼船都督', power: 140, rewardGold: 3750, description: '统领楼船的江防主将' },
  { id: 'grand-admiral', name: '水军大都督', power: 190, rewardGold: 10000, description: '号令三江的水师统帅' },
  { id: 'legendary-admiral', name: '水师名将', power: 230, rewardGold: 25000, description: '威震长江的一代名将' }
];

// 许都朝堂：比声望（主公 + 伴侣声望 + 宅邸），门槛最高，缴获约为同档陆战的 1.5 倍
export const courtEnemies: Enemy[] = [
  { id: 'county-aide', name: '郡丞', power: 60, rewardGold: 750, description: '地方小吏，惯于推诿' },
  { id: 'prefect', name: '太守', power: 110, rewardGold: 1800, description: '一郡之守，门生众多' },
  { id: 'nine-ministers', name: '九卿', power: 160, rewardGold: 4500, description: '朝中重臣，党羽遍布' },
  { id: 'three-dukes', name: '三公', power: 200, rewardGold: 12000, description: '位极人臣，一言九鼎' },
  { id: 'regent', name: '权臣', power: 240, rewardGold: 30000, description: '挟天子以令诸侯' }
];

// 北疆边患：比武力，限时迎战，缴获约为同档陆战的 2 倍
export const frontierEnemies: Enemy[] = [
  { id: 'border-raiders', name: '边地流寇', power: 30, rewardGold: 400, description: '趁乱劫掠的流民' },
  { id: 'nomad-riders', name: '胡骑游勇', power: 60, rewardGold: 1000, description: '来去如风的散骑' },
  { id: 'nomad-centurion', name: '胡骑百长', power: 100, rewardGold: 2400, description: '统领百骑的悍将' },
  { id: 'xiongnu-thousand', name: '匈奴千骑', power: 140, rewardGold: 6000, description: '黑压压的千人铁骑' },
  { id: 'xianbei-chief', name: '鲜卑大人', power: 190, rewardGold: 16000, description: '部族首领亲自南下' },
  { id: 'northern-khan', name: '北疆单于', power: 230, rewardGold: 40000, description: '草原霸主倾巢而出' }
];

export interface FarmLevel {
  level: number;
  name: string;
  cost: number;
  dailyIncome: number;
  description: string;
}

// 西蜀屯田：独立于宅邸的田产，每级一次性投入，永久提高每日收入（dailyIncome 为该级总额）。
// 按每日 15 次政务算边际回本：1 级约 13 日，2~5 级各约 21~23 日
export const farmLevels: FarmLevel[] = [
  { level: 0, name: '荒地', cost: 0, dailyIncome: 0, description: '蜀地山间尚是一片荒坡。' },
  { level: 1, name: '开荒', cost: 3000, dailyIncome: 15, description: '垦出第一块田，种下稻谷。' },
  { level: 2, name: '引水', cost: 8000, dailyIncome: 40, description: '引山泉入田，旱涝无忧。' },
  { level: 3, name: '修渠', cost: 20000, dailyIncome: 100, description: '沟渠纵横，梯田层层。' },
  { level: 4, name: '筑仓', cost: 50000, dailyIncome: 250, description: '谷仓满囤，可供一军。' },
  { level: 5, name: '沃野千里', cost: 120000, dailyIncome: 600, description: '蜀地粮仓，天下闻名。' }
];

export function findFarmLevel(level: number) {
  return farmLevels.find((farm) => farm.level === level) ?? farmLevels[0];
}

export const FARM_UNLOCK_HOME_LEVEL = 3;

export const homeLevels: HomeLevel[] = [
  { level: 1, name: '茅草屋', upgradeCost: 0, dailyIncome: 10, imagePath: 'assets/homes/home_level1.png' },
  { level: 2, name: '木屋', upgradeCost: 500, dailyIncome: 30, imagePath: 'assets/homes/home_level2.png' },
  { level: 3, name: '砖瓦宅', upgradeCost: 2000, dailyIncome: 80, imagePath: 'assets/homes/home_level3.png' },
  { level: 4, name: '府邸', upgradeCost: 8000, dailyIncome: 200, imagePath: 'assets/homes/home_level4.png' },
  { level: 5, name: '侯府', upgradeCost: 30000, dailyIncome: 500, imagePath: 'assets/homes/home_level5.png' },
  { level: 6, name: '王城', upgradeCost: 100000, dailyIncome: 1500, imagePath: 'assets/homes/home_level6.png' }
];

export const enemies: Enemy[] = [
  { id: 'yellow-turban', name: '黄巾贼兵', power: 30, rewardGold: 200, description: '新手敌军' },
  { id: 'bandit-chief', name: '山贼头目', power: 60, rewardGold: 500, description: '低阶过渡' },
  { id: 'rebel-captain', name: '叛军校尉', power: 100, rewardGold: 1200, description: '初期挑战' },
  { id: 'enemy-vanguard', name: '敌国先锋', power: 140, rewardGold: 3000, description: '中前期门槛' },
  { id: 'enemy-general', name: '敌国大将', power: 190, rewardGold: 8000, description: '中后期挑战' },
  { id: 'chaos-warlord', name: '乱世枭雄', power: 230, rewardGold: 20000, description: '高阶目标' }
];

export function findLord(id: string | null) {
  return lords.find((lord) => lord.id === id) ?? null;
}

export function findWeapon(id: string) {
  return weapons.find((weapon) => weapon.id === id) ?? weapons[0];
}

export function findHomeLevel(level: number) {
  return homeLevels.find((home) => home.level === level) ?? homeLevels[0];
}
