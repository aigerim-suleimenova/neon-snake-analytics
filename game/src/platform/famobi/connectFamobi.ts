import type { GameController } from '../../application/GameController';
import type { FamobiGameInterface } from './FamobiGameInterface';
import { toPercent } from './FamobiPlatform';

/**
 * Wires everything that is not an awaited gameplay moment: loading, live score and progress,
 * the platform's pause and mute, the player's mute choice, and the platform's requests.
 * Call it before the game scene is created, so gameReady follows the registered callbacks.
 */
export const connectFamobi = (controller: GameController, sdk: FamobiGameInterface): void => {
  sdk.sendPreloadProgress(0);

  controller.events.on('ready', () => {
    // The game has no assets to download, so loading is complete once the title screen is interactive.
    sdk.sendPreloadProgress(100);
    sdk.gameReady();
  });

  controller.events.on('scoreChanged', ({ score, level }) => sdk.sendScore(score, { level }));

  let reportedProgress: number | null = null;
  controller.events.on('progressChanged', ({ progress }) => {
    const percent = toPercent(progress);
    if (percent === reportedProgress) return;
    reportedProgress = percent;
    sdk.sendProgress(percent);
  });

  controller.setSystemPaused(sdk.isPaused());
  sdk.onPauseStateChange((paused) => controller.setSystemPaused(paused));

  controller.setSystemMuted(sdk.isMuted());
  sdk.onMuteStateChange((muted) => controller.setSystemMuted(muted));

  let reportedPlayerMuted = controller.getAudioState().playerMuted;
  sdk.gameMuted(reportedPlayerMuted);
  controller.events.on('audioChanged', ({ playerMuted }) => {
    if (playerMuted === reportedPlayerMuted) return;
    reportedPlayerMuted = playerMuted;
    sdk.gameMuted(playerMuted);
  });

  sdk.onGoToHome(() => void controller.quitToMenu('platform'));
  sdk.onQuitGame(() => void controller.quitToMenu('platform'));
  sdk.onGoToNextLevel(() => void controller.goToNextLevel('platform'));
  sdk.onRestartGame(() => void controller.restartLevel('platform'));
  // A level the player has not reached yet starts the highest unlocked one instead.
  sdk.onGoToLevel(
    (level) => void controller.startAtLevel(Math.min(level, controller.getProfile().highestUnlockedLevel), 'platform')
  );
  sdk.onGameOver(() => controller.forceGameOver());
};
