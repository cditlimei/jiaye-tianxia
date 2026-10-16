import { useState } from 'react';
import { openDaysLabel } from '../lib/clock';
import type { GameState } from '../types';
import { LEGACY_MAX_POINTS, LEGACY_POINT_STEP, legacyIncomeMultiplier, SUCCESSION_HOME_LEVEL } from '../lib/battle';
import { GameButton } from './common/GameButton';
import { endingHint, isEndingReached } from '../data/dynasty';
import { legacyPreview } from '../lib/prices';
import { ModalShell } from './common/ModalShell';

interface SettingsModalProps {
  state: GameState;
  onClose: () => void;
  onToggleSound: () => void;
  onCopySave: () => Promise<{ ok: boolean; message: string; payload: string | null }>;
  onImportSave: (payload: string) => { ok: boolean; message: string };
  canInstall: boolean;
  onInstall: () => void;
  onReturnTitle: () => void;
  onReset: () => void;
  onSucceed: () => void;
}

export function SettingsModal({
  state,
  onClose,
  onToggleSound,
  onCopySave,
  onImportSave,
  canInstall,
  onInstall,
  onReturnTitle,
  onReset,
  onSucceed
}: SettingsModalProps) {
  // 传位时府库里没收的金子先按钱粮全额并入，再按递增价折家业点；面板与实扣同一组函数（lib/prices.ts legacyPreview）
  const preview = legacyPreview(state);
  const treasuryNote = state.treasury.gold > 0 ? `府库尚有 ${state.treasury.gold.toLocaleString()} 金未收取，传位时先并入。` : '';
  const gainedPoints = preview.gained;
  // v3.1：到王城即可传位，折不到 1 点也能只换主公
  const canSucceed = state.homeLevel >= SUCCESSION_HOME_LEVEL && Boolean(state.selectedLordId);
  const successionHint = state.homeLevel < SUCCESSION_HOME_LEVEL
    ? `宅邸升至王城（${SUCCESSION_HOME_LEVEL} 级）后可传位。`
    : state.legacyPoints >= LEGACY_MAX_POINTS
      ? '家业点已满 20 点，传位只换主公，金子原样留给新主。'
      : gainedPoints < 1
        ? `${treasuryNote}下一点家业点要 ${(preview.nextPrice ?? 0).toLocaleString()} 金，现在传位只换主公、不加点。`
        : `${treasuryNote}现在传位可得 ${gainedPoints} 点家业点，花 ${preview.spent.toLocaleString()} 金、余 ${preview.left.toLocaleString()} 金，累计 ${preview.after} 点，收入 +${Math.round((legacyIncomeMultiplier(preview.after) - 1) * 100)}%。${preview.nextPrice ? `再下一点要 ${preview.nextPrice.toLocaleString()} 金。` : ''}`;
  const nearEnding = isEndingReached(state) ? '天下归心：六郡已归、王城已立，可在主城展开卷轴开创新朝。' : endingHint(state);
  const [importText, setImportText] = useState('');
  const [importStatus, setImportStatus] = useState<{ ok: boolean; message: string } | null>(null);

  const pasteSave = async () => {
    const clipboardText = await navigator.clipboard?.readText().catch(() => '');
    if (clipboardText) {
      setImportText(clipboardText);
      setImportStatus({ ok: true, message: '已读取剪贴板。' });
    } else {
      setImportStatus({ ok: false, message: '无法读取剪贴板，请手动粘贴。' });
    }
  };

  const copySave = async () => {
    const result = await onCopySave();
    if (result.payload) {
      setImportText(result.payload);
    }
    setImportStatus({ ok: result.ok, message: result.message });
  };

  const importSave = () => {
    const result = onImportSave(importText.trim());
    setImportStatus(result);
    if (result.ok) {
      setImportText('');
    }
  };

  return (
    <ModalShell title="设置" onClose={onClose}>
      <div className="settings-panel">
        <section>
          <span>当前存档</span>
          <strong>{openDaysLabel(state.foundedAt, state.day, Date.now())} · {state.gold.toLocaleString()} 金</strong>
          <p>胜 {state.battleWins}（讨伐 {state.battleWins - state.navalWins - state.courtWins - state.frontierWins} · 水战 {state.navalWins} · 朝议 {state.courtWins} · 守城 {state.frontierWins}）· 负 {state.battleLosses}</p>
        </section>
        <section className="succession-panel">
          <span>传位 · 第 {state.generation} 代</span>
          <strong>家业点 {state.legacyPoints}/{LEGACY_MAX_POINTS} · 收入 +{Math.round((legacyIncomeMultiplier(state.legacyPoints) - 1) * 100)}%</strong>
          <p>传位只换主公：宅邸、屯田、封地、伴侣、兵器与任务都留给新主。手里的金子按递增价折成家业点（第 n 点 {(LEGACY_POINT_STEP).toLocaleString()}×n 金{preview.rate < 1 ? '，富国家风八折' : ''}），每点政务与屯田收入 +5%，最多 {LEGACY_MAX_POINTS} 点，开新朝清零。</p>
          <p className={canSucceed ? 'is-ok' : ''}>{successionHint}</p>
          {nearEnding && <p className="is-ok">{nearEnding}</p>}
          <GameButton variant={canSucceed ? 'primary' : 'ghost'} disabled={!canSucceed} onClick={onSucceed}>
            传位给下一代
          </GameButton>
        </section>
        <section className="save-import-panel">
          <span>备份恢复</span>
          <textarea
            aria-label="粘贴存档 JSON"
            value={importText}
            onChange={(event) => setImportText(event.target.value)}
            placeholder="粘贴复制出的存档 JSON"
          />
          {importStatus && <p className={importStatus.ok ? 'is-ok' : 'is-error'}>{importStatus.message}</p>}
          <div className="save-import-actions">
            <GameButton variant="ghost" onClick={pasteSave}>
              粘贴存档
            </GameButton>
            <GameButton variant="secondary" onClick={importSave} disabled={!importText.trim()}>
              导入存档
            </GameButton>
          </div>
        </section>
        <div className="settings-actions">
          <GameButton variant="secondary" onClick={onToggleSound}>
            {state.soundEnabled ? '关闭声音' : '开启声音'}
          </GameButton>
          <GameButton variant="secondary" onClick={copySave}>
            复制存档
          </GameButton>
          {canInstall && (
            <GameButton variant="secondary" onClick={onInstall}>
              安装应用
            </GameButton>
          )}
          <GameButton variant="ghost" onClick={onReturnTitle}>
            返回标题
          </GameButton>
          <GameButton variant="danger" onClick={onReset}>
            重置存档
          </GameButton>
        </div>
      </div>
    </ModalShell>
  );
}
