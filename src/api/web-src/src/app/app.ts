import { Component, OnInit, inject } from '@angular/core';
import { SessionService } from './core/session.service';
import { PairingComponent } from './pairing/pairing.component';
import { ShellComponent } from './shell/shell.component';

// Unpaired visitors only ever get the pairing screen; nothing else renders or connects (FR-023b).
@Component({
	selector: 'app-root',
	imports: [PairingComponent, ShellComponent],
	template: `
		@switch (session.paired()) {
			@case (true) { <app-shell /> }
			@case (false) { <app-pairing /> }
			@default { <p class="empty" aria-live="polite">Connecting to Zwifit…</p> }
		}
	`
})
export class App implements OnInit {
	protected readonly session = inject(SessionService);

	ngOnInit(): void {
		this.session.refresh();
	}
}
