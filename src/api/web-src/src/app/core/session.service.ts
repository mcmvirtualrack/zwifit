import { Injectable, inject, signal } from '@angular/core';
import { ApiError, Device } from './api.types';
import { SocketService } from './socket.service';

async function readError(res: Response): Promise<ApiError> {
	try {
		const body = await res.json();
		return new ApiError(body.error ?? 'ERROR', body.message ?? 'Something went wrong.', body.details ?? body.retryAfterSeconds);
	}
	catch {
		return new ApiError('ERROR', `Request failed (${res.status}).`);
	}
}

// Pairing state and the HTTP endpoints (contracts/api.md). The device token is an HttpOnly cookie
// the page never sees.
@Injectable({ providedIn: 'root' })
export class SessionService {
	readonly paired = signal<boolean | null>(null);
	readonly deviceName = signal<string | null>(null);
	private readonly socket = inject(SocketService);

	async refresh(): Promise<void> {
		try {
			const res = await fetch('/api/session', { credentials: 'same-origin' });
			const body = await res.json();
			this.paired.set(!!body.paired);
			this.deviceName.set(body.deviceName ?? null);
			if (body.paired) {
				this.socket.connect();
			}
			else {
				this.socket.disconnect();
			}
		}
		catch {
			this.paired.set(false);
		}
	}

	async pair(code: string, deviceName: string): Promise<void> {
		const body: { code: string; deviceName?: string } = { code };
		if (deviceName.trim()) {
			body.deviceName = deviceName.trim();
		}
		const res = await fetch('/api/pair', {
			method: 'POST',
			credentials: 'same-origin',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});
		if (res.status === 429) {
			const body429 = await res.json().catch(() => ({}));
			throw new ApiError(body429.error ?? 'LOCKED_OUT', body429.message ?? 'Too many attempts.', body429.retryAfterSeconds);
		}
		if (!res.ok) {
			throw await readError(res);
		}
		await this.refresh();
		// The code was accepted, but the browser did not keep the pairing cookie (cookies blocked,
		// or a private / guest session). Retrying the same code would then fail as "already used".
		if (!this.paired()) {
			throw new ApiError('COOKIE_NOT_KEPT', 'The code worked, but this browser did not keep the pairing. Allow cookies for this site (and don\'t use a private or guest window) and pair again, or on a paired device open Settings → Paired devices and press "Trust address" for this one.');
		}
	}

	async unpair(): Promise<void> {
		await this.post('/api/unpair');
		this.socket.disconnect();
		await this.refresh();
	}

	async devices(): Promise<Device[]> {
		const res = await fetch('/api/devices', { credentials: 'same-origin' });
		if (!res.ok) {
			throw await readError(res);
		}
		return res.json();
	}

	async renameDevice(id: string, name: string): Promise<Device> {
		return this.patchDevice(id, { name });
	}

	// Rename and/or change the address of a device (a trusted one stays trusted at the new address).
	async editDevice(id: string, changes: { name?: string; ip?: string }): Promise<Device> {
		return this.patchDevice(id, changes);
	}

	// A client let in by its IP address alone, without pairing.
	async addDeviceByAddress(name: string, ip: string): Promise<Device> {
		const res = await fetch('/api/devices', {
			method: 'POST',
			credentials: 'same-origin',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name, ip })
		});
		if (!res.ok) {
			throw await readError(res);
		}
		return res.json();
	}

	// Trusted: requests from the device's last address count as it, without a code or cookie.
	async trustDevice(id: string, trusted: boolean): Promise<Device> {
		return this.patchDevice(id, { trusted });
	}

	private async patchDevice(id: string, body: { name?: string; ip?: string; trusted?: boolean }): Promise<Device> {
		const res = await fetch(`/api/devices/${encodeURIComponent(id)}`, {
			method: 'PATCH',
			credentials: 'same-origin',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});
		if (!res.ok) {
			throw await readError(res);
		}
		const device: Device = await res.json();
		if (device.current) {
			this.deviceName.set(device.name);
		}
		return device;
	}

	async revoke(id: string): Promise<void> {
		const res = await fetch(`/api/devices/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'same-origin' });
		if (!res.ok) {
			throw await readError(res);
		}
	}

	// A new code to pair another device: pairs one device and expires after 10 minutes.
	async newPairingCode(): Promise<{ code: string; expiresAt: string }> {
		const res = await fetch('/api/pairing-code', { method: 'POST', credentials: 'same-origin' });
		if (!res.ok) {
			throw await readError(res);
		}
		return res.json();
	}

	async importPlan(file: unknown): Promise<string> {
		const res = await fetch('/api/plans/import', {
			method: 'POST',
			credentials: 'same-origin',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(file)
		});
		if (!res.ok) {
			throw await readError(res);
		}
		return (await res.json()).id;
	}

	private async post(url: string): Promise<void> {
		const res = await fetch(url, { method: 'POST', credentials: 'same-origin' });
		if (!res.ok) {
			throw await readError(res);
		}
	}
}
