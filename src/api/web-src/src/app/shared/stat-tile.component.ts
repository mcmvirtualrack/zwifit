import { Component, input } from '@angular/core';

// A labelled big number, e.g. "DISTANCE 2.41 mi", tinted for heart rate, cadence or power.
@Component({
	selector: 'app-stat-tile',
	host: { '[class]': '"tile tile--" + variant()' },
	template: `
		<span class="eyebrow">{{ label() }}</span>
		<span class="tile__reading"><span class="tile__value num">{{ value() }}</span>@if (unit()) {<span class="tile__unit">{{ unit() }}</span>}</span>
		@if (sub()) { <span class="tile__sub">{{ sub() }}</span> }
	`
})
export class StatTileComponent {
	readonly label = input.required<string>();
	readonly value = input.required<string>();
	readonly unit = input<string>('');
	readonly sub = input<string>('');
	readonly variant = input<'default' | 'hr' | 'cadence' | 'power'>('default');
}
