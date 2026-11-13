// Editable form of a plan. The editor works in the user's display units; toPlan() converts to the
// canonical km/h + metres + seconds shape the server validates.
import { Block, Entered, EnteredUnit, Plan, Step } from '../core/api.types';
import * as units from '../core/units';

export interface StepModel {
	kind: 'step';
	id: string;
	label: string;
	form: 'speed' | 'pace';
	unit: EnteredUnit;
	speed: number | null;
	pace: string;
	incline: number;
	endType: 'time' | 'distance';
	duration: string;
	distance: number | null;
	distanceMetric: boolean;
}

export interface BlockModel {
	kind: 'block';
	id: string;
	label: string;
	repeat: number;
	steps: StepModel[];
}

export type ItemModel = StepModel | BlockModel;

export interface PlanModel {
	id?: string;
	name: string;
	description: string;
	controlIncline: boolean;
	items: ItemModel[];
}

let counter = 0;
export const newLocalId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}`;

export function newStep(metric: boolean, label = ''): StepModel {
	return {
		kind: 'step', id: newLocalId('s'), label, form: 'speed', unit: units.speedUnit(metric),
		speed: metric ? 8 : 5, pace: metric ? '7:30' : '12:00', incline: 1,
		endType: 'time', duration: '5:00', distance: metric ? 1 : 0.5, distanceMetric: metric
	};
}

export function newBlock(metric: boolean): BlockModel {
	return { kind: 'block', id: newLocalId('b'), label: 'Intervals', repeat: 4, steps: [newStep(metric, 'Fast'), { ...newStep(metric, 'Recover'), speed: metric ? 5 : 3 }] };
}

export function entered(step: StepModel): Entered {
	return step.form === 'speed'
		? { form: 'speed', unit: step.unit, value: Number(step.speed) }
		: { form: 'pace', unit: step.unit, value: step.pace.trim() };
}

export function stepKph(step: StepModel): number | null {
	return units.enteredToKph(entered(step));
}

export function stepEnd(step: StepModel): { type: 'time'; seconds: number } | { type: 'distance'; metres: number } | null {
	if (step.endType === 'time') {
		const seconds = units.parseDuration(step.duration);
		return seconds === null ? null : { type: 'time', seconds };
	}
	const value = Number(step.distance);
	if (!Number.isFinite(value) || value <= 0) {
		return null;
	}
	return { type: 'distance', metres: Math.round(units.fromDisplayDistance(value, step.distanceMetric) * 10) / 10 };
}

function fromStep(step: Step, metric: boolean): StepModel {
	const isSpeed = step.entered.form === 'speed';
	const distanceMetric = metric;
	return {
		kind: 'step',
		id: step.id,
		label: step.label ?? '',
		form: step.entered.form,
		unit: step.entered.unit,
		speed: isSpeed ? Number(step.entered.value) : Math.round(units.displaySpeed(step.targetKph, step.entered.unit === 'min/km') * 10) / 10,
		pace: isSpeed ? (units.kphToPace(step.targetKph, step.entered.unit === 'kph' ? 'min/km' : 'min/mi') ?? '') : String(step.entered.value),
		incline: step.targetIncline,
		endType: step.end.type,
		duration: step.end.type === 'time' ? units.formatDuration(step.end.seconds) : '5:00',
		distance: step.end.type === 'distance' ? Math.round(units.displayDistance(step.end.metres, distanceMetric) * 1000) / 1000 : (metric ? 1 : 0.5),
		distanceMetric
	};
}

export function fromPlan(plan: Plan, metric: boolean): PlanModel {
	return {
		id: plan.id,
		name: plan.name,
		description: plan.description ?? '',
		controlIncline: plan.controlIncline !== false,
		items: plan.items.map(item => item.kind === 'block'
			? { kind: 'block', id: item.id, label: item.label ?? '', repeat: item.repeat, steps: item.steps.map(s => fromStep(s, metric)) }
			: fromStep(item, metric))
	};
}

function toStep(step: StepModel): Step {
	const kph = stepKph(step);
	const end = stepEnd(step);
	return {
		kind: 'step',
		id: step.id,
		label: step.label.trim(),
		targetKph: kph === null ? 0 : Math.round(kph * 1e6) / 1e6,
		entered: entered(step),
		targetIncline: Math.round(Number(step.incline) * 2) / 2,
		// An unparseable end is sent as 0 so the server reports it at the exact field.
		end: end ?? (step.endType === 'time' ? { type: 'time', seconds: 0 } : { type: 'distance', metres: 0 })
	};
}

export function toPlan(model: PlanModel, metric: boolean): Plan {
	const plan: Plan = {
		schemaVersion: 1,
		name: model.name.trim(),
		description: model.description.trim(),
		authoredUnits: metric ? 'metric' : 'imperial',
		controlIncline: model.controlIncline,
		items: model.items.map(item => item.kind === 'block'
			? { kind: 'block', id: item.id, label: item.label.trim(), repeat: Number(item.repeat), steps: item.steps.map(toStep) } as Block
			: toStep(item))
	};
	if (model.id) {
		plan.id = model.id;
	}
	return plan;
}

export interface Totals {
	seconds: number;
	metres: number;
	estimated: boolean;
}

export function expandModel(model: PlanModel): { step: StepModel; repetition: number; repeatOf: number }[] {
	const flat: { step: StepModel; repetition: number; repeatOf: number }[] = [];
	for (const item of model.items) {
		if (item.kind === 'block') {
			const repeat = Math.max(0, Math.min(99, Math.floor(Number(item.repeat) || 0)));
			for (let r = 1; r <= repeat; r++) {
				for (const step of item.steps) {
					flat.push({ step, repetition: r, repeatOf: repeat });
				}
			}
		}
		else {
			flat.push({ step: item, repetition: 1, repeatOf: 1 });
		}
	}
	return flat;
}

export function stepDuration(step: StepModel): { seconds: number; metres: number } {
	const kph = stepKph(step) ?? 0;
	const end = stepEnd(step);
	if (!end || kph <= 0) {
		return { seconds: 0, metres: 0 };
	}
	return end.type === 'time'
		? { seconds: end.seconds, metres: kph / 3.6 * end.seconds }
		: { seconds: end.metres / (kph / 3.6), metres: end.metres };
}

export function totals(model: PlanModel): Totals {
	let seconds = 0;
	let metres = 0;
	for (const { step } of expandModel(model)) {
		const t = stepDuration(step);
		seconds += t.seconds;
		metres += t.metres;
	}
	return { seconds, metres, estimated: true };
}
