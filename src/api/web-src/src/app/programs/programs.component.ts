import { Component, computed, effect, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Program, ProgramDay, ProgramGoal, ProgramInput, ProgramSummary } from '../core/api.types';
import { PrefsService } from '../core/prefs.service';
import { SocketService } from '../core/socket.service';
import { ToastService } from '../core/toast.service';
import { fromDisplaySpeed, displaySpeed } from '../core/units';
import { expandPlan } from '../core/plan-profile.service';

const GOALS: { value: ProgramGoal; label: string }[] = [
	{ value: '5k', label: '5K' }, { value: '10k', label: '10K' }, { value: 'half', label: 'Half marathon' }, { value: 'marathon', label: 'Marathon' }
];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DEFAULT_WEEKS = 16;
const PHASE_LABELS: Record<ProgramDay['phase'], string> = { base: 'Base', build: 'Build', peak: 'Peak', taper: 'Taper' };

// The Sunday `weeks` weeks from now, as YYYY-MM-DD (local date).
function defaultRaceDate(weeks: number): string {
	const d = new Date();
	d.setDate(d.getDate() + weeks * 7 - 1);
	d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
	return localIso(d);
}

const localIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const daySeconds = (day: ProgramDay) => expandPlan({ items: day.items } as never).reduce((sum, s) => sum + s.seconds, 0);

@Component({
	selector: 'app-programs',
	imports: [FormsModule, RouterLink, DatePipe],
	template: `
		<div class="page-head">
			<h1>Training programs</h1>
			<a class="btn" routerLink="/plans">Plans</a>
		</div>

		@if (programs().length) {
			<ul class="program-list">
				@for (p of programs(); track p.id) {
					<li class="card program-card">
						<div class="program-card__main">
							<h2 class="plan-card__name"><a [routerLink]="['/programs', p.id]">{{ p.name }}</a></h2>
							<div class="muted">Race {{ p.raceDate | date: 'EEE d MMM y' }} · {{ p.weeks }} weeks · {{ p.done }} of {{ p.runs }} runs done</div>
							<div class="progress" role="progressbar" [attr.aria-valuenow]="p.done" aria-valuemin="0" [attr.aria-valuemax]="p.runs" [attr.aria-label]="p.name + ' progress'">
								<span class="progress__bar" [style.width.%]="p.runs ? (p.done / p.runs) * 100 : 0"></span>
							</div>
						</div>
						<a class="btn btn--primary" [routerLink]="['/programs', p.id]">Open</a>
					</li>
				}
			</ul>
		}

		<section class="card stack" aria-labelledby="new-program-title">
			<h2 class="card__title" id="new-program-title">New program</h2>
			<p class="muted">Pick a goal and race date; Zwifit builds a week-by-week schedule of treadmill runs (easy, hills, intervals, tempo, long runs and a taper), each with its speeds and inclines. Start each day's run from the program.</p>
			<div class="field">
				<span class="field__label" id="goal-label">Goal</span>
				<div class="segmented" role="group" aria-labelledby="goal-label">
					@for (g of goals; track g.value) {
						<button type="button" [attr.aria-pressed]="goal() === g.value" (click)="goal.set(g.value)">{{ g.label }}</button>
					}
				</div>
			</div>
			<div class="form-grid form-grid--3">
				<label class="field"><span class="field__label">Weeks</span>
					<input class="input num" type="number" min="6" max="24" [ngModel]="weeks()" (ngModelChange)="setWeeks($event)"></label>
				<label class="field"><span class="field__label">Race date</span>
					<input class="input" type="date" [min]="today" [ngModel]="raceDate()" (ngModelChange)="raceDate.set($event)"></label>
				<label class="field"><span class="field__label">Name (optional)</span>
					<input class="input" maxlength="60" [placeholder]="preview()?.name ?? ''" [ngModel]="name()" (ngModelChange)="name.set($event)"></label>
				<label class="field"><span class="field__label">Easy run speed ({{ prefs.speedLabel() }})</span>
					<input class="input num" type="number" step="0.1" min="2" max="20" [ngModel]="easySpeed()" (ngModelChange)="easySpeed.set($event)">
					<span class="field__hint">A relaxed, conversational speed ({{ prefs.pace(easyKph()) }}). Harder runs are faster multiples of it.</span></label>
				<label class="field"><span class="field__label">Base incline (%)</span>
					<input class="input num" type="number" step="0.5" min="0" max="15" [ngModel]="incline()" (ngModelChange)="incline.set($event)">
					<span class="field__hint">1 % feels like running outdoors. Hill sessions add 4 %.</span></label>
			</div>
			<div class="field">
				<span class="field__label" id="days-label">Run days ({{ runDays().length }}; 3–6, the last is the long run)</span>
				<div class="row" role="group" aria-labelledby="days-label">
					@for (d of days; track $index) {
						<button class="chip" type="button" [attr.aria-pressed]="runDays().includes($index)" (click)="toggleDay($index)">{{ d }}</button>
					}
				</div>
			</div>
			@if (problem(); as text) { <p class="field__error">{{ text }}</p> }

			@if (weekRows().length) {
				<div class="table-wrap" tabindex="0" role="region" aria-label="Preview, week by week">
					<table class="table program-preview">
						<caption class="visually-hidden">Preview, week by week</caption>
						<thead><tr><th scope="col">Week</th><th scope="col">Phase</th><th scope="col">Runs</th><th scope="col" class="num">Time</th></tr></thead>
						<tbody>
							@for (w of weekRows(); track w.week) {
								<tr>
									<td class="num">{{ w.week }}</td>
									<td><span class="phase phase--{{ w.phase }}">{{ phaseLabels[w.phase] }}</span></td>
									<td>{{ w.titles }}</td>
									<td class="num">{{ prefs.duration(w.seconds) }}</td>
								</tr>
							}
						</tbody>
					</table>
				</div>
			}
			<div class="row">
				<span class="spacer"></span>
				<button class="btn btn--primary" type="button" (click)="create()" [disabled]="!!problem() || !preview() || busy()">Create program</button>
			</div>
		</section>
	`
})
export class ProgramsComponent {
	private readonly socket = inject(SocketService);
	private readonly toast = inject(ToastService);
	private readonly router = inject(Router);
	protected readonly prefs = inject(PrefsService);
	protected readonly goals = GOALS;
	protected readonly days = DAYS;
	protected readonly phaseLabels = PHASE_LABELS;
	protected readonly today = localIso(new Date());

	protected readonly programs = signal<ProgramSummary[]>([]);
	protected readonly goal = signal<ProgramGoal>('half');
	protected readonly weeks = signal(DEFAULT_WEEKS);
	protected readonly raceDate = signal(defaultRaceDate(DEFAULT_WEEKS));
	protected readonly name = signal('');
	protected readonly runDays = signal<number[]>([1, 3, 5, 6]);
	protected readonly incline = signal(1);
	protected readonly easySpeed = signal<number | null>(null);
	protected readonly preview = signal<Program | null>(null);
	protected readonly problem = signal<string | null>(null);
	protected readonly busy = signal(false);

	protected readonly easyKph = computed(() => fromDisplaySpeed(Number(this.easySpeed()) || 0, this.prefs.metric()));
	private readonly input = computed<ProgramInput>(() => ({
		goal: this.goal(),
		weeks: Math.round(Number(this.weeks())),
		raceDate: this.raceDate(),
		runDays: this.runDays(),
		easyKph: Math.round(this.easyKph() * 10) / 10,
		incline: Number(this.incline()) || 0,
		...(this.name().trim() ? { name: this.name().trim() } : {})
	}));

	protected readonly weekRows = computed(() => {
		const program = this.preview();
		if (!program) {
			return [];
		}
		const rows = new Map<number, { week: number; phase: ProgramDay['phase']; titles: string; seconds: number }>();
		for (const day of program.days) {
			const row = rows.get(day.week) ?? { week: day.week, phase: day.phase, titles: '', seconds: 0 };
			row.titles = row.titles ? `${row.titles} · ${day.weekday} ${day.title}` : `${day.weekday} ${day.title}`;
			row.seconds += daySeconds(day);
			rows.set(day.week, row);
		}
		return [...rows.values()];
	});

	constructor() {
		// A sensible starting easy speed in the user's units (9 km/h ≈ 5.6 mph).
		effect(() => {
			if (this.easySpeed() === null && this.socket.settings()) {
				this.easySpeed.set(Math.round(displaySpeed(9, this.prefs.metric()) * 10) / 10);
			}
		});
		effect(() => {
			this.socket.programsVersion();
			if (this.socket.connected()) {
				this.socket.request<ProgramSummary[]>('programs:list').then(list => this.programs.set(list), err => this.toast.error(err));
			}
		});
		// Re-preview whenever the inputs change.
		effect(() => {
			const input = this.input();
			if (!this.socket.connected() || this.easySpeed() === null) {
				return;
			}
			this.refresh(input);
		});
	}

	private async refresh(input: ProgramInput): Promise<void> {
		const issue = this.check(input);
		this.problem.set(issue);
		if (issue) {
			this.preview.set(null);
			return;
		}
		try {
			this.preview.set(await this.socket.request<Program>('programs:preview', input));
		}
		catch (err) {
			this.preview.set(null);
			this.problem.set(err instanceof Error ? err.message : 'Could not build that program.');
		}
	}

	private check(input: ProgramInput): string | null {
		if (!(input.weeks >= 6 && input.weeks <= 24)) {
			return 'Weeks must be 6 to 24.';
		}
		if (!input.raceDate || input.raceDate < this.today) {
			return 'Pick a race date from today on.';
		}
		if (input.runDays.length < 3 || input.runDays.length > 6) {
			return 'Pick 3 to 6 run days.';
		}
		if (!(input.easyKph >= 3 && input.easyKph <= 20)) {
			return `Easy run speed must be between ${this.prefs.speed(3)} and ${this.prefs.speed(20)}.`;
		}
		return null;
	}

	protected setWeeks(value: number): void {
		this.weeks.set(value);
		if (value >= 6 && value <= 24) {
			this.raceDate.set(defaultRaceDate(value));
		}
	}

	protected toggleDay(index: number): void {
		this.runDays.update(days => (days.includes(index) ? days.filter(d => d !== index) : [...days, index].sort((a, b) => a - b)));
	}

	protected async create(): Promise<void> {
		this.busy.set(true);
		try {
			const program = await this.socket.request<Program>('programs:create', this.input());
			this.toast.show(`Created "${program.name}".`);
			this.router.navigate(['/programs', program.id]);
		}
		catch (err) {
			this.toast.error(err);
		}
		finally {
			this.busy.set(false);
		}
	}
}
