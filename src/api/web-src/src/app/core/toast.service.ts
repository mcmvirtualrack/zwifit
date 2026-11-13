import { Injectable, signal } from '@angular/core';
import { ApiError } from './api.types';

// One short message at a time, announced to screen readers by the shell's live region.
@Injectable({ providedIn: 'root' })
export class ToastService {
	readonly message = signal<string | null>(null);
	private timer: ReturnType<typeof setTimeout> | null = null;

	show(text: string, ms = 3500): void {
		this.message.set(text);
		if (this.timer) {
			clearTimeout(this.timer);
		}
		this.timer = setTimeout(() => this.message.set(null), ms);
	}

	error(err: unknown): void {
		if (err instanceof ApiError) {
			const first = Array.isArray(err.details) ? err.details[0] : null;
			this.show(first && first.message ? `${err.message} ${first.message}` : err.message, 5000);
			return;
		}
		this.show('Something went wrong.', 5000);
	}
}
