import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const CurrencyPrefsPage = GObject.registerClass(
    class CurrencyPrefsPage extends Adw.PreferencesPage {
        _init(settings, path) {
            super._init({
                title: 'Currency Settings',
                icon_name: 'dialog-information-symbolic',
            });

            this._settings = settings;
            this._path = path;

            const group = new Adw.PreferencesGroup({
                title: 'Currency Selection',
                description: 'Choose your base and target currencies',
            });
            this.add(group);

            this._baseRow = new Adw.ComboRow({
                title: 'Base Currency',
                subtitle: 'E.g. USD',
            });
            group.add(this._baseRow);

            this._targetRow = new Adw.ComboRow({
                title: 'Target Currency',
                subtitle: 'E.g. EUR',
            });
            group.add(this._targetRow);

            // Load currencies from the local file.
            this._loadCurrencies();
        }

        _loadCurrencies() {
            try {
                // Construct the path to the bundled JSON file.
                const file = Gio.File.new_for_path(`${this._path}/currencies.min.json`);
                const [ok, contents] = file.load_contents(null);

                if (!ok) {
                    throw new Error('Failed to load currencies.min.json from extension path.');
                }

                const decoder = new TextDecoder('utf-8');
                const data = JSON.parse(decoder.decode(contents));

                // The keys from the JSON are lowercase (e.g., 'usd')
                const currencies = Object.keys(data).sort();
                // We display them in uppercase for readability (e.g., 'USD')
                const model = Gtk.StringList.new(currencies.map(c => c.toUpperCase()));

                this._baseRow.set_model(model);
                this._targetRow.set_model(model);

                const currentBase = this._settings.get_string('base-currency');
                const currentTarget = this._settings.get_string('target-currency');

                // Find the index by searching the lowercase list.
                const baseIndex = currencies.indexOf(currentBase);
                if (baseIndex >= 0) this._baseRow.set_selected(baseIndex);

                const targetIndex = currencies.indexOf(currentTarget);
                if (targetIndex >= 0) this._targetRow.set_selected(targetIndex);

                this._baseRow.connect('notify::selected', () => {
                    const selected = currencies[this._baseRow.get_selected()];
                    // The API expects lowercase, so we save the original key.
                    if (selected) this._settings.set_string('base-currency', selected);
                });

                this._targetRow.connect('notify::selected', () => {
                    const selected = currencies[this._targetRow.get_selected()];
                    if (selected) this._settings.set_string('target-currency', selected);
                });

            } catch (error) {
                console.error(`[CurrencyConverter] Failed to load currencies: ${error}`);
                this._baseRow.set_sensitive(false);
                this._targetRow.set_sensitive(false);
                this._baseRow.set_subtitle('Failed to load currency list from file.');
                this._targetRow.set_subtitle('The extension might be corrupt.');
            }
        }
    }
);

export default class CurrencyConverterPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        // Use the built-in getSettings() and pass the extension path to the page.
        const page = new CurrencyPrefsPage(this.getSettings(), this.path);
        window.add(page);
    }
}