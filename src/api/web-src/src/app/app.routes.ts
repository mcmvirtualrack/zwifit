import { Routes } from '@angular/router';

// Pages with unsaved edits (the plan editor) ask before they are left by any link or menu.
const confirmLeave = (page: { canLeave?: () => boolean } | null) => !page?.canLeave || page.canLeave();

export const routes: Routes = [
	{ path: '', loadComponent: () => import('./control/control.component').then(m => m.ControlComponent), title: 'Zwifit · Dashboard' },
	{ path: 'plans', loadComponent: () => import('./plans/plans-list.component').then(m => m.PlansListComponent), title: 'Zwifit · Plans' },
	{ path: 'plans/new', loadComponent: () => import('./plans/plan-editor.component').then(m => m.PlanEditorComponent), title: 'Zwifit · New plan', canDeactivate: [confirmLeave] },
	{ path: 'plans/:id', loadComponent: () => import('./plans/plan-editor.component').then(m => m.PlanEditorComponent), title: 'Zwifit · Edit plan', canDeactivate: [confirmLeave] },
	{ path: 'programs', loadComponent: () => import('./programs/programs.component').then(m => m.ProgramsComponent), title: 'Zwifit · Training programs' },
	{ path: 'programs/new/custom', loadComponent: () => import('./programs/program-editor.component').then(m => m.ProgramEditorComponent), title: 'Zwifit · Build a program' },
	{ path: 'programs/:id/edit', loadComponent: () => import('./programs/program-editor.component').then(m => m.ProgramEditorComponent), title: 'Zwifit · Edit program' },
	{ path: 'programs/:id', loadComponent: () => import('./programs/program-detail.component').then(m => m.ProgramDetailComponent), title: 'Zwifit · Training program' },
	{ path: 'workout', loadComponent: () => import('./playback/playback.component').then(m => m.PlaybackComponent), title: 'Zwifit · Workout' },
	{ path: 'history', loadComponent: () => import('./history/history-list.component').then(m => m.HistoryListComponent), title: 'Zwifit · History' },
	{ path: 'history/:id', loadComponent: () => import('./history/history-detail.component').then(m => m.HistoryDetailComponent), title: 'Zwifit · Workout details' },
	{ path: 'settings', loadComponent: () => import('./settings/settings.component').then(m => m.SettingsComponent), title: 'Zwifit · Settings' },
	{ path: '**', redirectTo: '' }
];
