import { Component, input } from '@angular/core';
import { SensorKind } from '../core/api.types';

// The icon for what a sensor measures: a heart (heart rate), a bolt (power) or footprints
// (cadence), drawn in that metric's colour. Decorative; the label next to it names the metric.
@Component({
	selector: 'app-metric-icon',
	host: { '[class]': '"metric-icon metric-icon--" + kind()', 'aria-hidden': 'true' },
	template: `
		<svg viewBox="0 0 24 24" focusable="false">
			@switch (kind()) {
				@case ('hr') { <path d="M12 21s-7.2-4.4-9.6-8.6C.6 8.9 2.6 4.8 6.6 4.8c2.1 0 3.6 1.2 5.4 3.1 1.8-1.9 3.3-3.1 5.4-3.1 4 0 6 4.1 4 7.6C19.2 16.6 12 21 12 21z" /> }
				@case ('power') { <path d="M13.5 2 4 13.6h6.6L9.4 22 20 9.8h-6.8z" /> }
				@default {
					<path d="M8 2.5c1.8 0 3.1 2.1 3.1 4.7S9.8 11.9 8 11.9 4.9 9.8 4.9 7.2 6.2 2.5 8 2.5zM6.6 13h2.8v2.2a1.4 1.4 0 0 1-2.8 0z" />
					<path d="M16 8c1.8 0 3.1 2.1 3.1 4.7s-1.3 4.7-3.1 4.7-3.1-2.1-3.1-4.7S14.2 8 16 8zm-1.4 10.5h2.8v2.2a1.4 1.4 0 0 1-2.8 0z" />
				}
			}
		</svg>
	`
})
export class MetricIconComponent {
	readonly kind = input.required<SensorKind>();
}
