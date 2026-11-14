import { Component, DestroyRef, OnInit, computed, effect, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AntBroadcastKind, ApiError, Device, FoundSensor, SensorKind, Settings, ValidationIssue } from '../core/api.types';
import { PrefsService, Theme } from '../core/prefs.service';
import { SessionService } from '../core/session.service';
import { RestartService } from '../core/restart.service';
import { SocketService } from '../core/socket.service';
import { ToastService } from '../core/toast.service';
import { displaySpeed, fromDisplaySpeed } from '../core/units';
import { ZwiftDevicesComponent } from '../shared/zwift-devices.component';
import { ConsoleReadoutComponent } from './console-readout.component';

interface Form {
	metric: boolean;
	transport: 'wifi' | 'ble' | 'simulated';
	ip: string;
	bleCode: string;
	speedOffset: number;
	speedMultiplier: number;
	minSpeed: number;
	maxSpeed: number;
	minIncline: number;
	maxIncline: number;
	cooldown: number;
	ftms: boolean;
	rsc: boolean;
	hr: boolean;
	ant: boolean;
	bluetoothWithZwift: boolean;
	hrSource: SourceMode;
	cadenceSource: SourceMode;
	powerSource: 'auto' | 'ant' | 'ble' | 'off';
	powerSmoothing: 1 | 3 | 10;
	thresholdPower: number | null;
	weightKg: number | null;
	// Power to Zwift: inside the Fitness Machine data, and as its own Bluetooth power meter.
	ftmsPower: boolean;
	powerMeter: boolean;
	// ANT+ broadcast: Zwifit as ANT+ sensors for a watch or head unit (specs/003).
	antBroadcast: boolean;
	antFootpod: boolean;
	antHr: boolean;
	antPower: boolean;
	antTreadmill: boolean;
	antRebroadcastHr: boolean;
	antRebroadcastPower: boolean;
	port: number;
	host: string;
}

type SourceMode = 'auto' | 'ant' | 'ble' | 'treadmill' | 'off' | 'sensor';
type Transport = 'ant' | 'bluetooth';

// A device in a metric's card: "ANT+ · Stryd · Device 31877 · battery 82% · 248 W · In use".
interface DeviceRow {
	// null for the treadmill's own reading.
	entry: SensorEntry | null;
	badge: 'ANT+' | 'BLE' | 'Console';
	detail: string;
	value: string;
	status: string;
	inUse: boolean;
}

// One sensor in "Available sensors": heard in a scan, in use, or picked earlier.
interface SensorEntry {
	key: string;
	transport: Transport;
	id: string;
	name: string;
	kinds: SensorKind[];
	values: Partial<Record<SensorKind, number>>;
	rssi: number | null;
	battery?: string;
	// connected: picked and reporting; auto: reporting, taken as the first in range; connecting;
	// searching: picked but not heard; found: heard in a scan, not used.
	state: 'connected' | 'auto' | 'connecting' | 'searching' | 'found';
}

const round1 = (n: number) => Math.round(n * 10) / 10;
// An empty number box is "not set".
const blankToNull = (v: number | string | null, integer = false) => {
	if (v === null || v === '' || !Number.isFinite(Number(v))) {
		return null;
	}
	return integer ? Math.round(Number(v)) : round1(Number(v));
};
const AUTO = { value: 'auto', label: 'Auto (ANT+ first)' };
const ANT = { value: 'ant', label: 'ANT+' };
const BLE = { value: 'ble', label: 'Bluetooth' };
const OFF = { value: 'off', label: 'Off' };
const SOURCE_OPTIONS: Record<SensorKind, { value: string; label: string }[]> = {
	power: [AUTO, ANT, BLE, OFF],
	hr: [AUTO, ANT, BLE, { value: 'treadmill', label: 'Treadmill' }, OFF],
	cadence: [AUTO, ANT, BLE, OFF]
};
const KIND_ORDER: SensorKind[] = ['hr', 'power', 'cadence'];
const UNIT: Record<SensorKind, string> = { hr: 'bpm', power: 'W', cadence: 'spm' };
const STATE_ORDER = { connected: 0, connecting: 1, auto: 2, searching: 3, found: 4 };
const KIND_LABEL: Record<SensorKind, string> = { hr: 'Heart rate', power: 'Power', cadence: 'Cadence' };

// One row in "ANT+ devices in range": heard now, or found in the last scan.
interface AntInRangeRow {
	id: string;
	name: string;
	kinds: string;
	reading: string;
	detail: string;
	status: string;
	inUse: boolean;
	rssi: number | null;
}

// "just now", "40 s ago", "3 min ago", "2 h ago".
function ago(iso: string | undefined, now: number): string {
	const at = iso ? Date.parse(iso) : NaN;
	if (!Number.isFinite(at)) {
		return '';
	}
	const s = Math.max(0, Math.round((now - at) / 1000));
	return s < 10 ? 'just now' : s < 60 ? `${s} s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
}

// A name for a sensor that does not send one, from what it measures.
function defaultName(kinds: SensorKind[]): string {
	if (kinds.includes('power')) {
		return kinds.includes('cadence') ? 'Running power pod' : 'Power meter';
	}
	return kinds.includes('hr') ? 'Heart rate monitor' : 'Footpod';
}

@Component({
	selector: 'app-settings',
	imports: [FormsModule, DatePipe, ZwiftDevicesComponent, ConsoleReadoutComponent],
	templateUrl: './settings.component.html'
})
export class SettingsComponent implements OnInit {
	private readonly socket = inject(SocketService);
	protected readonly restarter = inject(RestartService);
	private readonly session = inject(SessionService);
	private readonly toast = inject(ToastService);
	protected readonly prefs = inject(PrefsService);
	protected readonly form = signal<Form | null>(null);
	protected readonly errors = signal<ValidationIssue[]>([]);
	protected readonly saving = signal(false);
	protected readonly devices = signal<Device[]>([]);
	protected readonly renaming = signal<string | null>(null);
	// A pairing code asked for on this screen, to type into another device.
	protected readonly pairingCode = signal<{ code: string; expiresAt: string } | null>(null);
	private codeTimer?: ReturnType<typeof setTimeout>;
	protected renameDraft = '';
	protected addressDraft = '';
	// "Add a device by address" form.
	protected newClientName = '';
	protected newClientIp = '';
	protected readonly themes: { value: Theme; label: string }[] = [
		{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }
	];
	protected readonly transports: { value: Form['transport']; label: string }[] = [
		{ value: 'wifi', label: 'Wi-Fi' }, { value: 'ble', label: 'Bluetooth' }, { value: 'simulated', label: 'Simulated' }
	];
	protected readonly sections = [
		{ id: 'treadmill', label: 'Treadmill' }, { id: 'console', label: 'Console readout' }, { id: 'limits', label: 'Safety limits' }, { id: 'zwift', label: 'Zwift broadcast' },
		{ id: 'sensors', label: 'Sensors' }, { id: 'ant-broadcast', label: 'ANT+ broadcast' }, { id: 'display', label: 'Display' }, { id: 'devices', label: 'Paired devices' },
		{ id: 'server', label: 'Server' }
	];
	protected readonly active = signal('treadmill');
	protected readonly treadmill = computed(() => this.socket.status()?.treadmill ?? null);
	protected readonly broadcast = computed(() => this.socket.status()?.broadcast ?? null);
	protected readonly ant = computed(() => this.socket.status()?.sensors?.ant ?? null);
	protected readonly antBroadcast = computed(() => this.socket.status()?.antBroadcast ?? null);
	protected readonly antBroadcastKinds: { kind: AntBroadcastKind; label: string; hint: string }[] = [
		{ kind: 'footpod', label: 'Footpod', hint: 'Speed, distance and cadence · pair "Footpod" on a watch' },
		{ kind: 'hr', label: 'Heart rate', hint: 'The heart rate shown on the dashboard' },
		{ kind: 'power', label: 'Power', hint: 'Running power from a Stryd or the treadmill' },
		{ kind: 'treadmill', label: 'Treadmill', hint: 'Speed, incline, distance and time as ANT+ fitness equipment' }
	];
	protected readonly renumbering = signal(false);
	protected readonly transportLabel = computed(() => ({ wifi: 'Wi-Fi', ble: 'Bluetooth', simulated: 'Simulated' })[this.treadmill()?.transport ?? 'wifi']);
	protected readonly speedScale = computed(() => (this.form()?.metric ? 22 : 14));

	// One card per metric (power, heart rate, cadence): the live value, the source choice and every
	// device that measures it, marked "In use" or "Standby".
	protected readonly metricCards = computed(() => {
		const t = this.treadmill();
		const sensors = this.availableSensors();
		const liveId = (kind: SensorKind, transport: Transport) => {
			const list = transport === 'ant' ? this.ant()?.devices ?? [] : this.bluetooth()?.devices ?? [];
			const d = list.find(x => x.kind === kind && Date.parse(x.lastSeenAt) > Date.now() - 10000);
			return d ? String(d.deviceId) : null;
		};
		const card = (kind: SensorKind, name: string, value: number | null | undefined, source: string | null | undefined, empty: string) => {
			const antInUse = source === 'ant';
			const rows: DeviceRow[] = sensors.filter(e => e.kinds.includes(kind)).map((e): DeviceRow => {
				const transport = e.transport === 'ant' ? 'ant' : 'ble';
				const inUse = source === transport && liveId(kind, e.transport) === e.id;
				const reading = e.values[kind];
				const parts = e.transport === 'ant' ? [`Device ${e.id}`] : [];
				if (e.battery) {
					parts.push(`battery ${e.battery}`);
				}
				if (e.transport === 'bluetooth' && !inUse && antInUse) {
					parts.push('not needed while ANT+ is live');
				}
				const status = inUse ? 'In use'
					: e.state === 'connecting' ? 'Connecting…'
					: e.state === 'searching' ? 'Not in range'
					: 'Standby';
				return {
					entry: e,
					badge: e.transport === 'ant' ? 'ANT+' : 'BLE',
					detail: parts.join(' · ') || 'Bluetooth',
					value: reading !== undefined ? `${reading} ${UNIT[kind]}` : '–',
					status,
					inUse
				};
			}).sort((a, b) => Number(b.inUse) - Number(a.inUse));
			if (source === 'treadmill' && value) {
				rows.unshift({ entry: null, badge: 'Console', detail: 'From the treadmill', value: `${value} ${UNIT[kind]}`, status: 'In use', inUse: true });
			}
			return { kind, name, value: value ? Math.round(value) : null, unit: UNIT[kind], options: SOURCE_OPTIONS[kind], rows, empty };
		};
		return [
			card('power', 'Power', t?.power, t?.powerSource, 'No power sensor yet. Wake your Stryd (tap it) and scan.'),
			card('hr', 'Heart rate', t?.hr, t?.hrSource, 'No heart-rate sensor yet. Put the strap on, or turn on "Broadcast Heart Rate" on a Garmin watch, and scan.'),
			card('cadence', 'Cadence', t?.cadence, t?.cadenceSource, 'No cadence sensor yet. A footpod or Stryd gives cadence; scan with it awake.')
		];
	});
	protected readonly bluetooth = computed(() => this.socket.status()?.sensors?.bluetooth ?? null);
	protected readonly busy = signal<string | null>(null);
	// Ticks every 5 s so "seen 40 s ago" stays current between status pushes.
	private readonly now = signal(Date.now());

	// Every ANT+ device Zwifit knows is in range: the ones heard now (one per kind; the stick locks
	// onto the first it hears) and everything the last scan found. A scan is the only way to see them
	// all, since it needs the whole stick.
	protected readonly antInRange = computed<AntInRangeRow[]>(() => {
		const ant = this.ant();
		const now = this.now();
		const names = this.socket.settings()?.sensors?.names ?? {};
		const rows = new Map<string, { id: string; name: string; kinds: SensorKind[]; values: Partial<Record<SensorKind, number>>; battery?: string; rssi: number | null; heardAt?: string; foundAt?: string; inUse: boolean }>();
		const row = (id: string) => {
			if (!rows.has(id)) {
				rows.set(id, { id, name: '', kinds: [], values: {}, rssi: null, inUse: false });
			}
			return rows.get(id)!;
		};
		for (const d of ant?.devices ?? []) {
			const r = row(String(d.deviceId));
			if (!r.kinds.includes(d.kind)) {
				r.kinds.push(d.kind);
			}
			const fresh = Date.parse(d.lastSeenAt) > now - 10000;
			if (fresh) {
				r.values[d.kind] = d.value;
			}
			r.inUse = r.inUse || fresh;
			r.name = r.name || d.manufacturer || '';
			r.battery = r.battery || d.battery;
			r.heardAt = !r.heardAt || d.lastSeenAt > r.heardAt ? d.lastSeenAt : r.heardAt;
		}
		for (const f of ant?.found ?? []) {
			const r = row(f.id);
			f.kinds.forEach(k => { if (!r.kinds.includes(k)) { r.kinds.push(k); } });
			r.values = { ...f.values, ...r.values };
			r.rssi = f.rssi;
			r.name = r.name || f.manufacturer || '';
			r.battery = r.battery || f.battery;
			r.foundAt = f.lastSeenAt ?? ant?.scan?.lastAt;
		}
		return [...rows.values()]
			.map(r => {
				const kinds = KIND_ORDER.filter(k => r.kinds.includes(k));
				const parts = [`Device ${r.id}`];
				if (r.battery) {
					parts.push(`battery ${r.battery}`);
				}
				if (r.rssi !== null) {
					parts.push(`signal ${r.rssi} dBm`);
				}
				return {
					id: r.id,
					name: names[`ant:${r.id}`] || r.name || defaultName(kinds),
					kinds: kinds.map(k => KIND_LABEL[k]).join(' + '),
					reading: kinds.filter(k => r.values[k] !== undefined).map(k => `${r.values[k]} ${UNIT[k]}`).join(' · ') || '–',
					detail: parts.join(' · '),
					status: r.inUse ? 'In use' : r.heardAt && (!r.foundAt || r.heardAt > r.foundAt) ? `Heard ${ago(r.heardAt, now)}` : `Found ${ago(r.foundAt, now)}`,
					inUse: r.inUse,
					rssi: r.rssi
				};
			})
			.sort((a, b) => Number(b.inUse) - Number(a.inUse) || (b.rssi ?? -999) - (a.rssi ?? -999));
	});
	protected readonly antLastScan = computed(() => {
		const at = this.ant()?.scan?.lastAt;
		return at ? ago(at, this.now()) : null;
	});

	// Every sensor worth showing: picked ones (even out of range), ones in use, ones heard in a scan.
	protected readonly availableSensors = computed<SensorEntry[]>(() => {
		const settings = this.socket.settings()?.sensors;
		const entries = new Map<string, SensorEntry>();
		const entry = (transport: Transport, id: string, init: () => Omit<SensorEntry, 'key' | 'transport' | 'id'>) => {
			const key = `${transport}:${id}`;
			if (!entries.has(key)) {
				entries.set(key, { key, transport, id, ...init() });
			}
			return entries.get(key)!;
		};
		const addKind = (e: SensorEntry, kind: SensorKind) => {
			if (!e.kinds.includes(kind)) {
				e.kinds.push(kind);
			}
		};
		const blank = () => ({ name: '', kinds: [] as SensorKind[], values: {}, rssi: null, state: 'found' as const });
		const merge = (e: SensorEntry, f: FoundSensor) => {
			f.kinds.forEach(k => addKind(e, k));
			e.values = { ...f.values, ...e.values };
			e.rssi = f.rssi;
			e.name = e.name || f.name || f.manufacturer || '';
			e.battery = e.battery || f.battery;
		};

		const ant = this.ant();
		const chosen = settings?.antDevices ?? {};
		for (const [kind, id] of Object.entries(chosen) as [SensorKind, number][]) {
			const e = entry('ant', String(id), blank);
			addKind(e, kind);
			e.state = 'searching';
		}
		for (const d of ant?.devices ?? []) {
			const e = entry('ant', String(d.deviceId), blank);
			addKind(e, d.kind);
			e.values[d.kind] = d.value;
			e.name = e.name || d.manufacturer || '';
			e.battery = e.battery || d.battery;
			const picked = chosen[d.kind] === d.deviceId;
			const fresh = Date.parse(d.lastSeenAt) > Date.now() - 10000;
			if (fresh) {
				e.state = picked ? 'connected' : e.state === 'found' ? 'auto' : e.state;
			}
		}
		for (const f of ant?.found ?? []) {
			merge(entry('ant', f.id, blank), f);
		}

		const ble = this.bluetooth();
		for (const c of ble?.connections ?? []) {
			const e = entry('bluetooth', c.id, blank);
			c.kinds.forEach(k => addKind(e, k));
			e.name = c.name ?? '';
			e.state = c.state;
			e.battery = c.battery;
		}
		for (const d of ble?.devices ?? []) {
			const e = entries.get(`bluetooth:${d.deviceId}`);
			if (e) {
				e.values[d.kind] = d.value;
			}
		}
		for (const f of ble?.found ?? []) {
			merge(entry('bluetooth', f.id, blank), f);
		}

		const names = settings?.names ?? {};
		return [...entries.values()]
			.map(e => ({ ...e, kinds: KIND_ORDER.filter(k => e.kinds.includes(k)), name: names[e.key] || e.name || defaultName(e.kinds) }))
			.sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || (b.rssi ?? -999) - (a.rssi ?? -999));
	});
	private loadedFrom: Settings | null = null;

	constructor() {
		const tick = setInterval(() => this.now.set(Date.now()), 5000);
		inject(DestroyRef).onDestroy(() => clearInterval(tick));
		// Fill the form when settings first arrive (and after saves from any device), unless editing.
		effect(() => {
			const s = this.socket.settings();
			if (s && (!this.form() || this.loadedFrom !== s)) {
				this.loadedFrom = s;
				if (!this.saving()) {
					this.form.set(this.toForm(s));
				}
			}
		});
	}

	ngOnInit(): void {
		this.loadDevices();
	}

	private toForm(s: Settings): Form {
		const m = s.metric;
		return {
			metric: m,
			transport: s.treadmill.transport,
			ip: s.treadmill.ip ?? '',
			bleCode: s.treadmill.bleCode ?? '',
			speedOffset: s.speedOffset,
			speedMultiplier: s.speedMultiplier,
			minSpeed: round1(displaySpeed(s.limits.minKph, m)),
			maxSpeed: round1(displaySpeed(s.limits.maxKph, m)),
			minIncline: s.limits.minIncline,
			maxIncline: s.limits.maxIncline,
			cooldown: round1(displaySpeed(s.cooldownKph, m)),
			ftms: s.broadcast.ftms,
			rsc: s.broadcast.rsc,
			hr: s.broadcast.hr !== false,
			ant: s.sensors?.ant !== false,
			bluetoothWithZwift: !!s.sensors?.bluetoothWithZwift,
			// "sensor" (ANT+ or Bluetooth, an older choice) shows as Auto, which also prefers a sensor.
			hrSource: s.sensors?.hrSource === 'sensor' ? 'auto' : s.sensors?.hrSource ?? 'auto',
			cadenceSource: s.sensors?.cadenceSource === 'sensor' ? 'auto' : s.sensors?.cadenceSource ?? 'auto',
			powerSource: s.sensors?.powerSource ?? 'auto',
			powerSmoothing: s.sensors?.powerSmoothing ?? 3,
			thresholdPower: s.sensors?.thresholdPower ?? null,
			weightKg: s.sensors?.weightKg ?? null,
			ftmsPower: !!s.broadcast.ftmsPower,
			powerMeter: !!s.broadcast.power,
			antBroadcast: !!s.antBroadcast?.enabled,
			antFootpod: s.antBroadcast?.footpod !== false,
			antHr: s.antBroadcast?.hr !== false,
			antPower: s.antBroadcast?.power !== false,
			antTreadmill: s.antBroadcast?.treadmill !== false,
			antRebroadcastHr: !!s.antBroadcast?.rebroadcastAnt?.hr,
			antRebroadcastPower: !!s.antBroadcast?.rebroadcastAnt?.power,
			port: s.server.port,
			host: s.server.host
		};
	}

	protected go(id: string): void {
		this.active.set(id);
		document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}

	// True when the form differs from the saved settings.
	protected dirty(): boolean {
		const f = this.form();
		return !!f && !!this.loadedFrom && JSON.stringify(f) !== JSON.stringify(this.toForm(this.loadedFrom));
	}

	// Position on a limit track, 0..100.
	protected pct(value: number, min: number, max: number): number {
		return Math.max(0, Math.min(100, ((Number(value) - min) / (max - min)) * 100));
	}

	protected inclineFloor(f: Form): number {
		return Math.min(0, Number(f.minIncline));
	}

	protected sourceOf(f: Form, kind: SensorKind): string {
		return kind === 'hr' ? f.hrSource : kind === 'cadence' ? f.cadenceSource : f.powerSource;
	}

	protected setSource(f: Form, kind: SensorKind, value: string): void {
		if (kind === 'hr') {
			f.hrSource = value as Form['hrSource'];
		}
		else if (kind === 'cadence') {
			f.cadenceSource = value as Form['cadenceSource'];
		}
		else {
			f.powerSource = value as Form['powerSource'];
		}
	}

	protected scanning(transport: Transport): boolean {
		return !!(transport === 'ant' ? this.ant() : this.bluetooth())?.scan?.active;
	}

	protected canScan(transport: Transport): boolean {
		const status = transport === 'ant' ? this.ant() : this.bluetooth();
		return !!status?.available && !status.scan?.active;
	}

	// Picked sensors and Bluetooth ones being connected can be disconnected; the rest connected.
	protected isPicked(s: SensorEntry): boolean {
		return s.state === 'connected' || s.state === 'connecting' || s.state === 'searching';
	}

	// Scans ANT+ and Bluetooth together (whichever is available).
	protected async scanAll(): Promise<void> {
		const transports = (['ant', 'bluetooth'] as Transport[]).filter(t => this.canScan(t));
		if (!transports.length) {
			this.toast.show('Neither ANT+ nor Bluetooth is ready to scan. See the notes above.');
			return;
		}
		await Promise.all(transports.map(t => this.scan(t)));
	}

	protected scanningAny(): boolean {
		return this.scanning('ant') || this.scanning('bluetooth');
	}

	protected async scan(transport: Transport): Promise<void> {
		this.busy.set(`scan:${transport}`);
		try {
			await this.socket.request('sensors:scan', { transport });
		}
		catch (err) {
			this.toast.error(err);
		}
		finally {
			this.busy.set(null);
		}
	}

	protected async connectSensor(s: SensorEntry): Promise<void> {
		this.busy.set(s.key);
		try {
			await this.socket.request('sensors:connect', { transport: s.transport, id: s.id });
			this.toast.show(`Connecting ${s.name}.`);
		}
		catch (err) {
			this.toast.error(err);
		}
		finally {
			this.busy.set(null);
		}
	}

	// Renaming a sensor in place: which one ("ant:4242"), and the name being typed.
	protected readonly renamingSensor = signal<string | null>(null);
	protected sensorNameDraft = '';

	protected startSensorRename(transport: Transport, id: string, current: string): void {
		this.renamingSensor.set(`${transport}:${id}`);
		const custom = this.socket.settings()?.sensors?.names?.[`${transport}:${id}`];
		this.sensorNameDraft = custom ?? current;
	}

	protected cancelSensorRename(): void {
		this.renamingSensor.set(null);
	}

	// Saves the typed name; an empty one goes back to the sensor's own name.
	protected async saveSensorRename(transport: Transport, id: string): Promise<void> {
		try {
			await this.socket.request('sensors:rename', { transport, id, name: this.sensorNameDraft.slice(0, 40) });
			this.renamingSensor.set(null);
		}
		catch (err) {
			this.toast.error(err);
		}
	}

	protected async forgetSensor(s: SensorEntry): Promise<void> {
		this.busy.set(s.key);
		try {
			await this.socket.request('sensors:forget', { transport: s.transport, id: s.id });
			this.toast.show(`Disconnected ${s.name}.`);
		}
		catch (err) {
			this.toast.error(err);
		}
		finally {
			this.busy.set(null);
		}
	}

	protected errorFor(path: string): string | null {
		return this.errors().find(e => e.path === path || e.path.startsWith(`${path}.`))?.message ?? null;
	}

	protected async save(): Promise<void> {
		const f = this.form();
		if (!f) {
			return;
		}
		const m = f.metric;
		const kph = (v: number) => Math.round(fromDisplaySpeed(Number(v), m) * 1000) / 1000;
		const treadmill: Record<string, unknown> = { transport: f.transport };
		if (f.transport === 'wifi') {
			treadmill['ip'] = f.ip.trim() || null;
		}
		if (f.transport === 'ble') {
			treadmill['bleCode'] = f.bleCode.trim() || null;
		}
		const patch = {
			metric: m,
			treadmill,
			speedOffset: Number(f.speedOffset),
			speedMultiplier: Number(f.speedMultiplier),
			limits: { minKph: kph(f.minSpeed), maxKph: kph(f.maxSpeed), minIncline: Number(f.minIncline), maxIncline: Number(f.maxIncline) },
			cooldownKph: kph(f.cooldown),
			broadcast: { ftms: f.ftms, rsc: f.rsc, hr: f.hr, ftmsPower: f.ftmsPower, power: f.powerMeter },
			sensors: {
				ant: f.ant, bluetoothWithZwift: f.bluetoothWithZwift, hrSource: f.hrSource, cadenceSource: f.cadenceSource, powerSource: f.powerSource,
				powerSmoothing: Number(f.powerSmoothing),
				thresholdPower: blankToNull(f.thresholdPower, true),
				weightKg: blankToNull(f.weightKg)
			},
			antBroadcast: {
				enabled: f.antBroadcast, footpod: f.antFootpod, hr: f.antHr, power: f.antPower, treadmill: f.antTreadmill,
				rebroadcastAnt: { hr: f.antRebroadcastHr, power: f.antRebroadcastPower }
			},
			server: { port: Number(f.port), host: f.host }
		};
		this.saving.set(true);
		this.errors.set([]);
		try {
			const saved = await this.socket.request<Settings>('settings:write', patch);
			this.form.set(this.toForm(saved));
			this.toast.show('Settings saved. Connection and server changes apply after Zwifit restarts.');
		}
		catch (err) {
			if (err instanceof ApiError && Array.isArray(err.details)) {
				this.errors.set(err.details as ValidationIssue[]);
			}
			this.toast.error(err);
		}
		finally {
			this.saving.set(false);
		}
	}

	// Labels and helpers for the ANT+ broadcast card.
	protected antBroadcastPill(): { tone: 'ok' | 'warn' | 'idle'; label: string } {
		const b = this.antBroadcast();
		switch (b?.state) {
			case 'broadcasting': return { tone: 'ok', label: 'Broadcasting' };
			case 'starting': return { tone: 'idle', label: 'Starting…' };
			case 'paused': return { tone: 'warn', label: 'Paused' };
			case 'error': return { tone: 'warn', label: 'Not broadcasting' };
			default: return { tone: 'idle', label: 'Off' };
		}
	}

	protected antKindSwitch(f: Form, kind: AntBroadcastKind): boolean {
		return { footpod: f.antFootpod, hr: f.antHr, power: f.antPower, treadmill: f.antTreadmill }[kind];
	}

	protected toggleAntKind(f: Form, kind: AntBroadcastKind): void {
		if (kind === 'footpod') { f.antFootpod = !f.antFootpod; }
		if (kind === 'hr') { f.antHr = !f.antHr; }
		if (kind === 'power') { f.antPower = !f.antPower; }
		if (kind === 'treadmill') { f.antTreadmill = !f.antTreadmill; }
	}

	protected antSensor(kind: AntBroadcastKind) {
		return this.antBroadcast()?.sensors.find(s => s.kind === kind) ?? null;
	}

	// New ANT+ device numbers: every watch or head unit has to pair with Zwifit again.
	protected async renumberAnt(): Promise<void> {
		if (!confirm('Give Zwifit new ANT+ device numbers? Watches and head units paired with it will need to pair again.')) {
			return;
		}
		this.renumbering.set(true);
		try {
			await this.socket.request('ant-broadcast:renumber', {});
			this.toast.show('New ANT+ device numbers. Pair your watch or head unit with Zwifit again.');
		}
		catch (err) {
			this.toast.error(err);
		}
		finally {
			this.renumbering.set(false);
		}
	}

	protected async loadDevices(): Promise<void> {
		try {
			this.devices.set(await this.session.devices());
		}
		catch (err) {
			this.toast.error(err);
		}
	}

	protected startRename(device: Device): void {
		this.renameDraft = device.name;
		this.addressDraft = device.ip ?? '';
		this.renaming.set(device.id);
	}

	protected async saveRename(device: Device): Promise<void> {
		try {
			const changes: { name?: string; ip?: string } = { name: this.renameDraft.trim() };
			if (device.trusted && this.addressDraft.trim() && this.addressDraft.trim() !== device.ip) {
				changes.ip = this.addressDraft.trim();
			}
			await this.session.editDevice(device.id, changes);
			this.renaming.set(null);
			this.loadDevices();
		}
		catch (err) {
			this.toast.error(err);
		}
	}

	protected async addByAddress(): Promise<void> {
		const name = this.newClientName.trim();
		const ip = this.newClientIp.trim();
		if (!name || !ip) {
			this.toast.show('Enter a name and an IP address.');
			return;
		}
		if (!confirm(`Let "${name}" use Zwifit from ${ip} without a pairing code?

Anything else that gets this address on the network will be treated as this device, so only do this on a network you trust, ideally with a fixed address for that device.`)) {
			return;
		}
		try {
			await this.session.addDeviceByAddress(name, ip);
			this.newClientName = '';
			this.newClientIp = '';
			this.toast.show(`"${name}" can now open Zwifit from ${ip}.`);
			this.loadDevices();
		}
		catch (err) {
			this.toast.error(err);
		}
	}

	protected async toggleTrust(device: Device): Promise<void> {
		if (!device.trusted && !confirm(`Let "${device.name}" use Zwifit without a code from ${device.ip}?

Anything else that gets this address on the network will be treated as this device, so only do this on a network you trust, ideally with a fixed address for that device.`)) {
			return;
		}
		try {
			await this.session.trustDevice(device.id, !device.trusted);
			this.loadDevices();
		}
		catch (err) {
			this.toast.error(err);
		}
	}

	protected async revoke(device: Device): Promise<void> {
		if (!confirm(`Remove "${device.name}"? It will need the pairing code again.`)) {
			return;
		}
		try {
			await this.session.revoke(device.id);
			this.toast.show(`Removed "${device.name}".`);
			this.loadDevices();
		}
		catch (err) {
			this.toast.error(err);
		}
	}

	protected async unpair(): Promise<void> {
		if (confirm('Unpair this device? You will need the pairing code to use it again.')) {
			await this.session.unpair();
		}
	}

	protected async newCode(): Promise<void> {
		if (this.pairingCode() && !confirm('Make a new code? The one shown stops working.')) {
			return;
		}
		try {
			const issued = await this.session.newPairingCode();
			this.pairingCode.set(issued);
			clearTimeout(this.codeTimer);
			// Hidden when it expires; it no longer works by then anyway.
			this.codeTimer = setTimeout(() => this.pairingCode.set(null), Date.parse(issued.expiresAt) - Date.now());
		}
		catch (err) {
			this.toast.error(err);
		}
	}

	protected hideCode(): void {
		clearTimeout(this.codeTimer);
		this.pairingCode.set(null);
	}
}
