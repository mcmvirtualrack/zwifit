import { Component, computed, input } from '@angular/core';
import { scaleFor } from './chart';

// A thin sparkline of recent readings for a stat tile. Decorative: the tile shows the number.
@Component({
	selector: 'app-spark',
	host: { class: 'spark', 'aria-hidden': 'true' },
	template: `
		<svg viewBox="0 0 1000 100" preserveAspectRatio="none">
			<path [class]="'spark__line spark__line--' + kind()" [attr.d]="path()" vector-effect="non-scaling-stroke" />
		</svg>
	`
})
export class SparkComponent {
	readonly values = input.required<(number | null)[]>();
	readonly kind = input<'hr' | 'cadence' | 'power' | 'speed'>('hr');

	protected readonly path = computed(() => {
		const values = this.values();
		const readings = values.filter((v): v is number => v !== null);
		if (readings.length < 2) {
			return '';
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
		return d;
	});
}
