import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SensorSource } from '../core/api.types';
import { HrHistoryService, HrSample } from '../core/hr-history.service';
import { PlanProfileService } from '../core/plan-profile.service';
import { PrefsService, zoneOf } from '../core/prefs.service';
import { SocketService } from '../core/socket.service';
import { ToastService } from '../core/toast.service';
import { displaySpeed, fromDisplaySpeed } from '../core/units';
import { ceilTo, lanePath } from '../shared/chart';
import { LiveChartComponent } from '../shared/live-chart.component';
import { SparkComponent } from '../shared/spark.component';

const SPEED_STEP = 0.5;
const INCLINE_STEP = 0.5;
const ACTIVE = ['waiting', 'running', 'paused', 'resuming'];
const SPARK_MS = 2 * 60 * 1000;
const WINDOWS = { short: 2 * 60 * 1000, long: 10 * 60 * 1000 };
// A gap longer than this between samples is not counted as time in a zone.
const MAX_GAP_S = 5;

type Window = 'short' | 'long' | 'workout';

const average = (values: number[]) => (values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null);

@Component({
	selector: 'app-control',
	imports: [RouterLink, LiveChartComponent, SparkComponent],
	templateUrl: './control.component.html'
})
export class ControlComponent {
	protected readonly socket = inject(SocketService);
	protected readonly prefs = inject(PrefsService);
	private readonly toast = inject(ToastService);
	private readonly history = inject(HrHistoryService);
	private readonly profile = inject(PlanProfileService);

	// What the live chart, zones and incline chart cover.
	protected readonly window = signal<Window>('long');
	protected readonly windowMs = computed(() => WINDOWS[this.window() === 'short' ? 'short' : 'long']);
	protected readonly windowTitle = computed(() => (this.window() === 'workout' && this.planActive() ? 'workout' : this.window() === 'short' ? 'last 2 min' : 'last 10 min'));
	protected readonly workoutStart = computed(() => Date.now() - (this.playback()?.planElapsed.seconds ?? 0) * 1000);

	private readonly windowSamples = computed<HrSample[]>(() => {
		const samples = this.history.samples();
		const from = this.window() === 'workout' && this.planActive() ? this.workoutStart() : Date.now() - this.windowMs();
		return samples.filter(s => s.t >= from);
	});

	protected readonly sparks = computed(() => {
		const from = Date.now() - SPARK_MS;
		const recent = this.history.samples().filter(s => s.t >= from);
		return { hr: recent.map(s => s.bpm), cadence: recent.map(s => s.c ?? null), power: recent.map(s => s.w ?? null) };
	});

	protected readonly maxOf = computed(() => {
		const hr = this.windowSamples().map(s => s.bpm).filter((v): v is number => v !== null);
		return { hr: hr.length ? Math.max(...hr) : null };
	});

	protected readonly avgOf = computed(() => {
		const of = (pick: (s: HrSample) => number | null | undefined) => average(this.windowSamples().map(pick).filter((v): v is number => typeof v === 'number' && v > 0));
		return { cadence: of(s => s.c), power: of(s => s.w) };
	});

	// Time in each heart-rate zone over the window.
	protected readonly zones = computed(() => {
		const samples = this.windowSamples();
		const max = this.prefs.maxHr();
		const seconds = [0, 0, 0, 0, 0];
		for (let i = 0; i < samples.length - 1; i++) {
			const bpm = samples[i].bpm;
			if (bpm) {
				seconds[zoneOf(bpm, max) - 1] += Math.min(MAX_GAP_S, (samples[i + 1].t - samples[i].t) / 1000);
			}
		}
		const total = seconds.reduce((a, b) => a + b, 0) || 1;
		return seconds.map((s, i) => ({ name: `Z${i + 1}`, seconds: Math.round(s), percent: Math.round((s / total) * 100) }));
	});

	protected readonly inclinePath = computed(() => {
		const samples = this.windowSamples();
		const points = samples.map(s => ({ t: s.t, v: s.inc ?? null }));
		const top = Math.max(6, ceilTo(Math.max(0, ...points.map(p => p.v ?? 0)) + 1, 2));
		const end = Date.now();
		const start = this.window() === 'workout' && this.planActive() ? this.workoutStart() : end - this.windowMs();
		return lanePath(points, start, end, Math.min(0, ...points.map(p => p.v ?? 0)), top, { step: true });
	});

	// The status pills under the header.
	protected readonly connections = computed(() => {
		const status = this.socket.status();
		if (!status) {
			return [];
		}
		const t = status.treadmill;
		const transport = { wifi: 'Wi-Fi', ble: 'Bluetooth', simulated: 'Simulated' }[t.transport] ?? t.transport;
		const pills: { label: string; tone: string }[] = [
			{ label: t.connected ? `Treadmill · ${transport}` : 'Treadmill · not connected', tone: t.connected ? 'ok' : 'warn' }
		];
		if (t.power) {
			pills.push({ label: `Power · ${this.sourceName(t.powerSource)}`, tone: 'power' });
		}
		const b = status.broadcast;
		pills.push({
			label: b.clients > 0 ? `Zwift · ${b.clients} connected` : b.advertising ? 'Zwift · waiting' : 'Zwift · off',
			tone: b.clients > 0 ? 'ok' : b.advertising ? 'idle' : 'warn'
		});
		const ant = status.sensors?.ant;
		if (ant?.available) {
			const names = { hr: 'HRM', cadence: 'footpod', power: 'power' };
			const kinds = [...new Set(ant.devices.filter(d => Date.parse(d.lastSeenAt) > Date.now() - 10000).map(d => names[d.kind]))];
			pills.push({ label: `ANT+ · ${kinds.length ? kinds.join(' + ') : 'listening'}`, tone: kinds.length ? 'ok' : 'idle' });
		}
		const ble = status.sensors?.bluetooth?.connections ?? [];
		if (ble.length) {
			const on = ble.filter(c => c.state === 'connected');
			pills.push({ label: `Bluetooth · ${on.length ? on.map(c => c.name || 'sensor').join(', ') : 'searching'}`, tone: on.length ? 'ok' : 'idle' });
		}
		return pills;
	});

	private sourceName(source: SensorSource | null | undefined): string {
		return source === 'ble' ? 'Bluetooth' : source === 'ant' ? 'ANT+' : 'treadmill';
	}

	protected readonly busy = signal(false);
	protected readonly treadmill = computed(() => this.socket.status()?.treadmill ?? null);
	// Which sensors have reported since the page opened (autodetect). Latched, so a tile does not
	// flicker away during a short dropout; it shows "signal lost" instead.
	private readonly detected = { hr: false, cadence: false, power: false };
	protected readonly seen = computed(() => {
		const t = this.treadmill();
		this.detected.hr ||= !!t?.hr;
		this.detected.cadence ||= !!t?.cadence;
		this.detected.power ||= !!t?.power;
		return { ...this.detected };
	});

	protected sourceLabel(source: SensorSource | null | undefined): string {
		return source === 'ant' ? 'from ANT+' : source === 'ble' ? 'from Bluetooth' : source === 'treadmill' ? 'from treadmill' : '';
	}

	// e.g. "HR 141 · cadence 172"
	protected readonly playback = computed(() => this.socket.playback());
	protected readonly planActive = computed(() => ACTIVE.includes(this.playback()?.state ?? 'idle'));
	protected readonly canControl = computed(() => {
		const t = this.treadmill();
		return !!t && t.connected && t.capabilities.canControl && !this.busy();
	});

	// Stop works whenever the treadmill is connected (it also ends a running plan). Start only
	// where the treadmill can be restarted remotely, and never during a plan (use Resume there).
	protected readonly canStop = computed(() => this.canControl());
	protected readonly canStart = computed(() => this.canControl() && !!this.treadmill()?.capabilities.canResume && !this.planActive());
	protected readonly startHint = computed(() => {
		const t = this.treadmill();
		if (!t?.connected) {
			return '';
		}
		if (!t.capabilities.canResume) {
			return 'This treadmill starts from its own console. Stop works from here.';
		}
		return this.planActive() ? 'A plan is running: Stop ends it. Use Resume on the workout screen to continue.' : '';
	});

	protected readonly kph = computed(() => this.treadmill()?.kph ?? 0);
	protected readonly incline = computed(() => this.treadmill()?.incline ?? 0);
	protected readonly limits = computed(() => this.treadmill()?.limits ?? { minKph: 0, maxKph: 20, minIncline: 0, maxIncline: 15 });
	protected readonly speedPercent = computed(() => Math.min(100, Math.max(0, (this.kph() / (this.limits().maxKph || 20)) * 100)));
	protected readonly speedPresets = computed(() => (this.prefs.metric() ? [4, 6, 8, 10, 12, 14, 16, 20, 22] : [2.5, 3.5, 5, 6, 7, 8]));
	protected readonly inclinePresets = [0, 2, 4, 6, 8, 10, 12];

	protected readonly hr = computed(() => {
		const hr = this.treadmill()?.hr;
		return hr ? String(Math.round(hr)) : '–';
	});

	// During a plan the tiles show the plan's distance and time, with progress.
	protected readonly distanceMetres = computed(() => (this.planActive() ? this.playback()!.planElapsed.metres : this.treadmill()?.metres ?? 0));
	protected readonly elapsedSeconds = computed(() => (this.planActive() ? this.playback()!.planElapsed.seconds : this.treadmill()?.seconds ?? 0));
	protected readonly planDistance = computed(() => {
		const p = this.playback();
		if (!this.planActive() || !p?.planRemaining) {
			return null;
		}
		const total = p.planElapsed.metres + p.planRemaining.metres;
		return total > 0 ? { total, percent: Math.round((p.planElapsed.metres / total) * 100) } : null;
	});

	protected readonly planTime = computed(() => {
		const p = this.playback();
		if (!this.planActive() || !p?.planRemaining) {
			return null;
		}
		const total = p.planElapsed.seconds + p.planRemaining.seconds;
		return total > 0 ? { remaining: p.planRemaining.seconds, percent: Math.round((p.planElapsed.seconds / total) * 100) } : null;
	});

	protected readonly planPercent = computed(() => this.planTime()?.percent ?? 0);
	protected readonly targetText = computed(() => {
		const step = this.planActive() ? this.playback()?.current : null;
		return step ? this.prefs.speed(this.playback()?.override?.kph ?? step.targetKph) : '';
	});

	protected readonly stepText = computed(() => {
		const p = this.playback();
		const step = p?.current;
		if (!p || !step) {
			return p?.message || p?.planName || '';
		}
		const left = p.stepRemaining?.seconds !== undefined
			? `${this.prefs.duration(p.stepRemaining.seconds)} left in step`
			: p.stepRemaining?.metres !== undefined ? `${this.prefs.distance(p.stepRemaining.metres)} ${this.prefs.distanceLabel()} left in step` : '';
		return `${step.label || 'Step ' + (step.flatIndex + 1)} ${this.prefs.speed(step.targetKph)} ${this.prefs.speedLabel()}${left ? ' · ' + left : ''}`;
	});

	protected readonly nextText = computed(() => {
		const next = this.playback()?.next;
		if (!next) {
			return '';
		}
		const end = next.end.type === 'time' ? this.prefs.duration(next.end.seconds) : `${this.prefs.distance(next.end.metres)} ${this.prefs.distanceLabel()}`;
		return `${next.label || 'Step ' + (next.flatIndex + 1)} ${this.prefs.speed(next.targetKph)} ${this.prefs.speedLabel()} · ${end}`;
	});

	// The plan as a strip of steps, shaded by how hard each one is.
	protected readonly segments = computed(() => {
		const steps = this.profile.steps();
		const speeds = steps.map(s => s.kph);
		const low = Math.min(...speeds);
		const high = Math.max(...speeds);
		return steps.map(s => {
			const share = high > low ? (s.kph - low) / (high - low) : 1;
			return { grow: Math.max(1, s.seconds), shade: share > 0.66 ? 3 : share > 0.33 ? 2 : 1 };
		});
	});

	protected isSpeed(preset: number): boolean {
		return this.kph() > 0 && Math.abs(displaySpeed(this.kph(), this.prefs.metric()) - preset) < 0.05;
	}


	// Next speed one step up or down from the current speed, in display units, snapped to the step.
	protected nextSpeed(direction: 1 | -1): number {
		const metric = this.prefs.metric();
		const steps = displaySpeed(this.kph(), metric) / SPEED_STEP;
		const target = direction > 0 ? (Math.floor(steps + 1e-6) + 1) * SPEED_STEP : (Math.ceil(steps - 1e-6) - 1) * SPEED_STEP;
		return fromDisplaySpeed(Math.max(0, target), metric);
	}

	protected canSpeed(direction: 1 | -1): boolean {
		const next = this.nextSpeed(direction);
		return this.canControl() && next >= this.limits().minKph - 1e-9 && next <= this.limits().maxKph + 1e-9;
	}

	protected canIncline(direction: 1 | -1): boolean {
		const next = this.incline() + direction * INCLINE_STEP;
		return this.canControl() && next >= this.limits().minIncline && next <= this.limits().maxIncline;
	}

	protected stepSpeed(direction: 1 | -1): void {
		this.send({ kph: Math.round(this.nextSpeed(direction) * 1000) / 1000 });
	}

	protected stepIncline(direction: 1 | -1): void {
		this.send({ incline: Math.round((this.incline() + direction * INCLINE_STEP) * 2) / 2 });
	}

	protected presetSpeed(value: number): void {
		this.send({ kph: Math.round(fromDisplaySpeed(value, this.prefs.metric()) * 1000) / 1000 });
	}

	protected presetIncline(value: number): void {
		this.send({ incline: value });
	}

	protected presetAllowed(value: number): boolean {
		const kph = fromDisplaySpeed(value, this.prefs.metric());
		return this.canControl() && kph >= this.limits().minKph && kph <= this.limits().maxKph + 1e-9;
	}

	protected startBelt(): void {
		this.command('control:start');
	}

	protected stopBelt(): void {
		this.command('control:stop');
	}

	private send(target: { kph?: number; incline?: number }): Promise<void> {
		return this.command('control:set', target);
	}

	private async command(event: string, payload?: unknown): Promise<void> {
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
