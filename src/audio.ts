/**
 * Pure Web Audio API mathematical synthesizer for the NYC Snow Globe.
 * Zero audio files — all sounds are synthesized in real time from oscillators and filtered noise:
 * - Borosilicate glass touch / grab chime (inharmonic modal partials)
 * - Viscous liquid slosh & snow swirl whoosh modulated by shake velocity
 * - Minnaert-resonance tiny liquid bubble pops during vigorous shakes
 * - Heavy walnut-on-oak desk thud when the base settles back down
 */
export class SnowGlobeAudio {
  private ctx: AudioContext | null = null;
  private enabled = true;
  private swishGain: GainNode | null = null;
  private swishFilter: BiquadFilterNode | null = null;
  private lastBubbleTime = 0;

  public isEnabled(): boolean {
    return this.enabled;
  }

  public setEnabled(val: boolean): void {
    this.enabled = val;
    if (this.ctx && this.swishGain) {
      this.swishGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    }
  }

  private ensureContext(): AudioContext | null {
    if (!this.enabled) return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
      this.setupContinuousSwishNode(this.ctx);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private setupContinuousSwishNode(ctx: AudioContext): void {
    // 2 seconds of synthesized pink-brown noise for liquid sloshing
    const sampleRate = ctx.sampleRate;
    const length = sampleRate * 2;
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);

    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.04;
      b6 = white * 0.115926;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 340;
    filter.Q.value = 2.2;

    const gain = ctx.createGain();
    gain.gain.value = 0.0;

    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    source.start();

    this.swishFilter = filter;
    this.swishGain = gain;
  }

  /** Plays a subtle resonant borosilicate glass tap when grabbing the globe */
  public playGlassGrab(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const partials = [
      { freq: 1180, amp: 0.06, decay: 0.28 },
      { freq: 2740, amp: 0.032, decay: 0.16 },
      { freq: 4410, amp: 0.014, decay: 0.08 },
    ];

    for (const p of partials) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(p.freq, now);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(p.amp, now + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, now + p.decay);

      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + p.decay + 0.02);
    }
  }

  /** Plays a soft wooden desk thud when the heavy walnut base settles */
  public playBaseSettle(intensity = 0.6): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(125, now);
    osc.frequency.exponentialRampToValueAtTime(46, now + 0.11);

    const amp = Math.min(0.14, 0.08 * intensity);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(amp, now + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);

    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.16);
  }

  /** Updates continuous liquid slosh sound & occasional Minnaert bubble bloops */
  public updateShakeSound(shakeSpeed: number, swirlEnergy: number): void {
    if (!this.enabled || !this.ctx || !this.swishGain || !this.swishFilter) return;

    const now = this.ctx.currentTime;
    const targetGain = Math.min(0.18, shakeSpeed * 0.065 + swirlEnergy * 0.04);
    const targetFreq = 260 + Math.min(900, shakeSpeed * 280 + swirlEnergy * 240);

    this.swishGain.gain.setTargetAtTime(targetGain, now, 0.04);
    this.swishFilter.frequency.setTargetAtTime(targetFreq, now, 0.05);

    // Trigger a tiny Minnaert bubble bloop during active swirling
    if (swirlEnergy > 0.35 && now - this.lastBubbleTime > 0.16 + Math.random() * 0.22) {
      this.lastBubbleTime = now;
      const bOsc = this.ctx.createOscillator();
      const bGain = this.ctx.createGain();
      const f0 = 680 + Math.random() * 520;
      bOsc.type = 'sine';
      bOsc.frequency.setValueAtTime(f0, now);
      bOsc.frequency.exponentialRampToValueAtTime(f0 * 1.48, now + 0.055);

      bGain.gain.setValueAtTime(0.0001, now);
      bGain.gain.linearRampToValueAtTime(0.015 * swirlEnergy, now + 0.006);
      bGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);

      bOsc.connect(bGain);
      bGain.connect(this.ctx.destination);
      bOsc.start(now);
      bOsc.stop(now + 0.07);
    }
  }
}
