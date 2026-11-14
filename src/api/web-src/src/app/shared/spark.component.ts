import { Component, computed, input } from '@angular/core';
import { ZONE_FLOORS, zoneStops } from '../core/prefs.service';
import { scaleFor } from './chart';

let nextId = 0;

// A thin sparkline of recent readings for a stat tile. Decorative: the tile shows the number.
// Given a zone reference (maximum heart rate, threshold power) the line is coloured by zone.
@Component({
	selector: 'app-spark',
	host: { class: 'spark', 'aria-hidden': 'true' },
	template: `
		<svg viewBox="0 0 1000 100" preserveAspectRatio="none">
			@if (stops().length) {
				<defs>
					<linearGradient [attr.id]="uid" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="100">
						@for (st of stops(); track $index) { <stop [class]="'zstop zstop--' + st.zone" [attr.offset]="st.offset" /> }
					</linearGradient>
				</defs>
			}
			<path [class]="'spark__line spark__line--' + kind()" [attr.d]="shape().d" vector-effect="non-scaling-stroke"
				[style.stroke]="stops().length ? 'url(#' + uid + ')' : null" />
		</svg>
	`
})
export class SparkComponent {
	readonly values = input.required<(number | null)[]>();
	readonly kind = input<'hr' | 'cadence' | 'power' | 'speed'>('hr');
	readonly zoneRef = input<number | null>(null);
	readonly zoneFloors = input<number[]>(ZONE_FLOORS);

	protected readonly uid = `spark-${nextId++}`;

	protected readonly shape = computed(() => {
		const values = this.values();
		const readings = values.filter((v): v is number => v !== null);
		if (readings.length < 2) {
			return { d: '', min: 0, max: 0 };
		}
		const { min, max } = scaleFor(readings, { minSpan: 10, step: 5 });
		const n = values.length - 1;
		let d = '';
		let pen = false;
		values.forEach((v, i) => {
			if (v === null) {
				pen = false;
				return;
			}
			const x = Math.round((i / n) * 1000);
			const y = Math.round(((max - v) / (max - min)) * 1000) / 10;
			d += `${pen ? 'L' : 'M'}${x} ${y}`;
			pen = true;
		});
		return { d, min, max };
	});

	protected readonly stops = computed(() => {
		const ref = this.zoneRef();
		const { d, min, max } = this.shape();
		return ref && d ? zoneStops(ref, max, min, this.zoneFloors()) : [];
	});
}
