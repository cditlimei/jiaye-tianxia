import { useEffect, useState } from 'react';
import { homeLevels, lords, partners, weapons } from './data/gameData';
import { useAudioManager } from './hooks/useAudioManager';
import { useEffectOverlay } from './hooks/useEffectOverlay';
import { useGameState } from './hooks/useGameState';
import { conquestStakeOf, legacyPreview, policyChangeCostOf, reclaimStakeRateOf, siegeBountyOf, stakeDiscountNotes, titleDdzScale, wallRepairCostOf } from './lib/prices';
import { hasTitleId } from './data/titleEffects';
import { preloadImages } from './lib/assets';
import { parseImportedGameState } from './lib/storage';
import { HOME_UNLOCKS } from './data/progression';
import { bountyScale, dynastyCount, effectiveRealms, findRealm, isHeirPending, realmFarmCost, realmRewardScale } from './data/dynasty';
import { BEQUESTS, FACTIONS, type BequestId, type FactionId } from './data/factions';
import { findHomeLevel } from './data/gameData';
import { findFief, nodeShortName, ownedFiefCount } from './data/fiefs';
import type { GameState } from './types';
import { BattleScreen, type RegionId } from './components/BattleScreen';
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
import { escortInfoFor, partnerSkillLevel, partnerSkills } from './data/partnerSkills';
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
    // 留贤留下的伴侣不占开局伴侣：只有她一位时还要去选开局伴侣
    const needStarter = game.state.ownedPartnerIds.length === 0 || (game.state.keptPartnerId !== null && game.state.ownedPartnerIds.length === 1 && game.state.ownedPartnerIds[0] === game.state.keptPartnerId);
    game.setScreen(game.selectedLord ? (needStarter ? 'partnerSelect' : 'home') : 'lordSelect');
  };

  const handleNew = () => {
    const dynasties = game.state.pastDynasties.length;
    if (game.hasSave && !confirmReset(`${game.state.legacyPoints > 0 ? `重开会清空当前家业进度，连同 ${game.state.legacyPoints} 点家业点与第 ${game.state.generation} 代传承一并作废。` : '重开会清空当前家业进度。'}${dynasties > 0 ? ` 本朝势力${FACTIONS[game.state.faction].name}、${dynasties} 朝国号遗泽与前朝记录保留。` : ''}`)) {
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
    // 传位或开新朝后还没定主公：屯田封地家业点都会保留，不是「清空进度」，不弹确认
    const hasProgress = game.hasSave && Boolean(current.selectedLordId) && (
      current.day > 1 ||
      current.homeLevel > 1 ||
      current.battleWins + current.battleLosses > 0 ||
      current.claimedQuestIds.length > 0 ||
      // 留贤留下、还没选开局伴侣：她会跟着新主公走，不算要清空的进度
      current.ownedPartnerIds.some((id) => id !== current.keptPartnerId)
    );
    if (hasProgress && !confirmReset('重选主公会清空当前家业进度。')) return;
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
      subtitle: HOME_UNLOCKS[homeLevels.find((home) => home.name === name)?.level ?? 0] ? `新开放：${HOME_UNLOCKS[homeLevels.find((home) => home.name === name)!.level]}` : undefined,
      fallbackMs: 2400
    });
  };

  // 进出征地图时预选的区域：屯田机会进西蜀、边患告警进北疆、引导出征进官道
  const [battleEntry, setBattleEntry] = useState<RegionId | undefined>(undefined);
  // 疆域图预选的郡：首页告急条「去守城 / 去修城 / 去收复」直达该郡
  const [fiefEntry, setFiefEntry] = useState<string | undefined>(undefined);
  const handleBattle = (region?: RegionId, fiefId?: string) => {
    audio.unlock();
    audio.playSfx('audio/sfx/sfx_button.mp3');
    setModal(null);
    setBattleEntry(region);
    setFiefEntry(fiefId);
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
      return { ok: true, message: `已导入第 ${imported.day} 日存档。` };
    } catch (error) {
      audio.playSfx('audio/sfx/sfx_button.mp3', 0.18);
      return { ok: false, message: error instanceof Error ? error.message : '存档导入失败。' };
    }
  };

  const succeed = () => {
    const preview = legacyPreview(game.state);
    const stored = game.state.treasury.gold;
    if (!window.confirm(`${stored > 0 ? `府库尚有 ${stored.toLocaleString()} 金未收取，传位时先并入再折家业点。\n\n` : ''}传位只换主公：宅邸、屯田、封地、伴侣、兵器与任务都留给新主。${preview.gained > 0 ? `可折 ${preview.gained} 点家业点（花 ${preview.spent.toLocaleString()} 金，余 ${preview.left.toLocaleString()} 金）。` : '金子不够折家业点，这次只换主公。'}\n\n确定传位吗？`)) {
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
      return <LordSelectScreen onConfirm={handleLordConfirm} onBack={() => game.setScreen('title')} disabled={transitioning} banner={dynastyBanner(game.state)} faction={game.state.faction} />;
    }

    if (game.state.screen === 'partnerSelect' && game.selectedLord) {
      return (
        <PartnerSelectScreen
          lord={game.selectedLord}
          excludeIds={game.state.keptPartnerId ? [game.state.keptPartnerId] : []}
          onConfirm={handleStarterPartnerConfirm}
          onBack={() => game.setScreen('lordSelect')}
        />
      );
    }

    if (game.state.screen === 'battle' && game.selectedLord) {
      return (
        <BattleScreen
          firstBattle={!game.state.tutorialDone && game.state.battleWins === 0}
          initialRegion={battleEntry}
          lord={game.selectedLord}
          weapon={game.equippedWeapon}
          totalPower={game.totalPower}
          navalPower={game.navalPower}
          courtPower={game.courtPower}
          farm={{ current: game.currentFarm, next: game.nextFarm, gold: game.state.gold, homeIncome: game.currentHome.dailyIncome }}
          orders={game.state.orders}
          orderCap={game.orderCap}
          orderClockAt={game.state.orderClockAt}
          realmScale={(mode) => realmRewardScale(effectiveRealms(game.state), mode) * bountyScale(game.state.day, mode)}
          titleDdzScale={titleDdzScale(game.state)}
          repairCostFor={(fief) => wallRepairCostOf(game.state, fief)}
          bountyFor={(fief) => siegeBountyOf(game.state, fief)}
          reclaimRate={reclaimStakeRateOf(game.state)}
          stakeNotes={stakeDiscountNotes(game.state)}
          homeBadge={{ realm: hasTitleId(game.state, 'unifier') ? realmChar(game.state) : null, golden: hasTitleId(game.state, 'north-general') }}
          farmCost={game.nextFarm ? realmFarmCost(effectiveRealms(game.state), game.nextFarm.cost) : 0}
          battleBonus={game.state.nextBattleBonus}
          day={game.state.day}
          siege={game.state.siege}
          fiefWalls={game.state.fiefWalls}
          lostFiefs={game.state.lostFiefs}
          initialFiefId={fiefEntry}
          onStartDefense={game.startDefense}
          onDefenseResolved={(win) => {
            game.resolveDefense(win);
            if (win) audio.playSfx('audio/sfx/sfx_coins.mp3', 0.5);
          }}
          onAbandonSiege={game.abandonSiege}
          onRepairWall={(fiefId) => {
            if (!game.repairWall(fiefId)) return false;
            audio.playSfx('audio/sfx/sfx_coins.mp3', 0.4);
            return true;
          }}
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
          onBattleStakeChange={game.updateActiveBattle}
          onReturnHome={() => game.setScreen('home')}
          fiefs={game.state.fiefs}
          faction={game.state.faction}
          conquestStakeFor={(fief) => conquestStakeOf(game.state, fief)}
          policyChangeCostFor={(fief) => policyChangeCostOf(game.state, fief)}
          onStartConquest={game.startConquest}
          onConquestResolved={(win, refundRate) => {
            game.resolveConquest(win, refundRate);
            if (win) audio.playSfx('audio/sfx/sfx_coins.mp3', 0.5);
          }}
          onChangeFiefPolicy={game.setFiefPolicy}
          escort={escortInfoFor(game.state)}
          escortOptions={partners.filter((partner) => game.state.ownedPartnerIds.includes(partner.id) && partnerSkills[partner.id]).map((partner) => ({ id: partner.id, name: partner.name, imagePath: partner.imagePath, level: Math.max(1, partnerSkillLevel(partner.id, game.state)) as 1 | 2 | 3 }))}
          onSelectEscort={game.setEscort}
          onSkillUsed={game.recordSkillUse}
          onRefundOrder={game.refundOrder}
        />
      );
    }

    if (!game.selectedLord) {
      return <LordSelectScreen onConfirm={handleLordConfirm} onBack={() => game.setScreen('title')} disabled={transitioning} banner={dynastyBanner(game.state)} faction={game.state.faction} />;
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
          onBattle={() => handleBattle()}
          onOpenFarm={() => handleBattle('xishu')}
          onBattleAt={handleBattle}
          onOpenSiege={(fiefId) => handleBattle('jingzhou', fiefId)}
          onClaimQuest={(questId) => {
            game.claimQuest(questId);
            audio.playSfx('audio/sfx/sfx_coins.mp3', 0.36);
          }}
          onCompleteTutorial={game.completeTutorial}
          onOpenSettings={() => setModal('settings')}
          onOpenLord={() => setModal('lord')}
          // 封地在出征页的疆域图上：看郡、攻郡、改方略都在那里
          onOpenFief={() => handleBattle('jingzhou')}
          onOpenEnding={() => setModal('ending')}
          onIncomeSfx={() => audio.playSfx('audio/sfx/sfx_coins.mp3', 0.28)}
          onUpgradeEffect={handleUpgradeEffect}
        />
        {modal === 'partner' && (
          <PartnerModal state={game.state} lord={game.selectedLord} costFor={game.recruitCostFor} discount={game.recruitDiscount} onClose={() => setModal(null)} onRecruit={handleRecruit} onTalk={() => setModal('partnerTalk')} />
        )}
        {modal === 'partnerTalk' && (
          <PartnerTalkModal lord={game.selectedLord} ownedPartners={game.ownedPartners} onClose={() => setModal(null)} />
        )}
        {modal === 'lord' && (
          <LordModal lord={game.selectedLord} state={game.state} totalPower={game.totalPower} intelligence={game.intelligence} charisma={game.charisma} onClose={() => setModal(null)} onSetPlaque={game.setPlaque} />
        )}
        {modal === 'ending' && (
          <EndingModal
            state={game.state}
            dailyIncome={game.dailyIncome}
            orderCap={game.orderCap}
            onClose={() => setModal(null)}
            onFound={(faction: FactionId, bequests: BequestId[], keepPartnerId: string | null) => {
              const info = FACTIONS[faction];
              const picked = bequests.map((id) => BEQUESTS.find((item) => item.id === id)?.name).filter(Boolean).join('、');
              if (!confirmReset(`选国号「${info.name}」= 下一朝从${info.capital}（${info.name}本府）起家，换一条路线重新开疆。\n金币、主公、伴侣${bequests.includes('keeper') ? '（留贤留下的一位除外）' : ''}、兵器、宅邸、屯田、封地、家业点与家谱归入前朝重来；家声、前朝国号遗泽保留${picked ? `，遗泽「${picked}」只管下一朝` : ''}。`)) return;
              audio.unlock();
              audio.playSfx('audio/sfx/sfx_home_upgrade.mp3', 0.5);
              setModal(null);
              game.foundDynasty(faction, bequests, keepPartnerId);
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

/** 国号字：本朝国号，开国第一朝写「群」 */
export function realmChar(state: GameState) {
  return state.realm ? findRealm(state.realm)?.name ?? '群' : '群';
}

function dynastyBanner(state: GameState) {
  // v3.1 传位：只换主公，家业原样留给新主
  if (isHeirPending(state)) {
    return `第 ${state.generation} 代择主 · 新主承袭${findHomeLevel(state.homeLevel).name}、${ownedFiefCount(state.fiefs)} 郡、${state.ownedPartnerIds.length} 位伴侣 · 家业点 ${state.legacyPoints} · 存金 ${state.gold.toLocaleString()}`;
  }
  const count = dynastyCount(state.realms);
  const faction = FACTIONS[state.faction];
  if (count === 0 && faction.id === 'qun') return undefined;
  // v3.2：横幅写本朝势力与本府（「魏 · 颍川」），国号效果按冻结遗泽 + 本朝一份
  const eff = effectiveRealms(state);
  const seat = findFief(faction.seat);
  const seatName = seat ? nodeShortName(seat) : faction.capital;
  const pack = (['wei', 'shu', 'wu'] as const).filter((id) => eff[id] > 0).map((id) => `${findRealm(id)!.name}×${eff[id]}`).join('、');
  return `第 ${count + 1} 朝 · ${faction.name} · ${seatName}（${faction.capital}）${pack ? ` · 国号加成 ${pack}` : ''} · 开局 ${state.foundingGold.toLocaleString()} 金${faction.id !== 'qun' ? ` · ${faction.name}营主公为旧部，三项 +3` : ''}`;
}

function confirmReset(message: string) {
  return window.confirm(`${message}\n\n建议先在设置里复制存档备份。确定继续吗？`);
}
