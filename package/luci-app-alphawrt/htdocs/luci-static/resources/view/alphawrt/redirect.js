'use strict';
'require view';

/* Old Basic bookmarks (/cgi-bin/luci/basic/<page>): the pages moved to the
 * Simple UI at /, which uses the same names except Quick Setup. */

return view.extend({
	render() {
		const page = L.env.requestpath[1] || 'home';
		location.replace('/#/' + (page == 'quicksetup' ? 'setup' : page));
		return E('p', {}, E('a', { 'href': '/' }, _('Open the simple pages')));
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
