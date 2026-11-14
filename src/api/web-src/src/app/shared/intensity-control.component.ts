import { Component, computed, inject, signal } from '@angular/core';
import { INTENSITY_MAX, INTENSITY_MIN, INTENSITY_STEP } from '../core/intensity';
import { SocketService } from '../core/socket.service';
import { ToastService } from '../core/toast.service';

// Workout intensity while a plan runs: − / + in 5 % steps (50–120 %) and back to 100 %. Scales the
// current step's speed now and every later step's; inclines stay as planned.
@Component({
	selector: 'app-intensity-control',
	host: { class: 'intensity', role: 'group', 'aria-label': 'Workout intensity' },
	template: `
		<span class="intensity__label">Intensity</span>
		<button class="btn btn--round btn--round-sm" type="button" (click)="change(-step)" [disabled]="busy() || !active() || percent() <= min" aria-label="Easier: lower the workout intensity">−</button>
		<span class="intensity__value num" [class.intensity__value--changed]="percent() !== 100" aria-live="polite">{{ percent() }}%</span>
		<button class="btn btn--round btn--round-sm" type="button" (click)="change(step)" [disabled]="busy() || !active() || percent() >= max" aria-label="Harder: raise the workout intensity">+</button>
		@if (percent() !== 100) {
			<button class="btn btn--ghost intensity__reset" type="button" (click)="set(100)" [disabled]="busy() || !active()">100%</button>
		}
	`
})
export class IntensityControlComponent {
	private readonly socket = inject(SocketService);
	private readonly toast = inject(ToastService);
	protected readonly min = INTENSITY_MIN;
	protected readonly max = INTENSITY_MAX;
	protected readonly step = INTENSITY_STEP;
	protected readonly busy = signal(false);
	protected readonly percent = computed(() => this.socket.playback()?.intensity ?? 100);
	protected readonly active = computed(() => ['waiting', 'running', 'paused', 'resuming'].includes(this.socket.playback()?.state ?? 'idle'));

	protected change(delta: number): void {
		this.set(Math.min(INTENSITY_MAX, Math.max(INTENSITY_MIN, this.percent() + delta)));
	}

	protected async set(percent: number): Promise<void> {
		this.busy.set(true);
		try {
			await this.socket.request('playback:intensity', { percent });
		}
		catch (err) {
			this.toast.error(err);
		}
		finally {
			this.busy.set(false);
		}
	}
}
