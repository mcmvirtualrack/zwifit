import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiError } from '../core/api.types';
import { deviceNameFrom } from '../core/device-name';
import { SessionService } from '../core/session.service';

@Component({
	selector: 'app-pairing',
	imports: [FormsModule],
	template: `
		<main class="pairing">
			<form class="card pairing__card" (ngSubmit)="submit()" aria-labelledby="pair-title">
				<div class="brand"><span class="brand__mark" aria-hidden="true">Z</span> Zwifit</div>
				<h1 id="pair-title">Pair this device</h1>
				<p class="muted">Enter the 8-character code from Settings → Paired devices → New pairing code on a
					device that is already paired, or from the Zwifit console. No code? Run <code>npm run pair</code> on the computer running Zwifit.</p>
				<label class="field">
					<span class="field__label">Pairing code</span>
					<input class="input pairing__code" name="code" [ngModel]="code()" (ngModelChange)="onCode($event)"
						autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" inputmode="text"
						maxlength="9" placeholder="XXXX-XXXX" required [attr.aria-invalid]="error() ? 'true' : null"
						aria-describedby="pair-error">
				</label>
				<label class="field">
					<span class="field__label">Device name (optional)</span>
					<input class="input" name="deviceName" [(ngModel)]="deviceName" maxlength="40" placeholder="e.g. Phone on the treadmill">
				</label>
				<p id="pair-error" class="field__error" aria-live="polite">{{ error() }}</p>
				<button class="btn btn--primary btn--lg btn--block" type="submit" [disabled]="busy() || code().replace('-', '').length !== 8">
					{{ busy() ? 'Pairing…' : 'Pair' }}
				</button>
			</form>
		</main>
	`
})
export class PairingComponent {
	private readonly session = inject(SessionService);
	readonly code = signal('');
	readonly error = signal('');
	readonly busy = signal(false);
	// Pre-filled so the Settings list says "iPhone · Safari" rather than "Device".
	deviceName = deviceNameFrom(navigator.userAgent);

	onCode(value: string): void {
		const clean = value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 8);
		this.code.set(clean.length > 4 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean);
	}

	async submit(): Promise<void> {
		this.busy.set(true);
		this.error.set('');
		try {
			await this.session.pair(this.code(), this.deviceName);
		}
		catch (err) {
			if (err instanceof ApiError && err.code === 'LOCKED_OUT') {
				const minutes = Math.ceil(Number(err.details || 900) / 60);
				this.error.set(`Too many attempts, retry in ${minutes} min.`);
			}
			else if (err instanceof ApiError && err.code === 'PAIRING_SUSPENDED') {
				this.error.set(err.message);
			}
			else if (err instanceof ApiError && err.code === 'BAD_CODE') {
				this.error.set('That code is not right, or it expired or was already used. Make a new one and try again.');
			}
			else {
				this.error.set(err instanceof ApiError ? err.message : 'Could not reach Zwifit.');
			}
		}
		finally {
			this.busy.set(false);
		}
	}
}
