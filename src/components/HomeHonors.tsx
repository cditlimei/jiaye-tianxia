import { useState } from 'react';
import type { GameState } from '../types';
import { findRealm } from '../data/dynasty';
import { hasTitleId, isCurrentTitleId, isLineageTitleId, PLAQUE_TEXT, plaqueOf, RETIRED_LINEAGE_NAMES, TITLE_INFO, type CurrentTitleId, type LineageTitleId, type RetiredLineageId } from '../data/titleEffects';

/**
 * 主城上的称号呈现（v3.1，纯 CSS + 内联 SVG，不加位图）：
 * - 宅邸上方居中挂匾：默认最高档本朝称号（乡绅木匾 / 侯门朱漆匾 / 王 黑底金字），主公页可固定挂哪一块（含旧誉纪念匾）
 * - 左侧旗帜最多 3 面：战旗（百战之将）、帅旗（一代枭雄）、角楼（金汤之将）
 * - 右上国号大纛（天下归心：国号字 + 第 N 朝），其余家声旗排在下面
 * 点匾或旗弹层写明效果，例如「乡绅：政务收入 +3%」。
 */
type HonorId = CurrentTitleId | LineageTitleId | RetiredLineageId;

const LEFT_FLAGS: CurrentTitleId[] = ['river-tiger', 'hegemon', 'north-general'];
const RIGHT_FLAGS: LineageTitleId[] = ['restorer', 'three-dynasties', 'three-realms', 'scholarly'];

function describe(id: HonorId): { name: string; effect: string; note: string } {
  if (isCurrentTitleId(id) || isLineageTitleId(id)) {
    const info = TITLE_INFO[id];
    return { name: info.name, effect: info.effect, note: `${isLineageTitleId(id) ? '家声（跨朝保留）' : '本朝称号'} · ${info.requirement}` };
  }
  return { name: RETIRED_LINEAGE_NAMES[id], effect: '纪念匾，只有外观', note: '旧誉（旧版家声，已退役，留作纪念）' };
}

function FlagSvg({ id, realm, dynasty }: { id: HonorId; realm?: string; dynasty?: number }) {
  // 旗杆 + 旗面；viewBox 统一 24×32
  switch (id) {
    case 'river-tiger':
      return (
        <svg viewBox="0 0 24 32" aria-hidden="true">
          <path d="M4 2v29" className="hh-pole" />
          <path d="M5 3h15l-4 6 4 6H5z" fill="#b3261e" stroke="#f0c75e" strokeWidth="0.8" />
          <text x="11.5" y="12" className="hh-flag-text">战</text>
        </svg>
      );
    case 'hegemon':
      return (
        <svg viewBox="0 0 24 32" aria-hidden="true">
          <path d="M4 2v29" className="hh-pole" />
          <path d="M5 3h16v13l-8 3-8-3z" fill="#16120c" stroke="#e2b54b" strokeWidth="0.9" />
          <text x="13" y="13" className="hh-flag-text is-gold">帅</text>
        </svg>
      );
    case 'north-general':
      // 城头角楼剪影
      return (
        <svg viewBox="0 0 24 32" aria-hidden="true">
          <path d="M3 30V18h18v12z" fill="#3b2f22" stroke="#e2b54b" strokeWidth="0.8" />
          <path d="M3 18v-3h3v3m3 0v-3h3v3m3 0v-3h3v3m3 0v-3h3v3" fill="none" stroke="#e2b54b" strokeWidth="0.8" />
          <path d="M6 15l6-7 6 7z" fill="#5a2b1d" stroke="#e2b54b" strokeWidth="0.8" />
          <path d="M4 9l8-6 8 6" fill="none" stroke="#e2b54b" strokeWidth="1" />
          <rect x="10.5" y="23" width="3" height="7" fill="#120d08" />
        </svg>
      );
    case 'unifier':
      return (
        <svg viewBox="0 0 32 44" aria-hidden="true">
          <path d="M5 1v42" className="hh-pole" />
          <circle cx="5" cy="1.8" r="1.6" fill="#f0c75e" />
          <path d="M6 4h23v22l-11.5 4L6 26z" fill="#8f1d16" stroke="#f0c75e" strokeWidth="1" />
          <text x="17.5" y="19.5" className="hh-realm-text">{realm ?? '群'}</text>
          {dynasty !== undefined && <text x="17.5" y="27.4" className="hh-realm-sub">第{dynasty}朝</text>}
        </svg>
      );
    case 'restorer':
      return (
        <svg viewBox="0 0 24 32" aria-hidden="true">
          <path d="M4 2v29" className="hh-pole" />
          <path d="M5 3h15v14H5z" fill="#c4321f" stroke="#f0c75e" strokeWidth="0.8" />
          <text x="12.5" y="9.6" className="hh-flag-text is-small">再</text>
          <text x="12.5" y="15.4" className="hh-flag-text is-small">造</text>
        </svg>
      );
    case 'three-dynasties':
      return (
        <svg viewBox="0 0 24 32" aria-hidden="true">
          {[3, 10, 17].map((x, index) => (
            <g key={x}>
              <path d={`M${x} ${4 + index}v26`} className="hh-pole" />
              <path d={`M${x + 0.6} ${5 + index}h5l-1.6 2.4 1.6 2.4h-5z`} fill={['#b3261e', '#d9a441', '#2f5d8a'][index]} />
            </g>
          ))}
        </svg>
      );
    case 'three-realms':
      // 魏蓝、蜀绿、吴红三色合一
      return (
        <svg viewBox="0 0 24 32" aria-hidden="true">
          <path d="M4 2v29" className="hh-pole" />
          <path d="M5 3h15v4.6H5z" fill="#2f5d8a" />
          <path d="M5 7.6h15v4.6H5z" fill="#3f7d3a" />
          <path d="M5 12.2h15v4.6H5z" fill="#b3261e" />
          <path d="M5 3h15v13.8H5z" fill="none" stroke="#f0c75e" strokeWidth="0.8" />
        </svg>
      );
    case 'scholarly':
      // 书卷旗：卷轴两端轴头
      return (
        <svg viewBox="0 0 24 32" aria-hidden="true">
          <path d="M4 2v29" className="hh-pole" />
          <rect x="5" y="3" width="15" height="13" rx="1" fill="#efe2bf" stroke="#8a6a2f" strokeWidth="0.8" />
          <path d="M5 4.5h15M5 14.5h15" stroke="#8a6a2f" strokeWidth="1.2" />
          <path d="M8 7.5h9M8 9.5h9M8 11.5h6" stroke="#5a4320" strokeWidth="0.6" />
        </svg>
      );
    default:
      return null;
  }
}

export function HomeHonors({ state }: { state: GameState }) {
  const [open, setOpen] = useState<HonorId | 'lineage' | null>(null);
  const plaque = plaqueOf(state) as HonorId | null;
  const leftFlags = LEFT_FLAGS.filter((id) => hasTitleId(state, id)).slice(0, 3);
  const hasBanner = hasTitleId(state, 'unifier');
  const rightFlags = RIGHT_FLAGS.filter((id) => hasTitleId(state, id));
  const realm = state.realm ? findRealm(state.realm)?.name ?? '群' : '群';
  const dynasty = state.pastDynasties.length + 1;
  if (!plaque && leftFlags.length === 0 && !hasBanner && rightFlags.length === 0) return null;
  const toggle = (id: HonorId | 'lineage') => setOpen((current) => (current === id ? null : id));
  const info = open && open !== 'lineage' ? describe(open) : null;
  const plaqueKind = plaque === 'gentry' || plaque === 'marquis-house' || plaque === 'hegemon' ? plaque : 'memorial';
  return (
    <div className="home-honors" aria-label="称号匾旗">
      {plaque && (
        <button type="button" className={`home-honors__plaque is-${plaqueKind}`} aria-label={`匾额「${PLAQUE_TEXT[plaque]}」· ${describe(plaque).name}`} aria-expanded={open === plaque} onClick={() => toggle(plaque)}>
          <span>{PLAQUE_TEXT[plaque]}</span>
        </button>
      )}
      {leftFlags.length > 0 && (
        <div className="home-honors__left">
          {leftFlags.map((id) => (
            <button key={id} type="button" className={`home-honors__flag is-${id}`} aria-label={`称号旗 · ${TITLE_INFO[id].name}`} aria-expanded={open === id} onClick={() => toggle(id)}>
              <FlagSvg id={id} />
            </button>
          ))}
        </div>
      )}
      {(hasBanner || rightFlags.length > 0) && (
        <div className="home-honors__right">
          {hasBanner && (
            <button type="button" className="home-honors__banner" aria-label={`国号大纛 · ${realm} · 第 ${dynasty} 朝`} aria-expanded={open === 'unifier'} onClick={() => toggle('unifier')}>
              <FlagSvg id="unifier" realm={realm} dynasty={dynasty} />
            </button>
          )}
          {rightFlags.length > 0 && (
            // 家声小旗挤成 2×2，单面点不准：整组一个按钮，弹层逐条列出各家声的效果
            <button type="button" className="home-honors__lineage" aria-label={`家声旗 · ${rightFlags.map((id) => TITLE_INFO[id].name).join('、')}`} aria-expanded={open === 'lineage'} onClick={() => toggle('lineage')}>
              {rightFlags.map((id) => (
                <span key={id} className={`home-honors__flag is-small is-${id}`}>
                  <FlagSvg id={id} />
                </span>
              ))}
            </button>
          )}
        </div>
      )}
      {open === 'lineage' && (
        <div className="home-honors__pop" role="status">
          {rightFlags.map((id) => (
            <strong key={id}>{TITLE_INFO[id].name}：{TITLE_INFO[id].effect}</strong>
          ))}
          <small>家声（跨朝保留）</small>
          <button type="button" aria-label="收起称号说明" onClick={() => setOpen(null)}>×</button>
        </div>
      )}
      {info && open && open !== 'lineage' && (
        <div className="home-honors__pop" role="status">
          <strong>{info.name}：{info.effect}</strong>
          <small>{info.note}</small>
          <button type="button" aria-label="收起称号说明" onClick={() => setOpen(null)}>×</button>
        </div>
      )}
    </div>
  );
}
