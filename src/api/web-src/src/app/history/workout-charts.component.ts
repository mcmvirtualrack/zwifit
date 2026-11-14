import { Component, computed, inject, input, signal } from '@angular/core';
import { POWER_ZONE_FLOORS, PrefsService, ZONE_FLOORS, zoneBands, zoneOf, zoneStops } from '../core/prefs.service';
import { CHART_H, CHART_W, ChartSample, Metric, XAxis, nearestIndex, series, valueOf, xPositions } from './workout-charts';

let nextId = 0;
const TITLES: Record<Metric, string> = { pace: 'Pace', hr: 'Heart rate', cadence: 'Cadence', power: 'Power', incline: 'Incline' };

// Pace, heart rate, cadence and power for one workout as stacked charts sharing the x axis (time or
// distance). Hover, touch or the arrow keys move one crosshair across all of them; the steps
// table above is the table view of the same data.
@Component({
	selector: 'app-workout-charts',
	template: `
		<div class="row wchart__head">
			<h2 class="card__title" id="charts-title">Charts</h2>
			<span class="spacer"></span>
			<div class="segmented" role="group" aria-label="Horizontal axis">
				<button type="button" [attr.aria-pressed]="axis() === 'time'" (click)="axis.set('time')">Time</button>
				<button type="button" [attr.aria-pressed]="axis() === 'distance'" (click)="axis.set('distance')">Distance</button>
			</div>
		</div>
		@if (charts().length) {
			<div class="wchart" tabindex="0" role="group" aria-labelledby="charts-title"
				aria-describedby="charts-help"
				(pointermove)="point($event)" (pointerdown)="point($event)" (pointerleave)="hover.set(null)"
				(keydown)="key($event)" (blur)="hover.set(null)">
				<span class="visually-hidden" id="charts-help">Use the left and right arrow keys to read values.</span>
				@for (c of charts(); track c.metric) {
					<div class="wchart__row">
						<div class="wchart__label">
							<span class="stat__label">{{ titles[c.metric] }}</span>
							<span class="muted">{{ unit(c.metric) }}@if (zoneData()[c.metric]) { · by zone }</span>
						</div>
						<div class="wchart__plot">
							<span class="wchart__tick wchart__tick--top num">{{ format(c.metric, c.top) }}</span>
							<span class="wchart__tick wchart__tick--bottom num">{{ format(c.metric, c.bottom) }}</span>
							<svg [attr.viewBox]="'0 0 ' + W + ' ' + H" preserveAspectRatio="none" aria-hidden="true">
								<line class="wchart__grid" x1="0" [attr.x2]="W" y1="0.5" y2="0.5" vector-effect="non-scaling-stroke" />
								<line class="wchart__grid" x1="0" [attr.x2]="W" [attr.y1]="H - 0.5" [attr.y2]="H - 0.5" vector-effect="non-scaling-stroke" />
								@if (zoneData()[c.metric]; as z) {
									<!-- Heart rate and power coloured by zone: stops at the zone limits on this chart's scale. -->
									<defs>
										<linearGradient [attr.id]="uid + c.metric + 'zones'" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" [attr.y2]="H">
											@for (st of z.stops; track $index) { <stop [class]="'zstop zstop--' + st.zone" [attr.offset]="st.offset" /> }
										</linearGradient>
									</defs>
									@for (band of z.bands; track band.zone) {
										<rect [class]="'live__zone live__zone--' + band.zone" x="0" [attr.width]="W" [attr.y]="band.y" [attr.height]="band.h" />
									}
								}
								<path [class]="'wchart__line wchart__line--' + c.metric" [attr.d]="c.line" vector-effect="non-scaling-stroke"
									[style.stroke]="zoneData()[c.metric] ? 'url(#' + uid + c.metric + 'zones)' : null" />
								@if (hoverX() !== null) {
									<line class="wchart__cross" [attr.x1]="hoverX()" [attr.x2]="hoverX()" y1="0" [attr.y2]="H" vector-effect="non-scaling-stroke" />
								}
							</svg>
						</div>
					</div>
				}
				<div class="wchart__axis num muted">
					<span>0</span><span>{{ axisEnd() }}</span>
				</div>
				@if (readout(); as r) {
					<div class="wchart__tip" role="status" [class.wchart__tip--right]="(hoverX() ?? 0) < W / 2">
						<strong class="num">{{ r.x }}</strong>
						@for (v of r.values; track v.label) { <span class="num">{{ v.label }} {{ v.value }}</span> }
					</div>
				}
			</div>
			@if (!hasCadence()) { <p class="muted">Cadence: not reported by this treadmill.</p> }
		}
		@else {
			<p class="muted">Not enough samples to chart.</p>
		}
	`,
	host: { class: 'card stack wcharts', 'aria-labelledby': 'charts-title', role: 'region' }
})
export class WorkoutChartsComponent {
	readonly samples = input.required<ChartSample[]>();
	protected readonly prefs = inject(PrefsService);
	protected readonly titles = TITLES;
	protected readonly uid = `wchart-${nextId++}-`;
	protected readonly W = CHART_W;
	protected readonly H = CHART_H;
	protected readonly axis = signal<XAxis>('time');
	protected readonly hover = signal<number | null>(null);

	private readonly metresPerUnit = computed(() => (this.prefs.metric() ? 1000 : 1609.344));
	private readonly xs = computed(() => xPositions(this.samples(), this.axis()));
	// Incline only for runs where the belt was ever tilted.
	private readonly tilted = computed(() => this.samples().some(s => typeof s.incline === 'number' && s.incline !== 0));
	protected readonly charts = computed(() => (['pace', 'hr', 'cadence', 'power', 'incline'] as Metric[])
		.filter(m => m !== 'incline' || this.tilted())
		.map(m => series(this.samples(), this.xs(), m, this.metresPerUnit()))
		.filter(c => c !== null));
	// Heart rate by zone of the maximum, power by zone of the threshold (when set).
	private zoneRef(metric: Metric): { value: number; floors: number[] } | null {
		if (metric === 'hr') {
			return { value: this.prefs.maxHr(), floors: ZONE_FLOORS };
		}
		const t = this.prefs.thresholdPower();
		return metric === 'power' && t ? { value: t, floors: POWER_ZONE_FLOORS } : null;
	}
	protected readonly zoneData = computed(() => {
		const out: Partial<Record<Metric, { stops: { offset: number; zone: number }[]; bands: { zone: number; y: number; h: number }[] }>> = {};
		for (const c of this.charts()) {
			const ref = this.zoneRef(c.metric);
			if (ref) {
				const stops = zoneStops(ref.value, c.top, c.bottom, ref.floors);
				out[c.metric] = { stops, bands: zoneBands(stops, CHART_H) };
			}
		}
		return out;
	});
	protected readonly hasCadence = computed(() => this.charts().some(c => c.metric === 'cadence'));
	protected readonly hoverX = computed(() => {
		const i = this.hover();
		return i === null ? null : this.xs()[i] ?? null;
	});

	protected readonly axisEnd = computed(() => {
		const list = this.samples();
		if (!list.length) {
			return '';
		}
		const last = list[list.length - 1];
		return this.axis() === 'time'
			? this.prefs.duration((Date.parse(last.t) - Date.parse(list[0].t)) / 1000)
			: `${this.prefs.distance(last.metres)} ${this.prefs.distanceLabel()}`;
	});

	protected readonly readout = computed(() => {
		const i = this.hover();
		const s = i === null ? null : this.samples()[i];
		if (!s) {
			return null;
		}
		const start = Date.parse(this.samples()[0].t);
		const values = this.charts().map(c => {
			const v = valueOf(s, c.metric, this.metresPerUnit());
			const ref = this.zoneRef(c.metric);
			const zone = ref && v !== null ? ` · Z${zoneOf(v, ref.value, ref.floors)}` : '';
			return { label: TITLES[c.metric], value: v === null ? '–' : `${this.format(c.metric, v)} ${this.unit(c.metric)}${zone}` };
		});
		return {
			x: `${this.prefs.duration((Date.parse(s.t) - start) / 1000)} · ${this.prefs.distance(s.metres)} ${this.prefs.distanceLabel()}`,
			values
		};
	});

	protected unit(metric: Metric): string {
		return metric === 'pace' ? this.prefs.paceLabel() : metric === 'hr' ? 'bpm' : metric === 'power' ? 'W' : metric === 'incline' ? '%' : 'spm';
	}

	protected format(metric: Metric, value: number): string {
		if (metric === 'pace') {
			const total = Math.round(value);
			return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
		}
		if (metric === 'incline') {
			return String(Math.round(value * 10) / 10);
		}
		return String(Math.round(value));
	}

	protected point(event: PointerEvent): void {
		const plot = (event.currentTarget as HTMLElement).querySelector('.wchart__plot');
		if (!plot) {
			return;
		}
		const box = plot.getBoundingClientRect();
		const x = ((event.clientX - box.left) / box.width) * CHART_W;
		this.hover.set(nearestIndex(this.xs(), Math.max(0, Math.min(CHART_W, x))));
	}

	protected key(event: KeyboardEvent): void {
		const count = this.samples().length;
		if (!count || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End')) {
			return;
		}
		event.preventDefault();
		const step = event.shiftKey ? 10 : 1;
		const current = this.hover() ?? (event.key === 'ArrowLeft' ? count : -1);
		const next = event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : current + (event.key === 'ArrowRight' ? step : -step);
		this.hover.set(Math.max(0, Math.min(count - 1, next)));
	}
}
