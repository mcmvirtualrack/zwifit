import { Component, computed, effect, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Program, ProgramDay } from '../core/api.types';
import { PrefsService } from '../core/prefs.service';
import { SocketService } from '../core/socket.service';
import { ToastService } from '../core/toast.service';
import { daySeconds } from './programs.component';

const localIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

type DayState = 'done' | 'missed' | 'today' | 'upcoming';

@Component({
	selector: 'app-program-detail',
	imports: [RouterLink, DatePipe],
	template: `
		@if (program(); as p) {
			<div class="page-head">
				<h1>{{ p.name }}</h1>
				<a class="btn" routerLink="/programs">All programs</a>
				@if (p.goal === 'custom') { <a class="btn" [routerLink]="['/programs', p.id, 'edit']">Edit</a> }
				<button class="btn btn--ghost btn--danger-text" type="button" (click)="remove(p)">Delete</button>
			</div>
			<p class="muted">@if (p.goal === 'custom') {Your own program} @else {Race {{ p.raceDate | date: 'EEEE d MMMM y' }}}@if (p.targetSeconds) {<span> · {{ p.targetFrom === 'time' ? 'Target' : 'Trains for' }} {{ prefs.duration(p.targetSeconds) }}</span>} · {{ p.weeks }} weeks from {{ p.startDate | date: 'd MMM' }} · {{ doneCount() }} of {{ p.days.length }} runs done</p>
			@if (planRunning()) {
				<div class="banner banner--accent" role="status">A plan is running. <a routerLink="/workout">Open workout</a></div>
			}

			@if (next(); as day) {
				<section class="card program-next" aria-labelledby="next-title">
					<div class="eyebrow" id="next-title">{{ day.date === today ? 'Today' : 'Next run' }} · Week {{ day.week }} · {{ day.date | date: 'EEE d MMM' }}</div>
					<div class="program-next__row">
						<div>
							<h2 class="program-next__title">{{ day.title }}</h2>
							<p class="muted">{{ day.description }} · {{ prefs.duration(seconds(day)) }}</p>
						</div>
						<span class="spacer"></span>
						<button class="btn btn--primary btn--lg" type="button" (click)="start(p, day)" [disabled]="planRunning() || busy()">
							<svg class="btn__icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4l13 8-13 8z" /></svg>Start
						</button>
					</div>
				</section>
			}
			@else {
				<div class="banner banner--ok" role="status">All runs are behind you. Good luck on race day!</div>
			}

			@for (w of weeks(); track w.week) {
				<section class="card program-week" [attr.aria-labelledby]="'week-' + w.week">
					<div class="row">
						<h2 class="card__title" [id]="'week-' + w.week">Week {{ w.week }}</h2>
						@if (w.phase !== 'custom') { <span class="phase phase--{{ w.phase }}">{{ w.phase }}</span> }
						<span class="spacer"></span>
						<span class="muted num">{{ prefs.duration(w.seconds) }}</span>
					</div>
					<ul class="list">
						@for (day of w.days; track day.date) {
							<li class="list-item program-day program-day--{{ state(day) }}">
								<span class="program-day__mark" aria-hidden="true">{{ marks[state(day)] }}</span>
								<div class="list-item__main">
									<div class="list-item__title">{{ day.weekday }} {{ day.date | date: 'd MMM' }} · {{ day.title }}
										@if (state(day) === 'today') { <span class="pill pill--accent">Today</span> }
										@if (state(day) === 'done') { <span class="visually-hidden">(done)</span> }
										@if (state(day) === 'missed') { <span class="visually-hidden">(missed)</span> }
									</div>
									<div class="muted">{{ day.description }} · {{ prefs.duration(seconds(day)) }}</div>
								</div>
								@if (day.workoutId) {
									<a class="btn btn--ghost" [routerLink]="['/history', day.workoutId]">Result</a>
								}
								<button class="btn" type="button" (click)="start(p, day)" [disabled]="planRunning() || busy()"
									[attr.aria-label]="'Start ' + day.title + ' on ' + day.date">{{ day.done ? 'Run again' : 'Start' }}</button>
							</li>
						}
					</ul>
				</section>
			}
		}
		@else if (missing()) {
			<div class="card empty"><p>That program no longer exists.</p><a class="btn" routerLink="/programs">All programs</a></div>
		}
		@else {
			<p class="empty">Loading…</p>
		}
	`
})
export class ProgramDetailComponent {
	private readonly id = inject(ActivatedRoute).snapshot.paramMap.get('id') ?? '';
	private readonly socket = inject(SocketService);
	private readonly toast = inject(ToastService);
	private readonly router = inject(Router);
	protected readonly prefs = inject(PrefsService);
	protected readonly today = localIso(new Date());
	protected readonly marks: Record<DayState, string> = { done: '✓', missed: '–', today: '●', upcoming: '○' };

	protected readonly program = signal<Program | null>(null);
	protected readonly missing = signal(false);
	protected readonly busy = signal(false);
	protected readonly planRunning = computed(() => ['waiting', 'running', 'paused', 'resuming'].includes(this.socket.playback()?.state ?? 'idle'));
	protected readonly doneCount = computed(() => this.program()?.days.filter(d => d.done).length ?? 0);
	// Today's run if not done yet, else the next one to come.
	protected readonly next = computed(() => this.program()?.days.find(d => d.date >= this.today && !(d.date === this.today && d.done)) ?? null);
	protected readonly weeks = computed(() => {
		const groups = new Map<number, { week: number; phase: string; seconds: number; days: ProgramDay[] }>();
		for (const day of this.program()?.days ?? []) {
			const g = groups.get(day.week) ?? { week: day.week, phase: day.phase, seconds: 0, days: [] };
			g.days.push(day);
			g.seconds += daySeconds(day);
			groups.set(day.week, g);
		}
		return [...groups.values()];
	});

	constructor() {
		effect(() => {
			this.socket.programsVersion();
			this.socket.workoutsVersion();
			if (this.socket.connected()) {
				this.load(this.id);
			}
		});
	}

	private async load(id: string): Promise<void> {
		try {
			this.program.set(await this.socket.request<Program>('programs:get', { id }));
		}
		catch {
			this.missing.set(true);
		}
	}

	protected seconds(day: ProgramDay): number {
		return daySeconds(day);
	}

	protected state(day: ProgramDay): DayState {
		if (day.done) {
			return 'done';
		}
		return day.date < this.today ? 'missed' : day.date === this.today ? 'today' : 'upcoming';
	}

	protected async start(program: Program, day: ProgramDay): Promise<void> {
		this.busy.set(true);
		try {
			await this.socket.request('programs:start', { id: program.id, date: day.date });
			this.router.navigate(['/workout']);
		}
		catch (err) {
			this.toast.error(err);
		}
		finally {
			this.busy.set(false);
		}
	}

	protected async remove(program: Program): Promise<void> {
		if (!confirm(`Delete "${program.name}"? Runs you already did stay in History, and their plans stay in Plans.`)) {
			return;
		}
		try {
			await this.socket.request('programs:delete', { id: program.id });
			this.router.navigate(['/programs']);
		}
		catch (err) {
			this.toast.error(err);
		}
	}
}
