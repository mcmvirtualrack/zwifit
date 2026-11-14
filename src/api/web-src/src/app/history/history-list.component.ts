import { Component, computed, effect, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { WorkoutSummary } from '../core/api.types';
import { PrefsService } from '../core/prefs.service';
import { SocketService } from '../core/socket.service';
import { ToastService } from '../core/toast.service';
import { END_REASONS } from '../core/units';

// The first page is large enough to cover the 12-week summary for most people.
const FIRST_PAGE = 100;
const PAGE = 20;
const WEEKS = 12;
const DAY_MS = 24 * 60 * 60 * 1000;

// Monday 00:00 of the week `date` falls in, local time.
function weekStart(date: Date): number {
	const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
	d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
	return d.getTime();
}

@Component({
	selector: 'app-history-list',
	imports: [RouterLink, DatePipe],
	template: `
		<div class="page-head"><h1>History</h1></div>
		@if (loading() && !workouts().length) {
			<p class="empty">Loading…</p>
		}
		@else if (!workouts().length) {
			<div class="card empty"><p>No workouts yet. Run a plan and it appears here.</p></div>
		}
		@else {
			<section class="card weeks" aria-labelledby="weeks-title">
				<div class="weeks__totals">
					<div class="weeks__stat"><span class="eyebrow">This week</span><span><span class="weeks__value num">{{ prefs.distance(thisWeek().metres, 1) }}</span><span class="tile__unit">{{ prefs.distanceLabel() }}</span></span></div>
					<div class="weeks__stat"><span class="eyebrow">Time</span><span class="weeks__value num">{{ prefs.duration(thisWeek().seconds) }}</span></div>
					<div class="weeks__stat"><span class="eyebrow">Runs</span><span class="weeks__value num">{{ thisWeek().runs }}</span></div>
					@if (thisWeek().avgPower; as power) {
						<div class="weeks__stat"><span class="eyebrow">Avg power</span><span><span class="weeks__value weeks__value--power num">{{ power }}</span><span class="tile__unit">W</span></span></div>
					}
					@else if (thisWeek().avgHr; as hr) {
						<div class="weeks__stat"><span class="eyebrow">Avg HR</span><span><span class="weeks__value weeks__value--hr num">{{ hr }}</span><span class="tile__unit">bpm</span></span></div>
					}
				</div>
				<div class="weeks__chart">
					<h2 class="card__title" id="weeks-title">Distance per week · {{ prefs.distanceLabel() }}</h2>
					<div class="weeks__bars" role="img" [attr.aria-label]="weeksDescription()">
						@for (w of weeks(); track w.start) {
							<span class="weeks__bar" [class.weeks__bar--now]="$last" [style.height.%]="w.percent" [attr.title]="(w.start | date: 'MMM d') + ': ' + prefs.distance(w.metres, 1) + ' ' + prefs.distanceLabel()"></span>
						}
						<span class="weeks__tag num">{{ prefs.distance(thisWeek().metres, 1) }}</span>
					</div>
					<div class="weeks__axis num" aria-hidden="true">
						<span>{{ weeks()[0].start | date: 'MMM d' }}</span><span>{{ weeks()[4].start | date: 'MMM d' }}</span><span>{{ weeks()[8].start | date: 'MMM d' }}</span><span>this week</span>
					</div>
				</div>
			</section>

			<ul class="runs" aria-label="Workouts">
				@for (w of workouts(); track w.id) {
					<li>
						<a class="run" [routerLink]="['/history', w.id]">
							<span class="run__main">
								<strong class="run__name">{{ w.planName }}</strong>
								<span class="run__when">{{ w.startedAt | date: 'EEEE d MMMM · HH:mm' }} · {{ w.endReason ? reasons[w.endReason] : 'in progress' }}</span>
								<span class="run__stats num">{{ prefs.duration(w.totals.seconds) }} · {{ prefs.distance(w.totals.metres) }} {{ prefs.distanceLabel() }}@if (avgKph(w); as kph) { · {{ prefs.pace(kph) }} {{ prefs.paceLabel() }}}@if (w.totals.climbMetres) { · ↑ {{ prefs.height(w.totals.climbMetres) }} {{ prefs.heightLabel() }}}@if (w.totals.avgHr) { · {{ w.totals.avgHr }} bpm avg}@if (w.totals.avgPower) { · {{ w.totals.avgPower }} W avg}</span>
							</span>
							<span class="run__badges">
								@if (w.totals.avgHr) { <span class="run__dot run__dot--hr" title="Heart rate"></span> }
								@if (w.totals.avgCadence) { <span class="run__dot run__dot--cadence" title="Cadence"></span> }
								@if (w.totals.avgPower) { <span class="run__dot run__dot--power" title="Power"></span> }
								<span class="run__chevron" aria-hidden="true">›</span>
							</span>
						</a>
					</li>
				}
			</ul>
			@if (more()) {
				<div class="row"><button class="btn btn--block" type="button" (click)="loadMore()" [disabled]="loading()">{{ loading() ? 'Loading…' : 'Show older' }}</button></div>
			}
		}
	`
})
export class HistoryListComponent {
	private readonly socket = inject(SocketService);
	private readonly toast = inject(ToastService);
	// Average pace over moving time (older workouts without it: over the elapsed time).
	protected avgKph(w: WorkoutSummary): number | null {
		if (w.totals.avgKph) {
			return w.totals.avgKph;
		}
		return w.totals.metres > 0 && w.totals.seconds > 0 ? (w.totals.metres / w.totals.seconds) * 3.6 : null;
	}

	protected readonly prefs = inject(PrefsService);
	protected readonly reasons = END_REASONS;
	protected readonly workouts = signal<WorkoutSummary[]>([]);
	protected readonly loading = signal(true);
	protected readonly more = signal(false);

	// Distance per week for the last 12 weeks, oldest first.
	protected readonly weeks = computed(() => {
		const current = weekStart(new Date());
		const weeks = Array.from({ length: WEEKS }, (_, i) => ({ start: current - (WEEKS - 1 - i) * 7 * DAY_MS, metres: 0 }));
		for (const w of this.workouts()) {
			const start = weekStart(new Date(w.startedAt));
			const week = weeks.find(x => x.start === start);
			if (week) {
				week.metres += w.totals.metres;
			}
		}
		const top = Math.max(1, ...weeks.map(w => w.metres));
		return weeks.map(w => ({ ...w, percent: Math.max(w.metres ? 3 : 1, Math.round((w.metres / top) * 100)) }));
	});

	protected readonly thisWeek = computed(() => {
		const since = weekStart(new Date());
		const runs = this.workouts().filter(w => Date.parse(w.startedAt) >= since);
		const weighted = (pick: (w: WorkoutSummary) => number | undefined) => {
			const rated = runs.filter(w => pick(w));
			const seconds = rated.reduce((sum, w) => sum + w.totals.seconds, 0);
			return seconds ? Math.round(rated.reduce((sum, w) => sum + pick(w)! * w.totals.seconds, 0) / seconds) : null;
		};
		return {
			runs: runs.length,
			metres: runs.reduce((sum, w) => sum + w.totals.metres, 0),
			seconds: runs.reduce((sum, w) => sum + w.totals.seconds, 0),
			avgPower: weighted(w => w.totals.avgPower),
			avgHr: weighted(w => w.totals.avgHr)
		};
	});

	protected readonly weeksDescription = computed(() => {
		const values = this.weeks().map(w => this.prefs.distance(w.metres, 1));
		return `Distance per week for the last ${WEEKS} weeks, oldest first: ${values.join(', ')} ${this.prefs.distanceLabel()}`;
	});

	constructor() {
		effect(() => {
			this.socket.workoutsVersion();
			if (this.socket.connected()) {
				this.load(true);
			}
		});
	}

	protected loadMore(): void {
		this.load(false);
	}

	private async load(reset: boolean): Promise<void> {
		this.loading.set(true);
		try {
			const existing = reset ? [] : this.workouts();
			const before = existing.length ? existing[existing.length - 1].startedAt : undefined;
			const limit = reset ? FIRST_PAGE : PAGE;
			const page = await this.socket.request<WorkoutSummary[]>('workouts:list', before ? { before, limit } : { limit });
			this.workouts.set([...existing, ...page]);
			this.more.set(page.length === limit);
		}
		catch (err) {
			this.toast.error(err);
		}
		finally {
			this.loading.set(false);
		}
	}
}
