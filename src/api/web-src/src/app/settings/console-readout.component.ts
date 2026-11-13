import { Component, DestroyRef, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { PrefsService } from '../core/prefs.service';
import { SocketService } from '../core/socket.service';
import { kphToMph } from '../core/units';

interface ConsoleField { key: string; value: string | null; at: string }
interface LogLine { seq: number; at: string; dir: 'in' | 'out'; text: string }
interface ConsoleReadout { transport: string; connected?: boolean; speedKey: string | null; calibrated: boolean; fields: ConsoleField[]; log: LogLine[]; logSeq: number }

const POLL_MS = 1000;
// Lines kept on screen.
const MAX_LINES = 300;
const time = (iso: string) => {
	const d = new Date(iso);
	return `${d.toTimeString().slice(0, 8)}.${String(d.getMilliseconds()).padStart(3, '0')}`;
};

// Settings → Console readout: what the treadmill console sends (set speed, measured belt speed,
// incline …) next to what Zwifit shows and sends to Zwift, refreshed every second.
@Component({
	selector: 'app-console-readout',
	imports: [DatePipe],
	template: `
		<section class="card stack" id="console" aria-labelledby="console-title">
			<h2 class="card__title" id="console-title">Console readout</h2>
			<div class="readout" role="group" aria-label="Live values">
				<div class="readout__cell">
					<div class="readout__label">Set speed (console)</div>
					<div class="readout__value num">{{ setSpeed() ?? '–' }}</div>
					<div class="readout__unit">{{ setKey() ?? 'not sent' }}</div>
				</div>
				<div class="readout__cell">
					<div class="readout__label">Belt speed (measured)</div>
					<div class="readout__value num">{{ beltSpeed() ?? '–' }}</div>
					<div class="readout__unit">{{ beltKey() ?? 'not sent by this console' }}</div>
				</div>
				<div class="readout__cell readout__cell--zwifit">
					<div class="readout__label">Zwifit shows / sends to Zwift</div>
					<div class="readout__value num">{{ zwifitSpeed() }}</div>
					<div class="readout__unit">{{ consoleUnit() }}@if (zwifitDisplay(); as d) { ({{ d }}) } · from "{{ readout()?.speedKey ?? '–' }}"@if (readout()?.calibrated) { · calibrated }</div>
				</div>
				<div class="readout__cell">
					<div class="readout__label">Incline set / actual</div>
					<div class="readout__value num">{{ field('Incline') ?? '–' }} / {{ field('Actual Incline') ?? '–' }}</div>
					<div class="readout__unit">%</div>
				</div>
			</div>
			@if (readout(); as r) {
				@if (!r.fields.length) {
					<p class="muted">@if (r.transport === 'ble') { A Bluetooth treadmill doesn't send console fields; only the values above are known. } @else { Nothing received from the console yet. }</p>
				}
				@else {
					<details class="readout__all">
						<summary>All {{ r.fields.length }} fields the console sent</summary>
						<div class="table-wrap" tabindex="0" role="region" aria-label="Console fields">
							<table class="table">
								<thead><tr><th scope="col">Field</th><th scope="col">Value</th><th scope="col">Updated</th></tr></thead>
								<tbody>
									@for (f of r.fields; track f.key) {
										<tr [class.readout__row--used]="f.key === r.speedKey">
											<td>{{ f.key }}@if (f.key === r.speedKey) { <span class="pill pill--accent">speed used</span> }</td>
											<td class="num">{{ f.value ?? '–' }}</td>
											<td class="muted">{{ f.at | date: 'HH:mm:ss' }}</td>
										</tr>
									}
								</tbody>
							</table>
						</div>
					</details>
				}
			}
			<div class="row">
				<h3 class="readout__subtitle" id="console-output-title">Console output</h3>
				<span class="muted">← from the treadmill · → sent by Zwifit</span>
				<span class="spacer"></span>
				<button class="btn btn--ghost" type="button" (click)="paused.set(!paused())">{{ paused() ? 'Resume' : 'Pause' }}</button>
				<button class="btn btn--ghost" type="button" (click)="lines.set([])">Clear</button>
				<button class="btn btn--ghost" type="button" (click)="copy()" [disabled]="!lines().length">Copy</button>
			</div>
			<pre #terminal class="terminal" tabindex="0" role="log" aria-live="off" aria-labelledby="console-output-title">@for (l of lines(); track l.seq) {<span class="terminal__line terminal__line--{{ l.dir }}"><span class="terminal__time">{{ l.time }}</span> {{ l.dir === 'in' ? '←' : '→' }} {{ l.text }}
</span>} @empty {<span class="terminal__empty">Waiting for the treadmill…</span>}</pre>
			<p class="field__hint">Speeds as the console sends them (its own units). Zwifit uses the measured belt speed when the console sends one, so Zwift and your history follow the belt; the set speed is the number on the console's screen.</p>
		</section>
	`
})
export class ConsoleReadoutComponent {
	private readonly socket = inject(SocketService);
	protected readonly prefs = inject(PrefsService);
	protected readonly readout = signal<ConsoleReadout | null>(null);
	// Console output: raw messages as they travel, newest last.
	protected readonly lines = signal<(LogLine & { time: string })[]>([]);
	protected readonly paused = signal(false);
	private lastSeq = 0;
	private readonly terminal = viewChild<ElementRef<HTMLElement>>('terminal');

	protected readonly setKey = computed(() => (this.field('KPH') !== null ? 'KPH' : this.field('MPH') !== null ? 'MPH' : null));
	protected readonly beltKey = computed(() => (this.field('Current KPH') !== null ? 'Current KPH' : this.field('Current MPH') !== null ? 'Current MPH' : null));
	protected readonly setSpeed = computed(() => { const k = this.setKey(); return k ? this.field(k) : null; });
	protected readonly beltSpeed = computed(() => { const k = this.beltKey(); return k ? this.field(k) : null; });
	// Zwifit's speed in the console's own unit, so the three numbers compare directly.
	protected readonly consoleUnit = computed(() => (this.setKey() === 'MPH' || this.beltKey() === 'Current MPH' ? 'MPH' : 'KPH'));
	protected readonly zwifitSpeed = computed(() => {
		const kph = this.socket.status()?.treadmill?.kph;
		if (kph == null) {
			return '–';
		}
		return (this.consoleUnit() === 'MPH' ? kphToMph(kph) : kph).toFixed(1);
	});
	// …and in the display units, when those differ.
	protected readonly zwifitDisplay = computed(() => {
		const kph = this.socket.status()?.treadmill?.kph;
		const differs = (this.consoleUnit() === 'KPH') !== this.prefs.metric();
		return kph == null || !differs ? null : `${this.prefs.speed(kph)} ${this.prefs.speedLabel()}`;
	});

	constructor() {
		const timer = setInterval(() => this.load(), POLL_MS);
		inject(DestroyRef).onDestroy(() => clearInterval(timer));
		this.load();
	}

	// Exactly as the console sent it ("2.0", not 2).
	protected field(key: string): string | null {
		return this.readout()?.fields.find(x => x.key === key)?.value ?? null;
	}

	protected async copy(): Promise<void> {
		const text = this.lines().map(l => `${l.time} ${l.dir === 'in' ? '<-' : '->'} ${l.text}`).join('\n');
		try {
			await navigator.clipboard.writeText(text);
		}
		catch {
			// No clipboard (e.g. plain http on another device): select the text instead.
			const el = this.terminal()?.nativeElement;
			if (el) {
				getSelection()?.selectAllChildren(el);
			}
		}
	}

	private async load(): Promise<void> {
		if (!this.socket.connected()) {
			return;
		}
		try {
			const readout = await this.socket.request<ConsoleReadout>('treadmill:console', { after: this.lastSeq });
			this.readout.set(readout);
			// Zwifit restarted (numbering began again): take everything it has.
			if (readout.logSeq < this.lastSeq) {
				this.lastSeq = 0;
				return;
			}
			this.lastSeq = readout.logSeq;
			if (!this.paused() && readout.log.length) {
				this.lines.update(old => [...old, ...readout.log.map(l => ({ ...l, time: time(l.at) }))].slice(-MAX_LINES));
				// Follow the newest line unless the reader scrolled up.
				const el = this.terminal()?.nativeElement;
				const atBottom = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 40;
				if (el && atBottom) {
					requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
				}
			}
		}
		catch {
			// Shown as dashes; the next poll tries again.
		}
	}
}
