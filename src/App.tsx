import { useEffect, useState } from 'react';
import { homeLevels, lords, partners, weapons } from './data/gameData';
import { useAudioManager } from './hooks/useAudioManager';
import { useEffectOverlay } from './hooks/useEffectOverlay';
import { useGameState } from './hooks/useGameState';
import { preloadImages } from './lib/assets';
import { parseImportedGameState } from './lib/storage';
import { ambitionSummary } from './data/ambitions';
import { DYNASTY_START_GOLD, dynastyCount, findRealm } from './data/dynasty';
import { defaultGameState } from './lib/storage';
import { LEGACY_START_GOLD_PER_POINT } from './lib/battle';
import type { GameState } from './types';
import { BattleScreen } from './components/BattleScreen';
import { EffectOverlay } from './components/common/EffectOverlay';
import { HomeScreen } from './components/HomeScreen';
import { LordSelectScreen } from './components/LordSelectScreen';
import { PartnerModal } from './components/PartnerModal';
import { PartnerSelectScreen } from './components/PartnerSelectScreen';
import { PartnerTalkModal } from './components/PartnerTalkModal';
import { SettingsModal } from './components/SettingsModal';
import { TitleScreen } from './components/TitleScreen';
import { WeaponModal } from './components/WeaponModal';
import { LordModal } from './components/LordModal';
import { FiefModal } from './components/FiefModal';
import { EndingModal } from './components/EndingModal';
import './styles.css';

type Modal = 'partner' | 'partnerTalk' | 'weapon' | 'settings' | 'lord' | 'fief' | 'ending' | null;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export function App() {
  const game = useGameState();
  const audio = useAudioManager(game.state.screen, game.state.soundEnabled);
  const effects = useEffectOverlay();
  const [modal, setModal] = useState<Modal>(null);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [transitioning, setTransitioning] = useState(false);

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      preloadImages(lords.map((lord) => lord.imagePath), 320);
      preloadImages(partners.map((partner) => partner.imagePath), 320);
      preloadImages(homeLevels.map((home) => home.imagePath), 640);
      preloadImages(weapons.map((weapon) => weapon.imagePath), 384);
      preloadImages(['assets/ui/ui_entrance_effect.png', 'assets/ui/ui_upgrade_effect.png', 'assets/ui/ui_assets_increase.png'], 384);
    }, 350);

    return () => window.clearTimeout(timer);
  }, []);

  const handleContinue = () => {
    audio.unlock();
    audio.playSfx('audio/sfx/sfx_button.mp3');
    game.setScreen(game.selectedLord ? (game.state.ownedPartnerIds.length > 0 ? 'home' : 'partnerSelect') : 'lordSelect');
  };

  const handleNew = () => {
    const dynasties = game.state.pastDynasties.length;
    if (game.hasSave && !confirmReset(`${game.state.legacyPoints > 0 ? `重开会清空当前家业进度，连同 ${game.state.legacyPoints} 点家业点与第 ${game.state.generation} 代传承一并作废。` : '重开会清空当前家业进度。'}${dynasties > 0 ? ` ${dynasties} 朝国号加成与前朝记录保留。` : ''}`)) {
      return;
    }
    audio.unlock();
    audio.playSfx('audio/sfx/sfx_button.mp3');
    game.restartGame();
    game.setScreen('lordSelect');
  };

  const handleLordConfirm = async (lordId: string) => {
    if (transitioning) return;
    // 选主公会重置存档；导入存档后从选伴侣页返回时也会走到这里，有进度就先确认
    const current = game.state;
    const hasProgress = game.hasSave && (
      current.day > 1 ||
      current.homeLevel > 1 ||
      current.battleWins + current.battleLosses > 0 ||
      current.claimedQuestIds.length > 0 ||
      current.ownedPartnerIds.length > 0
    );
    if (hasProgress && !confirmReset(`重选主公会清空当前家业进度${current.ambition ? '，本代志向作废' : ''}。`)) return;
    setTransitioning(true);
    try {
      audio.unlock();
      audio.playSfx('audio/sfx/sfx_button.mp3');
      await effects.playEffect({
        videoPath: 'assets/ui/ui_entrance_effect.mp4',
        posterPath: 'assets/ui/ui_entrance_effect.png',
        title: '封侯拜将',
        fallbackMs: 1800
      });
      game.selectLord(lordId);
    } finally {
      setTransitioning(false);
    }
  };

  const handleStarterPartnerConfirm = (partnerId: string) => {
    const partner = partners.find((item) => item.id === partnerId);
    if (!partner) return;
    audio.unlock();
    audio.playSfx('audio/sfx/sfx_partner_appear.mp3', 0.55);
    game.selectStarterPartner(partner);
  };

  const handleRecruit = (partnerId: string) => {
    const partner = partners.find((item) => item.id === partnerId);
    if (!partner) return false;
    audio.unlock();
    audio.playSfx('audio/sfx/sfx_button.mp3');
    if (game.recruitPartner(partner)) {
      audio.playSfx('audio/sfx/sfx_partner_appear.mp3', 0.55);
      return true;
    }
    return false;
  };

  const handleEquip = (weaponId: string) => {
    const weapon = weapons.find((item) => item.id === weaponId);
    if (!weapon) return false;
    audio.unlock();
    if (!game.state.ownedWeaponIds.includes(weapon.id)) {
      if (!game.buyWeapon(weapon)) {
        audio.playSfx('audio/sfx/sfx_button.mp3', 0.2);
        return false;
      }
      audio.playSfx('audio/sfx/sfx_coins.mp3', 0.3);
    } else {
      game.equipWeapon(weapon.id);
    }
    audio.playSfx(weapon.sfxPath, 0.52);
    void effects.playEffect({
      videoPath: weapon.videoPath,
      posterPath: weapon.imagePath,
      title: weapon.name,
      fallbackMs: 1500
    });
    return true;
  };

  // 升阶展示新宅邸的图（原视频是现代高楼，与三国题材不符）
  const handleUpgradeEffect = (imagePath: string, name: string) => {
    audio.playSfx('audio/sfx/sfx_home_upgrade.mp3', 0.55);
    void effects.playEffect({
      videoPath: '',
      imagePath,
      title: `宅邸升阶 · ${name}`,
      fallbackMs: 1700
    });
  };

  const handleBattle = () => {
    audio.unlock();
    audio.playSfx('audio/sfx/sfx_button.mp3');
    setModal(null);
    game.setScreen('battle');
  };

  const copySave = async () => {
    const payload = JSON.stringify(game.state, null, 2);
    audio.playSfx('audio/sfx/sfx_button.mp3', 0.28);
    try {
      if (!navigator.clipboard) throw new Error('no clipboard');
      await navigator.clipboard.writeText(payload);
      return { ok: true, message: '存档已复制到剪贴板，请粘贴到备忘录等处保存。', payload: null };
    } catch {
      return { ok: false, message: '无法写入剪贴板，存档已填入上方文本框，请长按全选后手动复制。', payload };
    }
  };

  const importSave = (payload: string) => {
    try {
      const imported = parseImportedGameState(payload);
      game.restoreGame(imported);
      audio.playSfx('audio/sfx/sfx_coins.mp3', 0.32);
      return { ok: true, message: `已导入第 ${imported.day} 天存档。` };
    } catch (error) {
      audio.playSfx('audio/sfx/sfx_button.mp3', 0.18);
      return { ok: false, message: error instanceof Error ? error.message : '存档导入失败。' };
    }
  };

  const succeed = () => {
    const note = ambitionSummary(game.state);
    if (!confirmReset(`${note && !note.includes('已达成') ? `${note}\n\n` : ''}传位后金币、主公、伴侣、兵器与宅邸全部重来，屯田与封地传给下一代，换取永久收入加成。`)) {
      return;
    }
    audio.unlock();
    audio.playSfx('audio/sfx/sfx_home_upgrade.mp3', 0.5);
    setModal(null);
    game.succeed();
  };

  const returnTitle = () => {
    setModal(null);
    game.setScreen('title');
  };

  const resetGame = () => {
    if (!confirmReset(`重置会清空当前本地存档${game.state.pastDynasties.length > 0 ? '，连同历朝国号加成与前朝记录' : ''}。`)) {
      return;
    }
    game.resetGame();
    setModal(null);
  };

  const installApp = async () => {
    if (!installPrompt) {
      return;
    }

    audio.playSfx('audio/sfx/sfx_button.mp3', 0.28);
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice.catch(() => null);
    if (choice?.outcome === 'accepted') {
      setInstallPrompt(null);
    }
  };

  const renderScreen = () => {
    if (game.state.screen === 'title') {
      return (
        <TitleScreen
          hasSave={game.hasSave}
          state={game.state}
          lordName={game.selectedLord?.name}
          onContinue={handleContinue}
          onNew={handleNew}
          onToggleSound={game.toggleSound}
        />
      );
    }

    if (game.state.screen === 'lordSelect') {
      return <LordSelectScreen onConfirm={handleLordConfirm} onBack={() => game.setScreen('title')} disabled={transitioning} banner={dynastyBanner(game.state)} />;
    }

    if (game.state.screen === 'partnerSelect' && game.selectedLord) {
      return (
        <PartnerSelectScreen
          lord={game.selectedLord}
          onConfirm={handleStarterPartnerConfirm}
          onBack={() => game.setScreen('lordSelect')}
        />
      );
    }

    if (game.state.screen === 'battle' && game.selectedLord) {
      return (
        <BattleScreen
          lord={game.selectedLord}
          weapon={game.equippedWeapon}
          totalPower={game.totalPower}
          navalPower={game.navalPower}
          courtPower={game.courtPower}
          farm={{ current: game.currentFarm, next: game.nextFarm, gold: game.state.gold, homeIncome: game.currentHome.dailyIncome }}
          orders={game.state.orders}
          orderCap={game.orderCap}
          battleBonus={game.state.nextBattleBonus}
          day={game.state.day}
          frontier={{ raid: game.state.frontierRaid, nextRaidDay: game.state.nextRaidDay, day: game.state.day }}
          onUpgradeFarm={() => {
            if (!game.upgradeFarm()) return false;
            audio.playSfx('audio/sfx/sfx_coins.mp3', 0.4);
            return true;
          }}
          homeLevel={game.state.homeLevel}
          wins={game.state.battleWins}
          losses={game.state.battleLosses}
          onPlayEffect={effects.playEffect}
          onSfx={audio.playSfx}
          onResolved={game.recordBattle}
          onBattleStart={game.startBattle}
          onReturnHome={() => game.setScreen('home')}
        />
      );
    }

    if (!game.selectedLord) {
      return <LordSelectScreen onConfirm={handleLordConfirm} onBack={() => game.setScreen('title')} disabled={transitioning} />;
    }

    return (
      <>
        <HomeScreen
          state={game.state}
          lord={game.selectedLord}
          currentHome={game.currentHome}
          nextHome={game.nextHome}
          weapon={game.equippedWeapon}
          ownedPartners={game.ownedPartners}
          totalPower={game.totalPower}
          intelligence={game.intelligence}
          charisma={game.charisma}
          dailyIncome={game.dailyIncome}
          farmPercent={game.currentFarm.incomePercent}
          farmFlat={game.currentFarm.flatIncome}
          orderCap={game.orderCap}
          recruitDiscount={game.recruitDiscount}
          questStatuses={game.questStatuses}
          titleStatus={game.titleStatus}
          onCollectIncome={game.collectIncome}
          onResolveChoice={(optionId: string) => {
            game.resolveChoice(optionId);
            audio.playSfx('audio/sfx/sfx_coins.mp3', 0.3);
          }}
          onUpgrade={game.upgradeHome}
          onOpenPartner={() => setModal('partner')}
          onOpenPartnerTalk={() => setModal('partnerTalk')}
          onOpenWeapon={() => setModal('weapon')}
          onBattle={handleBattle}
          onClaimQuest={(questId) => {
            game.claimQuest(questId);
            audio.playSfx('audio/sfx/sfx_coins.mp3', 0.36);
          }}
          onCompleteTutorial={game.completeTutorial}
          onOpenSettings={() => setModal('settings')}
          onOpenLord={() => setModal('lord')}
          onOpenFief={() => setModal('fief')}
          onOpenEnding={() => setModal('ending')}
          onChooseAmbition={(id) => {
            game.chooseAmbition(id);
            audio.playSfx('audio/sfx/sfx_button.mp3', 0.3);
          }}
          onIncomeSfx={() => audio.playSfx('audio/sfx/sfx_coins.mp3', 0.28)}
          onUpgradeEffect={handleUpgradeEffect}
        />
        {modal === 'partner' && (
          <PartnerModal state={game.state} lord={game.selectedLord} costFor={game.recruitCostFor} discount={game.recruitDiscount} onClose={() => setModal(null)} onRecruit={handleRecruit} />
        )}
        {modal === 'partnerTalk' && (
          <PartnerTalkModal lord={game.selectedLord} ownedPartners={game.ownedPartners} onClose={() => setModal(null)} />
        )}
        {modal === 'lord' && (
          <LordModal lord={game.selectedLord} state={game.state} totalPower={game.totalPower} intelligence={game.intelligence} charisma={game.charisma} onClose={() => setModal(null)} />
        )}
        {modal === 'ending' && (
          <EndingModal
            state={game.state}
            dailyIncome={game.dailyIncome}
            orderCap={game.orderCap}
            onClose={() => setModal(null)}
            onFound={(realm) => {
              if (!confirmReset('开创新朝会把金币、主公、伴侣、兵器、宅邸、屯田、封地、家业点与家谱全部归入前朝重来，只保留国号加成。')) return;
              audio.unlock();
              audio.playSfx('audio/sfx/sfx_home_upgrade.mp3', 0.5);
              setModal(null);
              game.foundDynasty(realm);
            }}
          />
        )}
        {modal === 'fief' && (
          <FiefModal
            state={game.state}
            farmingGain={game.farmingGain}
            totalPower={game.totalPower}
            orderCap={game.orderCap}
            onClose={() => setModal(null)}
            onClaim={(policyId) => {
              if (!game.claimFief(policyId)) return false;
              audio.playSfx('audio/sfx/sfx_home_upgrade.mp3', 0.5);
              return true;
            }}
            onChangePolicy={(fiefId, policyId) => {
              if (!game.setFiefPolicy(fiefId, policyId)) return false;
              audio.playSfx('audio/sfx/sfx_coins.mp3', 0.35);
              return true;
            }}
          />
        )}
        {modal === 'weapon' && (
          <WeaponModal lord={game.selectedLord} state={game.state} onClose={() => setModal(null)} onEquip={handleEquip} />
        )}
        {modal === 'settings' && (
          <SettingsModal
            state={game.state}
            onClose={() => setModal(null)}
            onToggleSound={game.toggleSound}
            onCopySave={copySave}
            onImportSave={importSave}
            canInstall={Boolean(installPrompt)}
            onInstall={installApp}
            onReturnTitle={returnTitle}
            onReset={resetGame}
            onSucceed={succeed}
          />
        )}
      </>
    );
  };

  return (
    <div className="app-shell">
      <div className="phone-shell">{renderScreen()}</div>
      {effects.overlay && <EffectOverlay overlay={effects.overlay} onFinish={effects.finishEffect} />}
    </div>
  );
}

function dynastyBanner(state: GameState) {
  const count = dynastyCount(state.realms);
  if (count === 0) return undefined;
  return `第 ${count + 1} 朝 · 国号加成 ${(['wei', 'shu', 'wu'] as const).filter((id) => state.realms[id] > 0).map((id) => `${findRealm(id)!.name}×${state.realms[id]}`).join('、')} · 开局 ${(defaultGameState.gold + state.legacyPoints * LEGACY_START_GOLD_PER_POINT + count * DYNASTY_START_GOLD).toLocaleString()} 金`;
}

function confirmReset(message: string) {
  return window.confirm(`${message}\n\n建议先在设置里复制存档备份。确定继续吗？`);
}
