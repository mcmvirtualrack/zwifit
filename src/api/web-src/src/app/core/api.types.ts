// Shapes from specs/001-cross-platform-training-plans/contracts/api.md and data-model.md.

export interface Limits {
	minKph: number;
	maxKph: number;
	minIncline: number;
	maxIncline: number;
}

export interface TreadmillStatus {
	transport: 'wifi' | 'ble' | 'simulated';
	connected: boolean;
	reason?: string;
	kph: number;
	incline: number;
	metres: number;
	seconds: number;
	hr: number | null;
	cadence?: number;
	// Where hr / cadence came from: the treadmill itself or an ANT+ / Bluetooth sensor (watch, strap, footpod).
	hrSource?: SensorSource | null;
	cadenceSource?: SensorSource;
	// Running power in watts, only while a power sensor (Stryd) reports.
	power?: number;
	powerSource?: 'ant' | 'ble';
	estimatedSpeed: boolean;
	limits: Limits;
	capabilities: { canControl: boolean; canPause: boolean; canResume: boolean };
}

export interface BroadcastStatus {
	available: boolean;
	reason?: string;
	poweredOn: boolean;
	advertising: boolean;
	clients: number;
	devices?: { address: string; services: string[] }[];
}

// A device remembered from an earlier connection to the Zwift broadcast.
export interface ZwiftDevice {
	address: string;
	name: string;
	named: boolean;
	firstSeenAt: string;
	lastSeenAt: string;
	services: string[];
}

export type SensorSource = 'treadmill' | 'ant' | 'ble';
export type SensorKind = 'hr' | 'cadence' | 'power';

// A sensor heard during the last scan.
export interface FoundSensor {
	id: string;
	kinds: SensorKind[];
	values: Partial<Record<SensorKind, number>>;
	rssi: number | null;
	// ANT+: the maker when it says (e.g. Garmin); Bluetooth: the advertised name.
	manufacturer?: string | null;
	name?: string | null;
	battery?: string;
}

export interface SensorScan {
	active: boolean;
	endsAt?: string;
	reason?: string;
}

export interface AntStatus {
	available: boolean;
	reason?: string;
	devices: { kind: SensorKind; deviceId: number; value: number; lastSeenAt: string; manufacturer?: string; battery?: string }[];
	scan?: SensorScan;
	found?: FoundSensor[];
}

export interface BluetoothSensorsStatus {
	available: boolean;
	reason?: string;
	devices: { kind: SensorKind; deviceId: string; value: number; lastSeenAt: string }[];
	scan?: SensorScan;
	found?: FoundSensor[];
	connections?: { id: string; name: string | null; kinds: SensorKind[]; state: 'connected' | 'connecting' | 'searching'; battery?: string }[];
}

export interface Status {
	treadmill: TreadmillStatus;
	broadcast: BroadcastStatus;
	sensors?: { ant: AntStatus; bluetooth?: BluetoothSensorsStatus };
}

export interface Settings {
	version: 2;
	metric: boolean;
	treadmill: { transport: 'wifi' | 'ble' | 'simulated'; ip: string | null; lastIP: string | null; bleCode: string | null };
	speedOffset: number;
	speedMultiplier: number;
	fallbackKph: number | null;
	limits: Limits;
	cooldownKph: number;
	// power: a Bluetooth power meter for Zwift; ftmsPower: power inside the Fitness Machine data.
	broadcast: { ftms: boolean; rsc: boolean; hr?: boolean; power?: boolean; ftmsPower?: boolean };
	sensors?: {
		ant?: boolean;
		hrSource?: 'auto' | 'ant' | 'ble' | 'treadmill' | 'off' | 'sensor';
		cadenceSource?: 'auto' | 'ant' | 'ble' | 'treadmill' | 'off' | 'sensor';
		powerSource?: 'auto' | 'ant' | 'ble' | 'off';
		powerSmoothing?: 1 | 3 | 10;
		thresholdPower?: number | null;
		weightKg?: number | null;
		antDevices?: Partial<Record<SensorKind, number>>;
		bluetooth?: { id: string; name: string | null; kinds: SensorKind[] }[];
	};
	server: { port: number; host: string; tls: unknown };
}

export type EnteredUnit = 'mph' | 'kph' | 'min/mi' | 'min/km';

export interface Entered {
	form: 'speed' | 'pace';
	unit: EnteredUnit;
	value: number | string;
}

export type StepEnd = { type: 'time'; seconds: number } | { type: 'distance'; metres: number };

export interface Step {
	kind: 'step';
	id: string;
	label?: string;
	targetKph: number;
	entered: Entered;
	targetIncline: number;
	end: StepEnd;
}

export interface Block {
	kind: 'block';
	id: string;
	label?: string;
	repeat: number;
	steps: Step[];
}

export interface Plan {
	id?: string;
	schemaVersion: 1;
	name: string;
	description?: string;
	authoredUnits?: 'metric' | 'imperial';
	controlIncline?: boolean;
	items: (Step | Block)[];
	createdAt?: string;
	updatedAt?: string;
}

export interface PlanTotals {
	seconds: number;
	metres: number;
	estimated: boolean;
}

export interface PlanSummary {
	id: string;
	name: string;
	totals: PlanTotals;
	updatedAt: string;
	problems?: ValidationIssue[];
}

export interface ValidationIssue {
	path: string;
	code: string;
	message: string;
}

export type PlaybackState = 'idle' | 'waiting' | 'running' | 'paused' | 'resuming' | 'completed' | 'ended';
export type EndReason = 'completed' | 'userStopped' | 'connectionLost' | 'treadmillStopped' | 'appRestart';

export interface PlaybackStep extends Step {
	flatIndex: number;
	repetition: number;
	repeatOf: number;
	blockLabel: string;
}

export interface Playback {
	state: PlaybackState;
	planId: string | null;
	planName: string | null;
	cursor: { flatIndex: number; itemIndex: number; stepIndex: number | null; repetition: number } | null;
	stepCount: number;
	current: PlaybackStep | null;
	next: PlaybackStep | null;
	stepElapsed: { seconds: number; metres: number };
	planElapsed: { seconds: number; metres: number };
	stepRemaining: { seconds?: number; metres?: number } | null;
	planRemaining: { seconds: number; metres: number } | null;
	override: { kph?: number; incline?: number } | null;
	controlIncline: boolean;
	estimated: boolean;
	endReason: EndReason | null;
	message: string | null;
}

export interface WorkoutSummary {
	id: string;
	planId: string | null;
	planName: string;
	startedAt: string;
	endedAt: string | null;
	endReason: EndReason | null;
	totals: { seconds: number; metres: number; avgHr?: number; maxHr?: number; avgCadence?: number; avgPower?: number; maxPower?: number };
}

export interface StepResult {
	flatIndex: number;
	label: string;
	repetition: number;
	target: { kph: number; incline: number };
	actual: { avgKph: number; avgIncline: number };
	seconds: number;
	metres: number;
	avgHr?: number;
	maxHr?: number;
	avgCadence?: number;
	avgPower?: number;
	overridden: boolean;
	skipped: boolean;
}

export interface Workout extends WorkoutSummary {
	steps: StepResult[];
}

export interface Device {
	id: string;
	name: string;
	pairedAt: string;
	lastSeenAt: string;
	expiresAt: string;
	// The address it last connected from; trusted: requests from there need no code or cookie.
	ip: string | null;
	trusted: boolean;
	current: boolean;
}

export class ApiError extends Error {
	constructor(public code: string, message: string, public details?: ValidationIssue[] | unknown) {
		super(message);
	}
}

// Training programs: multi-week schedules generated from a goal (programs:*).
export type ProgramGoal = '5k' | '10k' | 'half' | 'marathon';

export interface ProgramInput {
	goal: ProgramGoal;
	weeks: number;
	raceDate: string;
	runDays: number[];
	// Exactly one: an easy-run speed, or a goal finish time for the race distance.
	easyKph?: number;
	targetSeconds?: number;
	incline?: number;
	name?: string;
}

// The finish time a program trains for: entered by the user, or predicted from the easy speed.
export interface ProgramTarget {
	targetSeconds?: number;
	targetFrom?: 'time' | 'easy';
}

export interface ProgramDay {
	date: string;
	week: number;
	weekday: string;
	type: string;
	phase: 'base' | 'build' | 'peak' | 'taper';
	title: string;
	description: string;
	items: Plan['items'];
	planId?: string;
	done?: boolean;
	workoutId?: string | null;
}

export interface Program extends ProgramTarget {
	id?: string;
	name: string;
	goal: ProgramGoal;
	weeks: number;
	raceDate: string;
	startDate: string;
	runDays: number[];
	easyKph: number;
	days: ProgramDay[];
}

export interface ProgramSummary extends ProgramTarget {
	id: string;
	name: string;
	goal: ProgramGoal;
	weeks: number;
	raceDate: string;
	startDate: string;
	runs: number;
	done: number;
}
