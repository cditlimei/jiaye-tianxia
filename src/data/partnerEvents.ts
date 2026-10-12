import type { Partner } from './gameData';

export type PartnerBoost = Partial<Pick<Partner['bonus'], 'strength' | 'intelligence' | 'charisma'>>;

export interface PartnerEventOption {
  id: 'a' | 'b';
  label: string;
  detail: string;
  boost: PartnerBoost;
}

export interface PartnerEvent {
  partnerId: string;
  /** 第二段心事：所有在府伴侣第一段都了却后才轮到 */
  round?: 2;
  title: string;
  prompt: string;
  options: [PartnerEventOption, PartnerEventOption];
}

export const PARTNER_BOOST_AMOUNT = 6;
/** 伴侣心事每 10 日轮一位（第 5、15、25……日）；与门客献策同日时让位给府中事件 */
export const PARTNER_EVENT_CYCLE_DAYS = 10;
export const PARTNER_EVENT_OFFSET_DAY = 5;

const B = PARTNER_BOOST_AMOUNT;

// 每位伴侣一段心事：两个选项都是正向加成，差别在方向
// 第二段心事：第一段是「她想做什么」，第二段是「她与主公的家业如何相处」，选项依旧两头正向
const secondRound: PartnerEvent[] = [
  { partnerId: 'zhenji', round: 2, title: '铜雀夜宴', prompt: '甄姬受邀赴铜雀台夜宴，宴上必有人借诗试探府中虚实。', options: [
    { id: 'a', label: '随她赴宴', detail: '主公亲自同往，席间谈笑折服众人，声望 +6。', boost: { charisma: B } },
    { id: 'b', label: '托病不去', detail: '她以一纸辞章婉拒，反显府中高深，智谋 +6。', boost: { intelligence: B } } ] },
  { partnerId: 'sunshangxiang', round: 2, title: '江东迎亲', prompt: '孙尚香的兄长遣使来，说要接她回江东小住。', options: [
    { id: 'a', label: '点兵相送', detail: '府兵列阵送行，江东使者见之敛容，武力 +6。', boost: { strength: B } },
    { id: 'b', label: '设宴款待', detail: '留使者多住三日，两家情谊更厚，声望 +6。', boost: { charisma: B } } ] },
  { partnerId: 'daqiao', round: 2, title: '故人托孤', prompt: '大乔旧友病故，托她照看一双儿女。', options: [
    { id: 'a', label: '收养府中', detail: '孩子长成后皆为府中干才，智谋 +6。', boost: { intelligence: B } },
    { id: 'b', label: '置产供养', detail: '为孩子置田产自立，乡里称善，声望 +6。', boost: { charisma: B } } ] },
  { partnerId: 'xiaoqiao', round: 2, title: '琴台论道', prompt: '小乔要在府中办琴会，邀各方名士。', options: [
    { id: 'a', label: '广邀名士', detail: '琴会一时无两，名士争相来投，声望 +6。', boost: { charisma: B } },
    { id: 'b', label: '只邀谋士', detail: '琴声里论尽天下形势，智谋 +6。', boost: { intelligence: B } } ] },
  { partnerId: 'huangyueying', round: 2, title: '连弩成图', prompt: '黄月英画出连弩图样，问主公先造哪一样。', options: [
    { id: 'a', label: '先造连弩', detail: '府兵换装连弩，武力 +6。', boost: { strength: B } },
    { id: 'b', label: '先造水车', detail: '田间水车日夜不息，智谋 +6。', boost: { intelligence: B } } ] },
  { partnerId: 'diaochan', round: 2, title: '故地重游', prompt: '貂蝉想回一趟旧日的司徒府。', options: [
    { id: 'a', label: '亲自护送', detail: '主公佩剑同行，一路无人敢拦，武力 +6。', boost: { strength: B } },
    { id: 'b', label: '修葺旧府', detail: '替她修好故居，洛阳人人称道，声望 +6。', boost: { charisma: B } } ] },
  { partnerId: 'caiwenji', round: 2, title: '续写汉书', prompt: '蔡文姬想把残缺的史册补全，需要人手与钱粮。', options: [
    { id: 'a', label: '拨钱供书', detail: '史册修成，天下士人感念，声望 +6。', boost: { charisma: B } },
    { id: 'b', label: '亲自校书', detail: '主公夜夜与她校对，通晓古今，智谋 +6。', boost: { intelligence: B } } ] },
  { partnerId: 'mifuren', round: 2, title: '商路之争', prompt: '糜夫人娘家商队在外被人截了货。', options: [
    { id: 'a', label: '派兵护商', detail: '府兵护送商路，从此无人敢截，武力 +6。', boost: { strength: B } },
    { id: 'b', label: '登门讲理', detail: '主公亲自出面，对方赔礼道歉，声望 +6。', boost: { charisma: B } } ] },
  { partnerId: 'zhurong', round: 2, title: '象兵入阵', prompt: '祝融说南中可送来一队象兵，但要主公亲去相迎。', options: [
    { id: 'a', label: '亲往南中', detail: '象兵入阵，所向披靡，武力 +6。', boost: { strength: B } },
    { id: 'b', label: '遣使致谢', detail: '只取象牙珍宝，南中各部皆感主公之礼，声望 +6。', boost: { charisma: B } } ] },
  { partnerId: 'bulianshi', round: 2, title: '家法之议', prompt: '步练师拟了一套府中家法，问主公从严还是从宽。', options: [
    { id: 'a', label: '从严', detail: '府中上下令行禁止，智谋 +6。', boost: { intelligence: B } },
    { id: 'b', label: '从宽', detail: '宽仁之名传出府外，声望 +6。', boost: { charisma: B } } ] }
];

export const partnerEvents: PartnerEvent[] = [
  {
    partnerId: 'zhenji', title: '洛水之思', prompt: '甄姬临水赋诗，问主公：此诗当传于世，还是留作府中内政之鉴？',
    options: [
      { id: 'a', label: '传诗于世', detail: '洛神赋名动天下，声望 +6。', boost: { charisma: B } },
      { id: 'b', label: '留鉴内政', detail: '以诗寓政，智谋 +6。', boost: { intelligence: B } }
    ]
  },
  {
    partnerId: 'sunshangxiang', title: '弓马之约', prompt: '孙尚香要在府前立靶练箭，侍女们吓得不敢出门。',
    options: [
      { id: 'a', label: '陪她练箭', detail: '主公亲自搭弓，武力 +6。', boost: { strength: B } },
      { id: 'b', label: '请她授艺', detail: '府中侍卫皆成射手，声望 +6。', boost: { charisma: B } }
    ]
  },
  {
    partnerId: 'daqiao', title: '江东来信', prompt: '大乔收到江东旧友的书信，问主公可否回信通好。',
    options: [
      { id: 'a', label: '修书通好', detail: '江东诸族念旧情，声望 +6。', boost: { charisma: B } },
      { id: 'b', label: '只谈家事', detail: '不涉外事，专心内政，智谋 +6。', boost: { intelligence: B } }
    ]
  },
  {
    partnerId: 'xiaoqiao', title: '琴声夜话', prompt: '小乔新谱一曲，想在府中设宴请宾客共赏。',
    options: [
      { id: 'a', label: '设宴共赏', detail: '宾客尽欢，声望 +6。', boost: { charisma: B } },
      { id: 'b', label: '独奏与君', detail: '曲中有兵法之意，智谋 +6。', boost: { intelligence: B } }
    ]
  },
  {
    partnerId: 'huangyueying', title: '木牛流马', prompt: '黄月英造出一架木牛，问主公用在田间，还是送往军中。',
    options: [
      { id: 'a', label: '送往军中', detail: '辎重自行，武力 +6。', boost: { strength: B } },
      { id: 'b', label: '用于田间', detail: '省工省力，智谋 +6。', boost: { intelligence: B } }
    ]
  },
  {
    partnerId: 'diaochan', title: '月下独酌', prompt: '貂蝉月下独酌，说起旧事，问主公愿听她的歌舞，还是她的往事。',
    options: [
      { id: 'a', label: '听她歌舞', detail: '一舞倾城，声望 +6。', boost: { charisma: B } },
      { id: 'b', label: '听她往事', detail: '连环之计尽在言中，智谋 +6。', boost: { intelligence: B } }
    ]
  },
  {
    partnerId: 'caiwenji', title: '胡笳十八拍', prompt: '蔡文姬整理旧籍，问主公是续修史书，还是教府中子弟读书。',
    options: [
      { id: 'a', label: '续修史书', detail: '文名远播，声望 +6。', boost: { charisma: B } },
      { id: 'b', label: '教授子弟', detail: '府中人人知书，智谋 +6。', boost: { intelligence: B } }
    ]
  },
  {
    partnerId: 'mifuren', title: '仓廪之议', prompt: '糜夫人提议把娘家的商队并入府中，问主公要钱粮还是要人手。',
    options: [
      { id: 'a', label: '要人手', detail: '商队护卫编入府兵，武力 +6。', boost: { strength: B } },
      { id: 'b', label: '要钱粮', detail: '商路通达，声望 +6。', boost: { charisma: B } }
    ]
  },
  {
    partnerId: 'zhurong', title: '南中火把', prompt: '祝融要带南中旧部来府中比武，怕伤了府中体面。',
    options: [
      { id: 'a', label: '放手比武', detail: '以武会友，武力 +6。', boost: { strength: B } },
      { id: 'b', label: '改为校阅', detail: '礼法齐备，声望 +6。', boost: { charisma: B } }
    ]
  },
  {
    partnerId: 'bulianshi', title: '后宅之柄', prompt: '步练师想替主公打理后宅账目，问主公放权几分。',
    options: [
      { id: 'a', label: '全权托付', detail: '账目井然，智谋 +6。', boost: { intelligence: B } },
      { id: 'b', label: '共理家事', detail: '夫妇同心传为佳话，声望 +6。', boost: { charisma: B } }
    ]
  },
  ...secondRound
];

/** 心事键：第一段就是伴侣 id，第二段是「伴侣id#2」（存档 resolvedPartnerEvents / pendingChoice 都用它） */
export function partnerEventKey(partnerId: string, round: 1 | 2) {
  return round === 2 ? `${partnerId}#2` : partnerId;
}

export function partnerIdOfKey(key: string) {
  return key.split('#')[0];
}

export function findPartnerEvent(key: string) {
  const [partnerId, round] = key.split('#');
  return partnerEvents.find((event) => event.partnerId === partnerId && (round === '2' ? event.round === 2 : !event.round)) ?? null;
}

/** 已了却的心事涉及几位伴侣（称号/任务用，第二段不重复计） */
export function partnersWithResolvedEvent(resolved: Record<string, string>) {
  return new Set(Object.keys(resolved).map(partnerIdOfKey)).size;
}

export function isPartnerEventDay(day: number) {
  const onCycle = (d: number) => d % PARTNER_EVENT_CYCLE_DAYS === PARTNER_EVENT_OFFSET_DAY;
  // 第 15、45… 日是门客献策，心事顺延到次日
  if (onCycle(day)) return day % 15 !== 0;
  return onCycle(day - 1) && (day - 1) % 15 === 0;
}

/** 下一桩该出的心事（返回心事键）：先按招募顺序把每位的第一段轮完，再轮第二段 */
export function nextPartnerForEvent(ownedPartnerIds: string[], resolved: Record<string, string>) {
  const first = ownedPartnerIds.find((id) => !resolved[id] && findPartnerEvent(id));
  if (first) return first;
  return ownedPartnerIds.map((id) => partnerEventKey(id, 2)).find((key) => !resolved[key] && findPartnerEvent(key)) ?? null;
}

export function mergePartnerBoost(partner: Partner, boost: PartnerBoost | undefined): Partner {
  if (!boost) return partner;
  return {
    ...partner,
    bonus: {
      strength: (partner.bonus.strength ?? 0) + (boost.strength ?? 0) || undefined,
      intelligence: (partner.bonus.intelligence ?? 0) + (boost.intelligence ?? 0) || undefined,
      charisma: (partner.bonus.charisma ?? 0) + (boost.charisma ?? 0) || undefined
    }
  };
}
