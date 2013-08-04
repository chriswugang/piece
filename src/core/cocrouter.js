define(['require', 'backbone', 'core/mainview'],
	function(require, Backbone, MainView) {
		//a CoC router
		var CoCRouter = Backbone.Router.extend({

			urls: [],
			//排前面优先？
			routes: {
				//eg: index.html
				'': 'index',
				//eg: index.html#com.foss.demo/listView
				"*module/*page(?t=:timestamp)": "modularRoute",
				//eg: index.html#listView
				"*page(?t=:timestamp)": "pageRoute"
			},

			initialize: function(options) {
				var me = this;
				this.delegate = options.delegate;
				this.loadMode = pieceConfig.loadMode;
				this.defaultModule = pieceConfig.defaultModule;
				this.defaultView = pieceConfig.defaultView;
				this.enablePad = pieceConfig.enablePad;
			},

			index: function() {
				this.modularRoute(this.defaultModule, this.defaultView);
			},

			_loadViewByApp: function(module, view, success, fail) {
				require([module + '/' + view], function(ViewClass) {
					var v = new ViewClass();
					v.module = module;
					success(v);
				}, function(err) {
					fail(err);
				});
			},

			_loadViewByModule: function(module, moduleName, view, success, fail) {
				require([module + "/" + moduleName], function(Module) {
					var ViewClass;
					if (view === null || view === '') {
						ViewClass = Module['default'];
					} else {
						ViewClass = Module[view];
					}

					var v = new ViewClass();
					v.module = module;

					success(v);

				}, function(err) {
					fail(err);
				});
			},


			_loadViewByView: function(module, view, success, fail) {
				require([module + '/' + view], function(ViewClass) {
					var v = new ViewClass();
					v.module = module;
					success(v);
				}, function(err) {
					fail(err);
				});
			},

			modularRoute: function(module, view, timestamp) {

				console.info("cube---cocrouter---modularRoute--" + module + '/' + view + '/' + timestamp);

				var me = this;

				var viewLoaded;

				var moduleName;


				function success(viewInstance) {
					if (viewInstance.type == 'portal') {
						viewInstance.render();
					} else {
						//只是采用changePage
						me.delegate.changePage(viewInstance, module);
					}
				}

				function fail(err) {
					// var failedId = err.requireModules && err.requireModules[0];
					console.log("cube---cocrouter---load fail: " + err.message);
				}

				switch (this.loadMode) {
					case 'app':
						throw new Error('app scope router not implement yet');
					case 'module':
						console.info("cube---cocrouter---load by module");
						//判断是否开启pad页面
						if (this.enablePad === "true") {
							console.info("cube---cocrouter---enablePad === true");
							viewLoaded = require.defined(module + "/module");
							moduleName = "module";
						} else {
							viewLoaded = require.defined(module + "/module");
							moduleName = "module";

							if (!viewLoaded) {
								//TODO: show loading

							}
						}


						this._loadViewByModule(module, moduleName, view, success, fail);
						break;
					case 'view':
						console.info("cube---cocrouter---load by view");
						var viewLoaded = require.defined(module + "/" + view);
						if (!viewLoaded) {

						}

						this._loadViewByView(module, view, success, fail);
						break;
					default:
						throw new Error('missing loadMode');
				}
			},

			pageRoute: function(page, timestamp) {
				console.log('page route to:' + page);
			}

		});

		return CoCRouter;
	});