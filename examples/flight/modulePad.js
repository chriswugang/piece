define(function(require) {
	var v1 = require('flight/listViewPad'),
		v2 = require('flight/detailView');
	return {
		'default': v1,
		'listView': v1,
		'detailView': v2
	};
});