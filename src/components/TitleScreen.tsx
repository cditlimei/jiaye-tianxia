import type { GameState } from '../types';
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
    <main className="screen title-screen">
      <button className="sound-toggle" onClick={onToggleSound} aria-label="切换声音">
        {state.soundEnabled ? '音' : '静'}
      </button>
      <div className="title-screen__seal">汉末风云</div>
      <h1>家业天下</h1>
      <p className="title-screen__subtitle">三国经营策略</p>
      {hasSave ? (
        <div className="title-screen__save">
          <span>{lordName ?? '旧主'}</span>
          <strong>第 {state.day} 天 · {state.gold.toLocaleString()} 金</strong>
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

