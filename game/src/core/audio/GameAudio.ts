export type AudioCue = 'start' | 'fruit' | 'level-complete' | 'game-over' | 'finished';

type Tone = {
  frequency: number;
  duration: number;
  type: OscillatorType;
};

const tones: Record<AudioCue, Tone[]> = {
  start: [
    { frequency: 330, duration: 0.06, type: 'sine' },
    { frequency: 440, duration: 0.08, type: 'sine' }
  ],
  fruit: [{ frequency: 640, duration: 0.07, type: 'square' }],
  'level-complete': [
    { frequency: 440, duration: 0.08, type: 'sine' },
    { frequency: 554, duration: 0.08, type: 'sine' },
    { frequency: 659, duration: 0.12, type: 'sine' }
  ],
  'game-over': [
    { frequency: 220, duration: 0.12, type: 'sawtooth' },
    { frequency: 150, duration: 0.18, type: 'sawtooth' }
  ],
  finished: [
    { frequency: 523, duration: 0.09, type: 'sine' },
    { frequency: 659, duration: 0.09, type: 'sine' },
    { frequency: 784, duration: 0.16, type: 'sine' }
  ]
};

export class GameAudio {
  private context: AudioContext | null = null;
  private playerMuted: boolean;
  private systemMuted = false;

  constructor(initialPlayerMuted: boolean) {
    this.playerMuted = initialPlayerMuted;
  }

  get isPlayerMuted(): boolean {
    return this.playerMuted;
  }

  get isEffectivelyMuted(): boolean {
    return this.playerMuted || this.systemMuted;
  }

  setPlayerMuted(muted: boolean): void {
    this.playerMuted = muted;
  }

  setSystemMuted(muted: boolean): void {
    this.systemMuted = muted;
  }

  play(cue: AudioCue): void {
    if (this.isEffectivelyMuted) return;

    const context = this.getContext();
    if (!context) return;
    void context.resume();

    let offset = 0;
    tones[cue].forEach((tone) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const startsAt = context.currentTime + offset;
      const endsAt = startsAt + tone.duration;

      oscillator.type = tone.type;
      oscillator.frequency.setValueAtTime(tone.frequency, startsAt);
      gain.gain.setValueAtTime(0.0001, startsAt);
      gain.gain.exponentialRampToValueAtTime(0.055, startsAt + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, endsAt);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(startsAt);
      oscillator.stop(endsAt + 0.01);
      offset += tone.duration;
    });
  }

  dispose(): void {
    void this.context?.close();
    this.context = null;
  }

  private getContext(): AudioContext | null {
    if (this.context) return this.context;
    const AudioContextConstructor = window.AudioContext;
    if (!AudioContextConstructor) return null;
    this.context = new AudioContextConstructor();
    return this.context;
  }
}
