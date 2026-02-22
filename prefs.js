import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const CurrencyPrefsPage = GObject.registerClass(
class CurrencyPrefsPage extends Adw.PreferencesPage {
    _init(settings, path) {
        super._init({ title: 'Currency Settings', icon_name: 'dialog-information-symbolic' });
        this._settings = settings;

        const group = new Adw.PreferencesGroup({
            title: 'Currency Pair',
            description: 'Choose the base and target currencies',
        });
        this.add(group);

        this._baseRow   = new Adw.ComboRow({ title: 'Base Currency',   subtitle: 'e.g. USD' });
        this._targetRow = new Adw.ComboRow({ title: 'Target Currency', subtitle: 'e.g. ZAR' });
        group.add(this._baseRow);
        group.add(this._targetRow);

        this._loadCurrencies(path);
    }

    _loadCurrencies(path) {
        try {
            const file = Gio.File.new_for_path(`${path}/currencies.min.json`);
            const [ok, bytes] = file.load_contents(null);
            if (!ok) throw new Error('Failed to read currencies.min.json');

            const keys     = Object.keys(JSON.parse(new TextDecoder().decode(bytes))).sort();
            const model    = Gtk.StringList.new(keys.map(c => c.toUpperCase()));
            const idxOf    = k => keys.indexOf(this._settings.get_string(k));
            const bindRow  = (row, key) => {
                row.set_model(model);
                const i = idxOf(key);
                if (i >= 0) row.set_selected(i);
                row.connect('notify::selected', () => {
                    const sel = keys[row.get_selected()];
                    if (sel) this._settings.set_string(key, sel);
                });
            };

            bindRow(this._baseRow,   'base-currency');
            bindRow(this._targetRow, 'target-currency');
        } catch (e) {
            console.error(`[CurrencyConverter] prefs: ${e}`);
            [this._baseRow, this._targetRow].forEach(r => {
                r.set_sensitive(false);
                r.set_subtitle('Failed to load currency list — reinstall the extension.');
            });
        }
    }
});

export default class CurrencyConverterPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        window.add(new CurrencyPrefsPage(this.getSettings(), this.path));
    }
}
