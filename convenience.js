import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup';

/**
 * Saves a JavaScript object to a file as a JSON string.
 * @param {string} path The full path to the file.
 * @param {object} data The JavaScript object to save.
 */
export function saveJSON(path, data) {
    try {
        const file = Gio.File.new_for_path(path);
        const jsonString = JSON.stringify(data, null, 2); // Pretty-print JSON
        // Use replace_contents for an atomic write operation
        file.replace_contents(
            jsonString,
            null,
            false,
            Gio.FileCreateFlags.REPLACE_DESTINATION,
            null
        );
    } catch (e) {
        throw new Error(`Failed to save JSON to ${path}: ${e.message}`);
    }
}

/**
 * Performs an asynchronous network request and returns the parsed JSON.
 * @param {Soup.Session} session The Soup.Session to use for the request.
 * @param {string} url The URL to fetch.
 * @returns {Promise<object>} A promise that resolves with the parsed JSON object.
 */
export function fetchJSON(session, url) {
    const message = Soup.Message.new('GET', url);

    return new Promise((resolve, reject) => {
        session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (session, result) => {
            if (message.get_status() === Soup.Status.CANCELLED) {
                reject(new Error('Request was cancelled.'));
                return;
            }

            try {
                const bytes = session.send_and_read_finish(result);

                if (message.get_status() !== Soup.Status.OK) {
                    reject(new Error(`HTTP error! status: ${message.get_status()}`));
                    return;
                }

                if (!bytes || bytes.get_size() === 0) {
                    reject(new Error('Empty response'));
                    return;
                }

                const decoder = new TextDecoder('utf-8');
                const response = decoder.decode(bytes.get_data());
                resolve(JSON.parse(response));
            } catch (e) {
                reject(e);
            }
        });
    });
}