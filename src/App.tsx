import { useEffect, useState } from 'react';
import { partners, weapons } from './data/gameData';
import { useAudioManager } from './hooks/useAudioManager';
import { useEffectOverlay } from './hooks/useEffectOverlay';
import { useGameState } from './hooks/useGameState';
import { BattleScreen } from './components/BattleScreen';
import { EffectOverlay } from './components/common/EffectOverlay';
import { HomeScreen } from './components/HomeScreen';
import { LordSelectScreen } from './components/LordSelectScreen';
import { PartnerModal } from './components/PartnerModal';
import { SettingsModal } from './components/SettingsModal';
import { TitleScreen } from './components/TitleScreen';
import { WeaponModal } from './components/WeaponModal';
import './styles.css';

type Modal = 'partner' | 'weapon' | 'settings' | null;

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

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  const handleContinue = () => {
    audio.unlock();
    audio.playSfx('audio/sfx/sfx_button.mp3');
    game.setScreen(game.selectedLord ? 'home' : 'lordSelect');
  };

  const handleNew = () => {
    audio.unlock();
    audio.playSfx('audio/sfx/sfx_button.mp3');
    game.resetGame();
    game.setScreen('lordSelect');
  };

  const handleLordConfirm = async (lordId: string) => {
    audio.unlock();
    audio.playSfx('audio/sfx/sfx_button.mp3');
    await effects.playEffect({
      videoPath: 'assets/ui/ui_entrance_effect.mp4',
      posterPath: 'assets/ui/ui_entrance_effect.png',
      title: '封侯拜将',
      fallbackMs: 1800
    });
    game.selectLord(lordId);
  };

  const handleRecruit = (partnerId: string) => {
    const partner = partners.find((item) => item.id === partnerId);
    if (!partner) return;
    audio.unlock();
    audio.playSfx('audio/sfx/sfx_button.mp3');
    if (game.recruitPartner(partner)) {
      audio.playSfx('audio/sfx/sfx_partner_appear.mp3', 0.55);
    }
  };

  const handleEquip = (weaponId: string) => {
    const weapon = weapons.find((item) => item.id === weaponId);
    if (!weapon) return;
    audio.unlock();
    audio.playSfx(weapon.sfxPath, 0.52);
    game.equipWeapon(weapon.id);
    void effects.playEffect({
      videoPath: weapon.videoPath,
      posterPath: weapon.imagePath,
      title: weapon.name,
      fallbackMs: 1500
    });
  };

  const handleUpgradeEffect = () => {
    audio.playSfx('audio/sfx/sfx_home_upgrade.mp3', 0.55);
    void effects.playEffect({
      videoPath: 'assets/ui/ui_upgrade_effect.mp4',
      posterPath: 'assets/ui/ui_upgrade_effect.png',
      title: '宅邸升阶',
      fallbackMs: 1700
    });
  };

  const handleBattle = () => {
    audio.unlock();
    audio.playSfx('audio/sfx/sfx_button.mp3');
    setModal(null);
    game.setScreen('battle');
  };

  const copySave = () => {
    const payload = JSON.stringify(game.state, null, 2);
    void navigator.clipboard?.writeText(payload).catch(() => undefined);
    audio.playSfx('audio/sfx/sfx_button.mp3', 0.28);
  };

  const returnTitle = () => {
    setModal(null);
    game.setScreen('title');
  };

  const resetGame = () => {
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
      return <LordSelectScreen onConfirm={handleLordConfirm} onBack={() => game.setScreen('title')} />;
    }

    if (game.state.screen === 'battle' && game.selectedLord) {
      return (
        <BattleScreen
          lord={game.selectedLord}
          weapon={game.equippedWeapon}
          totalPower={game.totalPower}
          wins={game.state.battleWins}
          losses={game.state.battleLosses}
          onPlayEffect={effects.playEffect}
          onSfx={audio.playSfx}
          onResolved={game.recordBattle}
          onReturnHome={() => game.setScreen('home')}
        />
      );
    }

    if (!game.selectedLord) {
      return <LordSelectScreen onConfirm={handleLordConfirm} onBack={() => game.setScreen('title')} />;
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
          questStatuses={game.questStatuses}
          onCollectIncome={game.collectIncome}
          onUpgrade={game.upgradeHome}
          onOpenPartner={() => setModal('partner')}
          onOpenWeapon={() => setModal('weapon')}
          onBattle={handleBattle}
          onClaimQuest={(questId) => {
            game.claimQuest(questId);
            audio.playSfx('audio/sfx/sfx_coins.mp3', 0.36);
          }}
          onCompleteTutorial={game.completeTutorial}
          onOpenSettings={() => setModal('settings')}
          onIncomeSfx={() => audio.playSfx('audio/sfx/sfx_coins.mp3', 0.28)}
          onUpgradeEffect={handleUpgradeEffect}
        />
        {modal === 'partner' && (
          <PartnerModal state={game.state} lord={game.selectedLord} onClose={() => setModal(null)} onRecruit={handleRecruit} />
        )}
        {modal === 'weapon' && (
          <WeaponModal lord={game.selectedLord} equippedWeaponId={game.state.equippedWeaponId} onClose={() => setModal(null)} onEquip={handleEquip} />
        )}
        {modal === 'settings' && (
          <SettingsModal
            state={game.state}
            onClose={() => setModal(null)}
            onToggleSound={game.toggleSound}
            onCopySave={copySave}
            canInstall={Boolean(installPrompt)}
            onInstall={installApp}
            onReturnTitle={returnTitle}
            onReset={resetGame}
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
