//defaultConfig
var defaultConfig = {
	loadFrom: "root",
	defaultModule: null,
	defaultView: null,
	loadMode: "view",
	enablePad: false,
	hideAddressBar: true
};

var pieceConfig;

if (typeof(pieceConfig) === "undefined") {
	pieceConfig = new Object();
}

//如果没有自定义，或者定义了但是不是module，那么默认是从根目录进入
if (pieceConfig.loadFrom !== "module") {
	require.config({
		baseUrl: '.',
	});
} else {
	require.config({
		baseUrl: '../',
	});
}

require.config({
	paths: {
		//plugin
		text: 'src/vendor/requirejs-text/js/text',
		domReady: 'src/vendor/requirejs-domready/js/domready',
		i18n: 'src/vendor/requirejs-i18n/js/i18n',
		//lib
		zepto: 'src/vendor/zepto/js/zepto',
		underscore: 'src/vendor/underscore/js/underscore',
		backbone: 'src/vendor/backbone/js/backbone',
		fastclick: 'src/vendor/fastclick/js/fastclick',

		//path
		vendor: 'src/vendor',
		core: 'src/core'
	},
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
		fastclick: {
			exports: 'FastClick'
		}
	}
});

//设置默认语言
if (window.localStorage['lang'] === undefined) window.localStorage['lang'] = "zh-cn";
requirejs.config({
	config: {
		i18n: {
			locale: window.localStorage['lang']
		}
	}
});
(function() {
	require(['zepto', "underscore", "backbone", "fastclick", "text", "i18n", "core/app"],
		function($, _, Backbone, FastClick, text, i18n, App) {
			pieceConfig = _.extend(defaultConfig, pieceConfig);
			FastClick.attach(document.body);
			App.initialize();
		});
})();