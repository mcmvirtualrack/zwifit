import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { PlanSummary, Program } from '../core/api.types';
import { PrefsService } from '../core/prefs.service';
import { SocketService } from '../core/socket.service';
import { ToastService } from '../core/toast.service';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DEFAULT_WEEKS = 16;
const MAX_WEEKS = 52;
const DAY_MS = 24 * 60 * 60 * 1000;

const localIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
// The Monday of the week a YYYY-MM-DD date falls in (week 1 always starts on a Monday).
function mondayOf(iso: string): Date | null {
	const d = new Date(`${iso}T00:00:00`);
	if (Number.isNaN(d.getTime())) {
		return null;
	}
	d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
	return d;
}
// Next Monday (or today, if it is one).
function nextMonday(): string {
	const d = new Date();
	d.setDate(d.getDate() + ((8 - d.getDay()) % 7));
	return localIso(d);
}

// Your own training program: for each week (1 to 52, 16 by default) and weekday, one of your plans
// or a rest day. Copy a week to the next one or to every later week to fill it in quickly.
@Component({
	selector: 'app-program-editor',
	imports: [FormsModule, RouterLink, DatePipe],
	template: `
		<div class="page-head">
			<h1>{{ editingId() ? 'Edit program' : 'Build your own program' }}</h1>
			<a class="btn" [routerLink]="editingId() ? ['/programs', editingId()] : ['/programs']">Cancel</a>
		</div>

		@if (loading()) {
			<p class="empty">Loading…</p>
		} @else {
			<section class="card stack" aria-labelledby="program-basics">
				<h2 class="card__title" id="program-basics">Program</h2>
				<div class="form-grid form-grid--3">
					<label class="field"><span class="field__label">Name</span>
						<input class="input" type="text" maxlength="80" placeholder="e.g. Spring half marathon" [ngModel]="name()" (ngModelChange)="name.set($event)"></label>
					<label class="field"><span class="field__label">Start (week 1)</span>
						<input class="input" type="date" [ngModel]="startDate()" (ngModelChange)="startDate.set($event)"></label>
					<label class="field"><span class="field__label">Weeks</span>
						<input class="input num" type="number" min="1" [max]="maxWeeks" [ngModel]="weeks()" (ngModelChange)="setWeeks($event)"></label>
				</div>
				@if (monday(); as m) {
					<p class="field__hint">Week 1 starts on Monday {{ m | date: 'd MMMM y' }}; week {{ weeks() }} ends on {{ lastDay() | date: 'EEEE d MMMM y' }}. {{ runCount() }} runs.</p>
				}
				@if (!plans().length) {
					<div class="banner" role="status">You have no plans yet. <a routerLink="/plans">Create interval plans</a> first, then pick them here for each day.</div>
				}
			</section>

			<section class="card stack" aria-labelledby="program-weeks">
				<div class="row">
					<h2 class="card__title" id="program-weeks">Week by week</h2>
					<span class="spacer"></span>
					<a class="btn btn--ghost" routerLink="/plans">Plans…</a>
				</div>
				<p class="muted">Pick a plan for each day you run; leave the rest as Rest. "→ next" copies a week to the following week, "→ all" to every later week.</p>
				<div class="table-wrap">
					<table class="table program-grid">
						<thead>
							<tr>
								<th scope="col">Week</th>
								@for (d of days; track d) { <th scope="col">{{ d }}</th> }
								<th scope="col">Total</th>
								<th scope="col"><span class="visually-hidden">Copy</span></th>
							</tr>
						</thead>
						<tbody>
							@for (w of weekList(); track w) {
								<tr>
									<th scope="row" class="num">
										{{ w }}
										@if (weekStart(w); as ws) { <div class="muted">{{ ws | date: 'd MMM' }}</div> }
									</th>
									@for (d of days; track $index) {
										<td>
											<select class="select program-grid__cell" [attr.aria-label]="'Week ' + w + ' ' + d"
												[class.program-grid__cell--rest]="!cell(w, $index)"
												[ngModel]="cell(w, $index)" (ngModelChange)="setCell(w, $index, $event)">
												<option value="">Rest</option>
												@for (p of plans(); track p.id) { <option [value]="p.id">{{ p.name }}</option> }
												@if (cell(w, $index) && !planById(cell(w, $index))) { <option [value]="cell(w, $index)">(deleted plan)</option> }
											</select>
										</td>
									}
									<td class="num">{{ weekSeconds(w) ? prefs.duration(weekSeconds(w)) : '–' }}</td>
									<td class="program-grid__actions">
										<button class="btn btn--ghost" type="button" (click)="copyWeek(w, 'next')" [disabled]="w >= weeks()" [attr.aria-label]="'Copy week ' + w + ' to week ' + (w + 1)">→ next</button>
										<button class="btn btn--ghost" type="button" (click)="copyWeek(w, 'all')" [disabled]="w >= weeks()" [attr.aria-label]="'Copy week ' + w + ' to every later week'">→ all</button>
										<button class="btn btn--ghost" type="button" (click)="clearWeek(w)" [attr.aria-label]="'Clear week ' + w">Clear</button>
									</td>
								</tr>
							}
						</tbody>
					</table>
				</div>
			</section>

			<div class="row">
				<span class="spacer"></span>
				<button class="btn btn--primary btn--lg" type="button" (click)="save()" [disabled]="saving() || !name().trim() || !monday()">
					{{ editingId() ? 'Save changes' : 'Create program' }}
				</button>
			</div>
		}
	`
})
export class ProgramEditorComponent implements OnInit {
	private readonly socket = inject(SocketService);
	private readonly toast = inject(ToastService);
	private readonly router = inject(Router);
	private readonly route = inject(ActivatedRoute);
	protected readonly prefs = inject(PrefsService);

	protected readonly days = DAYS;
	protected readonly maxWeeks = MAX_WEEKS;
	protected readonly editingId = signal<string | null>(null);
	protected readonly loading = signal(true);
	protected readonly saving = signal(false);
	protected readonly plans = signal<PlanSummary[]>([]);
	protected readonly name = signal('');
	protected readonly startDate = signal(nextMonday());
	protected readonly weeks = signal(DEFAULT_WEEKS);
	// "week:weekday" → plan id; missing means rest.
	private readonly cells = signal<Record<string, string>>({});

	protected readonly monday = computed(() => mondayOf(this.startDate()));
	protected readonly lastDay = computed(() => {
		const m = this.monday();
		return m ? new Date(m.getTime() + (this.weeks() * 7 - 1) * DAY_MS) : null;
	});
	protected readonly weekList = computed(() => Array.from({ length: this.weeks() }, (_, i) => i + 1));
	protected readonly runCount = computed(() => Object.keys(this.cells()).filter(k => Number(k.split(':')[0]) <= this.weeks()).length);
	private readonly planMap = computed(() => new Map(this.plans().map(p => [p.id, p])));

	async ngOnInit(): Promise<void> {
		const id = this.route.snapshot.paramMap.get('id');
		try {
			this.plans.set(await this.socket.request<PlanSummary[]>('plans:list'));
			if (id) {
				this.editingId.set(id);
				const program = await this.socket.request<Program>('programs:get', { id });
				this.name.set(program.name);
				this.startDate.set(program.startDate);
				this.weeks.set(program.weeks);
				const cells: Record<string, string> = {};
				for (const day of program.days) {
					if (day.sourcePlanId) {
						cells[`${day.week}:${DAYS.indexOf(day.weekday)}`] = day.sourcePlanId;
					}
				}
				this.cells.set(cells);
			}
		}
		catch (err) {
			this.toast.error(err);
		}
		finally {
			this.loading.set(false);
		}
	}

	protected weekStart(week: number): Date | null {
		const m = this.monday();
		return m ? new Date(m.getTime() + (week - 1) * 7 * DAY_MS) : null;
	}

	protected planById(id: string): PlanSummary | undefined {
		return this.planMap().get(id);
	}

	protected cell(week: number, weekday: number): string {
		return this.cells()[`${week}:${weekday}`] ?? '';
	}

	protected setCell(week: number, weekday: number, planId: string): void {
		this.cells.update(c => {
			const next = { ...c };
			if (planId) {
				next[`${week}:${weekday}`] = planId;
			}
			else {
				delete next[`${week}:${weekday}`];
			}
			return next;
		});
	}

	protected weekSeconds(week: number): number {
		let total = 0;
		for (let d = 0; d < 7; d++) {
			const plan = this.planById(this.cell(week, d));
			total += plan ? plan.totals.seconds : 0;
		}
		return total;
	}

	protected setWeeks(value: number | string): void {
		const n = Math.round(Number(value));
		if (Number.isFinite(n)) {
			this.weeks.set(Math.min(MAX_WEEKS, Math.max(1, n)));
		}
	}

	protected copyWeek(week: number, to: 'next' | 'all'): void {
		const last = to === 'next' ? Math.min(week + 1, this.weeks()) : this.weeks();
		this.cells.update(c => {
			const next = { ...c };
			for (let target = week + 1; target <= last; target++) {
				for (let d = 0; d < 7; d++) {
					const planId = c[`${week}:${d}`];
					if (planId) {
						next[`${target}:${d}`] = planId;
					}
					else {
						delete next[`${target}:${d}`];
					}
				}
			}
			return next;
		});
	}

	protected clearWeek(week: number): void {
		this.cells.update(c => Object.fromEntries(Object.entries(c).filter(([k]) => Number(k.split(':')[0]) !== week)));
	}

	protected async save(): Promise<void> {
		const days = Object.entries(this.cells())
			.map(([k, planId]) => ({ week: Number(k.split(':')[0]), weekday: Number(k.split(':')[1]), planId }))
			.filter(d => d.week <= this.weeks());
		const payload = { name: this.name().trim(), startDate: this.startDate(), weeks: this.weeks(), days };
		this.saving.set(true);
		try {
			const id = this.editingId();
			const program = id
				? await this.socket.request<Program>('programs:updateCustom', { ...payload, id })
				: await this.socket.request<Program>('programs:createCustom', payload);
			this.toast.show(id ? 'Program saved.' : 'Program created.');
			await this.router.navigate(['/programs', program.id]);
		}
		catch (err) {
			this.toast.error(err);
		}
		finally {
			this.saving.set(false);
		}
	}
}
