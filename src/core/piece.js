/*! piece.js 1.0.1 | piecejs.org/LICENSE.md
 */

var Piece;
//defaultConfig
var defaultConfig = {
	loadFrom: "module",
	defaultModule: null,
	defaultView: null,
	loadMode: "view",
	enablePad: false,
	hideAddressBar: true,
	enablePhoneGap: false,
	preventTouchMove: false
};

var pieceConfig;

if (typeof(pieceConfig) === "undefined") {
	pieceConfig = new Object();
}

if (pieceConfig.enablePhoneGap === undefined) {
	pieceConfig.enablePhoneGap = false;
}

//如果没有自定义，或者定义了但是不是module，那么默认是从根目录进入
if (pieceConfig.loadFrom === "root") {
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
		canvasloader: 'src/components/canvasloader',

		gmu: 'src/components/gmu',

		//path
		vendor: 'src/vendor',
		core: 'src/core',
		components: 'src/components'
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
		gmu: {
			deps: ['zepto']
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
	//load phonegap js
	if (pieceConfig.enablePhoneGap) {
		var phonegapjs = document.createElement('script');
		phonegapjs.setAttribute('type', 'text/javascript');
		phonegapjs.setAttribute('src', '../cordova.js');
		document.head.appendChild(phonegapjs);
	}
	require(['zepto', "underscore", "backbone", "fastclick", "text", "i18n", "core/app", "components/components"],
		function($, _, Backbone, FastClick, text, i18n, App, Components) {
			Piece = Components;
			pieceConfig = _.extend(defaultConfig, pieceConfig);
			FastClick.attach(document.body);
			//hide address bar
			if (pieceConfig.hideAddressBar) setTimeout(function() {
				window.scrollTo(0, 1);
			}, 0);
			if (pieceConfig.preventTouchMove) document.addEventListener('touchmove', function(e) {
				e.preventDefault();
			}, false);

			function onDeviceReady(desktop) {

				// Hiding splash screen when app is loaded
				window.isDesktop = desktop;

				App.initialize();

				$('html').css('min-height', window.screen.availHeight - 44 + "px");
				// $('html').css('min-height', window.innerHeight);

			}

			if (pieceConfig.enablePhoneGap && navigator.userAgent.match(/(iPad|iPhone|Android)/)) {
				// This is running on a device so waiting for deviceready event
				document.addEventListener('deviceready', onDeviceReady, false);

			} else {
				// On desktop don't have to wait for anything
				onDeviceReady(true);
			}
			// }); //domReady
		});
})();