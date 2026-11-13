import { Injectable, signal } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { ApiError, Playback, Settings, Status } from './api.types';

type Ack<T> = { ok: true; data?: T } | { ok: false; error: string; message: string; details?: unknown };

// The one Socket.IO connection. Live server state is exposed as signals; commands return promises
// that resolve with `data` or reject with ApiError. The connection only works once paired
// (the device cookie travels with the handshake).
@Injectable({ providedIn: 'root' })
export class SocketService {
	readonly connected = signal(false);
	readonly connectError = signal<string | null>(null);
	readonly status = signal<Status | null>(null);
	readonly settings = signal<Settings | null>(null);
	readonly playback = signal<Playback | null>(null);
	// Bumped whenever the server says plans or workouts changed; screens reload on change.
	readonly plansVersion = signal(0);
	readonly workoutsVersion = signal(0);
	readonly programsVersion = signal(0);
	readonly zwiftDevicesVersion = signal(0);

	private socket: Socket | null = null;

	connect(): void {
		if (this.socket) {
			return;
		}
		// WebSocket only: its handshake always carries Origin, which the server checks.
		const socket = io({ transports: ['websocket'], withCredentials: true });
		this.socket = socket;
		socket.on('connect', () => {
			this.connected.set(true);
			this.connectError.set(null);
		});
		socket.on('disconnect', () => this.connected.set(false));
		socket.on('connect_error', (err: Error) => this.connectError.set(err.message));
		socket.on('status', (s: Status) => this.status.set(s));
		socket.on('settings', (s: Settings) => this.settings.set(s));
		socket.on('playback', (p: Playback) => this.playback.set(p));
		socket.on('plans:changed', () => this.plansVersion.update(v => v + 1));
		socket.on('workouts:changed', () => this.workoutsVersion.update(v => v + 1));
		socket.on('programs:changed', () => this.programsVersion.update(v => v + 1));
		socket.on('zwift-devices:changed', () => this.zwiftDevicesVersion.update(v => v + 1));
	}

	disconnect(): void {
		this.socket?.disconnect();
		this.socket = null;
		this.connected.set(false);
	}

	request<T = void>(event: string, payload?: unknown): Promise<T> {
		const socket = this.socket;
		if (!socket) {
			return Promise.reject(new ApiError('NOT_CONNECTED', 'Not connected to Zwifit.'));
		}
		return new Promise<T>((resolve, reject) => {
			const done = (reply: Ack<T>) => {
				if (reply && reply.ok) {
					resolve(reply.data as T);
				}
				else {
					reject(new ApiError(reply?.error ?? 'ERROR', reply?.message ?? 'Something went wrong.', reply && !reply.ok ? reply.details : undefined));
				}
			};
			const timed = socket.timeout(10000);
			const callback = (err: Error | null, reply: Ack<T>) => (err ? reject(new ApiError('TIMEOUT', 'Zwifit did not answer.')) : done(reply));
			if (payload === undefined) {
				timed.emit(event, callback);
			}
			else {
				timed.emit(event, payload, callback);
			}
		});
	}
}
