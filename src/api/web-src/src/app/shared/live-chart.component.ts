import { Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { HrHistoryService } from '../core/hr-history.service';
import { POWER_ZONE_FLOORS, PrefsService, timeInZones, zoneBands, zoneOf, zoneStops } from '../core/prefs.service';
import { SocketService } from '../core/socket.service';
import { displaySpeed } from '../core/units';
import { LanePaths, axisLabels, ceilTo, lanePath, scaleFor } from './chart';
import { TracePoint } from './hr-trace';

let nextId = 0;

interface Lane {
	kind: 'speed' | 'hr' | 'cadence' | 'power';
	paths: LanePaths;
	min: number;
	max: number;
}

const average = (values: number[]) => (values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null);

// The dashboard's live chart: speed on top with the big readout over it, then heart rate,
// cadence and power in their own lanes (each on its own scale) on one time axis. A lane appears
// once its sensor has reported in the window. Readings come from HrHistoryService.
@Component({
	selector: 'app-live-chart',
	host: { class: 'live' },
	template: `
		@if (showSpeed()) {
		<div class="live__lane live__lane--speed">
			<svg class="live__svg" viewBox="0 0 1000 100" preserveAspectRatio="none" role="img" [attr.aria-label]="speedDescription()">
				<defs>
					<linearGradient [attr.id]="uid + 'speed'" x1="0" y1="0" x2="0" y2="1">
						<stop class="live__stop-top live__stop-top--speed" offset="0" /><stop class="live__stop-bottom live__stop-bottom--speed" offset="1" />
					</linearGradient>
				</defs>
				<g class="live__grid">
					@for (x of gridX; track x) { <line [attr.x1]="x" [attr.x2]="x" y1="0" y2="100" vector-effect="non-scaling-stroke" /> }
					@for (y of [14.3, 42.9, 71.4]; track y) { <line x1="0" x2="1000" [attr.y1]="y" [attr.y2]="y" vector-effect="non-scaling-stroke" /> }
				</g>
				<path [attr.d]="speed().paths.area" [attr.fill]="'url(#' + uid + 'speed)'" />
				@if (inclineLane(); as inc) {
					<!-- Incline as a step trace in the bottom third of the speed chart, on its own scale. -->
					<g transform="translate(0 64) scale(1 0.36)">
						<path class="live__incline-area" [attr.d]="inc.paths.area" />
						<path class="live__line live__line--incline" [attr.d]="inc.paths.line" vector-effect="non-scaling-stroke" />
					</g>
				}
				<path class="live__line live__line--speed" [attr.d]="speed().paths.line" vector-effect="non-scaling-stroke" />
			</svg>
			<div class="live__readout">
				<span class="eyebrow">Speed</span>
				<div class="live__speed">
					<span class="live__speed-value num" aria-live="off">{{ prefs.speed(kph()) }}</span>
					<span class="live__speed-unit">{{ prefs.speedLabel() }}</span>
				</div>
				<span class="live__pace"><span class="num">{{ prefs.pace(kph()) }}</span> {{ prefs.paceLabel() }}@if (target()) { · target {{ target() }} }</span>
			</div>
			@if (speed().paths.lastY !== null) {
				<span class="live__tag live__tag--speed" [style.top.%]="speed().paths.lastY"><span class="live__tag-dot"></span><span class="live__tag-value num">{{ prefs.speed(kph()) }}</span></span>
			}
			@if (inclineLane(); as inc) {
				@if (inc.paths.lastY !== null) {
					<span class="live__tag live__tag--incline" [style.top.%]="64 + inc.paths.lastY * 0.36"><span class="live__tag-value num">{{ incline().toFixed(1) }}%</span></span>
				}
			}
			<span class="live__scale">{{ prefs.speedLabel() }} · {{ speed().min }}–{{ speed().max }}@if (inclineLane(); as inc) { · <span class="live__scale-incline">incline {{ inc.min }}–{{ inc.max }} %</span>}</span>
		</div>
		}

		@for (lane of lanes(); track lane.kind) {
			<div class="live__lane" [class]="'live__lane live__lane--' + lane.kind">
				<svg class="live__svg" viewBox="0 0 1000 100" preserveAspectRatio="none" role="img" [attr.aria-label]="describe(lane)">
					<defs>
						<linearGradient [attr.id]="uid + lane.kind" x1="0" y1="0" x2="0" y2="1">
							<stop [class]="'live__stop-top live__stop-top--' + lane.kind" offset="0" /><stop [class]="'live__stop-bottom live__stop-bottom--' + lane.kind" offset="1" />
						</linearGradient>
						@if (laneStops(lane).length) {
							<!-- Colours the heart-rate or power line by zone: the stops sit at the zone limits on this lane's scale. -->
							<linearGradient [attr.id]="uid + lane.kind + 'zones'" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="100">
								@for (st of laneStops(lane); track $index) { <stop [class]="'zstop zstop--' + st.zone" [attr.offset]="st.offset" /> }
							</linearGradient>
						}
					</defs>
					@if (laneStops(lane).length) {
						@for (band of laneBands(lane); track band.zone) {
							<rect [class]="'live__zone live__zone--' + band.zone" x="0" width="1000" [attr.y]="band.y" [attr.height]="band.h" />
						}
					}
					<g class="live__grid">
						@for (x of gridX; track x) { <line [attr.x1]="x" [attr.x2]="x" y1="0" y2="100" vector-effect="non-scaling-stroke" /> }
						<line x1="0" x2="1000" y1="50" y2="50" vector-effect="non-scaling-stroke" />
					</g>
					@if (lane.kind === 'power' && thresholdY(lane); as ty) {
						<line class="live__threshold" x1="0" x2="1000" [attr.y1]="ty" [attr.y2]="ty" vector-effect="non-scaling-stroke" />
					}
					@if (lane.kind === 'power' && !laneStops(lane).length) { <path [attr.d]="lane.paths.area" [attr.fill]="'url(#' + uid + lane.kind + ')'" /> }
					<path [class]="'live__line live__line--' + lane.kind" [attr.d]="lane.paths.line" vector-effect="non-scaling-stroke"
						[style.stroke]="laneStops(lane).length ? 'url(#' + uid + lane.kind + 'zones)' : null" />
				</svg>
				<div class="live__badge">
					@switch (lane.kind) {
						@case ('hr') {
							<svg class="live__icon live__icon--hr" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-4.4-9.3-9C1 8.4 3.2 4 7.2 4c2 0 3.5 1.1 4.8 2.8C13.3 5.1 14.8 4 16.8 4c4 0 6.2 4.4 4.5 8-2.3 4.6-9.3 9-9.3 9z" /></svg>
							<span class="live__badge-value num">{{ hr() ?? '–' }}</span>
							<span class="live__badge-text">bpm@if (hr()) { · <span [class]="'zone-text zone-text--' + zone()">Zone {{ zone() }}</span>}@if (avg().hr) { · avg {{ avg().hr }}}</span>
						}
						@case ('cadence') {
							<span class="live__badge-value live__badge-value--sm num">{{ cadence() ?? '–' }}</span>
							<span class="live__badge-text">spm cadence@if (avg().cadence) { · avg {{ avg().cadence }}}</span>
						}
						@case ('power') {
							<svg class="live__icon live__icon--power" viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2L4 14h7l-1 8 9-12h-7z" /></svg>
							<span class="live__badge-value num">{{ power() ?? '–' }}</span>
							<span class="live__badge-text">W running power@if (power() && prefs.thresholdPower(); as t) { · <span [class]="'zone-text zone-text--' + powerZone()">Zone {{ powerZone() }}</span> · {{ pct(power()!, t) }}% of {{ t }} W threshold }@else if (avg().power) { · avg {{ avg().power }}}</span>
						}
					}
				</div>
				@if (lane.kind === 'hr' && hrZoneTime(); as zt) {
					<!-- Time in each heart-rate zone over the chart's window, as a stacked bar and times. -->
					<div class="live__zones" role="img" [attr.aria-label]="zoneTimeText(zt)">
						<span class="live__zones-bar" aria-hidden="true">
							@for (z of zt; track z.zone) { @if (z.percent) { <span [class]="'live__zones-seg zones__fill--Z' + z.zone" [style.width.%]="z.percent"></span> } }
						</span>
						<span class="live__zones-list" aria-hidden="true">
							@for (z of zt; track z.zone) {
								<span class="live__zones-item num" [class.live__zones-item--off]="!z.seconds"><span [class]="'live__zones-dot zones__fill--Z' + z.zone"></span>Z{{ z.zone }} {{ prefs.duration(z.seconds) }}</span>
							}
						</span>
					</div>
				}
				@if (lane.paths.lastY !== null) {
					<span [class]="'live__tag live__tag--' + lane.kind + (lane.paths.last && zoneFor(lane, lane.paths.last) ? ' live__tag--z' + zoneFor(lane, lane.paths.last) : '')" [style.top.%]="lane.paths.lastY"><span class="live__tag-dot"></span><span class="live__tag-value num">{{ lane.paths.last }}</span></span>
				}
				<span class="live__scale">{{ scaleText(lane) }}</span>
			</div>
		}

		<div class="live__axis num" aria-hidden="true">
			@for (label of axis(); track $index) { <span>{{ label }}</span> }
		</div>
	`
})
export class LiveChartComponent {
	private readonly history = inject(HrHistoryService);
	private readonly socket = inject(SocketService);
	protected readonly prefs = inject(PrefsService);
	// How much time the chart shows, and (for a workout) when it started: then the axis counts up.
	readonly windowMs = input(10 * 60 * 1000);
	readonly startedAt = input<number | null>(null);
	// The step's target speed, already formatted ("12.0").
	readonly target = input<string>('');
	readonly show = input<{ hr: boolean; cadence: boolean; power: boolean }>({ hr: true, cadence: true, power: true });
	// Off where the speed is already shown big (the workout's Now card): only the sensor lanes.
	readonly showSpeed = input(true);

	protected readonly uid = `live-${nextId++}-`;
	protected readonly gridX = [100, 200, 300, 400, 500, 600, 700, 800, 900];
	private readonly now = signal(Date.now());

	private readonly treadmill = computed(() => this.socket.status()?.treadmill ?? null);
	protected readonly kph = computed(() => (this.treadmill()?.connected ? this.treadmill()!.kph : 0));
	protected readonly hr = computed(() => (this.treadmill()?.hr ? Math.round(this.treadmill()!.hr!) : null));
	protected readonly cadence = computed(() => this.treadmill()?.cadence || null);
	protected readonly power = computed(() => this.treadmill()?.power || null);
	protected readonly zone = computed(() => (this.hr() ? zoneOf(this.hr()!, this.prefs.maxHr()) : null));
	// Seconds in each heart-rate zone over the window; null before any heart rate.
	protected readonly hrZoneTime = computed(() => {
		const seconds = timeInZones(this.inRange().map(s => ({ t: s.t, v: s.bpm })), this.prefs.maxHr());
		const total = seconds.reduce((a, b) => a + b, 0);
		return total ? seconds.map((sec, i) => ({ zone: i + 1, seconds: Math.round(sec), percent: (sec / total) * 100 })) : null;
	});
	protected readonly powerZone = computed(() => {
		const t = this.prefs.thresholdPower();
		return this.power() && t ? zoneOf(this.power()!, t, POWER_ZONE_FLOORS) : null;
	});

	private readonly range = computed(() => {
		const end = this.now();
		const started = this.startedAt();
		const start = started !== null ? Math.min(started, end - 30000) : end - this.windowMs();
		return { start, end };
	});

	private readonly inRange = computed(() => {
		const { start } = this.range();
		return this.history.samples().filter(s => s.t >= start);
	});

	private series(pick: (s: { bpm: number | null; w?: number | null; kph?: number | null; c?: number | null; inc?: number | null }) => number | null | undefined): TracePoint[] {
		return this.inRange().map(s => ({ t: s.t, v: pick(s) ?? null }));
	}

	protected readonly speed = computed<Lane>(() => {
		const metric = this.prefs.metric();
		const points = this.series(s => (s.kph == null ? null : displaySpeed(s.kph, metric)));
		const top = Math.max(metric ? 14 : 9, ceilTo(Math.max(0, ...points.map(p => p.v ?? 0)) + 1, 2));
		const { start, end } = this.range();
		return { kind: 'speed', paths: lanePath(points, start, end, 0, top), min: 0, max: top };
	});

	protected readonly incline = computed(() => (this.treadmill()?.connected ? this.treadmill()!.incline ?? 0 : 0));
	// Incline over the window, shown once the belt has been tilted in it (or is tilted now).
	protected readonly inclineLane = computed(() => {
		const points = this.series(s => s.inc);
		const values = points.map(p => p.v).filter((v): v is number => v !== null);
		if (!values.some(v => v !== 0) && !this.incline()) {
			return null;
		}
		const min = Math.min(0, ...values);
		const max = Math.max(6, ceilTo(Math.max(0, ...values) + 1, 2));
		const { start, end } = this.range();
		return { paths: lanePath(points, start, end, min, max, { step: true }), min, max };
	});

	protected readonly lanes = computed<Lane[]>(() => {
		const { start, end } = this.range();
		const show = this.show();
		const lanes: Lane[] = [];
		const add = (kind: Lane['kind'], points: TracePoint[], scale: { min: number; max: number }) => {
			if (points.some(p => p.v !== null)) {
				lanes.push({ kind, paths: lanePath(points, start, end, scale.min, scale.max), ...scale });
			}
		};
		const values = (points: TracePoint[]) => points.map(p => p.v).filter((v): v is number => v !== null);
		if (show.hr) {
			const points = this.series(s => s.bpm);
			add('hr', points, scaleFor(values(points), { floor: 90, ceiling: 180, minSpan: 40, step: 10 }));
		}
		if (show.cadence) {
			const points = this.series(s => s.c);
			add('cadence', points, scaleFor(values(points), { minSpan: 40, step: 5 }));
		}
		if (show.power) {
			const points = this.series(s => s.w);
			const top = Math.max(350, ceilTo(Math.max(0, ...values(points), this.prefs.thresholdPower() ?? 0) * 1.15, 50));
			add('power', points, { min: 0, max: top });
		}
		return lanes;
	});

	protected readonly avg = computed(() => {
		const samples = this.inRange();
		const of = (pick: (s: (typeof samples)[number]) => number | null | undefined) =>
			average(samples.map(pick).filter((v): v is number => typeof v === 'number' && v > 0));
		return { hr: of(s => s.bpm), cadence: of(s => s.c), power: of(s => s.w) };
	});

	protected readonly axis = computed(() => {
		const { start, end } = this.range();
		const started = this.startedAt();
		return axisLabels(end - start, started !== null ? Math.max(0, (start - started) / 1000) : null);
	});

	protected readonly speedDescription = computed(() =>
		`Speed over the ${this.windowText()}, now ${this.prefs.speed(this.kph())} ${this.prefs.speedLabel()}`);

	private windowText(): string {
		return this.startedAt() !== null ? 'workout' : `last ${Math.round(this.windowMs() / 60000)} minutes`;
	}

	protected describe(lane: Lane): string {
		const now = lane.paths.last;
		const what = { speed: 'Speed', hr: 'Heart rate', cadence: 'Cadence', power: 'Running power' }[lane.kind];
		const unit = { speed: this.prefs.speedLabel(), hr: 'bpm', cadence: 'steps per minute', power: 'watts' }[lane.kind];
		return `${what} over the ${this.windowText()}${now !== null ? `, now ${now} ${unit}` : ''}`;
	}

	protected scaleText(lane: Lane): string {
		switch (lane.kind) {
			case 'hr': return `bpm · ${lane.min}–${lane.max} · coloured by zone`;
			case 'cadence': return `spm · ${lane.min}–${lane.max}`;
			case 'power': return `W · ${lane.min}–${lane.max}${this.prefs.thresholdPower() ? ' · coloured by zone · dashed = threshold' : ''}`;
			default: return '';
		}
	}

	// Heart rate by zone of the maximum; power by zone of the threshold (when one is set).
	protected laneStops(lane: Lane): { offset: number; zone: number }[] {
		if (lane.kind === 'hr') {
			return zoneStops(this.prefs.maxHr(), lane.max, lane.min);
		}
		const t = this.prefs.thresholdPower();
		return lane.kind === 'power' && t ? zoneStops(t, lane.max, lane.min, POWER_ZONE_FLOORS) : [];
	}

	// Each zone faintly shaded in its colour, clipped to the lane's scale.
	protected laneBands(lane: Lane): { zone: number; y: number; h: number }[] {
		return zoneBands(this.laneStops(lane), 100);
	}

	protected zoneFor(lane: Lane, value: number): number | null {
		if (lane.kind === 'hr') {
			return zoneOf(value, this.prefs.maxHr());
		}
		const t = this.prefs.thresholdPower();
		return lane.kind === 'power' && t ? zoneOf(value, t, POWER_ZONE_FLOORS) : null;
	}

	protected zoneTimeText(zones: { zone: number; seconds: number }[]): string {
		return `Time in heart-rate zone over the ${this.windowText()}: ${zones.map(z => `zone ${z.zone} ${this.prefs.duration(z.seconds)}`).join(', ')}`;
	}

	protected thresholdY(lane: Lane): number | null {
		const t = this.prefs.thresholdPower();
		return t ? Math.round(((lane.max - t) / (lane.max - lane.min)) * 1000) / 10 : null;
	}

	protected pct(value: number, of: number): number {
		return Math.round((value / of) * 100);
	}

	constructor() {
		const timer = setInterval(() => this.now.set(Date.now()), 1000);
		inject(DestroyRef).onDestroy(() => clearInterval(timer));
	}
}
