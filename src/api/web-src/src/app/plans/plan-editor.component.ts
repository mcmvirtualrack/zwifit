import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiError, Plan, ValidationIssue } from '../core/api.types';
import { PrefsService } from '../core/prefs.service';
import { SocketService } from '../core/socket.service';
import { ToastService } from '../core/toast.service';
import * as units from '../core/units';
import { BlockModel, ItemModel, PlanModel, StepModel, expandModel, fromPlan, newBlock, newStep, stepDuration, stepKph, toPlan, totals } from './plan-model';

type FieldGroup = 'label' | 'speed' | 'incline' | 'end' | 'repeat' | 'steps' | 'id';

const FIELD_OF: Record<string, FieldGroup> = {
	label: 'label', targetKph: 'speed', entered: 'speed', targetIncline: 'incline', end: 'end', repeat: 'repeat', steps: 'steps', id: 'id'
};

@Component({
	selector: 'app-plan-editor',
	imports: [FormsModule, RouterLink, NgTemplateOutlet],
	templateUrl: './plan-editor.component.html'
})
export class PlanEditorComponent implements OnInit {
	private readonly socket = inject(SocketService);
	private readonly toast = inject(ToastService);
	private readonly route = inject(ActivatedRoute);
	private readonly router = inject(Router);
	protected readonly prefs = inject(PrefsService);

	protected readonly model = signal<PlanModel>({ name: '', description: '', controlIncline: true, items: [] });
	protected readonly loading = signal(true);
	protected readonly saving = signal(false);
	protected readonly dirty = signal(false);
	protected readonly errors = signal<ValidationIssue[]>([]);
	protected readonly dragIndex = signal<number | null>(null);
	protected readonly dropIndex = signal<number | null>(null);
	// Bumped on every edit so the computed totals and preview refresh (the model is mutated in place).
	private readonly revision = signal(0);

	protected readonly totals = computed(() => {
		this.revision();
		return totals(this.model());
	});
	protected readonly preview = computed(() => {
		this.revision();
		const flat = expandModel(this.model());
		const max = Math.max(1, ...flat.map(f => stepKph(f.step) ?? 0));
		const total = flat.reduce((sum, f) => sum + stepDuration(f.step).seconds, 0) || 1;
		return flat.map(f => ({ height: Math.max(8, ((stepKph(f.step) ?? 0) / max) * 100), grow: stepDuration(f.step).seconds / total, label: f.step.label }));
	});
	protected readonly expandedCount = computed(() => {
		this.revision();
		return expandModel(this.model()).length;
	});
	protected readonly planRunning = computed(() => ['waiting', 'running', 'paused', 'resuming'].includes(this.socket.playback()?.state ?? 'idle'));
	protected readonly generalErrors = computed(() => this.errors().filter(e => !/^items\[\d+\]/.test(e.path) || /^items$/.test(e.path)));

	async ngOnInit(): Promise<void> {
		const id = this.route.snapshot.paramMap.get('id');
		if (!id) {
			const metric = this.prefs.metric();
			this.model.set({ name: '', description: '', controlIncline: true, items: [{ ...newStep(metric, 'Warm-up'), speed: metric ? 6 : 4 }] });
			this.loading.set(false);
			return;
		}
		try {
			const plan = await this.socket.request<Plan>('plans:get', { id });
			this.model.set(fromPlan(plan, this.prefs.metric()));
		}
		catch (err) {
			this.toast.error(err);
			this.router.navigate(['/plans']);
		}
		finally {
			this.loading.set(false);
		}
	}

	// The plan open here is the one running (it cannot be deleted then).
	protected readonly runningThis = computed(() => this.planRunning() && !!this.model().id && this.socket.playback()?.planId === this.model().id);

	// Called by the router before leaving this page (app.routes.ts): unsaved edits are only
	// thrown away after asking.
	canLeave(): boolean {
		return !this.dirty() || confirm('Leave without saving? Your changes to this plan will be lost.');
	}

	protected async deletePlan(): Promise<void> {
		const { id, name } = this.model();
		if (!id || !confirm(`Delete "${name || 'this plan'}"? This cannot be undone.`)) {
			return;
		}
		try {
			await this.socket.request('plans:delete', { id });
			this.dirty.set(false);
			this.toast.show(`Deleted "${name}".`);
			this.router.navigate(['/plans']);
		}
		catch (err) {
			this.toast.error(err);
		}
	}

	protected changed(): void {
		this.dirty.set(true);
		this.errors.set([]);
		this.revision.update(r => r + 1);
	}

	// --- Items ---------------------------------------------------------------------------------

	protected addStep(): void {
		this.model().items.push(newStep(this.prefs.metric(), `Step ${this.model().items.length + 1}`));
		this.changed();
	}

	protected addBlock(): void {
		this.model().items.push(newBlock(this.prefs.metric()));
		this.changed();
	}

	protected addBlockStep(block: BlockModel): void {
		block.steps.push(newStep(this.prefs.metric(), `Step ${block.steps.length + 1}`));
		this.changed();
	}

	protected remove(list: ItemModel[] | StepModel[], index: number): void {
		list.splice(index, 1);
		this.changed();
	}

	protected move(list: ItemModel[] | StepModel[], index: number, by: number): void {
		const to = index + by;
		if (to < 0 || to >= list.length) {
			return;
		}
		const [item] = list.splice(index, 1);
		(list as ItemModel[]).splice(to, 0, item as ItemModel);
		this.changed();
	}

	// Keyboard reordering: Alt+↑ / Alt+↓ on an item's handle.
	protected keyMove(event: KeyboardEvent, list: ItemModel[] | StepModel[], index: number): void {
		if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
			event.preventDefault();
			this.move(list, index, event.key === 'ArrowUp' ? -1 : 1);
		}
	}

	protected onDragStart(index: number, event: DragEvent): void {
		this.dragIndex.set(index);
		event.dataTransfer?.setData('text/plain', String(index));
	}

	protected onDragOver(index: number, event: DragEvent): void {
		if (this.dragIndex() !== null) {
			event.preventDefault();
			this.dropIndex.set(index);
		}
	}

	protected onDrop(index: number, event: DragEvent): void {
		event.preventDefault();
		const from = this.dragIndex();
		this.dragIndex.set(null);
		this.dropIndex.set(null);
		if (from === null || from === index) {
			return;
		}
		const items = this.model().items;
		const [item] = items.splice(from, 1);
		items.splice(index, 0, item);
		this.changed();
	}

	protected onDragEnd(): void {
		this.dragIndex.set(null);
		this.dropIndex.set(null);
	}

	// --- Step helpers --------------------------------------------------------------------------

	protected isMetricUnit(step: StepModel): boolean {
		return step.unit === 'kph' || step.unit === 'min/km';
	}

	protected setForm(step: StepModel, form: 'speed' | 'pace'): void {
		if (step.form === form) {
			return;
		}
		const kph = stepKph(step);
		const metric = this.isMetricUnit(step);
		step.form = form;
		step.unit = form === 'speed' ? units.speedUnit(metric) : units.paceUnit(metric);
		if (kph) {
			if (form === 'speed') {
				step.speed = Math.round(units.displaySpeed(kph, metric) * 10) / 10;
			}
			else {
				step.pace = units.kphToPace(kph, units.paceUnit(metric)) ?? step.pace;
			}
		}
		this.changed();
	}

	protected setEndType(step: StepModel, type: 'time' | 'distance'): void {
		step.endType = type;
		this.changed();
	}

	protected equivalent(step: StepModel): string {
		const kph = stepKph(step);
		if (!kph) {
			return '';
		}
		const metric = this.isMetricUnit(step);
		return step.form === 'speed'
			? `= ${units.kphToPace(kph, units.paceUnit(metric))} ${units.paceUnit(metric)}`
			: `= ${units.displaySpeed(kph, metric).toFixed(1)} ${units.speedLabel(metric)}`;
	}

	protected stepSummary(step: StepModel): string {
		const t = stepDuration(step);
		return `${this.prefs.duration(t.seconds)} · ${this.prefs.distance(t.metres)} ${this.prefs.distanceLabel()}`;
	}

	protected speedUnitLabel(step: StepModel): string {
		return step.form === 'speed' ? units.speedLabel(this.isMetricUnit(step)) : step.unit;
	}

	protected errorAt(path: string, field: FieldGroup): string | null {
		const prefix = `${path}.`;
		const found = this.errors().find(e => e.path.startsWith(prefix) && FIELD_OF[e.path.slice(prefix.length).split(/[.[]/)[0]] === field);
		return found ? found.message : null;
	}

	// --- Save / start --------------------------------------------------------------------------

	protected async save(): Promise<string | null> {
		this.saving.set(true);
		this.errors.set([]);
		try {
			const saved = await this.socket.request<Plan>('plans:save', toPlan(this.model(), this.prefs.metric()));
			this.model.update(m => ({ ...m, id: saved.id }));
			this.dirty.set(false);
			this.toast.show('Plan saved.');
			if (!this.route.snapshot.paramMap.get('id')) {
				this.router.navigate(['/plans', saved.id], { replaceUrl: true });
			}
			return saved.id ?? null;
		}
		catch (err) {
			if (err instanceof ApiError && Array.isArray(err.details)) {
				this.errors.set(err.details as ValidationIssue[]);
				this.toast.show('The plan has problems. They are marked below.');
			}
			else {
				this.toast.error(err);
			}
			return null;
		}
		finally {
			this.saving.set(false);
		}
	}

	protected async start(): Promise<void> {
		const id = this.dirty() || !this.model().id ? await this.save() : this.model().id;
		if (!id) {
			return;
		}
		try {
			await this.socket.request('playback:start', { planId: id });
			this.router.navigate(['/workout']);
		}
		catch (err) {
			this.toast.error(err);
		}
	}

	protected isBlock(item: ItemModel): item is BlockModel {
		return item.kind === 'block';
	}

	protected asStep(item: ItemModel): StepModel {
		return item as StepModel;
	}
}
