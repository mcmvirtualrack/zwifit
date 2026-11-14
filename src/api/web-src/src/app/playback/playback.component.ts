import { atIntensity } from '../core/intensity';
import { IntensityControlComponent } from '../shared/intensity-control.component';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SensorSource } from '../core/api.types';
import { HrHistoryService } from '../core/hr-history.service';
import { PlanProfileService } from '../core/plan-profile.service';
import { POWER_ZONE_FLOORS, POWER_ZONE_NAMES, PrefsService, zoneOf } from '../core/prefs.service';
import { SocketService } from '../core/socket.service';
import { ToastService } from '../core/toast.service';
import { END_REASONS } from '../core/units';
import { clock } from '../shared/chart';
import { HrTraceComponent } from '../shared/hr-trace.component';
import { LiveChartComponent } from '../shared/live-chart.component';

const RING = 2 * Math.PI * 54;
// The belt is "on target" within this many km/h.
const ON_TARGET_KPH = 0.15;

const average = (values: number[]) => (values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null);

@Component({
	selector: 'app-playback',
	imports: [IntensityControlComponent, RouterLink, HrTraceComponent, LiveChartComponent],
	templateUrl: './playback.component.html'
})
export class PlaybackComponent {
	protected readonly socket = inject(SocketService);
	protected readonly prefs = inject(PrefsService);
	private readonly toast = inject(ToastService);
	private readonly history = inject(HrHistoryService);
	private readonly profile = inject(PlanProfileService);
	protected readonly busy = signal(false);
	protected readonly reasons = END_REASONS;
	protected readonly round = Math.round;

	protected readonly p = computed(() => this.socket.playback());
	protected readonly treadmill = computed(() => this.socket.status()?.treadmill ?? null);
	protected readonly active = computed(() => ['waiting', 'running', 'paused', 'resuming'].includes(this.p()?.state ?? 'idle'));
	protected readonly finished = computed(() => ['completed', 'ended'].includes(this.p()?.state ?? 'idle'));
	// The live lanes: which sensors have reported during this workout, and the time window.
	protected readonly window = signal<'short' | 'long' | 'workout'>('workout');
	protected readonly workoutStart = computed(() => Date.now() - (this.p()?.planElapsed.seconds ?? 0) * 1000);
	protected readonly sensorsSeen = computed(() => {
		const since = this.workoutStart();
		const t = this.treadmill();
		const samples = this.history.samples().filter(s => s.t >= since);
		const hr = !!t?.hr || samples.some(s => s.bpm);
		const cadence = !!t?.cadence || samples.some(s => s.c);
		const power = !!t?.power || samples.some(s => s.w);
		return { hr, cadence, power, any: hr || cadence || power };
	});

	protected readonly totalSeconds = computed(() => {
		const p = this.p();
		return p?.planRemaining ? p.planElapsed.seconds + p.planRemaining.seconds : this.profile.totalSeconds();
	});

	protected readonly plannedMetres = computed(() => {
		const p = this.p();
		return p?.planRemaining ? p.planElapsed.metres + p.planRemaining.metres : null;
	});

	protected readonly stepProgress = computed(() => {
		const p = this.p();
		const step = p?.current;
		if (!p || !step) {
			return 0;
		}
		const done = step.end.type === 'time' ? p.stepElapsed.seconds / step.end.seconds : p.stepElapsed.metres / step.end.metres;
		return Math.min(100, Math.max(0, done * 100));
	});

	protected readonly ringOffset = computed(() => Math.round(RING * (this.stepProgress() / 100) * 10) / 10);

	protected readonly planProgress = computed(() => {
		const p = this.p();
		if (!p || !p.planRemaining) {
			return this.finished() ? 100 : 0;
		}
		const total = p.planElapsed.seconds + p.planRemaining.seconds;
		return total ? Math.min(100, (p.planElapsed.seconds / total) * 100) : 0;
	});

	protected readonly targetKph = computed(() => {
		const p = this.p();
		return p?.override?.kph ?? (p?.current ? atIntensity(p.current.targetKph, p.intensity, this.treadmill()?.limits) : 0);
	});

	protected readonly onTarget = computed(() => {
		const t = this.treadmill();
		return !!t?.connected && Math.abs(t.kph - this.targetKph()) <= ON_TARGET_KPH;
	});

	protected readonly powerNames = POWER_ZONE_NAMES;
	protected readonly powerZone = computed(() => {
		const w = this.treadmill()?.power;
		const t = this.prefs.thresholdPower();
		return w && t ? zoneOf(w, t, POWER_ZONE_FLOORS) : null;
	});
	protected readonly zone = computed(() => {
		const hr = this.treadmill()?.hr;
		return hr ? zoneOf(hr, this.prefs.maxHr()) : null;
	});

	// Averages since the current step began.
	protected readonly stepAvg = computed(() => {
		const since = Date.now() - (this.p()?.stepElapsed.seconds ?? 0) * 1000;
		const samples = this.history.samples().filter(s => s.t >= since);
		const of = (pick: (s: (typeof samples)[number]) => number | null | undefined) => average(samples.map(pick).filter((v): v is number => typeof v === 'number' && v > 0));
		return { hr: of(s => s.bpm), cadence: of(s => s.c), power: of(s => s.w) };
	});

	// The plan's steps as bars (height = speed), coloured done / current / to do.
	protected readonly bars = computed(() => {
		const steps = this.profile.steps();
		const total = this.profile.totalSeconds();
		const current = this.p()?.cursor?.flatIndex ?? (this.finished() ? steps.length : -1);
		if (!steps.length || !total) {
			return [];
		}
		const top = Math.max(...steps.map(s => s.kph)) * 1.15 || 1;
		return steps.map((s, i) => ({
			x: Math.round((s.startsAt / total) * 10000) / 10,
			w: Math.max(1, Math.round(((s.seconds / total) * 1000 - 3) * 10) / 10),
			y: Math.round((100 - (s.kph / top) * 100) * 10) / 10,
			state: i < current ? 'done' : i === current ? 'current' : 'todo'
		}));
	});

	protected readonly profileAxis = computed(() => {
		const total = this.profile.totalSeconds();
		return Array.from({ length: 6 }, (_, i) => clock((total * i) / 5));
	});

	protected readonly upNext = computed(() => {
		const steps = this.profile.steps();
		const current = this.p()?.cursor?.flatIndex ?? -1;
		const speeds = steps.map(s => s.kph);
		const low = Math.min(...speeds);
		const high = Math.max(...speeds);
		const controlIncline = !!this.p()?.controlIncline;
		return steps.slice(current + 1, current + 5).map(s => {
			const share = high > low ? (s.kph - low) / (high - low) : 1;
			return {
				label: s.label,
				target: `${this.prefs.speed(atIntensity(s.kph, this.p()?.intensity, this.treadmill()?.limits))} ${this.prefs.speedLabel()}${controlIncline ? ` · ${s.incline}%` : ''}`,
				duration: clock(s.seconds),
				shade: share > 0.66 ? 3 : share > 0.33 ? 2 : 1
			};
		});
	});

	protected readonly remainingText = computed(() => {
		const r = this.p()?.stepRemaining;
		if (!r) {
			return '–';
		}
		return r.seconds !== undefined ? this.prefs.duration(r.seconds) : this.prefs.distance(r.metres);
	});

	protected readonly remainingUnit = computed(() => {
		const r = this.p()?.stepRemaining;
		return r && r.seconds === undefined ? this.prefs.distanceLabel() : '';
	});

	protected sourceLabel(source: SensorSource | null | undefined): string {
		return source === 'ant' ? 'ANT+ sensor' : source === 'ble' ? 'Bluetooth sensor' : source === 'treadmill' ? 'from the treadmill' : 'not available';
	}

	// "Run · interval 4 of 6"
	protected stepTitle(step: { label?: string; flatIndex: number; repetition: number; repeatOf: number; blockLabel: string } | null): string {
		if (!step) {
			return '';
		}
		const name = step.label || `Step ${step.flatIndex + 1}`;
		return step.repeatOf > 1 ? `${name} · interval ${step.repetition} of ${step.repeatOf}` : name;
	}

	protected runAgain(planId: string): void {
		this.command('playback:start', undefined, { planId });
	}

	protected async command(event: string, confirmText?: string, payload?: unknown): Promise<void> {
		if (confirmText && !confirm(confirmText)) {
			return;
		}
		this.busy.set(true);
		try {
			await this.socket.request(event, payload);
		}
		catch (err) {
			this.toast.error(err);
		}
		finally {
			this.busy.set(false);
		}
	}
}
