define(function(require) {
	var v1 = require('examples/listView'),
		v2 = require('examples/detailView');
	return {
		'default': v1,
		'listView': v1,
		'detailView': v2
	};
});