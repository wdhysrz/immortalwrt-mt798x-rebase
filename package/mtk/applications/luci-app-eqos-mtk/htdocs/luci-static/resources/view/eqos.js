'use strict';
'require form';
'require network';
'require tools.widgets as widgets';
'require uci';
'require view';

function collectHostChoices(hosts) {
	var choices = {
		ip: [],
		ip6: [],
		mac: []
	};

	for (var mac in hosts) {
		var ipaddrs = L.toArray(hosts[mac].ipaddrs || hosts[mac].ipv4);
		var ip6addrs = L.toArray(hosts[mac].ip6addrs || hosts[mac].ipv6);
		var name = hosts[mac].name;

		for (var i = 0; i < ipaddrs.length; i++)
			choices.ip.push([ ipaddrs[i], name ? '%s (%s)'.format(name, ipaddrs[i]) : ipaddrs[i] ]);

		for (var j = 0; j < ip6addrs.length; j++)
			choices.ip6.push([ ip6addrs[j], name ? '%s (%s)'.format(name, ip6addrs[j]) : ip6addrs[j] ]);

		var hint = name || ipaddrs[0] || ip6addrs[0];
		choices.mac.push([ mac, hint ? '%s (%s)'.format(mac, hint) : mac ]);
	}

	return choices;
}

function addChoices(option, choices) {
	for (var i = 0; i < choices.length; i++)
		option.value(choices[i][0], choices[i][1]);
}

function selectorValue(section_id) {
	var selector = uci.get('eqos', section_id, 'selector');

	if (selector === 'ip' || selector === 'ip6' || selector === 'mac')
		return selector;

	if (uci.get('eqos', section_id, 'ip6'))
		return 'ip6';

	if (uci.get('eqos', section_id, 'mac'))
		return 'mac';

	return 'ip';
}

function matchLabel(selector) {
	if (selector === 'ip6')
		return _('IPv6 address');

	if (selector === 'mac')
		return _('MAC address');

	return _('IPv4 address');
}

function matchValue(section_id) {
	var selector = selectorValue(section_id);

	return uci.get('eqos', section_id, selector) || '';
}

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('eqos'),
			network.getHostHints()
		]);
	},

	render: function(data) {
		var hosts = data[1] ? data[1].hosts || {} : {};
		var hostChoices = collectHostChoices(hosts);
		var queueTip = _('Slots 1-31 use HNAT HQoS; slots 32 and above use tc software shaping and require an IPv4 or IPv6 address.');
		var m, s, o;

		m = new form.Map('eqos', _('EQoS'),
			_('Network speed control service for MediaTek HNAT.'));

		s = m.section(form.NamedSection, 'config', 'eqos', _('Settings'));
		s.anonymous = true;

		o = s.option(form.Flag, 'enabled', _('Enable'));
		o.default = o.disabled;
		o.rmempty = false;

		o = s.option(widgets.DeviceSelect, 'dev', _('Controlled device'));
		o.default = 'br-lan';
		o.placeholder = 'br-lan';
		o.rmempty = false;

		o = s.option(form.Value, 'download', _('Download speed (Mbit/s)'),
			_('Total download bandwidth.'));
		o.datatype = 'and(uinteger,min(1))';
		o.rmempty = false;

		o = s.option(form.Value, 'upload', _('Upload speed (Mbit/s)'),
			_('Total upload bandwidth.'));
		o.datatype = 'and(uinteger,min(1))';
		o.rmempty = false;

		s = m.section(form.GridSection, 'device', _('Device rules'));
		s.addremove = true;
		s.anonymous = true;
		s.sortable = true;
		s.handleAdd = function(ev) {
			var section_id = uci.add('eqos', 'device');

			uci.set('eqos', section_id, 'enabled', '1');
			uci.set('eqos', section_id, 'selector', 'ip');
			m.addedSection = section_id;

			return this.renderMoreOptionsModal(section_id);
		};

		s.tab('general', _('General Settings'));

		o = s.taboption('general', form.Flag, 'enabled', _('Enable'));
		o.default = o.enabled;
		o.rmempty = false;
		o.editable = true;

		o = s.taboption('general', form.Value, 'queue', _('Name'));
		o.datatype = 'and(uinteger,min(1),max(65535))';
		o.placeholder = '1';
		o.rmempty = false;
		o.editable = true;
		o.renderWidget = function(section_id, option_index, cfgvalue) {
			var node = form.Value.prototype.renderWidget.apply(this, arguments);
			var input = node.querySelector('input') || node;

			input.setAttribute('data-tooltip', queueTip);
			input.setAttribute('title', queueTip);

			return node;
		};
		o.validate = function(section_id, value) {
			var rv = form.Value.prototype.validate.apply(this, arguments);
			var sections = uci.sections('eqos', 'device');

			if (rv !== true)
				return rv;

			for (var i = 0; i < sections.length; i++) {
				if (sections[i]['.name'] === section_id)
					continue;

				if (uci.get('eqos', sections[i]['.name'], 'enabled') === '0')
					continue;

				if ((uci.get('eqos', sections[i]['.name'], 'queue') ||
				     uci.get('eqos', sections[i]['.name'], 'comment')) === value)
					return _('Name already exists.');
			}

			return true;
		};

		o = s.option(form.DummyValue, '_match', _('Match'));
		o.textvalue = function(section_id) {
			var selector = selectorValue(section_id);
			var value = matchValue(section_id);

			return value ? '%s: %s'.format(matchLabel(selector), value) : E('em', _('unspecified'));
		};

		o = s.taboption('general', form.Value, 'download', _('Download speed (kbit/s)'));
		o.datatype = 'and(uinteger,min(0))';
		o.rmempty = false;
		o.editable = true;

		o = s.taboption('general', form.Value, 'upload', _('Upload speed (kbit/s)'));
		o.datatype = 'and(uinteger,min(0))';
		o.rmempty = false;
		o.editable = true;

		o = s.taboption('general', form.ListValue, 'selector', _('Type'));
		o.modalonly = true;
		o.default = 'ip';
		o.rmempty = false;
		o.value('ip', _('IPv4 address'));
		o.value('ip6', _('IPv6 address'));
		o.value('mac', _('MAC address'));
		o.cfgvalue = function(section_id) {
			return selectorValue(section_id);
		};
		o.write = function(section_id, value) {
			uci.set('eqos', section_id, 'selector', value);

			if (value !== 'ip')
				uci.unset('eqos', section_id, 'ip');

			if (value !== 'ip6')
				uci.unset('eqos', section_id, 'ip6');

			if (value !== 'mac')
				uci.unset('eqos', section_id, 'mac');
		};

		o = s.taboption('general', form.Value, 'ip', _('IPv4 address'));
		o.modalonly = true;
		o.datatype = 'ip4addr("nomask")';
		o.placeholder = '192.0.2.100';
		o.rmempty = false;
		o.depends('selector', 'ip');
		addChoices(o, hostChoices.ip);

		o = s.taboption('general', form.Value, 'ip6', _('IPv6 address'));
		o.modalonly = true;
		o.datatype = 'ip6addr("nomask")';
		o.placeholder = '2001:db8::100';
		o.rmempty = false;
		o.depends('selector', 'ip6');
		addChoices(o, hostChoices.ip6);

		o = s.taboption('general', form.Value, 'mac', _('MAC address'));
		o.modalonly = true;
		o.datatype = 'macaddr';
		o.placeholder = '00:11:22:33:44:55';
		o.rmempty = false;
		o.depends('selector', 'mac');
		addChoices(o, hostChoices.mac);

		return m.render();
	}
});
