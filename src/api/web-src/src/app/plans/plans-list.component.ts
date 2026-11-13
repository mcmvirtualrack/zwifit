import { Component, computed, effect, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { Plan, PlanSummary } from '../core/api.types';
import { ProfileStep, expandPlan } from '../core/plan-profile.service';
import { PrefsService } from '../core/prefs.service';
import { SessionService } from '../core/session.service';
import { SocketService } from '../core/socket.service';
import { ToastService } from '../core/toast.service';

// Profiles are drawn for this many plans; the rest of a long list shows without one.
const MAX_PROFILES = 40;

// A plan's steps as bars in a 1000 × 100 box (height = speed).
function profileOf(steps: ProfileStep[]): { path: string; steps: number; maxKph: number } {
	const total = steps.reduce((sum, s) => sum + s.seconds, 0) || 1;
	const maxKph = Math.max(0, ...steps.map(s => s.kph));
	const top = maxKph * 1.15 || 1;
	const path = steps.map(s => {
		const x = (s.startsAt / total) * 1000;
		const w = Math.max(1, (s.seconds / total) * 1000 - 3);
		const y = 100 - (s.kph / top) * 100;
		return `M${x.toFixed(1)} 100V${y.toFixed(1)}h${w.toFixed(1)}V100Z`;
	}).join('');
	return { path, steps: steps.length, maxKph };
}

@Component({
	selector: 'app-plans-list',
	imports: [RouterLink, DatePipe],
	template: `
		<div class="page-head">
			<h1>Plans</h1>
			<label class="search">
				<svg class="search__icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
				<span class="visually-hidden">Search plans</span>
				<input class="search__input" type="search" placeholder="Search plans" [value]="query()" (input)="query.set($any($event.target).value)">
			</label>
			<a class="btn" routerLink="/programs">Programs</a>
			<label class="btn" for="import-file">Import</label>
			<input id="import-file" class="visually-hidden" type="file" accept=".json,application/json" (change)="importFile($event)">
			<a class="btn btn--primary" routerLink="/plans/new">
				<svg class="btn__icon btn__icon--stroke" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>New plan
			</a>
		</div>
		@if (planRunning()) {
			<div class="banner banner--accent" role="status">A plan is running. <a routerLink="/workout">Open workout</a></div>
		}
		@if (loading()) {
			<p class="empty">Loading…</p>
		}
		@else if (!plans().length) {
			<div class="card empty">
				<p>No plans yet.</p>
				<a class="btn btn--primary" routerLink="/plans/new">Create your first plan</a>
			</div>
		}
		@else {
			<ul class="plan-grid">
				@for (plan of shown(); track plan.id) {
					<li class="plan-card">
						<div class="plan-card__head">
							<h2 class="plan-card__name"><a [routerLink]="['/plans', plan.id]">{{ plan.name }}</a></h2>
							@if (profiles()[plan.id]; as p) { <span class="plan-card__tag">{{ p.steps }} steps</span> }
						</div>
						<div class="plan-card__profile">
							@if (profiles()[plan.id]; as p) {
								<svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true"><path [attr.d]="p.path" /></svg>
							}
						</div>
						<div class="plan-card__stats num">
							<span>{{ prefs.duration(plan.totals.seconds) }}</span>
							<span>{{ prefs.distance(plan.totals.metres, 1) }} {{ prefs.distanceLabel() }}@if (plan.totals.estimated) {*}</span>
							@if (profiles()[plan.id]; as p) { <span>max {{ prefs.speed(p.maxKph) }}</span> }
						</div>
						@if (plan.problems?.length) {
							<div class="field__error">Doesn't fit the treadmill's limits: {{ plan.problems![0].message }}</div>
						}
						<div class="plan-card__foot">
							<span class="plan-card__note">Updated {{ plan.updatedAt | date: 'mediumDate' }}</span>
							<a class="btn btn--ghost" [routerLink]="['/plans', plan.id]" [attr.aria-label]="'Edit ' + plan.name">Edit</a>
							<button class="btn btn--primary" type="button" (click)="start(plan)" [disabled]="planRunning() || !!plan.problems?.length" [attr.aria-label]="'Start ' + plan.name">
								<svg class="btn__icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4l13 8-13 8z" /></svg>Run
							</button>
						</div>
						<details class="plan-card__more">
							<summary>More</summary>
							<div class="plan-card__actions">
								<a class="btn btn--ghost" [href]="'/api/plans/' + plan.id + '/export'" download>Export</a>
								<button class="btn btn--ghost" type="button" (click)="duplicate(plan)">Duplicate</button>
								<button class="btn btn--ghost btn--danger-text" type="button" (click)="remove(plan)" [attr.aria-label]="'Delete ' + plan.name">Delete</button>
							</div>
						</details>
					</li>
				}
				@empty {
					<li class="card empty">No plan matches "{{ query() }}".</li>
				}
			</ul>
			@if (anyEstimated()) { <p class="field__hint">* Distance estimated from the target speeds.</p> }
		}
	`
})
export class PlansListComponent {
	private readonly socket = inject(SocketService);
	private readonly session = inject(SessionService);
	private readonly toast = inject(ToastService);
	private readonly router = inject(Router);
	protected readonly prefs = inject(PrefsService);
	protected readonly plans = signal<PlanSummary[]>([]);
	protected readonly loading = signal(true);
	protected readonly planRunning = computed(() => ['waiting', 'running', 'paused', 'resuming'].includes(this.socket.playback()?.state ?? 'idle'));
	protected readonly query = signal('');
	protected readonly shown = computed(() => {
		const q = this.query().trim().toLowerCase();
		return q ? this.plans().filter(p => p.name.toLowerCase().includes(q)) : this.plans();
	});

	protected readonly anyEstimated = computed(() => this.plans().some(p => p.totals.estimated));
	// Each plan's speed profile for its card, loaded after the list.
	protected readonly profiles = signal<Record<string, { path: string; steps: number; maxKph: number }>>({});

	constructor() {
		effect(() => {
			this.socket.plansVersion();
			if (this.socket.connected()) {
				this.load();
			}
		});
	}

	private async load(): Promise<void> {
		try {
			const plans = await this.socket.request<PlanSummary[]>('plans:list');
			this.plans.set(plans);
			this.loadProfiles(plans);
		}
		catch (err) {
			this.toast.error(err);
		}
		finally {
			this.loading.set(false);
		}
	}

	private async loadProfiles(plans: PlanSummary[]): Promise<void> {
		const entries = await Promise.all(plans.slice(0, MAX_PROFILES).map(async summary => {
			try {
				const steps = expandPlan(await this.socket.request<Plan>('plans:get', { id: summary.id }));
				return [summary.id, profileOf(steps)] as const;
			}
			catch {
				return null;
			}
		}));
		this.profiles.set(Object.fromEntries(entries.filter((e): e is NonNullable<typeof e> => !!e)));
	}

	protected async start(plan: PlanSummary): Promise<void> {
		try {
			await this.socket.request('playback:start', { planId: plan.id });
			this.router.navigate(['/workout']);
		}
		catch (err) {
			this.toast.error(err);
		}
	}

	protected async duplicate(plan: PlanSummary): Promise<void> {
		try {
			await this.socket.request('plans:duplicate', { id: plan.id });
			this.toast.show(`Copied "${plan.name}".`);
		}
		catch (err) {
			this.toast.error(err);
		}
	}

	protected async remove(plan: PlanSummary): Promise<void> {
		if (!confirm(`Delete "${plan.name}"? This cannot be undone.`)) {
			return;
		}
		try {
			await this.socket.request('plans:delete', { id: plan.id });
			this.toast.show(`Deleted "${plan.name}".`);
		}
		catch (err) {
			this.toast.error(err);
		}
	}

	protected async importFile(event: Event): Promise<void> {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) {
			return;
		}
		if (file.size > 1024 * 1024) {
			this.toast.show('That file is too large to be a plan (over 1 MB).');
			return;
		}
		try {
			const id = await this.session.importPlan(JSON.parse(await file.text()));
			this.toast.show('Plan imported.');
			this.router.navigate(['/plans', id]);
		}
		catch (err) {
			this.toast.error(err instanceof SyntaxError ? new Error('That file is not valid JSON.') : err);
		}
	}
}
