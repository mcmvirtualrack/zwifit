import { atIntensity } from '../core/intensity';
import { IntensityControlComponent } from '../shared/intensity-control.component';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SensorSource } from '../core/api.types';
import { HrHistoryService, HrSample } from '../core/hr-history.service';
import { PlanProfileService } from '../core/plan-profile.service';
import { POWER_ZONE_FLOORS, POWER_ZONE_NAMES, PrefsService, zoneOf } from '../core/prefs.service';
import { SocketService } from '../core/socket.service';
import { ToastService } from '../core/toast.service';
import { displaySpeed, fromDisplaySpeed } from '../core/units';
import { LiveChartComponent } from '../shared/live-chart.component';
import { SparkComponent } from '../shared/spark.component';

const SPEED_STEP = 0.5;
const INCLINE_STEP = 0.5;
const ACTIVE = ['waiting', 'running', 'paused', 'resuming'];
const SPARK_MS = 2 * 60 * 1000;
const WINDOWS = { short: 2 * 60 * 1000, long: 10 * 60 * 1000 };

type Window = 'short' | 'long' | 'workout';

const average = (values: number[]) => (values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null);

@Component({
	selector: 'app-control',
	imports: [IntensityControlComponent, RouterLink, LiveChartComponent, SparkComponent],
	templateUrl: './control.component.html'
})
export class ControlComponent {
	protected readonly socket = inject(SocketService);
	protected readonly prefs = inject(PrefsService);
	private readonly toast = inject(ToastService);
	private readonly history = inject(HrHistoryService);
	private readonly profile = inject(PlanProfileService);

	// What the live chart covers.
	protected readonly window = signal<Window>('long');
	protected readonly windowMs = computed(() => WINDOWS[this.window() === 'short' ? 'short' : 'long']);
	protected readonly windowTitle = computed(() => (this.window() === 'workout' && this.planActive() ? 'workout' : this.window() === 'short' ? 'last 2 min' : 'last 10 min'));
	protected readonly workoutStart = computed(() => Date.now() - (this.playback()?.planElapsed.seconds ?? 0) * 1000);

	private readonly windowSamples = computed<HrSample[]>(() => {
		const samples = this.history.samples();
		const from = this.window() === 'workout' && this.planActive() ? this.workoutStart() : Date.now() - this.windowMs();
		return samples.filter(s => s.t >= from);
	});

	protected readonly powerFloors = POWER_ZONE_FLOORS;
	protected readonly powerNames = POWER_ZONE_NAMES;
	// The zone of the current reading: heart rate from the maximum, power from the threshold (if set).
	protected readonly hrZone = computed(() => {
		const hr = this.treadmill()?.hr;
		return hr ? zoneOf(hr, this.prefs.maxHr()) : null;
	});
	protected readonly powerZone = computed(() => {
		const w = this.treadmill()?.power;
		const t = this.prefs.thresholdPower();
		return w && t ? zoneOf(w, t, POWER_ZONE_FLOORS) : null;
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

	// The status pills under the header.
	protected readonly connections = computed(() => {
		const status = this.socket.status();
		if (!status) {
			return [];
		}
		const t = status.treadmill;
		const transport = { wifi: 'Wi-Fi', ble: 'Bluetooth', simulated: 'Simulated' }[t.transport] ?? t.transport;
		const pills: { label: string; tone: string; title?: string }[] = [
			{ label: t.connected ? `Treadmill · ${transport}` : 'Treadmill · not connected', tone: t.connected ? 'ok' : 'warn' }
		];
		if (t.power) {
			pills.push({ label: `Power · ${this.sourceName(t.powerSource)}`, tone: 'power' });
		}
		const b = status.broadcast;
		// The Bluetooth broadcast to Zwift: broadcasting means Zwift can find "Zwifit" and pair.
		pills.push({
			label: b.clients > 0 ? `Bluetooth → Zwift · ${b.clients} connected` : b.advertising ? 'Bluetooth → Zwift · broadcasting' : 'Bluetooth → Zwift · off',
			tone: b.clients > 0 || b.advertising ? 'ok' : 'warn',
			title: b.clients > 0 ? 'Zwift is paired with Zwifit over Bluetooth.'
				: b.advertising ? 'Broadcasting as "Zwifit" over Bluetooth, waiting for Zwift to pair.'
				: b.reason ?? 'The Bluetooth broadcast is not running.'
		});
		const ant = status.sensors?.ant;
		if (ant?.available) {
			const names = { hr: 'HRM', cadence: 'footpod', power: 'power' };
			const kinds = [...new Set(ant.devices.filter(d => Date.parse(d.lastSeenAt) > Date.now() - 10000).map(d => names[d.kind]))];
			pills.push({ label: `ANT+ · ${kinds.length ? kinds.join(' + ') : 'listening'}`, tone: kinds.length ? 'ok' : 'idle' });
		}
		// Zwifit as ANT+ sensors for a watch or head unit (specs/003); hidden while off.
		const antOut = status.antBroadcast;
		if (antOut && antOut.state !== 'off') {
			const sending = antOut.sensors.filter(x => x.sending).map(x => `${x.kind} #${x.deviceNumber}`);
			pills.push(antOut.state === 'broadcasting'
				? { label: 'ANT+ broadcasting', tone: 'ok', title: sending.length ? `Sending as ${sending.join(', ')}.` : 'Nothing to send right now.' }
				: antOut.state === 'starting'
					? { label: 'ANT+ broadcast · starting', tone: 'idle' }
					: { label: `ANT+ broadcast · ${antOut.state === 'paused' ? 'paused' : 'not broadcasting'}`, tone: 'warn', title: antOut.reason ?? undefined });
		}
		// Bluetooth sensors (strap, Stryd, footpod): only looked for once one is chosen in Settings.
		const bleStatus = status.sensors?.bluetooth;
		const ble = bleStatus?.connections ?? [];
		if (bleStatus && !bleStatus.available) {
			pills.push({ label: 'Bluetooth sensors · unavailable', tone: 'warn', title: bleStatus.reason ?? 'Bluetooth sensors cannot be used.' });
		}
		else if (ble.length) {
			const on = ble.filter(c => c.state === 'connected');
			pills.push({
				label: `Bluetooth sensors · ${on.length ? on.map(c => c.name || 'sensor').join(', ') : 'listening'}`,
				tone: on.length ? 'ok' : 'idle',
				title: on.length ? 'Connected over Bluetooth.' : `Listening for ${ble.map(c => c.name || 'sensor').join(', ')}.`
			});
		}
		else if (bleStatus) {
			pills.push({ label: 'Bluetooth sensors · none chosen', tone: 'idle', title: 'To use a Bluetooth sensor, open Settings → Sensors → Scan for sensors.' });
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
	// A run without a plan in progress (recorded for the history): Pause / Resume / Finish.
	protected readonly freeRun = computed(() => this.socket.status()?.freeRun ?? { state: 'idle' as const });
	protected readonly freeRunActive = computed(() => this.freeRun().state !== 'idle' && !this.planActive());
	protected readonly canResumeHere = computed(() => !!this.treadmill()?.capabilities.canResume);
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
		return step ? this.prefs.speed(this.playback()?.override?.kph ?? atIntensity(step.targetKph, this.playback()?.intensity, this.treadmill()?.limits)) : '';
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
		return `${step.label || 'Step ' + (step.flatIndex + 1)} ${this.prefs.speed(atIntensity(step.targetKph, this.playback()?.intensity, this.treadmill()?.limits))} ${this.prefs.speedLabel()}${left ? ' · ' + left : ''}`;
	});

	protected readonly nextText = computed(() => {
		const next = this.playback()?.next;
		if (!next) {
			return '';
		}
		const end = next.end.type === 'time' ? this.prefs.duration(next.end.seconds) : `${this.prefs.distance(next.end.metres)} ${this.prefs.distanceLabel()}`;
		return `${next.label || 'Step ' + (next.flatIndex + 1)} ${this.prefs.speed(atIntensity(next.targetKph, this.playback()?.intensity, this.treadmill()?.limits))} ${this.prefs.speedLabel()} · ${end}`;
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

	// Ends the free run and saves it to the history (also stops the belt).
	protected async finishRun(): Promise<void> {
		if (await this.command('control:finish')) {
			this.toast.show('Free run saved to the history.');
		}
	}

	private async send(target: { kph?: number; incline?: number }): Promise<void> {
		await this.command('control:set', target);
	}

	// True when the server accepted it; errors are shown as a toast.
	private async command(event: string, payload?: unknown): Promise<boolean> {
		this.busy.set(true);
		try {
			await this.socket.request(event, payload);
			return true;
		}
		catch (err) {
			this.toast.error(err);
			return false;
		}
		finally {
			this.busy.set(false);
		}
	}
}
