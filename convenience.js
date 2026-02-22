import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup';

/**
 * Atomically write a JS object as JSON to `path`.
 */
export function saveJSON(path, data) {
    const file = Gio.File.new_for_path(path);
    file.replace_contents(
        JSON.stringify(data, null, 2),
        null, false,
        Gio.FileCreateFlags.REPLACE_DESTINATION,
        null
    );
}

/**
 * Fetch `url` via `session` and return the parsed JSON.
 * Rejects with a descriptive Error on network or HTTP failure.
 */
export function fetchJSON(session, url) {
    const msg = Soup.Message.new('GET', url);
    return new Promise((resolve, reject) => {
        session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null, (s, result) => {
            if (msg.get_status() === Soup.Status.CANCELLED) {
                reject(new Error('Request was cancelled.'));
                return;
            }
            try {
                const bytes = s.send_and_read_finish(result);
                if (msg.get_status() !== Soup.Status.OK)
                    throw new Error(`HTTP ${msg.get_status()} for ${url}`);
                if (!bytes?.get_size())
                    throw new Error(`Empty response from ${url}`);
                resolve(JSON.parse(new TextDecoder().decode(bytes.get_data())));
            } catch (e) {
                reject(e);
            }
        });
    });
}
