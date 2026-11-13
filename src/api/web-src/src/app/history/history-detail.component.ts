import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Workout } from '../core/api.types';
import { PrefsService } from '../core/prefs.service';
import { SocketService } from '../core/socket.service';
import { ToastService } from '../core/toast.service';
import { END_REASONS } from '../core/units';
import { StatTileComponent } from '../shared/stat-tile.component';
import { ChartSample } from './workout-charts';
import { WorkoutChartsComponent } from './workout-charts.component';

@Component({
	selector: 'app-history-detail',
	imports: [RouterLink, DatePipe, StatTileComponent, WorkoutChartsComponent],
	template: `
		<div class="page-head">
			<a class="btn btn--ghost" routerLink="/history">← History</a>
			<h1>{{ workout()?.planName || 'Workout' }}</h1>
			@if (workout(); as w) {
				<a class="btn btn--primary" [href]="'/api/workouts/' + w.id + '/export.fit'" download
					title="For Garmin Connect, Strava and other training apps">Export FIT</a>
				<a class="btn" [href]="'/api/workouts/' + w.id + '/export.csv'" download>Export CSV</a>
				<button class="btn btn--ghost" type="button" (click)="remove()">Delete</button>
			}
		</div>
		@if (workout(); as w) {
			<p class="muted">{{ w.startedAt | date: 'EEEE d MMMM y · HH:mm' }} · {{ w.endReason ? reasons[w.endReason] : 'In progress' }}</p>
			<div class="detail-grid">
				<app-stat-tile label="Time" [value]="prefs.duration(w.totals.seconds)" />
				<app-stat-tile label="Distance" [value]="prefs.distance(w.totals.metres)" [unit]="prefs.distanceLabel()" />
				<app-stat-tile label="Avg HR" [value]="w.totals.avgHr ? '' + w.totals.avgHr : '–'" [unit]="w.totals.avgHr ? 'bpm' : ''" [sub]="w.totals.avgHr ? '' : 'not available'" variant="hr" />
				<app-stat-tile label="Max HR" [value]="w.totals.maxHr ? '' + w.totals.maxHr : '–'" [unit]="w.totals.maxHr ? 'bpm' : ''" variant="hr" />
				@if (w.totals.avgCadence) {
					<app-stat-tile label="Avg cadence" [value]="'' + w.totals.avgCadence" unit="spm" variant="cadence" />
				}
				@if (w.totals.avgPower) {
					<app-stat-tile label="Avg power" [value]="'' + w.totals.avgPower" unit="W" [sub]="'max ' + w.totals.maxPower + ' W'" variant="power" />
				}
			</div>
			<section class="card" aria-labelledby="steps-title">
				<h2 id="steps-title" class="card__title">Steps · target vs actual</h2>
				<div class="table-wrap">
					<table class="table">
						<thead>
							<tr>
								<th scope="col">#</th><th scope="col">Step</th><th scope="col">Target</th><th scope="col">Actual</th>
								<th scope="col">Time</th><th scope="col">Distance</th><th scope="col">Avg HR</th><th scope="col">Max HR</th>
								@if (hasCadence()) { <th scope="col">Avg cadence</th> }
								@if (hasPower()) { <th scope="col">Avg power</th> }
								<th scope="col"></th>
							</tr>
						</thead>
						<tbody>
							@for (s of w.steps; track s.flatIndex) {
								<tr>
									<td class="num">{{ s.flatIndex + 1 }}</td>
									<td>{{ s.label || 'Step' }}@if (s.repetition > 1) { <span class="muted"> ×{{ s.repetition }}</span> }</td>
									<td class="num">{{ prefs.speed(s.target.kph) }} {{ prefs.speedLabel() }} · {{ s.target.incline }}%</td>
									<td class="num">{{ prefs.speed(s.actual.avgKph) }} {{ prefs.speedLabel() }} · {{ s.actual.avgIncline }}%</td>
									<td class="num">{{ prefs.duration(s.seconds) }}</td>
									<td class="num">{{ prefs.distance(s.metres) }}</td>
									<td class="num">{{ s.avgHr ? s.avgHr + ' bpm' : 'n/a' }}</td>
									<td class="num">{{ s.maxHr ? s.maxHr + ' bpm' : 'n/a' }}</td>
									@if (hasCadence()) { <td class="num">{{ s.avgCadence ? s.avgCadence + ' spm' : 'n/a' }}</td> }
									@if (hasPower()) { <td class="num">{{ s.avgPower ? s.avgPower + ' W' : 'n/a' }}</td> }
									<td>@if (s.skipped) { <span class="pill">Skipped</span> } @else if (s.overridden) { <span class="pill pill--warn">Changed</span> }</td>
								</tr>
							}
						</tbody>
					</table>
				</div>
			</section>
			<app-workout-charts [samples]="samples()" />
		}
		@else {
			<p class="empty">Loading…</p>
		}
	`
})
export class HistoryDetailComponent implements OnInit {
	private readonly socket = inject(SocketService);
	private readonly toast = inject(ToastService);
	private readonly route = inject(ActivatedRoute);
	private readonly router = inject(Router);
	protected readonly prefs = inject(PrefsService);
	protected readonly reasons = END_REASONS;
	protected readonly workout = signal<Workout | null>(null);
	protected readonly samples = signal<ChartSample[]>([]);
	protected readonly hasCadence = computed(() => !!this.workout()?.steps.some(s => s.avgCadence));
	protected readonly hasPower = computed(() => !!this.workout()?.steps.some(s => s.avgPower));

	async ngOnInit(): Promise<void> {
		const id = this.route.snapshot.paramMap.get('id');
		try {
			this.workout.set(await this.socket.request<Workout>('workouts:get', { id }));
			this.samples.set(await this.loadSamples(id));
		}
		catch (err) {
			this.toast.error(err);
			this.router.navigate(['/history']);
		}
	}

	// The server returns at most 3600 samples per request.
	private async loadSamples(id: string | null): Promise<ChartSample[]> {
		const all: ChartSample[] = [];
		for (let fromIndex = 0; ; ) {
			const page = await this.socket.request<{ total: number; samples: ChartSample[] }>('workouts:samples', { id, fromIndex, limit: 3600 });
			all.push(...page.samples);
			fromIndex += page.samples.length;
			if (!page.samples.length || fromIndex >= page.total) {
				return all;
			}
		}
	}

	protected async remove(): Promise<void> {
		const w = this.workout();
		if (!w || !confirm('Delete this workout and its heart-rate data? This cannot be undone.')) {
			return;
		}
		try {
			await this.socket.request('workouts:delete', { id: w.id });
			this.toast.show('Workout deleted.');
			this.router.navigate(['/history']);
		}
		catch (err) {
			this.toast.error(err);
		}
	}
}
