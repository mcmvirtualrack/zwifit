import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { HR_WINDOW_MS, HrHistoryService } from '../core/hr-history.service';
import { HrTracePaths, MIN_SPAN_WATTS, TracePoint, trace, traceSpan } from './hr-trace';

let nextId = 0;

interface Lane {
	kind: 'hr' | 'power';
	paths: HrTracePaths;
	// Where the lane sits in the 0..100 box.
	offset: number;
}

// The last 10 minutes of heart rate, and running power when a Stryd reports it, as thin lines over
// a faint grid (Grafana-like) behind a card's content (the parent sets `position: relative`).
// Heart rate and power have different units, so each gets its own lane and scale on one shared
// time axis: power on top, heart rate below; one alone fills the box. Decorative and
// click-through, so it never covers the card's buttons; the ranges are printed in the corner and
// given to screen readers.
@Component({
	selector: 'app-hr-trace',
	host: { class: 'hr-trace' },
	template: `
		@if (lanes(); as list) {
			<svg class="hr-trace__plot" viewBox="0 0 1000 100" preserveAspectRatio="none" role="img" [attr.aria-label]="description()">
				<defs>
					@for (kind of kinds; track kind) {
						<linearGradient [attr.id]="fillId + kind" x1="0" y1="0" x2="0" y2="1">
							<stop [class]="'hr-trace__stop-top hr-trace__stop-top--' + kind" offset="0" />
							<stop [class]="'hr-trace__stop-bottom hr-trace__stop-bottom--' + kind" offset="1" />
						</linearGradient>
					}
				</defs>
				<g class="hr-trace__grid">
					@for (x of gridX; track x) { <line [attr.x1]="x" [attr.x2]="x" y1="0" y2="100" vector-effect="non-scaling-stroke" /> }
					@for (y of gridY; track y) { <line x1="0" x2="1000" [attr.y1]="y" [attr.y2]="y" vector-effect="non-scaling-stroke" /> }
				</g>
				@for (lane of list; track lane.kind) {
					<g [attr.transform]="'translate(0 ' + lane.offset + ')'">
						<path class="hr-trace__area" [attr.d]="lane.paths.area" [attr.fill]="'url(#' + fillId + lane.kind + ')'" />
						<path [class]="'hr-trace__line hr-trace__line--' + lane.kind" [attr.d]="lane.paths.line" vector-effect="non-scaling-stroke" />
					</g>
				}
			</svg>
			<span class="hr-trace__label" aria-hidden="true">{{ label() }}</span>
		}
	`
})
export class HrTraceComponent {
	private readonly history = inject(HrHistoryService);
	// Re-evaluated every few seconds so the trace slides left even when the readings hold steady.
	private readonly now = signal(Date.now());
	protected readonly fillId = `hr-trace-fill-${nextId++}-`;
	protected readonly kinds = ['hr', 'power'];
	protected readonly gridX = [100, 200, 300, 400, 500, 600, 700, 800, 900];
	protected readonly gridY = [25, 50, 75];

	protected readonly lanes = computed<Lane[] | null>(() => {
		const samples = this.history.samples();
		const now = this.now();
		const hr: TracePoint[] = samples.map(s => ({ t: s.t, v: s.bpm }));
		const power: TracePoint[] = samples.map(s => ({ t: s.t, v: s.w ?? null }));
		// One time axis for both: the longer of the two spans.
		const spans = [traceSpan(hr, now, HR_WINDOW_MS), traceSpan(power, now, HR_WINDOW_MS)].filter((s): s is number => s !== null);
		if (!spans.length) {
			return null;
		}
		const spanMs = Math.max(...spans);
		const both = spans.length === 2;
		const height = both ? 46 : 100;
		const hrPaths = trace(hr, now, HR_WINDOW_MS, { height, minSpan: 20, spanMs });
		const powerPaths = trace(power, now, HR_WINDOW_MS, { height, minSpan: MIN_SPAN_WATTS, spanMs });
		const lanes: Lane[] = [];
		if (powerPaths) {
			lanes.push({ kind: 'power', paths: powerPaths, offset: 0 });
		}
		if (hrPaths) {
			lanes.push({ kind: 'hr', paths: hrPaths, offset: powerPaths ? 54 : 0 });
		}
		return lanes.length ? lanes : null;
	});

	private readonly parts = computed(() => (this.lanes() ?? []).map(l =>
		l.kind === 'hr' ? `Heart rate ${l.paths.min}–${l.paths.max} bpm` : `Power ${l.paths.min}–${l.paths.max} W`));

	protected readonly label = computed(() => {
		const lanes = this.lanes();
		return lanes ? `${this.parts().join(' · ')} · last ${this.minutes(lanes[0].paths.spanMs)} min` : '';
	});

	protected readonly description = computed(() => {
		const lanes = this.lanes();
		return lanes ? `Last ${this.minutes(lanes[0].paths.spanMs)} minutes: ${this.parts().join(', ')}` : '';
	});

	protected minutes(ms: number): number {
		return Math.max(1, Math.round(ms / 60000));
	}

	constructor() {
		const timer = setInterval(() => this.now.set(Date.now()), 5000);
		inject(DestroyRef).onDestroy(() => clearInterval(timer));
	}
}
