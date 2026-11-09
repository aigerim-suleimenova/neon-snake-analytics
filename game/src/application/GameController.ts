import { GameAudio } from '../core/audio/GameAudio';
import { EventBus } from '../core/events/EventBus';
import type { GameStorage, PlayerProfile } from '../core/storage/GameStorage';
import { LEVELS } from '../game/levels';
import { SnakeGame } from '../game/snakeGame';
import type { Direction, FailureReason, GameListener, GameSnapshot, PauseSource } from '../game/types';
import type { GameEventMap, RunEndReason } from './gameEvents';
import { offlinePlatform, type GamePlatform, type RunSummary } from './GamePlatform';

/** Who asked for a command. Player commands are blocked while the platform pauses the game. */
export type CommandSource = 'player' | 'platform';

const isActive = (snapshot: GameSnapshot): boolean => snapshot.phase === 'playing' || snapshot.phase === 'paused';

const levelEndReason = (snapshot: GameSnapshot): Exclude<RunEndReason, 'quit'> | null => {
  if (snapshot.phase === 'level-complete' || snapshot.phase === 'finished') return 'complete';
  if (snapshot.phase === 'game-over') return 'fail';
  return null;
};

// A failing platform call must not leave the game stuck, so it counts as resolved.
const settle = async (call: () => Promise<void>): Promise<void> => {
  try {
    await call();
  } catch {
    // Gameplay continues without the platform's confirmation.
  }
};

const done = (): Promise<void> => Promise.resolve();

export class GameController {
  readonly events = new EventBus<GameEventMap>();

  private readonly audio: GameAudio;
  private profile: PlayerProfile;
  private previousSnapshot: GameSnapshot;
  private runStartedAt: number | null = null;
  private playerPauseActive = false;
  private systemPauseActive = false;
  private systemMuted = false;
  private ready = false;
  private taskQueue: Promise<void> = Promise.resolve();
  private pendingTasks = 0;
  private tickSkipped = false;

  constructor(
    private readonly simulation: SnakeGame,
    private readonly storage: GameStorage,
    private readonly platform: GamePlatform = offlinePlatform
  ) {
    this.profile = storage.loadProfile();
    this.audio = new GameAudio(this.profile.playerMuted);
    this.previousSnapshot = simulation.getSnapshot();
    simulation.subscribe(this.handleSnapshot);
  }

  getSnapshot(): GameSnapshot {
    return this.simulation.getSnapshot();
  }

  getProfile(): Readonly<PlayerProfile> {
    return this.profile;
  }

  getAudioState(): { playerMuted: boolean; systemMuted: boolean; effectiveMuted: boolean } {
    return {
      playerMuted: this.audio.isPlayerMuted,
      systemMuted: this.systemMuted,
      effectiveMuted: this.audio.isEffectivelyMuted
    };
  }

  /** True while the game waits for the platform; gameplay is frozen and commands are ignored. */
  isBusy(): boolean {
    return this.pendingTasks > 0;
  }

  isSystemPaused(): boolean {
    return this.systemPauseActive;
  }

  subscribe(listener: GameListener): () => void {
    return this.simulation.subscribe(listener);
  }

  markReady(): void {
    if (this.ready) return;
    this.ready = true;
    this.events.emit('ready', { occurredAt: Date.now() });
  }

  startNewGame(source: CommandSource = 'player'): Promise<void> {
    return this.runCommand(source, () => this.beginRun(1, () => this.simulation.start()));
  }

  startAtLevel(level: number, source: CommandSource = 'player'): Promise<void> {
    const highestAllowedLevel = Math.min(this.profile.highestUnlockedLevel, LEVELS.length);
    if (!Number.isInteger(level) || level < 1 || level > highestAllowedLevel) return done();
    return this.goToLevel(level, source);
  }

  goToLevel(level: number, source: CommandSource = 'player'): Promise<void> {
    if (!Number.isInteger(level) || level < 1 || level > LEVELS.length) return done();
    return this.runCommand(source, () => this.beginRun(level, () => this.simulation.startAtLevel(level)));
  }

  restartLevel(source: CommandSource = 'player'): Promise<void> {
    const { level } = this.simulation.getSnapshot();
    return this.runCommand(source, () => this.beginRun(level, () => this.simulation.restartLevel()));
  }

  goToNextLevel(source: CommandSource = 'player'): Promise<void> {
    const snapshot = this.simulation.getSnapshot();
    if (isActive(snapshot)) return this.goToLevel(Math.min(LEVELS.length, snapshot.level + 1), source);
    if (snapshot.phase !== 'level-complete') return done();
    return this.runCommand(source, () => this.beginRun(snapshot.level + 1, () => this.simulation.nextLevel()));
  }

  quitToMenu(source: CommandSource = 'player'): Promise<void> {
    if (this.simulation.getSnapshot().phase === 'menu') return done();
    return this.runCommand(source, async () => {
      if (isActive(this.simulation.getSnapshot())) await this.endActiveRun();
      this.resetPauseState();
      this.simulation.quitToMenu();
    });
  }

  forceGameOver(): void {
    if (this.isBusy()) return;
    this.resetPauseState();
    this.simulation.forceGameOver();
  }

  move(direction: Direction): void {
    this.simulation.setDirection(direction);
  }

  tick(): void {
    if (this.isBusy()) {
      this.tickSkipped = true;
      return;
    }
    this.simulation.step();
  }

  togglePlayerPause(): Promise<void> {
    if (!isActive(this.simulation.getSnapshot())) return done();
    return this.runCommand('player', async () => {
      const pause = !this.playerPauseActive;
      await settle(() => (pause ? this.platform.pauseRun() : this.platform.resumeRun()));
      if (!isActive(this.simulation.getSnapshot())) return;
      this.playerPauseActive = pause;
      this.reconcilePauseState();
    });
  }

  setSystemPaused(paused: boolean): void {
    if (this.systemPauseActive === paused) return;
    this.systemPauseActive = paused;
    this.reconcilePauseState();
    this.events.emit('systemPauseChanged', { paused });
  }

  togglePlayerMuted(): void {
    this.setPlayerMuted(!this.audio.isPlayerMuted);
  }

  setPlayerMuted(muted: boolean): void {
    if (this.audio.isPlayerMuted === muted) return;
    this.audio.setPlayerMuted(muted);
    this.profile = { ...this.profile, playerMuted: muted };
    this.persistProfile();
    this.emitAudioState();
  }

  setSystemMuted(muted: boolean): void {
    if (this.systemMuted === muted) return;
    this.systemMuted = muted;
    this.audio.setSystemMuted(muted);
    this.emitAudioState();
  }

  dispose(): void {
    this.audio.dispose();
    this.events.clear();
  }

  private handleSnapshot = (snapshot: GameSnapshot): void => {
    const previous = this.previousSnapshot;
    const now = Date.now();

    if (snapshot.score !== previous.score) {
      const delta = snapshot.score - previous.score;
      if (delta > 0) this.audio.play('fruit');
      if (snapshot.score > this.profile.bestScore) {
        this.profile = { ...this.profile, bestScore: snapshot.score };
        this.persistProfile();
      }
      this.events.emit('scoreChanged', { level: snapshot.level, score: snapshot.score, delta });
    }

    if (snapshot.progress !== previous.progress || snapshot.level !== previous.level) {
      this.events.emit('progressChanged', {
        level: snapshot.level,
        progress: snapshot.progress,
        collected: snapshot.fruitEaten,
        target: snapshot.target
      });
    }

    const endReason = levelEndReason(snapshot);
    if (endReason && isActive(previous) && this.runStartedAt !== null) {
      const summary = this.summarize(snapshot, now);
      this.emitRunEnded(endReason, summary, now, endReason === 'fail' ? snapshot.failureReason : null);

      if (endReason === 'complete') {
        const highestUnlockedLevel = Math.min(LEVELS.length, snapshot.level + 1);
        if (highestUnlockedLevel > this.profile.highestUnlockedLevel) {
          this.profile = { ...this.profile, highestUnlockedLevel };
          this.persistProfile();
        }
        this.audio.play(snapshot.phase === 'finished' ? 'finished' : 'level-complete');
      } else {
        this.audio.play('game-over');
      }

      // The level has already ended in the simulation; the result screen waits for the platform.
      const finished = snapshot.phase === 'finished';
      void this.enqueue(async () => {
        await settle(() => this.platform.endRun(endReason, summary));
        if (finished) await settle(() => this.platform.finishGame(summary));
      });
    }

    const pauseChanged = snapshot.phase === 'paused' !== (previous.phase === 'paused');
    const pauseSourceChanged = snapshot.pauseSource !== previous.pauseSource;
    if (pauseChanged || pauseSourceChanged) {
      this.events.emit('pauseChanged', {
        paused: snapshot.phase === 'paused',
        source: snapshot.pauseSource
      });
    }

    if (snapshot.phase === 'finished' && previous.phase !== 'finished') {
      this.events.emit('gameFinished', { score: snapshot.score, bestScore: this.profile.bestScore });
    }

    this.previousSnapshot = snapshot;
    this.events.emit('stateChanged', snapshot);
  };

  /** Runs a command unless another one is pending or, for the player, the platform pauses the game. */
  private runCommand(source: CommandSource, task: () => Promise<void>): Promise<void> {
    if (this.isBusy()) return done();
    if (source === 'player' && this.systemPauseActive) return done();
    return this.enqueue(task);
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const idle = this.pendingTasks === 0;
    this.pendingTasks += 1;
    if (idle) this.events.emit('busyChanged', { busy: true });
    // An idle queue starts the task at once, so the platform hears about the moment immediately.
    const started = idle ? new Promise<void>((resolve) => resolve(task())) : this.taskQueue.then(task);
    const run = started.finally(() => this.finishTask());
    this.taskQueue = run.catch(() => undefined);
    return run;
  }

  private finishTask(): void {
    this.pendingTasks -= 1;
    if (this.pendingTasks > 0) return;
    this.events.emit('busyChanged', { busy: false });
    // A tick skipped while busy is replayed so the scene's timer is armed again.
    if (this.tickSkipped) {
      this.tickSkipped = false;
      this.tick();
    }
  }

  /** Ends an active level with a quit, then starts a level; the old level stays frozen on screen meanwhile. */
  private async beginRun(level: number, startLevel: () => void): Promise<void> {
    if (isActive(this.simulation.getSnapshot())) await this.endActiveRun();
    await settle(() => this.platform.startRun(level));

    this.resetPauseState();
    startLevel();
    this.reconcilePauseState();

    const now = Date.now();
    this.runStartedAt = now;
    this.profile = { ...this.profile, totalRuns: this.profile.totalRuns + 1 };
    this.persistProfile();
    this.events.emit('runStarted', {
      level: this.simulation.getSnapshot().level,
      runNumber: this.profile.totalRuns,
      occurredAt: now
    });
    this.audio.play('start');
  }

  private async endActiveRun(): Promise<void> {
    const snapshot = this.simulation.getSnapshot();
    const summary = this.summarize(snapshot, Date.now());
    await settle(() => this.platform.endRun('quit', summary));
    this.emitRunEnded('quit', summary, Date.now(), null);
  }

  private summarize(snapshot: GameSnapshot, now: number): RunSummary {
    return {
      level: snapshot.level,
      score: snapshot.score,
      levelScore: snapshot.levelScore,
      progress: snapshot.progress,
      durationMs: this.runStartedAt === null ? 0 : Math.max(0, now - this.runStartedAt)
    };
  }

  private emitRunEnded(
    reason: RunEndReason,
    summary: RunSummary,
    now: number,
    failureReason: FailureReason | null
  ): void {
    this.events.emit('runEnded', {
      level: summary.level,
      score: summary.score,
      levelScore: summary.levelScore,
      progress: summary.progress,
      reason,
      failureReason,
      durationMs: summary.durationMs,
      occurredAt: now
    });
    this.runStartedAt = null;
  }

  private reconcilePauseState(): void {
    const pauseSource: Exclude<PauseSource, null> | null = this.systemPauseActive
      ? 'system'
      : this.playerPauseActive
        ? 'player'
        : null;

    if (pauseSource) this.simulation.pause(pauseSource);
    else this.simulation.resume();
  }

  /** Clears only the player's pause; a platform pause stays until the platform lifts it. */
  private resetPauseState(): void {
    this.playerPauseActive = false;
  }

  private persistProfile(): void {
    this.storage.saveProfile(this.profile);
  }

  private emitAudioState(): void {
    this.events.emit('audioChanged', this.getAudioState());
  }
}
