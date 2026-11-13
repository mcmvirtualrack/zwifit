import { Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { HrHistoryService } from '../core/hr-history.service';
import { RestartService } from '../core/restart.service';
import { SocketService } from '../core/socket.service';
import { ToastService } from '../core/toast.service';

const ACTIVE = ['waiting', 'running', 'paused', 'resuming'];

// The page frame: the brand (with the running plan, if any) on the left and the page links as a
// segmented control on the top right; on narrow screens the links wrap below the brand.
@Component({
	selector: 'app-shell',
	imports: [RouterOutlet, RouterLink, RouterLinkActive],
	template: `
		<div class="shell">
			<header class="topbar">
				<a class="brand" routerLink="/" aria-label="Zwifit dashboard">
					<svg class="brand__mark" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h4l3-8 4 16 3-8h4" /></svg>
					<span class="brand__name">Zwifit</span>
				</a>
				@if (context(); as text) { <span class="topbar__context">{{ text }}</span> }
				@if (!socket.connected()) {
					<span class="pill pill--danger" aria-live="polite"><span class="pill__dot"></span>Reconnecting…</span>
				}
				<span class="spacer"></span>
				<button class="btn topbar__restart" type="button" (click)="restarter.restart()" [disabled]="restarter.restarting() || !socket.connected()"
					[attr.aria-label]="restarter.restarting() ? 'Restarting Zwifit' : 'Restart Zwifit'" [attr.title]="restarter.restarting() ? 'Restarting…' : 'Restart Zwifit'">
					<svg class="topbar__restart-icon" [class.topbar__restart-icon--spin]="restarter.restarting()" viewBox="0 0 24 24" aria-hidden="true">
						<path d="M20 12a8 8 0 1 1-2.34-5.66" /><path d="M20 4v5h-5" />
					</svg>
				</button>
				<nav class="topnav" id="main-nav" aria-label="Main">
					@for (link of links; track link.path) {
						<a class="topnav__link" [routerLink]="link.path" routerLinkActive="topnav__link--active"
							[routerLinkActiveOptions]="{ exact: link.path === '/' }" ariaCurrentWhenActive="page">
							{{ link.label }}
							@if (link.path === '/workout' && planActive()) { <span class="topnav__badge" aria-label="plan running"></span> }
						</a>
					}
				</nav>
			</header>
			<main class="shell__main" id="main">
				<router-outlet />
			</main>
		</div>
		<div class="visually-hidden" aria-live="polite">{{ toast.message() }}</div>
		@if (toast.message()) { <div class="toast" role="status">{{ toast.message() }}</div> }
	`
})
export class ShellComponent {
	protected readonly socket = inject(SocketService);
	protected readonly toast = inject(ToastService);
	protected readonly restarter = inject(RestartService);
	// Started here so the live graphs have history whichever page is opened first.
	private readonly hrHistory = inject(HrHistoryService);
	protected readonly links = [
		{ path: '/', label: 'Dashboard' },
		{ path: '/workout', label: 'Workout' },
		{ path: '/plans', label: 'Plans' },
		{ path: '/history', label: 'History' },
		{ path: '/settings', label: 'Settings' }
	];
	protected readonly planActive = computed(() => ACTIVE.includes(this.socket.playback()?.state ?? 'idle'));
	// "Intervals 6× · step 7 of 13" while a plan runs.
	protected readonly context = computed(() => {
		const p = this.socket.playback();
		if (!p || !ACTIVE.includes(p.state) || !p.planName) {
			return null;
		}
		return p.cursor ? `${p.planName} · step ${p.cursor.flatIndex + 1} of ${p.stepCount}` : p.planName;
	});
}
