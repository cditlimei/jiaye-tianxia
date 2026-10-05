import type { CSSProperties } from 'react';
import type { GameState } from '../types';
import { getTitleStatus } from '../data/progression';
import { imageUrl } from '../lib/assets';
import { LEGACY_START_GOLD_PER_POINT } from '../lib/battle';
import { defaultGameState } from '../lib/storage';
import { GameButton } from './common/GameButton';

interface TitleScreenProps {
  hasSave: boolean;
  state: GameState;
  lordName?: string;
  onContinue: () => void;
  onNew: () => void;
  onToggleSound: () => void;
}

export function TitleScreen({ hasSave, state, lordName, onContinue, onNew, onToggleSound }: TitleScreenProps) {
  return (
    <main
      className="screen title-screen"
      style={{ '--title-backdrop': `url(${imageUrl('assets/lords/lord_caocao.png', 640)})` } as CSSProperties}
    >
      <button className="sound-toggle" onClick={onToggleSound} aria-label="切换声音">
        {state.soundEnabled ? '音' : '静'}
      </button>
      <div className="title-screen__seal">三国经营策略</div>
      <h1>家业天下</h1>
      <p className="title-screen__subtitle">选定主公，经营家业，招募伴侣，配备兵器，于乱世中成就一方门阀霸业。</p>
      {hasSave ? (
        <div className="title-screen__save">
          {lordName ? (
            <>
              <span>{lordName} · 「{getTitleStatus(state).current.name}」</span>
              <strong>{state.generation > 1 ? `第 ${state.generation} 代 · ` : ''}第 {state.day} 天 · {state.gold.toLocaleString()} 金</strong>
            </>
          ) : (
            // 传位后还没选新主公
            <>
              <span>第 {state.generation} 代 · 待择新主</span>
              <strong>家业点 {state.legacyPoints} · 新主起手 {(defaultGameState.gold + state.legacyPoints * LEGACY_START_GOLD_PER_POINT).toLocaleString()} 金</strong>
            </>
          )}
        </div>
      ) : (
        <div className="title-screen__save title-screen__save--empty">
          <span>开局择主</span>
          <strong>一宅一兵，起家于乱世</strong>
        </div>
      )}
      <div className="title-screen__actions">
        <GameButton block onClick={hasSave ? onContinue : onNew}>
          {hasSave ? '继续家业' : '开始游戏'}
        </GameButton>
        {hasSave && (
          <GameButton block variant="secondary" onClick={onNew}>
            重开基业
          </GameButton>
        )}
      </div>
    </main>
  );
}
