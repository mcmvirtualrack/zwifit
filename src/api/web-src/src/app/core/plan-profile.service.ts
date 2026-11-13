import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { Plan, Step } from './api.types';
import { SocketService } from './socket.service';

// One step of the running plan, in play order (blocks expanded), with its expected duration.
export interface ProfileStep {
	flatIndex: number;
	label: string;
	kph: number;
	incline: number;
	// Seconds the step should take (a distance step at its target speed).
	seconds: number;
	// Seconds into the plan where it starts.
	startsAt: number;
}

export function expandPlan(plan: Plan): ProfileStep[] {
	const flat: Step[] = [];
	for (const item of plan.items) {
		if (item.kind === 'block') {
			for (let r = 0; r < item.repeat; r++) {
				flat.push(...item.steps);
			}
		}
		else {
			flat.push(item);
		}
	}
	let at = 0;
	return flat.map((step, flatIndex) => {
		const seconds = step.end.type === 'time' ? step.end.seconds : step.targetKph > 0 ? step.end.metres / (step.targetKph / 3.6) : 0;
		const out = { flatIndex, label: step.label || `Step ${flatIndex + 1}`, kph: step.targetKph, incline: step.targetIncline, seconds, startsAt: at };
		at += seconds;
		return out;
	});
}

// The steps of the plan that is running (or just finished), loaded once per plan.
@Injectable({ providedIn: 'root' })
export class PlanProfileService {
	private readonly socket = inject(SocketService);
	private readonly plan = signal<Plan | null>(null);
	private loading: string | null = null;
	readonly steps = computed(() => {
		const plan = this.plan();
		const id = this.socket.playback()?.planId;
		return plan && plan.id === id ? expandPlan(plan) : [];
	});
	readonly totalSeconds = computed(() => {
		const steps = this.steps();
		const last = steps[steps.length - 1];
		return last ? last.startsAt + last.seconds : 0;
	});

	constructor() {
		effect(() => {
			const id = this.socket.playback()?.planId ?? null;
			if (id && id !== this.plan()?.id && id !== this.loading && this.socket.connected()) {
				this.load(id);
			}
		});
	}

	private async load(id: string): Promise<void> {
		this.loading = id;
		try {
			this.plan.set(await this.socket.request<Plan>('plans:get', { id }));
		}
		catch {
			// the profile is optional; the workout still runs without it
		}
		finally {
			this.loading = null;
		}
	}
}
