import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Soup from 'gi://Soup';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import { PopupMenuItem, PopupSeparatorMenuItem } from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { fetchJSON, saveJSON } from './convenience.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const REFRESH_INTERVAL_S  = 60 * 60;       // auto-refresh rates every hour
const CURRENCY_LIST_TTL_S = 24 * 60 * 60;  // refresh currency list daily
const FETCH_BATCH         = 8;              // concurrent API requests
const API_EARLIEST        = '2024-01-01';  // fawazahmed0 API start date

const VIEW = {
    month: { days: 30,      step: 1 }, // daily for 1 month
    year:  { days: 365,     step: 1 }, // daily for 1 year
    max:   { from: API_EARLIEST, step: 7 }, // weekly from API start → today
};

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ---------------------------------------------------------------------------
// Disk cache helpers
// ---------------------------------------------------------------------------
function cacheDir() {
    return `${GLib.get_user_cache_dir()}/gnome-shell-currency-converter`;
}
function cacheWrite(key, data) {
    try {
        GLib.mkdir_with_parents(cacheDir(), 0o755);
        const file = Gio.File.new_for_path(`${cacheDir()}/${key}.json`);
        file.replace_contents(
            JSON.stringify({ ts: GLib.get_real_time() / 1e6, data }),
            null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null
        );
    } catch (e) { console.warn(`[CurrencyConverter] cache write: ${e}`); }
}
function cacheRead(key, maxAgeS = Infinity) {
    try {
        const [ok, bytes] = Gio.File.new_for_path(`${cacheDir()}/${key}.json`).load_contents(null);
        if (!ok) return null;
        const { ts, data } = JSON.parse(new TextDecoder().decode(bytes));
        return (GLib.get_real_time() / 1e6) - ts <= maxAgeS ? data : null;
    } catch { return null; }
}

// ---------------------------------------------------------------------------
// Rate history — one merged file per currency pair, keyed by ISO date
// { "2024-01-03": 15.91, "2024-01-10": 16.04, ... }
// ---------------------------------------------------------------------------
const histFile = (base, target) => `history-${base}-${target}`;
const loadHist = (base, target) => cacheRead(histFile(base, target)) ?? {};
const saveHist = (base, target, h) => cacheWrite(histFile(base, target), h);

// ---------------------------------------------------------------------------
// API fetch helpers (CDN + Cloudflare fallback)
// ---------------------------------------------------------------------------
const CDN_URL      = (date, base) =>
    `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${date}/v1/currencies/${base}.min.json`;
const FALLBACK_URL = (date, base) =>
    `https://${date}.currency-api.pages.dev/v1/currencies/${base}.min.json`;

async function fetchRate(session, date, base, target) {
    let data;
    try       { data = await fetchJSON(session, CDN_URL(date, base)); }
    catch (_) { data = await fetchJSON(session, FALLBACK_URL(date, base)); }
    return data?.[base]?.[target] ?? null;
}

async function fetchBatch(session, dates, base, target) {
    const out = {};
    for (let i = 0; i < dates.length; i += FETCH_BATCH) {
        const slice = dates.slice(i, i + FETCH_BATCH);
        const res   = await Promise.allSettled(slice.map(d => fetchRate(session, d, base, target)));
        slice.forEach((d, j) => {
            if (res[j].status === 'fulfilled' && res[j].value != null) out[d] = res[j].value;
        });
    }
    return out;
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------
function isoDate(dt) { return dt.format('%Y-%m-%d'); }

/** Generate ISO date strings stepping backward from today by stepDays. */
function makeDates(days, stepDays = 1) {
    const today = GLib.DateTime.new_now_local();
    const dates = [];
    for (let i = 0; i < days; i += stepDays)
        dates.push(isoDate(today.add_days(-i)));
    return dates; // newest → oldest
}

/** Generate weekly ISO dates from API_EARLIEST up to today. */
function makeMaxDates() {
    const today    = GLib.DateTime.new_now_local();
    const earliest = GLib.DateTime.new_local(2024, 1, 1, 0, 0, 0);
    const dates    = [];
    let   cur      = today;
    while (cur.compare(earliest) >= 0) {
        dates.push(isoDate(cur));
        cur = cur.add_days(-7);
    }
    return dates; // newest → oldest
}

function toDateLabel(iso, showYear = false) {
    const [y, m, d] = iso.split('-');
    const label = `${parseInt(d)} ${MONTHS[parseInt(m) - 1]}`;
    return showYear ? `${label} ${y.slice(2)}` : label; // "14 Mar" or "14 Mar 24"
}

// ---------------------------------------------------------------------------
// Chart widget
// ---------------------------------------------------------------------------
const LineChart = GObject.registerClass(
class LineChart extends St.DrawingArea {
    _init(width = 500, height = 250) {
        super._init({ width, height, style_class: 'currency-line-chart' });
        this._fullData = [];
        this._view     = 'year';
        this.connect('repaint', this._draw.bind(this));
    }
    setView(mode) { this._view = mode; this.queue_repaint(); }
    setData(data) { this._fullData = data; this.queue_repaint(); } // oldest → newest

    _visiblePts() {
        if (this._view === 'max') return this._fullData;
        const cutoff = new Date();
        if (this._view === 'month') cutoff.setMonth(cutoff.getMonth() - 1);
        else                        cutoff.setFullYear(cutoff.getFullYear() - 1);
        return this._fullData.filter(p => new Date(p.date) >= cutoff);
    }

    _draw(area) {
        const cr = area.get_context();
        const [W, H] = area.get_surface_size();
        const pad = { t: 24, r: 20, b: 64, l: 72 };
        const cw  = W - pad.l - pad.r;
        const ch  = H - pad.t  - pad.b;

        // Background
        cr.setSourceRGBA(0.1, 0.1, 0.1, 0.9);
        cr.rectangle(0, 0, W, H);
        cr.fill();

        const pts = this._visiblePts();
        if (pts.length < 2) {
            cr.setSourceRGBA(0.8, 0.8, 0.8, 1);
            cr.setFontSize(12);
            cr.moveTo(W / 2 - 80, H / 2);
            cr.showText('Not enough data for this range');
            cr.$dispose();
            return;
        }

        const rates = pts.map(p => p.rate);
        const lo    = Math.min(...rates), hi = Math.max(...rates);
        const span  = (hi - lo) || 1;
        const p10   = span * 0.1;
        const yLo   = lo - p10, yHi = hi + p10, ySpan = yHi - yLo;

        const xOf = i => pad.l + (i / (pts.length - 1)) * cw;
        const yOf = r => pad.t + ((yHi - r) / ySpan) * ch;

        // Axes
        cr.setSourceRGBA(0.5, 0.5, 0.5, 1);
        cr.setLineWidth(1);
        cr.moveTo(pad.l, pad.t);     cr.lineTo(pad.l, H - pad.b);
        cr.moveTo(pad.l, H - pad.b); cr.lineTo(W - pad.r, H - pad.b);
        cr.stroke();

        // Y grid + bold labels
        cr.selectFontFace('Sans', 0, 1 /* BOLD */);
        for (let i = 0; i <= 5; i++) {
            const y = pad.t + (i / 5) * ch;
            const v = yHi  - (i / 5) * ySpan;
            cr.setSourceRGBA(0.25, 0.25, 0.25, 0.6);
            cr.setLineWidth(0.5);
            cr.moveTo(pad.l, y); cr.lineTo(W - pad.r, y);
            cr.stroke();
            cr.setSourceRGBA(1, 1, 1, 1);
            cr.setFontSize(11);
            cr.moveTo(4, y + 4);
            cr.showText(v.toFixed(2));
        }

        // Area fill
        cr.setSourceRGBA(0.5, 0.8, 1, 0.08);
        cr.moveTo(xOf(0), yOf(pts[0].rate));
        pts.forEach((p, i) => cr.lineTo(xOf(i), yOf(p.rate)));
        cr.lineTo(xOf(pts.length - 1), H - pad.b);
        cr.lineTo(xOf(0), H - pad.b);
        cr.closePath(); cr.fill();

        // Line
        cr.setSourceRGBA(0.5, 0.8, 1, 1);
        cr.setLineWidth(2);
        pts.forEach((p, i) => {
            if (i === 0) cr.moveTo(xOf(0), yOf(p.rate));
            else         cr.lineTo(xOf(i), yOf(p.rate));
        });
        cr.stroke();

        // Dots — only for 1M (≤30 pts)
        if (pts.length <= 30) {
            cr.setSourceRGBA(0.3, 0.6, 1, 1);
            pts.forEach((p, i) => { cr.arc(xOf(i), yOf(p.rate), 3, 0, 2 * Math.PI); cr.fill(); });
        }

        // X labels — show year when range spans multiple calendar years
        const multiYear = pts[0].date.slice(0, 4) !== pts.at(-1).date.slice(0, 4);
        const maxLabels = Math.max(2, Math.floor(cw / (multiYear ? 64 : 52)));
        const step      = (pts.length - 1) / (maxLabels - 1);
        const show      = new Set([0, pts.length - 1]);
        for (let i = 1; i < maxLabels - 1; i++) show.add(Math.round(i * step));

        cr.setFontSize(10);
        cr.selectFontFace('Sans', 0, 1);
        pts.forEach((p, i) => {
            const x = xOf(i);
            cr.setSourceRGBA(0.5, 0.5, 0.5, 1);
            cr.moveTo(x, H - pad.b); cr.lineTo(x, H - pad.b + 4);
            cr.stroke();
            if (show.has(i)) {
                cr.setSourceRGBA(1, 1, 1, 1);
                cr.save();
                cr.translate(x, H - pad.b + 10);
                cr.rotate(Math.PI / 6);
                cr.moveTo(0, 0);
                cr.showText(toDateLabel(p.date, multiYear)); // year suffix on multi-year views
                cr.restore();
            }
        });

        // Title
        cr.setSourceRGBA(0.85, 0.85, 0.85, 1);
        cr.setFontSize(11);
        cr.selectFontFace('Sans', 0, 1);
        const title = `${toDateLabel(pts[0].date, multiYear)} – ${toDateLabel(pts.at(-1).date, multiYear)}`;
        const te    = cr.textExtents(title);
        cr.moveTo((W - te.width) / 2, pad.t - 7);
        cr.showText(title);

        cr.$dispose();
    }
});

// ---------------------------------------------------------------------------
// Panel indicator
// ---------------------------------------------------------------------------
const CurrencyIndicator = GObject.registerClass(
class CurrencyIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, 'Currency Converter');
        this._ext      = extension;
        this._settings = extension.getSettings();
        this._log      = extension.getLogger();

        // Panel row: "USD/ZAR: 18.42 ▼ 0.13"
        const row = new St.BoxLayout({ style_class: 'panel-status-menu-box' });
        this._rateLabel = new St.Label({ text: 'Loading…', y_align: Clutter.ActorAlign.CENTER });
        this._dirLabel  = new St.Label({ y_align: Clutter.ActorAlign.CENTER,
                                         style: 'margin-left:5px; font-size:11px;', visible: false });
        this._diffLabel = new St.Label({ y_align: Clutter.ActorAlign.CENTER,
                                         style: 'margin-left:2px;', visible: false });
        row.add_child(this._rateLabel);
        row.add_child(this._dirLabel);
        row.add_child(this._diffLabel);
        this.add_child(row);

        // Dropdown: chart + controls
        const chartItem = new PopupMenuItem('', { reactive: false, can_focus: false });
        const chartBox  = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style: 'padding: 10px;',
        });
        chartItem.add_child(chartBox);

        // 1M / 1Y / Max buttons
        const btnRow = new St.BoxLayout({ style: 'margin-bottom: 6px;' });
        this._viewBtns = {};
        for (const [label, mode] of [['1M', 'month'], ['1Y', 'year'], ['Max', 'max']]) {
            const btn = new St.Button({ label, style_class: 'button',
                style: 'margin-right:4px; padding:2px 8px; font-size:11px;' });
            btn.connect('clicked', () => { this._chart.setView(mode); this._activateBtn(mode); });
            btnRow.add_child(btn);
            this._viewBtns[mode] = btn;
        }
        chartBox.add_child(btnRow);

        this._chart = new LineChart(500, 250);
        chartBox.add_child(this._chart);
        this.menu.addMenuItem(chartItem);
        this._activateBtn('year');

        this.menu.addMenuItem(new PopupSeparatorMenuItem());

        const mkItem = (label, fn) => {
            const item = new PopupMenuItem(label);
            item.connect('activate', fn);
            this.menu.addMenuItem(item);
        };
        mkItem('Refresh',              () => this._fetchRates(true));
        mkItem('Update Currency List', () => this._fetchCurrencyList(true));
        mkItem('Preferences…',         () => extension.openPreferences());

        this._settingsId = this._settings.connect('changed', () => this._fetchRates(true));
        this._rateTimer  = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, REFRESH_INTERVAL_S, () => {
            this._fetchRates(true);
            return GLib.SOURCE_CONTINUE;
        });
        this._listTimer  = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, CURRENCY_LIST_TTL_S, () => {
            this._fetchCurrencyList(false);
            return GLib.SOURCE_CONTINUE;
        });

        this._fetchRates(false);
    }

    // ── View button highlight ──────────────────────────────────────────────
    _activateBtn(active) {
        for (const [mode, btn] of Object.entries(this._viewBtns)) {
            btn.style = mode === active
                ? 'margin-right:4px; padding:2px 8px; font-size:11px; background:#4a90d9; color:#fff; border-radius:4px;'
                : 'margin-right:4px; padding:2px 8px; font-size:11px;';
        }
    }

    // ── Direction indicator ────────────────────────────────────────────────
    // USD/ZAR: rate UP = rand WEAKER (▼ red) / rate DOWN = rand STRONGER (▲ green)
    _setDirection(diff) {
        this._dirLabel.visible = this._diffLabel.visible = true;
        if (Math.abs(diff) <= 0.00001) {
            this._dirLabel.set_text('▬');
            this._dirLabel.style = 'margin-left:5px; font-size:11px; color:#888;';
        } else if (diff < 0) {
            this._dirLabel.set_text('▲');
            this._dirLabel.style = 'margin-left:5px; font-size:11px; color:#26A269;';
        } else {
            this._dirLabel.set_text('▼');
            this._dirLabel.style = 'margin-left:5px; font-size:11px; color:#E01B24;';
        }
        this._diffLabel.set_text(Math.abs(diff).toFixed(2));
    }

    // ── Rate fetching ──────────────────────────────────────────────────────
    async _fetchRates(bustToday = false) {
        const base   = this._settings.get_string('base-currency');
        const target = this._settings.get_string('target-currency');
        if (!base || !target) { this._rateLabel.set_text('Config Error'); return; }

        const hist = loadHist(base, target);

        // Daily dates for 1Y + weekly dates from API_EARLIEST for Max
        const dailyDates  = makeDates(VIEW.year.days, 1);
        const maxDates    = makeMaxDates();
        const allDates    = [...new Set([...dailyDates, ...maxDates])]; // unique, newest→oldest

        // Bust today on manual/hourly refresh
        if (bustToday || cacheRead(`today-${base}-${target}`, REFRESH_INTERVAL_S) === null) {
            delete hist[allDates[0]];
            cacheWrite(`today-${base}-${target}`, true);
        }

        const missing = allDates.filter(d => hist[d] == null);
        if (missing.length > 0) {
            this._rateLabel.set_text('Updating…');
            try {
                Object.assign(hist, await fetchBatch(this._ext._session, missing, base, target));
                saveHist(base, target, hist);
            } catch (e) {
                if (e.message !== 'Request was cancelled.')
                    this._log.error(`fetchRates: ${e}`);
                this._rateLabel.set_text('Error');
                return;
            }
        }

        // Panel label
        const today     = allDates[0];
        const yesterday = dailyDates[1];
        const rate0 = hist[today], rate1 = hist[yesterday];
        if (rate0 == null) { this._rateLabel.set_text('No data'); return; }

        this._rateLabel.set_text(`${base.toUpperCase()}/${target.toUpperCase()}: ${rate0.toFixed(2)}`);
        if (rate1 != null) this._setDirection(rate0 - rate1);
        else               this._dirLabel.visible = this._diffLabel.visible = false;

        // Chart data — chronological, oldest first
        const chartData = allDates
            .filter(d => hist[d] != null)
            .map(d => ({ date: d, rate: hist[d] }))
            .reverse();
        this._chart.setData(chartData);
    }

    // ── Currency list (cached daily) ───────────────────────────────────────
    async _fetchCurrencyList(notify = true) {
        if (!notify && cacheRead('currency-list', CURRENCY_LIST_TTL_S)) return;
        if (notify) Main.notify('Currency Converter', 'Updating currency list…');
        try {
            const url  = 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies.min.json';
            const data = await fetchJSON(this._ext._session, url);
            saveJSON(`${this._ext.path}/currencies.min.json`, data);
            cacheWrite('currency-list', data);
            if (notify) Main.notify('Currency Converter', 'Currency list updated!');
            this._validateSettings(Object.keys(data));
        } catch (e) {
            this._log.error(`fetchCurrencyList: ${e}`);
            if (notify) Main.notify('Currency Converter', 'Failed to update currency list.');
        }
    }

    _validateSettings(valid) {
        const reset = (key, fallback) => {
            const v = this._settings.get_string(key);
            if (!valid.includes(v)) {
                Main.notify('Currency Converter', `${v.toUpperCase()} is no longer supported; reset.`);
                this._settings.set_string(key, fallback);
            }
        };
        reset('base-currency',   'usd');
        reset('target-currency', this._settings.get_string('base-currency') === 'usd' ? 'zar' : 'usd');
    }

    // ── Cleanup ────────────────────────────────────────────────────────────
    destroy() {
        if (this._rateTimer)  { GLib.source_remove(this._rateTimer);         this._rateTimer  = null; }
        if (this._listTimer)  { GLib.source_remove(this._listTimer);         this._listTimer  = null; }
        if (this._settingsId) { this._settings.disconnect(this._settingsId); this._settingsId = null; }
        super.destroy();
    }
});

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------
export default class CurrencyConverterExtension extends Extension {
    enable() {
        this._session   = new Soup.Session();
        this._indicator = new CurrencyIndicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator, -1, 'center');
    }
    disable() {
        this._session?.abort();     this._session   = null;
        this._indicator?.destroy(); this._indicator = null;
    }
}
