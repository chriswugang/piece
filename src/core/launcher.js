require(['src/vendor/zepto/js/zepto'],
	function($) {
		console.info("===");
	});



// //init require js
// require.config({
// 	baseUrl: '../',
// 	paths: {
// 		//plugin
// 		text: 'vendor/requirejs-text/js/text',
// 		domReady: 'vendor/requirejs-domready/js/domready',
// 		i18n: 'vendor/requirejs-i18n/js/i18n',
// 		//lib
// 		zepto: 'vendor/zepto/js/zepto',
// 		underscore: 'vendor/underscore/js/underscore',
// 		backbone: 'vendor/backbone/js/backbone',
// 		//path
// 		vendor: 'vendor'
// 	},
// 	shim: {
// 		backbone: {
// 			deps: ['underscore']
// 		},
// 		zepto: {
// 			exports: '$'
// 		}
// 	}
// });
// //i18n
// if (window.localStorage['lang'] === undefined) window.localStorage['lang'] = "zh-cn";
// requirejs.config({
// 	config: {
// 		i18n: {
// 			locale: window.localStorage['lang']
// 		}
// 	}
// });
// (function() {

// 	var launcher = document.querySelector("meta[name='launcher']");
// 	var hideAddressBar = launcher.getAttribute('hideAddressBar') == 'true';
// 	var preventTouchMove = launcher.getAttribute('preventTouchMove') == 'true';
// 	var enablePhoneGap = launcher.getAttribute('enablePhoneGap') == 'true';

// 	var defaultModule = launcher.getAttribute('defaultModule');
// 	var defaultView = launcher.getAttribute('defaultView');
// 	var loadMode = launcher.getAttribute('loadMode');

// 	var enablePad = launcher.getAttribute('enablePad');

// 	//load phonegap js
// 	if (enablePhoneGap) {
// 		var phonegapjs = document.createElement('script');
// 		phonegapjs.setAttribute('type', 'text/javascript');
// 		phonegapjs.setAttribute('src', '../cordova.js');
// 		document.head.appendChild(phonegapjs);
// 	}
// 	require(['domReady', 'zepto'],
// 		function(domReady, $) {
// 			alert("...");


// 		});

// })();