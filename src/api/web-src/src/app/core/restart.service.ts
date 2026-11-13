import { Injectable, inject, signal } from '@angular/core';
import { SocketService } from './socket.service';
import { ToastService } from './toast.service';

// Restart Zwifit (server:restart), from the top bar or Settings → Server. `restarting` is true
// from the request until the live connection is back.
@Injectable({ providedIn: 'root' })
export class RestartService {
	private readonly socket = inject(SocketService);
	private readonly toast = inject(ToastService);
	readonly restarting = signal(false);

	async restart(): Promise<void> {
		if (this.restarting() || !confirm('Restart Zwifit now? The treadmill, sensors and Zwift broadcast reconnect; this takes a few seconds.')) {
			return;
		}
		this.restarting.set(true);
		try {
			await this.socket.request('server:restart');
			this.toast.show('Restarting Zwifit… this page reconnects by itself.');
			// The socket drops while Zwifit stops; "done" once it is connected again (or after a minute).
			const started = Date.now();
			const wait = setInterval(() => {
				const elapsed = Date.now() - started;
				if ((this.socket.connected() && elapsed > 3000) || elapsed > 60000) {
					clearInterval(wait);
					this.restarting.set(false);
				}
			}, 500);
		}
		catch (err) {
			this.restarting.set(false);
			this.toast.error(err);
		}
	}
}
