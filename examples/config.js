require.config({
	paths: {
		//plugin
		text: 'piece/js/vendor/requirejs-text/js/text',
		domReady: 'piece/js/vendor/requirejs-domready/js/domready',
		i18n: 'piece/js/vendor/requirejs-i18n/js/i18n',
		//lib
		zepto: 'piece/js/vendor/zepto/js/zepto',
		underscore: 'piece/js/vendor/underscore/js/underscore',
		backbone: 'piece/js/vendor/backbone/js/backbone',
		fastclick: 'piece/js/vendor/fastclick/js/fastclick',
		canvasloader: 'piece/js/components/canvasloader',
		iScroll: 'piece/js/vendor/iscroll/js/iscroll-lite',

		gmu: 'piece/js/components/gmu',

		//path
		vendor: 'piece/js/vendor',
		core: 'piece/js/core',
		components: 'piece/js/components'
	},
	waitSeconds: 30,
	shim: {
		backbone: {
			deps: ['underscore'],
			exports: 'Backbone'
		},
		iScroll: {
			exports: 'iScroll'
		},
		zepto: {
			exports: '$'
		},
		underscore: {
			exports: '_'
		},
		gmu: {
			deps: ['zepto']
		},
		fastclick: {
			exports: 'FastClick'
		}
	}
});