# Currency Conversion Rate for GNOME Shell

![GNOME Shell Versions](https://img.shields.io/badge/GNOME%20Shell-45+-blue.svg)
![License](https://img.shields.io/badge/License-GPLv3-blue.svg)

A simple and elegant GNOME Shell extension that displays real-time currency conversion rates directly on your top panel.


![Extension Screenshot 1](screenshots/img_1.png)

## Features

*   **Real-time Rate Display**: See the latest conversion rate for your chosen currency pair in the GNOME top panel.
*   **Daily Change Indicator**: A visual icon (▲, ▼, or ―) shows you if the rate has gone up, down, or stayed the same since yesterday.
*   **Historical Data Chart**: A simple text-based line chart in the dropdown menu visualizes the rate trend over the last 10 days.
*   **Customizable Currencies**: Use the preferences window to select any base and target currency from a comprehensive list.
*   **Manual Refresh**: Instantly fetch the latest rates with a "Refresh" button in the menu and update the currency list.
*   **Resilient Design**: Works reliably using standard, legacy-compatible GNOME Shell features for maximum stability.

## Installation

### From the GNOME Extensions Website (Recommended)

The easiest way to install is from the official GNOME Extensions website.

1.  Go to the Currency Conversion Rate page on extensions.gnome.org *(TBD - This link will be active once published)*.
2.  Click the "ON/OFF" switch.
3.  Click "Install" in the pop-up dialog.

### Manual Installation from Source

If you prefer to install from the source code:

1. Clone this repository:
```bash
git clone https://github.com/binary-smith/currency-conversion-rate.git
```
2. Copy the extension to GNOME extensions directory:
```bash
cp -r currency-conversion-rate ~/.local/share/gnome-shell/extensions/currency-conversion-rate@optimus
```
3. Restart GNOME Shell (X11):
    - Press Alt+F2
    - Type 'r' and press Enter
4. If you are on Wayland, logout and log back in
5. Enable the extension using GNOME Extensions app or GNOME Tweaks

## Configuration
1. Click the currency indicator on your top panel. 
2. Select Preferences… from the dropdown menu.
3. In the preferences window, choose your desired Base Currency and Target Currency.
4. The changes will be applied instantly.

## Supported list of currencies, which can be paired

- Refer - https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies.min.json

## License

- This project is licensed under the GPL-3.0 License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- This extension uses the free currency-api by fawazahmed0 for exchange rate data - https://github.com/fawazahmed0/exchange-api
- Also inspired by an existing GNOME extension - https://github.com/faymaz/currency-tracker

