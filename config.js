require.config({
	paths: {
		//plugin
		text: 'src/js/vendor/requirejs-text/js/text',
		domReady: 'src/js/vendor/requirejs-domready/js/domready',
		i18n: 'src/js/vendor/requirejs-i18n/js/i18n',
		//lib
		zepto: 'src/js/vendor/zepto/js/zepto',
		underscore: 'src/js/vendor/underscore/js/underscore',
		backbone: 'src/js/vendor/backbone/js/backbone',
		fastclick: 'src/js/vendor/fastclick/js/fastclick',
		canvasloader: 'src/js/components/canvasloader',

		gmu: 'src/js/components/gmu',

		//path
		vendor: 'src/js/vendor',
		core: 'src/js/core',
		components: 'src/js/components'
	},
	waitSeconds: 30,
	shim: {
		backbone: {
			deps: ['underscore'],
			exports: 'Backbone'
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