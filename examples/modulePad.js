define(function(require) {
	var v1 = require('com.foss.bb/listViewPad'),
		v2 = require('com.foss.bb/detailView');
	return {
		'default': v1,
		'listView': v1,
		'detailView': v2
	};
});