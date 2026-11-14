import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { PlaybackStep } from '../core/api.types';
import { atIntensity } from '../core/intensity';
import { PrefsService } from '../core/prefs.service';
import { SocketService } from '../core/socket.service';

const WARN_S = 5;

// The last 5 seconds of a plan step: a big flashing number over every page with what comes next,
// a beep each second and a long tone when the next step starts. Playback reports the time left
// once a second; the countdown runs on this device's clock between reports so it ticks evenly.
// Distance steps are timed from the belt's speed. It never blocks taps (Pause / Skip stay usable).
@Component({
	selector: 'app-step-countdown',
	template: `
		@if (shown(); as n) {
			<div class="countdown" [class.countdown--last]="n === 1" role="status" aria-live="assertive" aria-atomic="true">
				<div class="countdown__panel">
					<span class="countdown__eyebrow">{{ nextStep() ? 'Next step in' : 'Workout ends in' }}</span>
					<span class="countdown__number num">{{ n }}</span>
					@if (nextStep(); as s) {
						<span class="countdown__next">
							@if (s.label) { <strong>{{ s.label }}</strong> }
							<span class="num">{{ prefs.speed(nextKph()) }} {{ prefs.speedLabel() }}</span>
							<span class="num">{{ s.targetIncline }}%</span>
						</span>
					}
				</div>
			</div>
		}
	`
})
export class StepCountdownComponent {
	private readonly socket = inject(SocketService);
	protected readonly prefs = inject(PrefsService);
	private readonly now = signal(Date.now());
	// When the current step should end (device clock), from the latest playback report.
	private readonly endsAt = signal<number | null>(null);
	private audio: AudioContext | null = null;
	private lastBeep: number | null = null;
	private lastStep: number | null = null;

	protected readonly nextStep = computed<PlaybackStep | null>(() => this.socket.playback()?.next ?? null);

	protected readonly nextKph = computed(() => {
		const p = this.socket.playback();
		return p?.next ? atIntensity(p.next.targetKph, p.intensity, this.socket.status()?.treadmill?.limits) : null;
	});

	private readonly secondsLeft = computed(() => {
		const end = this.endsAt();
		return end === null ? null : Math.ceil((end - this.now()) / 1000);
	});

	protected readonly shown = computed(() => {
		const p = this.socket.playback();
		const left = this.secondsLeft();
		return this.prefs.stepCountdown() && p?.state === 'running' && left !== null && left >= 1 && left <= WARN_S ? left : null;
	});

	constructor() {
		// Re-time the end of the step on each report.
		effect(() => {
			const p = this.socket.playback();
			const r = p?.stepRemaining;
			if (!p || p.state !== 'running' || !r) {
				this.endsAt.set(null);
				return;
			}
			let seconds = r.seconds;
			if (seconds === undefined && r.metres !== undefined) {
				const t = this.socket.status()?.treadmill;
				const kph = t?.connected && t.kph > 0.5 ? t.kph : p.current ? atIntensity(p.current.targetKph, p.intensity) : 0;
				seconds = kph > 0 ? r.metres / (kph / 3.6) : undefined;
			}
			this.endsAt.set(seconds === undefined ? null : Date.now() + seconds * 1000);
		});

		// Beeps: short on 5…1, long when the step changes or the plan completes right after a countdown.
		effect(() => {
			const n = this.shown();
			if (n !== null && n !== this.lastBeep) {
				this.lastBeep = n;
				this.beep(n === 1 ? 990 : 880, 0.12);
			}
		});
		effect(() => {
			const p = this.socket.playback();
			const step = p?.cursor?.flatIndex ?? null;
			const finished = !!p && p.state !== 'running' && p.endReason === 'completed';
			if (this.lastBeep !== null && this.lastBeep <= 2 && ((step !== null && step !== this.lastStep && this.lastStep !== null) || finished)) {
				this.beep(1320, 0.45);
				this.lastBeep = null;
			}
			if (this.shown() === null && this.lastBeep !== null && this.lastBeep > 2) {
				this.lastBeep = null;
			}
			this.lastStep = step;
		});

		const timer = setInterval(() => this.now.set(Date.now()), 100);
		// Browsers only allow sound after a tap or key press: unlock audio on the first one.
		const unlock = () => this.ensureAudio();
		window.addEventListener('pointerdown', unlock);
		window.addEventListener('keydown', unlock);
		inject(DestroyRef).onDestroy(() => {
			clearInterval(timer);
			window.removeEventListener('pointerdown', unlock);
			window.removeEventListener('keydown', unlock);
			void this.audio?.close();
		});
	}

	private ensureAudio(): AudioContext | null {
		try {
			if (!this.audio) {
				const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
				this.audio = Ctor ? new Ctor() : null;
			}
			if (this.audio?.state === 'suspended') {
				void this.audio.resume();
			}
		}
		catch {
			this.audio = null;
		}
		return this.audio;
	}

	private beep(frequency: number, seconds: number): void {
		if (!this.prefs.stepCountdown() || !this.prefs.stepCountdownSound()) {
			return;
		}
		const ctx = this.ensureAudio();
		if (!ctx || ctx.state !== 'running') {
			return;
		}
		const osc = ctx.createOscillator();
		const gain = ctx.createGain();
		osc.type = 'sine';
		osc.frequency.value = frequency;
		const t = ctx.currentTime;
		gain.gain.setValueAtTime(0.0001, t);
		gain.gain.exponentialRampToValueAtTime(0.35, t + 0.01);
		gain.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
		osc.connect(gain).connect(ctx.destination);
		osc.start(t);
		osc.stop(t + seconds + 0.02);
	}
}
