import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Gio from 'gi://Gio';
import UPower from 'gi://UPowerGlib';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { Indicator } from './indicator.js'

const xml = '<node>\
   <interface name="org.freedesktop.UPower.Device">\
      <property name="Type" type="u" access="read" />\
      <property name="State" type="u" access="read" />\
      <property name="Percentage" type="d" access="read" />\
      <property name="TimeToEmpty" type="x" access="read" />\
      <property name="TimeToFull" type="x" access="read" />\
      <property name="IsPresent" type="b" access="read" />\
      <property name="IconName" type="s" access="read" />\
   </interface>\
</node>';
const PowerManagerProxy = Gio.DBusProxy.makeProxyWrapper(xml);
const BUS_NAME = 'org.freedesktop.UPower';


const Log = function (msg) {
	if (true) {
		log('[upower-battery] ' + msg);
	}
}

const LogError = function (msg) {
	log('[upower-battery] ' + msg);
}

export default class UPowerExtension extends Extension {
	constructor(meta) {
		super(meta);
		const proxy = new PowerManagerProxy(
			Gio.DBus.system,
			BUS_NAME,
			'/org/freedesktop/UPower');
		this._dbusCon = proxy.get_connection();
	}

	enable() {
		Log('Enable');
		this._indicator = new Indicator();
		this._proxies = {};
		Main.panel.addToStatusArea(this._uuid, this._indicator, 3, 'right');

		const iname = 'org.freedesktop.UPower';
		const sender = 'org.freedesktop.UPower';
		this._subIdAdd = this._dbusCon.signal_subscribe(sender, iname, 'DeviceAdded', null, null, 0, () => {
			Log('Device added')
			this._refresh();
		});
		this._subIdRem = this._dbusCon.signal_subscribe(sender, iname, 'DeviceRemoved', null, null, 0, () => {
			Log('Device removed')
			this._refresh();
		});
		this.timeout_handle = setTimeout(() => {
			this._refresh();
			return false;
		}, 10);
	}

	_refresh() {
		const devices = this._findDevices();
		devices.forEach((device, index) => {
			try {
				device.udevice.refresh_sync(null);
			} catch (error) {
				LogError('Error ' + error)
			}
		});
		this._update();
	}

	_update() {
		const devices = this._findDevices();
		this._indicator.refresh(devices);
		devices.forEach((device, index) => {
			this._indicator.setLabel(device.name, device.udevice.percentage, index);
		});
	}

	_findDevices() {
		Log('Finding devices');
		const icons = {};
		icons[UPower.DeviceKind.MOUSE] = { icon: 'input-mouse-symbolic' };
		icons[UPower.DeviceKind.KEYBOARD] = { icon: 'input-keyboard-symbolic' };
		icons[UPower.DeviceKind.GAMING_INPUT] = { icon: 'input-gaming-symbolic' };
		icons[UPower.DeviceKind.TOUCHPAD] = { icon: 'input-touchpad-symbolic' };
		icons[UPower.DeviceKind.HEADSET] = { icon: 'audio-headphones-symbolic' };
		icons[UPower.DeviceKind.HEADPHONES] = { icon: 'audio-headphones-symbolic' };
		const devices = [];
		const upowerClient = UPower.Client.new_full(null);
		const udevices = upowerClient.get_devices();
		const newProxies = {}
		for (let i = 0; i < udevices.length; i++) {
			const udevice = udevices[i];
			if (udevice.kind in icons) {
				if (udevice.state != UPower.DeviceState.UNKNOWN || udevice.native_path.includes("bluez")) {
					let kind = udevice.kind;
					if (udevice.model == 'MX Master 3S') {
						kind = UPower.DeviceKind.MOUSE;
					}
					const icon = icons[kind];
					Log('Found device: ' + icon.icon + ' | ' + udevice.native_path + ' | ' + kind + " | " + udevice.model);
					devices.push({
						name: udevice.model,
						path: udevice.native_path,
						icon: icon.icon,
						udevice: udevice,
					});
				}
				if (udevice.native_path in this._proxies) {
					newProxies[udevice.native_path] = this._proxies[udevice.native_path];
				} else {
					const proxy = new PowerManagerProxy(Gio.DBus.system,
						BUS_NAME,
						udevice.get_object_path()
					);
					proxy.connect('g-properties-changed', () => {
						Log('Property changed for ' + udevice.model);
						this._update();
					});
					newProxies[udevice.native_path] = proxy;
				}
			}
		}
		this._proxies = newProxies;
		devices.sort((a, b) => (a.name > b.name) ? 1 : ((b.name > a.name) ? -1 : ((a.native_path > b.native_path) ? 1 : -1)));
		return devices;
	}

	disable() {
		Log('Disable');
		this._dbusCon.signal_unsubscribe(this._indicator.subIdAdd);
		this._dbusCon.signal_unsubscribe(this._indicator.subIdRem);
		this._proxies = {};
		if (this._indicator) {
			this._indicator.destroy();
			this._indicator = null;
		}
		if (this.timeout_handle) {
			clearTimeout(this.timeout_handle);
			this.timeout_handle = null;
		}
	}
}
