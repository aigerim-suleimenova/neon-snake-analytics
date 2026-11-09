import './style.css';

import Phaser from 'phaser';

import { GameController } from './application/GameController';
import { offlinePlatform } from './application/GamePlatform';
import { KeyValueGameStorage } from './core/storage/GameStorage';
import { SnakeScene } from './game/scenes/SnakeScene';
import { SnakeGame } from './game/snakeGame';
import type { Direction, GamePhase, GameSnapshot } from './game/types';
import { connectAnalytics } from './platform/analytics/connectAnalytics';
import { createEventSender } from './platform/analytics/createEventSender';
import { randomId } from './platform/analytics/randomId';
import { connectFamobi } from './platform/famobi/connectFamobi';
import { getGameInterface } from './platform/famobi/FamobiGameInterface';
import { FamobiPlatform } from './platform/famobi/FamobiPlatform';

const requiredElement = <T extends HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
};

const levelValue = requiredElement<HTMLElement>('#level-value');
const scoreValue = requiredElement<HTMLElement>('#score-value');
const bestValue = requiredElement<HTMLElement>('#best-value');
const fruitValue = requiredElement<HTMLElement>('#fruit-value');
const progressValue = requiredElement<HTMLElement>('#progress-value');
const overlay = requiredElement<HTMLElement>('#game-overlay');
const overlayEyebrow = requiredElement<HTMLElement>('#overlay-eyebrow');
const overlayTitle = requiredElement<HTMLElement>('#overlay-title');
const overlayCopy = requiredElement<HTMLElement>('#overlay-copy');
const primaryAction = requiredElement<HTMLButtonElement>('#primary-action');
const secondaryAction = requiredElement<HTMLButtonElement>('#secondary-action');
const pauseButton = requiredElement<HTMLButtonElement>('#pause-button');
const muteButton = requiredElement<HTMLButtonElement>('#mute-button');
const levelSelect = requiredElement<HTMLElement>('#level-select');

// With the Famobi SDK present, saving and the gameplay moments go through it; otherwise the game runs on its own.
const gameInterface = getGameInterface();
const storage = new KeyValueGameStorage(gameInterface ? () => gameInterface.storage : undefined);
const simulation = new SnakeGame();
const controller = new GameController(simulation, storage, gameInterface ? new FamobiPlatform(gameInterface) : offlinePlatform);
if (gameInterface) connectFamobi(controller, gameInterface);
// Gameplay analytics for our own backend; off without VITE_ANALYTICS_URL. The sender is never disposed:
// beforeunload fires before pagehide, and disposing would remove the listener that hands events to sendBeacon.
connectAnalytics(controller.events, createEventSender(import.meta.env.VITE_ANALYTICS_URL), randomId);
const snakeScene = new SnakeScene(controller);
let currentSnapshot = controller.getSnapshot();

const phaserGame = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game-container',
  width: 600,
  height: 600,
  backgroundColor: '#10182c',
  scene: [snakeScene],
  render: {
    antialias: true,
    pixelArt: false
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  }
});

const failureCopy: Record<NonNullable<GameSnapshot['failureReason']>, string> = {
  wall: 'You ran into the edge of the grid.',
  snake: 'You crossed your own trail.',
  obstacle: 'That barrier was tougher than it looked.',
  external: 'The run was ended by an external game command.'
};

const overlayContent: Record<
  Exclude<GamePhase, 'playing'>,
  (snapshot: GameSnapshot) => {
    eyebrow: string;
    title: string;
    copy: string;
    primary?: string;
    secondary?: string;
  }
> = {
  menu: () => ({
    eyebrow: 'Three levels',
    title: 'Ready to slither?',
    copy: 'Eat the fruit, avoid the walls, and clear every level.',
    primary: 'Start game'
  }),
  paused: (snapshot) =>
    snapshot.pauseSource === 'system'
      ? {
          eyebrow: 'Game paused',
          title: 'Please wait',
          copy: 'Gameplay will continue when the interruption has ended.'
        }
      : {
          eyebrow: 'Game paused',
          title: 'Take a breather',
          copy: 'Your run is waiting exactly where you left it.',
          primary: 'Resume',
          secondary: 'Exit to menu'
        },
  'level-complete': (snapshot) => ({
    eyebrow: `Level ${snapshot.level} clear`,
    title: 'Nice moves!',
    copy: `Score ${snapshot.score}. The next grid is faster and a little less friendly.`,
    primary: 'Next level',
    secondary: 'Exit to menu'
  }),
  'game-over': (snapshot) => ({
    eyebrow: `Level ${snapshot.level}`,
    title: 'Game over',
    copy: snapshot.failureReason ? failureCopy[snapshot.failureReason] : 'That run came to an end.',
    primary: 'Try again',
    secondary: 'Exit to menu'
  }),
  finished: (snapshot) => ({
    eyebrow: 'All levels clear',
    title: 'Snake master!',
    copy: `Final score: ${snapshot.score}. You conquered every grid.`,
    primary: 'Play again',
    secondary: 'Main menu'
  })
};

const resultPhases: GamePhase[] = ['level-complete', 'game-over', 'finished'];

const renderInterface = (snapshot: GameSnapshot): void => {
  currentSnapshot = snapshot;
  const busy = controller.isBusy();
  const systemPaused = controller.isSystemPaused();

  levelValue.textContent = String(snapshot.level);
  scoreValue.textContent = String(snapshot.score);
  bestValue.textContent = String(controller.getProfile().bestScore);
  fruitValue.textContent = `${snapshot.fruitEaten} / ${snapshot.target}`;
  progressValue.style.transform = `scaleX(${Math.min(1, snapshot.progress)})`;

  const canPause = (snapshot.phase === 'playing' || snapshot.phase === 'paused') && !busy && !systemPaused;
  pauseButton.disabled = !canPause;
  pauseButton.setAttribute('aria-label', snapshot.phase === 'paused' ? 'Resume game' : 'Pause game');
  pauseButton.firstElementChild!.textContent = snapshot.phase === 'paused' ? '▶' : 'Ⅱ';
  levelSelect.hidden = snapshot.phase !== 'menu' || systemPaused;
  levelSelect.querySelectorAll<HTMLButtonElement>('[data-level]').forEach((button) => {
    const level = Number(button.dataset.level);
    button.disabled = busy || level > controller.getProfile().highestUnlockedLevel;
  });

  // A result screen appears only once the platform has confirmed the end of the level.
  if (snapshot.phase === 'playing' || (busy && resultPhases.includes(snapshot.phase))) {
    overlay.hidden = true;
    return;
  }

  overlay.hidden = false;
  // The platform's pause covers every screen, without the buttons of the screen underneath.
  const content = systemPaused ? overlayContent.paused({ ...snapshot, pauseSource: 'system' }) : overlayContent[snapshot.phase](snapshot);
  overlayEyebrow.textContent = content.eyebrow;
  overlayTitle.textContent = content.title;
  overlayCopy.textContent = content.copy;
  primaryAction.textContent = content.primary ?? '';
  primaryAction.hidden = !content.primary;
  primaryAction.disabled = busy;
  secondaryAction.textContent = content.secondary ?? '';
  secondaryAction.hidden = !content.secondary;
  secondaryAction.disabled = busy;
};

const performPrimaryAction = (): void => {
  switch (currentSnapshot.phase) {
    case 'menu':
    case 'finished':
      controller.startNewGame();
      break;
    case 'paused':
      if (currentSnapshot.pauseSource === 'player') controller.togglePlayerPause();
      break;
    case 'level-complete':
      controller.goToNextLevel();
      break;
    case 'game-over':
      controller.restartLevel();
      break;
    case 'playing':
      break;
  }
};

const togglePause = (): void => {
  controller.togglePlayerPause();
};

const renderAudioState = (): void => {
  const audioState = controller.getAudioState();
  muteButton.setAttribute('aria-label', audioState.playerMuted ? 'Unmute audio' : 'Mute audio');
  muteButton.firstElementChild!.textContent = audioState.effectiveMuted ? '×' : '♪';
};

controller.subscribe(renderInterface);
controller.events.on('busyChanged', () => renderInterface(controller.getSnapshot()));
controller.events.on('systemPauseChanged', () => renderInterface(controller.getSnapshot()));
controller.events.on('audioChanged', renderAudioState);
renderAudioState();

primaryAction.addEventListener('click', performPrimaryAction);
secondaryAction.addEventListener('click', () => controller.quitToMenu());
pauseButton.addEventListener('click', togglePause);
muteButton.addEventListener('click', () => controller.togglePlayerMuted());

document.querySelectorAll<HTMLButtonElement>('[data-direction]').forEach((button) => {
  button.addEventListener('click', () => {
    controller.move(button.dataset.direction as Direction);
    phaserGame.canvas.focus({ preventScroll: true });
  });
});

levelSelect.querySelectorAll<HTMLButtonElement>('[data-level]').forEach((button) => {
  button.addEventListener('click', () => controller.startAtLevel(Number(button.dataset.level)));
});

window.addEventListener('beforeunload', () => {
  controller.dispose();
  phaserGame.destroy(true);
});
