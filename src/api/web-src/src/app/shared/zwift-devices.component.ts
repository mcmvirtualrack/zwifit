import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ZwiftDevice } from '../core/api.types';
import { SocketService } from '../core/socket.service';
import { ToastService } from '../core/toast.service';

// Devices connected to the Zwift broadcast now, plus the ones remembered from earlier
// connections. Bluetooth gives only an address, so each can be renamed (e.g. "Apple TV").
@Component({
	selector: 'app-zwift-devices',
	imports: [FormsModule],
	template: `
		@if (rows().length) {
			<ul class="zdev" aria-label="Zwift devices">
				@for (d of rows(); track d.address) {
					<li class="zdev__item">
						<span class="pill__dot zdev__dot" [class.zdev__dot--on]="d.connected" aria-hidden="true"></span>
						@if (editing() === d.address) {
							<input class="input zdev__input" name="zwiftDeviceName" [(ngModel)]="draft" maxlength="40"
								aria-label="Device name" (keydown.enter)="save(d.address)" (keydown.escape)="editing.set(null)">
							<button class="btn" type="button" (click)="save(d.address)">Save</button>
							<button class="btn btn--ghost" type="button" (click)="editing.set(null)">Cancel</button>
						}
						@else {
							<span class="zdev__text">
								<strong>{{ d.name }}</strong>
								<span class="muted">
									{{ d.connected ? 'Connected' : 'Last seen ' + ago(d.lastSeenAt) }}{{ d.services.length ? ' · ' + d.services.join(', ') : '' }}
								</span>
							</span>
							<button class="btn btn--ghost" type="button" (click)="edit(d)" [attr.aria-label]="'Rename ' + d.name">Rename</button>
							@if (!d.connected) {
								<button class="btn btn--ghost" type="button" (click)="forget(d.address)" [attr.aria-label]="'Forget ' + d.name">Forget</button>
							}
						}
					</li>
				}
			</ul>
		}
		@else {
			<p class="muted">No Zwift device has connected yet. In Zwift, pair "Zwifit" under Run Speed and Heart Rate.</p>
		}
	`
})
export class ZwiftDevicesComponent {
	private readonly socket = inject(SocketService);
	private readonly toast = inject(ToastService);
	private readonly saved = signal<ZwiftDevice[]>([]);
	protected readonly editing = signal<string | null>(null);
	protected draft = '';

	// Connected first (live services), then the remembered ones, most recent first.
	protected readonly rows = computed(() => {
		const live = this.socket.status()?.broadcast.devices ?? [];
		const byAddress = new Map(this.saved().map(d => [d.address, d]));
		const connected = live.map(c => {
			const known = byAddress.get(c.address.toLowerCase());
			return { address: c.address.toLowerCase(), name: known?.name ?? 'Connecting…', lastSeenAt: known?.lastSeenAt ?? '', services: c.services, connected: true };
		});
		const liveSet = new Set(connected.map(c => c.address));
		const rest = this.saved().filter(d => !liveSet.has(d.address)).map(d => ({ ...d, connected: false }));
		return [...connected, ...rest];
	});

	constructor() {
		effect(() => {
			this.socket.zwiftDevicesVersion();
			if (this.socket.connected()) {
				this.socket.request<ZwiftDevice[]>('zwift-devices:list').then(list => this.saved.set(list), () => {});
			}
		});
	}

	protected edit(d: { address: string; name: string }): void {
		this.draft = d.name;
		this.editing.set(d.address);
	}

	protected async save(address: string): Promise<void> {
		try {
			await this.socket.request('zwift-devices:rename', { address, name: this.draft.trim() });
			this.editing.set(null);
		}
		catch (err) {
			this.toast.error(err);
		}
	}

	protected async forget(address: string): Promise<void> {
		try {
			await this.socket.request('zwift-devices:forget', { address });
		}
		catch (err) {
			this.toast.error(err);
		}
	}

	protected ago(iso: string): string {
		const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000);
		if (!Number.isFinite(minutes) || minutes < 1) {
			return 'just now';
		}
		if (minutes < 60) {
			return `${minutes} min ago`;
		}
		const hours = Math.round(minutes / 60);
		return hours < 48 ? `${hours} h ago` : new Date(iso).toLocaleDateString();
	}
}
