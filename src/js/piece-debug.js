/*! piece.js 1.0.1 | piecejs.org/LICENSE.md
 */

var Piece;
//pieceDefaultConfig
var pieceDefaultConfig = {
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

	//navigation api(web), will be replace 
	window.Navigation = window.navigation || {};
	window.Navigation.navigate = function(fragment, options) {
		options = options || {trigger: true};
		Backbone.history.navigate(fragment, options);
	};
	//delegate to window.location
	window.Navigation.href = function(href) {
		window.location.href = href;
		//TODO: open new tab/window mode?
	};
	//delegate to backbone history navigate
	window.Navigation.backboneNavigate = function(fragment, options) {
		options = options || {trigger: true};
		Backbone.history.navigate(fragment, opti ons);
	};

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
			pieceConfig = _.extend(pieceDefaultConfig, pieceConfig);
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

				// $('html').css('min-height', window.screen.availHeight - 44 + "px");
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