/** vim: et:ts=4:sw=4:sts=4
 * @license RequireJS 2.1.8 Copyright (c) 2010-2012, The Dojo Foundation All Rights Reserved.
 * Available via the MIT or new BSD license.
 * see: http://github.com/jrburke/requirejs for details
 */
//Not using strict: uneven strict support in browsers, #392, and causes
//problems with requirejs.exec()/transpiler plugins that may not be strict.
/*jslint regexp: true, nomen: true, sloppy: true */
/*global window, navigator, document, importScripts, setTimeout, opera */

var requirejs, require, define;
(function (global) {
    var req, s, head, baseElement, dataMain, src,
        interactiveScript, currentlyAddingScript, mainScript, subPath,
        version = '2.1.8',
        commentRegExp = /(\/\*([\s\S]*?)\*\/|([^:]|^)\/\/(.*)$)/mg,
        cjsRequireRegExp = /[^.]\s*require\s*\(\s*["']([^'"\s]+)["']\s*\)/g,
        jsSuffixRegExp = /\.js$/,
        currDirRegExp = /^\.\//,
        op = Object.prototype,
        ostring = op.toString,
        hasOwn = op.hasOwnProperty,
        ap = Array.prototype,
        apsp = ap.splice,
        isBrowser = !!(typeof window !== 'undefined' && navigator && window.document),
        isWebWorker = !isBrowser && typeof importScripts !== 'undefined',
        //PS3 indicates loaded and complete, but need to wait for complete
        //specifically. Sequence is 'loading', 'loaded', execution,
        // then 'complete'. The UA check is unfortunate, but not sure how
        //to feature test w/o causing perf issues.
        readyRegExp = isBrowser && navigator.platform === 'PLAYSTATION 3' ?
                      /^complete$/ : /^(complete|loaded)$/,
        defContextName = '_',
        //Oh the tragedy, detecting opera. See the usage of isOpera for reason.
        isOpera = typeof opera !== 'undefined' && opera.toString() === '[object Opera]',
        contexts = {},
        cfg = {},
        globalDefQueue = [],
        useInteractive = false;

    function isFunction(it) {
        return ostring.call(it) === '[object Function]';
    }

    function isArray(it) {
        return ostring.call(it) === '[object Array]';
    }

    /**
     * Helper function for iterating over an array. If the func returns
     * a true value, it will break out of the loop.
     */
    function each(ary, func) {
        if (ary) {
            var i;
            for (i = 0; i < ary.length; i += 1) {
                if (ary[i] && func(ary[i], i, ary)) {
                    break;
                }
            }
        }
    }

    /**
     * Helper function for iterating over an array backwards. If the func
     * returns a true value, it will break out of the loop.
     */
    function eachReverse(ary, func) {
        if (ary) {
            var i;
            for (i = ary.length - 1; i > -1; i -= 1) {
                if (ary[i] && func(ary[i], i, ary)) {
                    break;
                }
            }
        }
    }

    function hasProp(obj, prop) {
        return hasOwn.call(obj, prop);
    }

    function getOwn(obj, prop) {
        return hasProp(obj, prop) && obj[prop];
    }

    /**
     * Cycles over properties in an object and calls a function for each
     * property value. If the function returns a truthy value, then the
     * iteration is stopped.
     */
    function eachProp(obj, func) {
        var prop;
        for (prop in obj) {
            if (hasProp(obj, prop)) {
                if (func(obj[prop], prop)) {
                    break;
                }
            }
        }
    }

    /**
     * Simple function to mix in properties from source into target,
     * but only if target does not already have a property of the same name.
     */
    function mixin(target, source, force, deepStringMixin) {
        if (source) {
            eachProp(source, function (value, prop) {
                if (force || !hasProp(target, prop)) {
                    if (deepStringMixin && typeof value !== 'string') {
                        if (!target[prop]) {
                            target[prop] = {};
                        }
                        mixin(target[prop], value, force, deepStringMixin);
                    } else {
                        target[prop] = value;
                    }
                }
            });
        }
        return target;
    }

    //Similar to Function.prototype.bind, but the 'this' object is specified
    //first, since it is easier to read/figure out what 'this' will be.
    function bind(obj, fn) {
        return function () {
            return fn.apply(obj, arguments);
        };
    }

    function scripts() {
        return document.getElementsByTagName('script');
    }

    function defaultOnError(err) {
        throw err;
    }

    //Allow getting a global that expressed in
    //dot notation, like 'a.b.c'.
    function getGlobal(value) {
        if (!value) {
            return value;
        }
        var g = global;
        each(value.split('.'), function (part) {
            g = g[part];
        });
        return g;
    }

    /**
     * Constructs an error with a pointer to an URL with more information.
     * @param {String} id the error ID that maps to an ID on a web page.
     * @param {String} message human readable error.
     * @param {Error} [err] the original error, if there is one.
     *
     * @returns {Error}
     */
    function makeError(id, msg, err, requireModules) {
        var e = new Error(msg + '\nhttp://requirejs.org/docs/errors.html#' + id);
        e.requireType = id;
        e.requireModules = requireModules;
        if (err) {
            e.originalError = err;
        }
        return e;
    }

    if (typeof define !== 'undefined') {
        //If a define is already in play via another AMD loader,
        //do not overwrite.
        return;
    }

    if (typeof requirejs !== 'undefined') {
        if (isFunction(requirejs)) {
            //Do not overwrite and existing requirejs instance.
            return;
        }
        cfg = requirejs;
        requirejs = undefined;
    }

    //Allow for a require config object
    if (typeof require !== 'undefined' && !isFunction(require)) {
        //assume it is a config object.
        cfg = require;
        require = undefined;
    }

    function newContext(contextName) {
        var inCheckLoaded, Module, context, handlers,
            checkLoadedTimeoutId,
            config = {
                //Defaults. Do not set a default for map
                //config to speed up normalize(), which
                //will run faster if there is no default.
                waitSeconds: 7,
                baseUrl: './',
                paths: {},
                pkgs: {},
                shim: {},
                config: {}
            },
            registry = {},
            //registry of just enabled modules, to speed
            //cycle breaking code when lots of modules
            //are registered, but not activated.
            enabledRegistry = {},
            undefEvents = {},
            defQueue = [],
            defined = {},
            urlFetched = {},
            requireCounter = 1,
            unnormalizedCounter = 1;

        /**
         * Trims the . and .. from an array of path segments.
         * It will keep a leading path segment if a .. will become
         * the first path segment, to help with module name lookups,
         * which act like paths, but can be remapped. But the end result,
         * all paths that use this function should look normalized.
         * NOTE: this method MODIFIES the input array.
         * @param {Array} ary the array of path segments.
         */
        function trimDots(ary) {
            var i, part;
            for (i = 0; ary[i]; i += 1) {
                part = ary[i];
                if (part === '.') {
                    ary.splice(i, 1);
                    i -= 1;
                } else if (part === '..') {
                    if (i === 1 && (ary[2] === '..' || ary[0] === '..')) {
                        //End of the line. Keep at least one non-dot
                        //path segment at the front so it can be mapped
                        //correctly to disk. Otherwise, there is likely
                        //no path mapping for a path starting with '..'.
                        //This can still fail, but catches the most reasonable
                        //uses of ..
                        break;
                    } else if (i > 0) {
                        ary.splice(i - 1, 2);
                        i -= 2;
                    }
                }
            }
        }

        /**
         * Given a relative module name, like ./something, normalize it to
         * a real name that can be mapped to a path.
         * @param {String} name the relative name
         * @param {String} baseName a real name that the name arg is relative
         * to.
         * @param {Boolean} applyMap apply the map config to the value. Should
         * only be done if this normalization is for a dependency ID.
         * @returns {String} normalized name
         */
        function normalize(name, baseName, applyMap) {
            var pkgName, pkgConfig, mapValue, nameParts, i, j, nameSegment,
                foundMap, foundI, foundStarMap, starI,
                baseParts = baseName && baseName.split('/'),
                normalizedBaseParts = baseParts,
                map = config.map,
                starMap = map && map['*'];

            //Adjust any relative paths.
            if (name && name.charAt(0) === '.') {
                //If have a base name, try to normalize against it,
                //otherwise, assume it is a top-level require that will
                //be relative to baseUrl in the end.
                if (baseName) {
                    if (getOwn(config.pkgs, baseName)) {
                        //If the baseName is a package name, then just treat it as one
                        //name to concat the name with.
                        normalizedBaseParts = baseParts = [baseName];
                    } else {
                        //Convert baseName to array, and lop off the last part,
                        //so that . matches that 'directory' and not name of the baseName's
                        //module. For instance, baseName of 'one/two/three', maps to
                        //'one/two/three.js', but we want the directory, 'one/two' for
                        //this normalization.
                        normalizedBaseParts = baseParts.slice(0, baseParts.length - 1);
                    }

                    name = normalizedBaseParts.concat(name.split('/'));
                    trimDots(name);

                    //Some use of packages may use a . path to reference the
                    //'main' module name, so normalize for that.
                    pkgConfig = getOwn(config.pkgs, (pkgName = name[0]));
                    name = name.join('/');
                    if (pkgConfig && name === pkgName + '/' + pkgConfig.main) {
                        name = pkgName;
                    }
                } else if (name.indexOf('./') === 0) {
                    // No baseName, so this is ID is resolved relative
                    // to baseUrl, pull off the leading dot.
                    name = name.substring(2);
                }
            }

            //Apply map config if available.
            if (applyMap && map && (baseParts || starMap)) {
                nameParts = name.split('/');

                for (i = nameParts.length; i > 0; i -= 1) {
                    nameSegment = nameParts.slice(0, i).join('/');

                    if (baseParts) {
                        //Find the longest baseName segment match in the config.
                        //So, do joins on the biggest to smallest lengths of baseParts.
                        for (j = baseParts.length; j > 0; j -= 1) {
                            mapValue = getOwn(map, baseParts.slice(0, j).join('/'));

                            //baseName segment has config, find if it has one for
                            //this name.
                            if (mapValue) {
                                mapValue = getOwn(mapValue, nameSegment);
                                if (mapValue) {
                                    //Match, update name to the new value.
                                    foundMap = mapValue;
                                    foundI = i;
                                    break;
                                }
                            }
                        }
                    }

                    if (foundMap) {
                        break;
                    }

                    //Check for a star map match, but just hold on to it,
                    //if there is a shorter segment match later in a matching
                    //config, then favor over this star map.
                    if (!foundStarMap && starMap && getOwn(starMap, nameSegment)) {
                        foundStarMap = getOwn(starMap, nameSegment);
                        starI = i;
                    }
                }

                if (!foundMap && foundStarMap) {
                    foundMap = foundStarMap;
                    foundI = starI;
                }

                if (foundMap) {
                    nameParts.splice(0, foundI, foundMap);
                    name = nameParts.join('/');
                }
            }

            return name;
        }

        function removeScript(name) {
            if (isBrowser) {
                each(scripts(), function (scriptNode) {
                    if (scriptNode.getAttribute('data-requiremodule') === name &&
                            scriptNode.getAttribute('data-requirecontext') === context.contextName) {
                        scriptNode.parentNode.removeChild(scriptNode);
                        return true;
                    }
                });
            }
        }

        function hasPathFallback(id) {
            var pathConfig = getOwn(config.paths, id);
            if (pathConfig && isArray(pathConfig) && pathConfig.length > 1) {
                removeScript(id);
                //Pop off the first array value, since it failed, and
                //retry
                pathConfig.shift();
                context.require.undef(id);
                context.require([id]);
                return true;
            }
        }

        //Turns a plugin!resource to [plugin, resource]
        //with the plugin being undefined if the name
        //did not have a plugin prefix.
        function splitPrefix(name) {
            var prefix,
                index = name ? name.indexOf('!') : -1;
            if (index > -1) {
                prefix = name.substring(0, index);
                name = name.substring(index + 1, name.length);
            }
            return [prefix, name];
        }

        /**
         * Creates a module mapping that includes plugin prefix, module
         * name, and path. If parentModuleMap is provided it will
         * also normalize the name via require.normalize()
         *
         * @param {String} name the module name
         * @param {String} [parentModuleMap] parent module map
         * for the module name, used to resolve relative names.
         * @param {Boolean} isNormalized: is the ID already normalized.
         * This is true if this call is done for a define() module ID.
         * @param {Boolean} applyMap: apply the map config to the ID.
         * Should only be true if this map is for a dependency.
         *
         * @returns {Object}
         */
        function makeModuleMap(name, parentModuleMap, isNormalized, applyMap) {
            var url, pluginModule, suffix, nameParts,
                prefix = null,
                parentName = parentModuleMap ? parentModuleMap.name : null,
                originalName = name,
                isDefine = true,
                normalizedName = '';

            //If no name, then it means it is a require call, generate an
            //internal name.
            if (!name) {
                isDefine = false;
                name = '_@r' + (requireCounter += 1);
            }

            nameParts = splitPrefix(name);
            prefix = nameParts[0];
            name = nameParts[1];

            if (prefix) {
                prefix = normalize(prefix, parentName, applyMap);
                pluginModule = getOwn(defined, prefix);
            }

            //Account for relative paths if there is a base name.
            if (name) {
                if (prefix) {
                    if (pluginModule && pluginModule.normalize) {
                        //Plugin is loaded, use its normalize method.
                        normalizedName = pluginModule.normalize(name, function (name) {
                            return normalize(name, parentName, applyMap);
                        });
                    } else {
                        normalizedName = normalize(name, parentName, applyMap);
                    }
                } else {
                    //A regular module.
                    normalizedName = normalize(name, parentName, applyMap);

                    //Normalized name may be a plugin ID due to map config
                    //application in normalize. The map config values must
                    //already be normalized, so do not need to redo that part.
                    nameParts = splitPrefix(normalizedName);
                    prefix = nameParts[0];
                    normalizedName = nameParts[1];
                    isNormalized = true;

                    url = context.nameToUrl(normalizedName);
                }
            }

            //If the id is a plugin id that cannot be determined if it needs
            //normalization, stamp it with a unique ID so two matching relative
            //ids that may conflict can be separate.
            suffix = prefix && !pluginModule && !isNormalized ?
                     '_unnormalized' + (unnormalizedCounter += 1) :
                     '';

            return {
                prefix: prefix,
                name: normalizedName,
                parentMap: parentModuleMap,
                unnormalized: !!suffix,
                url: url,
                originalName: originalName,
                isDefine: isDefine,
                id: (prefix ?
                        prefix + '!' + normalizedName :
                        normalizedName) + suffix
            };
        }

        function getModule(depMap) {
            var id = depMap.id,
                mod = getOwn(registry, id);

            if (!mod) {
                mod = registry[id] = new context.Module(depMap);
            }

            return mod;
        }

        function on(depMap, name, fn) {
            var id = depMap.id,
                mod = getOwn(registry, id);

            if (hasProp(defined, id) &&
                    (!mod || mod.defineEmitComplete)) {
                if (name === 'defined') {
                    fn(defined[id]);
                }
            } else {
                mod = getModule(depMap);
                if (mod.error && name === 'error') {
                    fn(mod.error);
                } else {
                    mod.on(name, fn);
                }
            }
        }

        function onError(err, errback) {
            var ids = err.requireModules,
                notified = false;

            if (errback) {
                errback(err);
            } else {
                each(ids, function (id) {
                    var mod = getOwn(registry, id);
                    if (mod) {
                        //Set error on module, so it skips timeout checks.
                        mod.error = err;
                        if (mod.events.error) {
                            notified = true;
                            mod.emit('error', err);
                        }
                    }
                });

                if (!notified) {
                    req.onError(err);
                }
            }
        }

        /**
         * Internal method to transfer globalQueue items to this context's
         * defQueue.
         */
        function takeGlobalQueue() {
            //Push all the globalDefQueue items into the context's defQueue
            if (globalDefQueue.length) {
                //Array splice in the values since the context code has a
                //local var ref to defQueue, so cannot just reassign the one
                //on context.
                apsp.apply(defQueue,
                           [defQueue.length - 1, 0].concat(globalDefQueue));
                globalDefQueue = [];
            }
        }

        handlers = {
            'require': function (mod) {
                if (mod.require) {
                    return mod.require;
                } else {
                    return (mod.require = context.makeRequire(mod.map));
                }
            },
            'exports': function (mod) {
                mod.usingExports = true;
                if (mod.map.isDefine) {
                    if (mod.exports) {
                        return mod.exports;
                    } else {
                        return (mod.exports = defined[mod.map.id] = {});
                    }
                }
            },
            'module': function (mod) {
                if (mod.module) {
                    return mod.module;
                } else {
                    return (mod.module = {
                        id: mod.map.id,
                        uri: mod.map.url,
                        config: function () {
                            var c,
                                pkg = getOwn(config.pkgs, mod.map.id);
                            // For packages, only support config targeted
                            // at the main module.
                            c = pkg ? getOwn(config.config, mod.map.id + '/' + pkg.main) :
                                      getOwn(config.config, mod.map.id);
                            return  c || {};
                        },
                        exports: defined[mod.map.id]
                    });
                }
            }
        };

        function cleanRegistry(id) {
            //Clean up machinery used for waiting modules.
            delete registry[id];
            delete enabledRegistry[id];
        }

        function breakCycle(mod, traced, processed) {
            var id = mod.map.id;

            if (mod.error) {
                mod.emit('error', mod.error);
            } else {
                traced[id] = true;
                each(mod.depMaps, function (depMap, i) {
                    var depId = depMap.id,
                        dep = getOwn(registry, depId);

                    //Only force things that have not completed
                    //being defined, so still in the registry,
                    //and only if it has not been matched up
                    //in the module already.
                    if (dep && !mod.depMatched[i] && !processed[depId]) {
                        if (getOwn(traced, depId)) {
                            mod.defineDep(i, defined[depId]);
                            mod.check(); //pass false?
                        } else {
                            breakCycle(dep, traced, processed);
                        }
                    }
                });
                processed[id] = true;
            }
        }

        function checkLoaded() {
            var map, modId, err, usingPathFallback,
                waitInterval = config.waitSeconds * 1000,
                //It is possible to disable the wait interval by using waitSeconds of 0.
                expired = waitInterval && (context.startTime + waitInterval) < new Date().getTime(),
                noLoads = [],
                reqCalls = [],
                stillLoading = false,
                needCycleCheck = true;

            //Do not bother if this call was a result of a cycle break.
            if (inCheckLoaded) {
                return;
            }

            inCheckLoaded = true;

            //Figure out the state of all the modules.
            eachProp(enabledRegistry, function (mod) {
                map = mod.map;
                modId = map.id;

                //Skip things that are not enabled or in error state.
                if (!mod.enabled) {
                    return;
                }

                if (!map.isDefine) {
                    reqCalls.push(mod);
                }

                if (!mod.error) {
                    //If the module should be executed, and it has not
                    //been inited and time is up, remember it.
                    if (!mod.inited && expired) {
                        if (hasPathFallback(modId)) {
                            usingPathFallback = true;
                            stillLoading = true;
                        } else {
                            noLoads.push(modId);
                            removeScript(modId);
                        }
                    } else if (!mod.inited && mod.fetched && map.isDefine) {
                        stillLoading = true;
                        if (!map.prefix) {
                            //No reason to keep looking for unfinished
                            //loading. If the only stillLoading is a
                            //plugin resource though, keep going,
                            //because it may be that a plugin resource
                            //is waiting on a non-plugin cycle.
                            return (needCycleCheck = false);
                        }
                    }
                }
            });

            if (expired && noLoads.length) {
                //If wait time expired, throw error of unloaded modules.
                err = makeError('timeout', 'Load timeout for modules: ' + noLoads, null, noLoads);
                err.contextName = context.contextName;
                return onError(err);
            }

            //Not expired, check for a cycle.
            if (needCycleCheck) {
                each(reqCalls, function (mod) {
                    breakCycle(mod, {}, {});
                });
            }

            //If still waiting on loads, and the waiting load is something
            //other than a plugin resource, or there are still outstanding
            //scripts, then just try back later.
            if ((!expired || usingPathFallback) && stillLoading) {
                //Something is still waiting to load. Wait for it, but only
                //if a timeout is not already in effect.
                if ((isBrowser || isWebWorker) && !checkLoadedTimeoutId) {
                    checkLoadedTimeoutId = setTimeout(function () {
                        checkLoadedTimeoutId = 0;
                        checkLoaded();
                    }, 50);
                }
            }

            inCheckLoaded = false;
        }

        Module = function (map) {
            this.events = getOwn(undefEvents, map.id) || {};
            this.map = map;
            this.shim = getOwn(config.shim, map.id);
            this.depExports = [];
            this.depMaps = [];
            this.depMatched = [];
            this.pluginMaps = {};
            this.depCount = 0;

            /* this.exports this.factory
               this.depMaps = [],
               this.enabled, this.fetched
            */
        };

        Module.prototype = {
            init: function (depMaps, factory, errback, options) {
                options = options || {};

                //Do not do more inits if already done. Can happen if there
                //are multiple define calls for the same module. That is not
                //a normal, common case, but it is also not unexpected.
                if (this.inited) {
                    return;
                }

                this.factory = factory;

                if (errback) {
                    //Register for errors on this module.
                    this.on('error', errback);
                } else if (this.events.error) {
                    //If no errback already, but there are error listeners
                    //on this module, set up an errback to pass to the deps.
                    errback = bind(this, function (err) {
                        this.emit('error', err);
                    });
                }

                //Do a copy of the dependency array, so that
                //source inputs are not modified. For example
                //"shim" deps are passed in here directly, and
                //doing a direct modification of the depMaps array
                //would affect that config.
                this.depMaps = depMaps && depMaps.slice(0);

                this.errback = errback;

                //Indicate this module has be initialized
                this.inited = true;

                this.ignore = options.ignore;

                //Could have option to init this module in enabled mode,
                //or could have been previously marked as enabled. However,
                //the dependencies are not known until init is called. So
                //if enabled previously, now trigger dependencies as enabled.
                if (options.enabled || this.enabled) {
                    //Enable this module and dependencies.
                    //Will call this.check()
                    this.enable();
                } else {
                    this.check();
                }
            },

            defineDep: function (i, depExports) {
                //Because of cycles, defined callback for a given
                //export can be called more than once.
                if (!this.depMatched[i]) {
                    this.depMatched[i] = true;
                    this.depCount -= 1;
                    this.depExports[i] = depExports;
                }
            },

            fetch: function () {
                if (this.fetched) {
                    return;
                }
                this.fetched = true;

                context.startTime = (new Date()).getTime();

                var map = this.map;

                //If the manager is for a plugin managed resource,
                //ask the plugin to load it now.
                if (this.shim) {
                    context.makeRequire(this.map, {
                        enableBuildCallback: true
                    })(this.shim.deps || [], bind(this, function () {
                        return map.prefix ? this.callPlugin() : this.load();
                    }));
                } else {
                    //Regular dependency.
                    return map.prefix ? this.callPlugin() : this.load();
                }
            },

            load: function () {
                var url = this.map.url;

                //Regular dependency.
                if (!urlFetched[url]) {
                    urlFetched[url] = true;
                    context.load(this.map.id, url);
                }
            },

            /**
             * Checks if the module is ready to define itself, and if so,
             * define it.
             */
            check: function () {
                if (!this.enabled || this.enabling) {
                    return;
                }

                var err, cjsModule,
                    id = this.map.id,
                    depExports = this.depExports,
                    exports = this.exports,
                    factory = this.factory;

                if (!this.inited) {
                    this.fetch();
                } else if (this.error) {
                    this.emit('error', this.error);
                } else if (!this.defining) {
                    //The factory could trigger another require call
                    //that would result in checking this module to
                    //define itself again. If already in the process
                    //of doing that, skip this work.
                    this.defining = true;

                    if (this.depCount < 1 && !this.defined) {
                        if (isFunction(factory)) {
                            //If there is an error listener, favor passing
                            //to that instead of throwing an error. However,
                            //only do it for define()'d  modules. require
                            //errbacks should not be called for failures in
                            //their callbacks (#699). However if a global
                            //onError is set, use that.
                            if ((this.events.error && this.map.isDefine) ||
                                req.onError !== defaultOnError) {
                                try {
                                    exports = context.execCb(id, factory, depExports, exports);
                                } catch (e) {
                                    err = e;
                                }
                            } else {
                                exports = context.execCb(id, factory, depExports, exports);
                            }

                            if (this.map.isDefine) {
                                //If setting exports via 'module' is in play,
                                //favor that over return value and exports. After that,
                                //favor a non-undefined return value over exports use.
                                cjsModule = this.module;
                                if (cjsModule &&
                                        cjsModule.exports !== undefined &&
                                        //Make sure it is not already the exports value
                                        cjsModule.exports !== this.exports) {
                                    exports = cjsModule.exports;
                                } else if (exports === undefined && this.usingExports) {
                                    //exports already set the defined value.
                                    exports = this.exports;
                                }
                            }

                            if (err) {
                                err.requireMap = this.map;
                                err.requireModules = this.map.isDefine ? [this.map.id] : null;
                                err.requireType = this.map.isDefine ? 'define' : 'require';
                                return onError((this.error = err));
                            }

                        } else {
                            //Just a literal value
                            exports = factory;
                        }

                        this.exports = exports;

                        if (this.map.isDefine && !this.ignore) {
                            defined[id] = exports;

                            if (req.onResourceLoad) {
                                req.onResourceLoad(context, this.map, this.depMaps);
                            }
                        }

                        //Clean up
                        cleanRegistry(id);

                        this.defined = true;
                    }

                    //Finished the define stage. Allow calling check again
                    //to allow define notifications below in the case of a
                    //cycle.
                    this.defining = false;

                    if (this.defined && !this.defineEmitted) {
                        this.defineEmitted = true;
                        this.emit('defined', this.exports);
                        this.defineEmitComplete = true;
                    }

                }
            },

            callPlugin: function () {
                var map = this.map,
                    id = map.id,
                    //Map already normalized the prefix.
                    pluginMap = makeModuleMap(map.prefix);

                //Mark this as a dependency for this plugin, so it
                //can be traced for cycles.
                this.depMaps.push(pluginMap);

                on(pluginMap, 'defined', bind(this, function (plugin) {
                    var load, normalizedMap, normalizedMod,
                        name = this.map.name,
                        parentName = this.map.parentMap ? this.map.parentMap.name : null,
                        localRequire = context.makeRequire(map.parentMap, {
                            enableBuildCallback: true
                        });

                    //If current map is not normalized, wait for that
                    //normalized name to load instead of continuing.
                    if (this.map.unnormalized) {
                        //Normalize the ID if the plugin allows it.
                        if (plugin.normalize) {
                            name = plugin.normalize(name, function (name) {
                                return normalize(name, parentName, true);
                            }) || '';
                        }

                        //prefix and name should already be normalized, no need
                        //for applying map config again either.
                        normalizedMap = makeModuleMap(map.prefix + '!' + name,
                                                      this.map.parentMap);
                        on(normalizedMap,
                            'defined', bind(this, function (value) {
                                this.init([], function () { return value; }, null, {
                                    enabled: true,
                                    ignore: true
                                });
                            }));

                        normalizedMod = getOwn(registry, normalizedMap.id);
                        if (normalizedMod) {
                            //Mark this as a dependency for this plugin, so it
                            //can be traced for cycles.
                            this.depMaps.push(normalizedMap);

                            if (this.events.error) {
                                normalizedMod.on('error', bind(this, function (err) {
                                    this.emit('error', err);
                                }));
                            }
                            normalizedMod.enable();
                        }

                        return;
                    }

                    load = bind(this, function (value) {
                        this.init([], function () { return value; }, null, {
                            enabled: true
                        });
                    });

                    load.error = bind(this, function (err) {
                        this.inited = true;
                        this.error = err;
                        err.requireModules = [id];

                        //Remove temp unnormalized modules for this module,
                        //since they will never be resolved otherwise now.
                        eachProp(registry, function (mod) {
                            if (mod.map.id.indexOf(id + '_unnormalized') === 0) {
                                cleanRegistry(mod.map.id);
                            }
                        });

                        onError(err);
                    });

                    //Allow plugins to load other code without having to know the
                    //context or how to 'complete' the load.
                    load.fromText = bind(this, function (text, textAlt) {
                        /*jslint evil: true */
                        var moduleName = map.name,
                            moduleMap = makeModuleMap(moduleName),
                            hasInteractive = useInteractive;

                        //As of 2.1.0, support just passing the text, to reinforce
                        //fromText only being called once per resource. Still
                        //support old style of passing moduleName but discard
                        //that moduleName in favor of the internal ref.
                        if (textAlt) {
                            text = textAlt;
                        }

                        //Turn off interactive script matching for IE for any define
                        //calls in the text, then turn it back on at the end.
                        if (hasInteractive) {
                            useInteractive = false;
                        }

                        //Prime the system by creating a module instance for
                        //it.
                        getModule(moduleMap);

                        //Transfer any config to this other module.
                        if (hasProp(config.config, id)) {
                            config.config[moduleName] = config.config[id];
                        }

                        try {
                            req.exec(text);
                        } catch (e) {
                            return onError(makeError('fromtexteval',
                                             'fromText eval for ' + id +
                                            ' failed: ' + e,
                                             e,
                                             [id]));
                        }

                        if (hasInteractive) {
                            useInteractive = true;
                        }

                        //Mark this as a dependency for the plugin
                        //resource
                        this.depMaps.push(moduleMap);

                        //Support anonymous modules.
                        context.completeLoad(moduleName);

                        //Bind the value of that module to the value for this
                        //resource ID.
                        localRequire([moduleName], load);
                    });

                    //Use parentName here since the plugin's name is not reliable,
                    //could be some weird string with no path that actually wants to
                    //reference the parentName's path.
                    plugin.load(map.name, localRequire, load, config);
                }));

                context.enable(pluginMap, this);
                this.pluginMaps[pluginMap.id] = pluginMap;
            },

            enable: function () {
                enabledRegistry[this.map.id] = this;
                this.enabled = true;

                //Set flag mentioning that the module is enabling,
                //so that immediate calls to the defined callbacks
                //for dependencies do not trigger inadvertent load
                //with the depCount still being zero.
                this.enabling = true;

                //Enable each dependency
                each(this.depMaps, bind(this, function (depMap, i) {
                    var id, mod, handler;

                    if (typeof depMap === 'string') {
                        //Dependency needs to be converted to a depMap
                        //and wired up to this module.
                        depMap = makeModuleMap(depMap,
                                               (this.map.isDefine ? this.map : this.map.parentMap),
                                               false,
                                               !this.skipMap);
                        this.depMaps[i] = depMap;

                        handler = getOwn(handlers, depMap.id);

                        if (handler) {
                            this.depExports[i] = handler(this);
                            return;
                        }

                        this.depCount += 1;

                        on(depMap, 'defined', bind(this, function (depExports) {
                            this.defineDep(i, depExports);
                            this.check();
                        }));

                        if (this.errback) {
                            on(depMap, 'error', bind(this, this.errback));
                        }
                    }

                    id = depMap.id;
                    mod = registry[id];

                    //Skip special modules like 'require', 'exports', 'module'
                    //Also, don't call enable if it is already enabled,
                    //important in circular dependency cases.
                    if (!hasProp(handlers, id) && mod && !mod.enabled) {
                        context.enable(depMap, this);
                    }
                }));

                //Enable each plugin that is used in
                //a dependency
                eachProp(this.pluginMaps, bind(this, function (pluginMap) {
                    var mod = getOwn(registry, pluginMap.id);
                    if (mod && !mod.enabled) {
                        context.enable(pluginMap, this);
                    }
                }));

                this.enabling = false;

                this.check();
            },

            on: function (name, cb) {
                var cbs = this.events[name];
                if (!cbs) {
                    cbs = this.events[name] = [];
                }
                cbs.push(cb);
            },

            emit: function (name, evt) {
                each(this.events[name], function (cb) {
                    cb(evt);
                });
                if (name === 'error') {
                    //Now that the error handler was triggered, remove
                    //the listeners, since this broken Module instance
                    //can stay around for a while in the registry.
                    delete this.events[name];
                }
            }
        };

        function callGetModule(args) {
            //Skip modules already defined.
            if (!hasProp(defined, args[0])) {
                getModule(makeModuleMap(args[0], null, true)).init(args[1], args[2]);
            }
        }

        function removeListener(node, func, name, ieName) {
            //Favor detachEvent because of IE9
            //issue, see attachEvent/addEventListener comment elsewhere
            //in this file.
            if (node.detachEvent && !isOpera) {
                //Probably IE. If not it will throw an error, which will be
                //useful to know.
                if (ieName) {
                    node.detachEvent(ieName, func);
                }
            } else {
                node.removeEventListener(name, func, false);
            }
        }

        /**
         * Given an event from a script node, get the requirejs info from it,
         * and then removes the event listeners on the node.
         * @param {Event} evt
         * @returns {Object}
         */
        function getScriptData(evt) {
            //Using currentTarget instead of target for Firefox 2.0's sake. Not
            //all old browsers will be supported, but this one was easy enough
            //to support and still makes sense.
            var node = evt.currentTarget || evt.srcElement;

            //Remove the listeners once here.
            removeListener(node, context.onScriptLoad, 'load', 'onreadystatechange');
            removeListener(node, context.onScriptError, 'error');

            return {
                node: node,
                id: node && node.getAttribute('data-requiremodule')
            };
        }

        function intakeDefines() {
            var args;

            //Any defined modules in the global queue, intake them now.
            takeGlobalQueue();

            //Make sure any remaining defQueue items get properly processed.
            while (defQueue.length) {
                args = defQueue.shift();
                if (args[0] === null) {
                    return onError(makeError('mismatch', 'Mismatched anonymous define() module: ' + args[args.length - 1]));
                } else {
                    //args are id, deps, factory. Should be normalized by the
                    //define() function.
                    callGetModule(args);
                }
            }
        }

        context = {
            config: config,
            contextName: contextName,
            registry: registry,
            defined: defined,
            urlFetched: urlFetched,
            defQueue: defQueue,
            Module: Module,
            makeModuleMap: makeModuleMap,
            nextTick: req.nextTick,
            onError: onError,

            /**
             * Set a configuration for the context.
             * @param {Object} cfg config object to integrate.
             */
            configure: function (cfg) {
                //Make sure the baseUrl ends in a slash.
                if (cfg.baseUrl) {
                    if (cfg.baseUrl.charAt(cfg.baseUrl.length - 1) !== '/') {
                        cfg.baseUrl += '/';
                    }
                }

                //Save off the paths and packages since they require special processing,
                //they are additive.
                var pkgs = config.pkgs,
                    shim = config.shim,
                    objs = {
                        paths: true,
                        config: true,
                        map: true
                    };

                eachProp(cfg, function (value, prop) {
                    if (objs[prop]) {
                        if (prop === 'map') {
                            if (!config.map) {
                                config.map = {};
                            }
                            mixin(config[prop], value, true, true);
                        } else {
                            mixin(config[prop], value, true);
                        }
                    } else {
                        config[prop] = value;
                    }
                });

                //Merge shim
                if (cfg.shim) {
                    eachProp(cfg.shim, function (value, id) {
                        //Normalize the structure
                        if (isArray(value)) {
                            value = {
                                deps: value
                            };
                        }
                        if ((value.exports || value.init) && !value.exportsFn) {
                            value.exportsFn = context.makeShimExports(value);
                        }
                        shim[id] = value;
                    });
                    config.shim = shim;
                }

                //Adjust packages if necessary.
                if (cfg.packages) {
                    each(cfg.packages, function (pkgObj) {
                        var location;

                        pkgObj = typeof pkgObj === 'string' ? { name: pkgObj } : pkgObj;
                        location = pkgObj.location;

                        //Create a brand new object on pkgs, since currentPackages can
                        //be passed in again, and config.pkgs is the internal transformed
                        //state for all package configs.
                        pkgs[pkgObj.name] = {
                            name: pkgObj.name,
                            location: location || pkgObj.name,
                            //Remove leading dot in main, so main paths are normalized,
                            //and remove any trailing .js, since different package
                            //envs have different conventions: some use a module name,
                            //some use a file name.
                            main: (pkgObj.main || 'main')
                                  .replace(currDirRegExp, '')
                                  .replace(jsSuffixRegExp, '')
                        };
                    });

                    //Done with modifications, assing packages back to context config
                    config.pkgs = pkgs;
                }

                //If there are any "waiting to execute" modules in the registry,
                //update the maps for them, since their info, like URLs to load,
                //may have changed.
                eachProp(registry, function (mod, id) {
                    //If module already has init called, since it is too
                    //late to modify them, and ignore unnormalized ones
                    //since they are transient.
                    if (!mod.inited && !mod.map.unnormalized) {
                        mod.map = makeModuleMap(id);
                    }
                });

                //If a deps array or a config callback is specified, then call
                //require with those args. This is useful when require is defined as a
                //config object before require.js is loaded.
                if (cfg.deps || cfg.callback) {
                    context.require(cfg.deps || [], cfg.callback);
                }
            },

            makeShimExports: function (value) {
                function fn() {
                    var ret;
                    if (value.init) {
                        ret = value.init.apply(global, arguments);
                    }
                    return ret || (value.exports && getGlobal(value.exports));
                }
                return fn;
            },

            makeRequire: function (relMap, options) {
                options = options || {};

                function localRequire(deps, callback, errback) {
                    var id, map, requireMod;

                    if (options.enableBuildCallback && callback && isFunction(callback)) {
                        callback.__requireJsBuild = true;
                    }

                    if (typeof deps === 'string') {
                        if (isFunction(callback)) {
                            //Invalid call
                            return onError(makeError('requireargs', 'Invalid require call'), errback);
                        }

                        //If require|exports|module are requested, get the
                        //value for them from the special handlers. Caveat:
                        //this only works while module is being defined.
                        if (relMap && hasProp(handlers, deps)) {
                            return handlers[deps](registry[relMap.id]);
                        }

                        //Synchronous access to one module. If require.get is
                        //available (as in the Node adapter), prefer that.
                        if (req.get) {
                            return req.get(context, deps, relMap, localRequire);
                        }

                        //Normalize module name, if it contains . or ..
                        map = makeModuleMap(deps, relMap, false, true);
                        id = map.id;

                        if (!hasProp(defined, id)) {
                            return onError(makeError('notloaded', 'Module name "' +
                                        id +
                                        '" has not been loaded yet for context: ' +
                                        contextName +
                                        (relMap ? '' : '. Use require([])')));
                        }
                        return defined[id];
                    }

                    //Grab defines waiting in the global queue.
                    intakeDefines();

                    //Mark all the dependencies as needing to be loaded.
                    context.nextTick(function () {
                        //Some defines could have been added since the
                        //require call, collect them.
                        intakeDefines();

                        requireMod = getModule(makeModuleMap(null, relMap));

                        //Store if map config should be applied to this require
                        //call for dependencies.
                        requireMod.skipMap = options.skipMap;

                        requireMod.init(deps, callback, errback, {
                            enabled: true
                        });

                        checkLoaded();
                    });

                    return localRequire;
                }

                mixin(localRequire, {
                    isBrowser: isBrowser,

                    /**
                     * Converts a module name + .extension into an URL path.
                     * *Requires* the use of a module name. It does not support using
                     * plain URLs like nameToUrl.
                     */
                    toUrl: function (moduleNamePlusExt) {
                        var ext,
                            index = moduleNamePlusExt.lastIndexOf('.'),
                            segment = moduleNamePlusExt.split('/')[0],
                            isRelative = segment === '.' || segment === '..';

                        //Have a file extension alias, and it is not the
                        //dots from a relative path.
                        if (index !== -1 && (!isRelative || index > 1)) {
                            ext = moduleNamePlusExt.substring(index, moduleNamePlusExt.length);
                            moduleNamePlusExt = moduleNamePlusExt.substring(0, index);
                        }

                        return context.nameToUrl(normalize(moduleNamePlusExt,
                                                relMap && relMap.id, true), ext,  true);
                    },

                    defined: function (id) {
                        return hasProp(defined, makeModuleMap(id, relMap, false, true).id);
                    },

                    specified: function (id) {
                        id = makeModuleMap(id, relMap, false, true).id;
                        return hasProp(defined, id) || hasProp(registry, id);
                    }
                });

                //Only allow undef on top level require calls
                if (!relMap) {
                    localRequire.undef = function (id) {
                        //Bind any waiting define() calls to this context,
                        //fix for #408
                        takeGlobalQueue();

                        var map = makeModuleMap(id, relMap, true),
                            mod = getOwn(registry, id);

                        delete defined[id];
                        delete urlFetched[map.url];
                        delete undefEvents[id];

                        if (mod) {
                            //Hold on to listeners in case the
                            //module will be attempted to be reloaded
                            //using a different config.
                            if (mod.events.defined) {
                                undefEvents[id] = mod.events;
                            }

                            cleanRegistry(id);
                        }
                    };
                }

                return localRequire;
            },

            /**
             * Called to enable a module if it is still in the registry
             * awaiting enablement. A second arg, parent, the parent module,
             * is passed in for context, when this method is overriden by
             * the optimizer. Not shown here to keep code compact.
             */
            enable: function (depMap) {
                var mod = getOwn(registry, depMap.id);
                if (mod) {
                    getModule(depMap).enable();
                }
            },

            /**
             * Internal method used by environment adapters to complete a load event.
             * A load event could be a script load or just a load pass from a synchronous
             * load call.
             * @param {String} moduleName the name of the module to potentially complete.
             */
            completeLoad: function (moduleName) {
                var found, args, mod,
                    shim = getOwn(config.shim, moduleName) || {},
                    shExports = shim.exports;

                takeGlobalQueue();

                while (defQueue.length) {
                    args = defQueue.shift();
                    if (args[0] === null) {
                        args[0] = moduleName;
                        //If already found an anonymous module and bound it
                        //to this name, then this is some other anon module
                        //waiting for its completeLoad to fire.
                        if (found) {
                            break;
                        }
                        found = true;
                    } else if (args[0] === moduleName) {
                        //Found matching define call for this script!
                        found = true;
                    }

                    callGetModule(args);
                }

                //Do this after the cycle of callGetModule in case the result
                //of those calls/init calls changes the registry.
                mod = getOwn(registry, moduleName);

                if (!found && !hasProp(defined, moduleName) && mod && !mod.inited) {
                    if (config.enforceDefine && (!shExports || !getGlobal(shExports))) {
                        if (hasPathFallback(moduleName)) {
                            return;
                        } else {
                            return onError(makeError('nodefine',
                                             'No define call for ' + moduleName,
                                             null,
                                             [moduleName]));
                        }
                    } else {
                        //A script that does not call define(), so just simulate
                        //the call for it.
                        callGetModule([moduleName, (shim.deps || []), shim.exportsFn]);
                    }
                }

                checkLoaded();
            },

            /**
             * Converts a module name to a file path. Supports cases where
             * moduleName may actually be just an URL.
             * Note that it **does not** call normalize on the moduleName,
             * it is assumed to have already been normalized. This is an
             * internal API, not a public one. Use toUrl for the public API.
             */
            nameToUrl: function (moduleName, ext, skipExt) {
                var paths, pkgs, pkg, pkgPath, syms, i, parentModule, url,
                    parentPath;

                //If a colon is in the URL, it indicates a protocol is used and it is just
                //an URL to a file, or if it starts with a slash, contains a query arg (i.e. ?)
                //or ends with .js, then assume the user meant to use an url and not a module id.
                //The slash is important for protocol-less URLs as well as full paths.
                if (req.jsExtRegExp.test(moduleName)) {
                    //Just a plain path, not module name lookup, so just return it.
                    //Add extension if it is included. This is a bit wonky, only non-.js things pass
                    //an extension, this method probably needs to be reworked.
                    url = moduleName + (ext || '');
                } else {
                    //A module that needs to be converted to a path.
                    paths = config.paths;
                    pkgs = config.pkgs;

                    syms = moduleName.split('/');
                    //For each module name segment, see if there is a path
                    //registered for it. Start with most specific name
                    //and work up from it.
                    for (i = syms.length; i > 0; i -= 1) {
                        parentModule = syms.slice(0, i).join('/');
                        pkg = getOwn(pkgs, parentModule);
                        parentPath = getOwn(paths, parentModule);
                        if (parentPath) {
                            //If an array, it means there are a few choices,
                            //Choose the one that is desired
                            if (isArray(parentPath)) {
                                parentPath = parentPath[0];
                            }
                            syms.splice(0, i, parentPath);
                            break;
                        } else if (pkg) {
                            //If module name is just the package name, then looking
                            //for the main module.
                            if (moduleName === pkg.name) {
                                pkgPath = pkg.location + '/' + pkg.main;
                            } else {
                                pkgPath = pkg.location;
                            }
                            syms.splice(0, i, pkgPath);
                            break;
                        }
                    }

                    //Join the path parts together, then figure out if baseUrl is needed.
                    url = syms.join('/');
                    url += (ext || (/\?/.test(url) || skipExt ? '' : '.js'));
                    url = (url.charAt(0) === '/' || url.match(/^[\w\+\.\-]+:/) ? '' : config.baseUrl) + url;
                }

                return config.urlArgs ? url +
                                        ((url.indexOf('?') === -1 ? '?' : '&') +
                                         config.urlArgs) : url;
            },

            //Delegates to req.load. Broken out as a separate function to
            //allow overriding in the optimizer.
            load: function (id, url) {
                req.load(context, id, url);
            },

            /**
             * Executes a module callback function. Broken out as a separate function
             * solely to allow the build system to sequence the files in the built
             * layer in the right sequence.
             *
             * @private
             */
            execCb: function (name, callback, args, exports) {
                return callback.apply(exports, args);
            },

            /**
             * callback for script loads, used to check status of loading.
             *
             * @param {Event} evt the event from the browser for the script
             * that was loaded.
             */
            onScriptLoad: function (evt) {
                //Using currentTarget instead of target for Firefox 2.0's sake. Not
                //all old browsers will be supported, but this one was easy enough
                //to support and still makes sense.
                if (evt.type === 'load' ||
                        (readyRegExp.test((evt.currentTarget || evt.srcElement).readyState))) {
                    //Reset interactive script so a script node is not held onto for
                    //to long.
                    interactiveScript = null;

                    //Pull out the name of the module and the context.
                    var data = getScriptData(evt);
                    context.completeLoad(data.id);
                }
            },

            /**
             * Callback for script errors.
             */
            onScriptError: function (evt) {
                var data = getScriptData(evt);
                if (!hasPathFallback(data.id)) {
                    return onError(makeError('scripterror', 'Script error for: ' + data.id, evt, [data.id]));
                }
            }
        };

        context.require = context.makeRequire();
        return context;
    }

    /**
     * Main entry point.
     *
     * If the only argument to require is a string, then the module that
     * is represented by that string is fetched for the appropriate context.
     *
     * If the first argument is an array, then it will be treated as an array
     * of dependency string names to fetch. An optional function callback can
     * be specified to execute when all of those dependencies are available.
     *
     * Make a local req variable to help Caja compliance (it assumes things
     * on a require that are not standardized), and to give a short
     * name for minification/local scope use.
     */
    req = requirejs = function (deps, callback, errback, optional) {

        //Find the right context, use default
        var context, config,
            contextName = defContextName;

        // Determine if have config object in the call.
        if (!isArray(deps) && typeof deps !== 'string') {
            // deps is a config object
            config = deps;
            if (isArray(callback)) {
                // Adjust args if there are dependencies
                deps = callback;
                callback = errback;
                errback = optional;
            } else {
                deps = [];
            }
        }

        if (config && config.context) {
            contextName = config.context;
        }

        context = getOwn(contexts, contextName);
        if (!context) {
            context = contexts[contextName] = req.s.newContext(contextName);
        }

        if (config) {
            context.configure(config);
        }

        return context.require(deps, callback, errback);
    };

    /**
     * Support require.config() to make it easier to cooperate with other
     * AMD loaders on globally agreed names.
     */
    req.config = function (config) {
        return req(config);
    };

    /**
     * Execute something after the current tick
     * of the event loop. Override for other envs
     * that have a better solution than setTimeout.
     * @param  {Function} fn function to execute later.
     */
    req.nextTick = typeof setTimeout !== 'undefined' ? function (fn) {
        setTimeout(fn, 4);
    } : function (fn) { fn(); };

    /**
     * Export require as a global, but only if it does not already exist.
     */
    if (!require) {
        require = req;
    }

    req.version = version;

    //Used to filter out dependencies that are already paths.
    req.jsExtRegExp = /^\/|:|\?|\.js$/;
    req.isBrowser = isBrowser;
    s = req.s = {
        contexts: contexts,
        newContext: newContext
    };

    //Create default context.
    req({});

    //Exports some context-sensitive methods on global require.
    each([
        'toUrl',
        'undef',
        'defined',
        'specified'
    ], function (prop) {
        //Reference from contexts instead of early binding to default context,
        //so that during builds, the latest instance of the default context
        //with its config gets used.
        req[prop] = function () {
            var ctx = contexts[defContextName];
            return ctx.require[prop].apply(ctx, arguments);
        };
    });

    if (isBrowser) {
        head = s.head = document.getElementsByTagName('head')[0];
        //If BASE tag is in play, using appendChild is a problem for IE6.
        //When that browser dies, this can be removed. Details in this jQuery bug:
        //http://dev.jquery.com/ticket/2709
        baseElement = document.getElementsByTagName('base')[0];
        if (baseElement) {
            head = s.head = baseElement.parentNode;
        }
    }

    /**
     * Any errors that require explicitly generates will be passed to this
     * function. Intercept/override it if you want custom error handling.
     * @param {Error} err the error object.
     */
    req.onError = defaultOnError;

    /**
     * Creates the node for the load command. Only used in browser envs.
     */
    req.createNode = function (config, moduleName, url) {
        var node = config.xhtml ?
                document.createElementNS('http://www.w3.org/1999/xhtml', 'html:script') :
                document.createElement('script');
        node.type = config.scriptType || 'text/javascript';
        node.charset = 'utf-8';
        node.async = true;
        return node;
    };

    /**
     * Does the request to load a module for the browser case.
     * Make this a separate function to allow other environments
     * to override it.
     *
     * @param {Object} context the require context to find state.
     * @param {String} moduleName the name of the module.
     * @param {Object} url the URL to the module.
     */
    req.load = function (context, moduleName, url) {
        var config = (context && context.config) || {},
            node;
        if (isBrowser) {
            //In the browser so use a script tag
            node = req.createNode(config, moduleName, url);

            node.setAttribute('data-requirecontext', context.contextName);
            node.setAttribute('data-requiremodule', moduleName);

            //Set up load listener. Test attachEvent first because IE9 has
            //a subtle issue in its addEventListener and script onload firings
            //that do not match the behavior of all other browsers with
            //addEventListener support, which fire the onload event for a
            //script right after the script execution. See:
            //https://connect.microsoft.com/IE/feedback/details/648057/script-onload-event-is-not-fired-immediately-after-script-execution
            //UNFORTUNATELY Opera implements attachEvent but does not follow the script
            //script execution mode.
            if (node.attachEvent &&
                    //Check if node.attachEvent is artificially added by custom script or
                    //natively supported by browser
                    //read https://github.com/jrburke/requirejs/issues/187
                    //if we can NOT find [native code] then it must NOT natively supported.
                    //in IE8, node.attachEvent does not have toString()
                    //Note the test for "[native code" with no closing brace, see:
                    //https://github.com/jrburke/requirejs/issues/273
                    !(node.attachEvent.toString && node.attachEvent.toString().indexOf('[native code') < 0) &&
                    !isOpera) {
                //Probably IE. IE (at least 6-8) do not fire
                //script onload right after executing the script, so
                //we cannot tie the anonymous define call to a name.
                //However, IE reports the script as being in 'interactive'
                //readyState at the time of the define call.
                useInteractive = true;

                node.attachEvent('onreadystatechange', context.onScriptLoad);
                //It would be great to add an error handler here to catch
                //404s in IE9+. However, onreadystatechange will fire before
                //the error handler, so that does not help. If addEventListener
                //is used, then IE will fire error before load, but we cannot
                //use that pathway given the connect.microsoft.com issue
                //mentioned above about not doing the 'script execute,
                //then fire the script load event listener before execute
                //next script' that other browsers do.
                //Best hope: IE10 fixes the issues,
                //and then destroys all installs of IE 6-9.
                //node.attachEvent('onerror', context.onScriptError);
            } else {
                node.addEventListener('load', context.onScriptLoad, false);
                node.addEventListener('error', context.onScriptError, false);
            }
            node.src = url;

            //For some cache cases in IE 6-8, the script executes before the end
            //of the appendChild execution, so to tie an anonymous define
            //call to the module name (which is stored on the node), hold on
            //to a reference to this node, but clear after the DOM insertion.
            currentlyAddingScript = node;
            if (baseElement) {
                head.insertBefore(node, baseElement);
            } else {
                head.appendChild(node);
            }
            currentlyAddingScript = null;

            return node;
        } else if (isWebWorker) {
            try {
                //In a web worker, use importScripts. This is not a very
                //efficient use of importScripts, importScripts will block until
                //its script is downloaded and evaluated. However, if web workers
                //are in play, the expectation that a build has been done so that
                //only one script needs to be loaded anyway. This may need to be
                //reevaluated if other use cases become common.
                importScripts(url);

                //Account for anonymous modules
                context.completeLoad(moduleName);
            } catch (e) {
                context.onError(makeError('importscripts',
                                'importScripts failed for ' +
                                    moduleName + ' at ' + url,
                                e,
                                [moduleName]));
            }
        }
    };

    function getInteractiveScript() {
        if (interactiveScript && interactiveScript.readyState === 'interactive') {
            return interactiveScript;
        }

        eachReverse(scripts(), function (script) {
            if (script.readyState === 'interactive') {
                return (interactiveScript = script);
            }
        });
        return interactiveScript;
    }

    //Look for a data-main script attribute, which could also adjust the baseUrl.
    if (isBrowser) {
        //Figure out baseUrl. Get it from the script tag with require.js in it.
        eachReverse(scripts(), function (script) {
            //Set the 'head' where we can append children by
            //using the script's parent.
            if (!head) {
                head = script.parentNode;
            }

            //Look for a data-main attribute to set main script for the page
            //to load. If it is there, the path to data main becomes the
            //baseUrl, if it is not already set.
            dataMain = script.getAttribute('data-main');
            if (dataMain) {
                //Preserve dataMain in case it is a path (i.e. contains '?')
                mainScript = dataMain;

                //Set final baseUrl if there is not already an explicit one.
                if (!cfg.baseUrl) {
                    //Pull off the directory of data-main for use as the
                    //baseUrl.
                    src = mainScript.split('/');
                    mainScript = src.pop();
                    subPath = src.length ? src.join('/')  + '/' : './';

                    cfg.baseUrl = subPath;
                }

                //Strip off any trailing .js since mainScript is now
                //like a module name.
                mainScript = mainScript.replace(jsSuffixRegExp, '');

                 //If mainScript is still a path, fall back to dataMain
                if (req.jsExtRegExp.test(mainScript)) {
                    mainScript = dataMain;
                }

                //Put the data-main script in the files to load.
                cfg.deps = cfg.deps ? cfg.deps.concat(mainScript) : [mainScript];

                return true;
            }
        });
    }

    /**
     * The function that handles definitions of modules. Differs from
     * require() in that a string for the module should be the first argument,
     * and the function to execute after dependencies are loaded should
     * return a value to define the module corresponding to the first argument's
     * name.
     */
    define = function (name, deps, callback) {
        var node, context;

        //Allow for anonymous modules
        if (typeof name !== 'string') {
            //Adjust args appropriately
            callback = deps;
            deps = name;
            name = null;
        }

        //This module may not have dependencies
        if (!isArray(deps)) {
            callback = deps;
            deps = null;
        }

        //If no name, and callback is a function, then figure out if it a
        //CommonJS thing with dependencies.
        if (!deps && isFunction(callback)) {
            deps = [];
            //Remove comments from the callback string,
            //look for require calls, and pull them into the dependencies,
            //but only if there are function args.
            if (callback.length) {
                callback
                    .toString()
                    .replace(commentRegExp, '')
                    .replace(cjsRequireRegExp, function (match, dep) {
                        deps.push(dep);
                    });

                //May be a CommonJS thing even without require calls, but still
                //could use exports, and module. Avoid doing exports and module
                //work though if it just needs require.
                //REQUIRES the function to expect the CommonJS variables in the
                //order listed below.
                deps = (callback.length === 1 ? ['require'] : ['require', 'exports', 'module']).concat(deps);
            }
        }

        //If in IE 6-8 and hit an anonymous define() call, do the interactive
        //work.
        if (useInteractive) {
            node = currentlyAddingScript || getInteractiveScript();
            if (node) {
                if (!name) {
                    name = node.getAttribute('data-requiremodule');
                }
                context = contexts[node.getAttribute('data-requirecontext')];
            }
        }

        //Always save off evaluating the def call until the script onload handler.
        //This allows multiple modules to be in a file without prematurely
        //tracing dependencies, and allows for anonymous module support,
        //where the module name is not known until the script onload event
        //occurs. If no context, use the global queue, and get it processed
        //in the onscript load callback.
        (context ? context.defQueue : globalDefQueue).push([name, deps, callback]);
    };

    define.amd = {
        jQuery: true
    };


    /**
     * Executes the text. Normally just uses eval, but can be modified
     * to use a better, environment-specific call. Only used for transpiling
     * loader plugins, not for plain JS modules.
     * @param {String} text the text to execute/evaluate.
     */
    req.exec = function (text) {
        /*jslint evil: true */
        return eval(text);
    };

    //Set up with config info.
    req(cfg);
}(this));
;/* Zepto v1.0 - polyfill zepto detect event ajax form fx - zeptojs.com/license */

//     Underscore.js 1.5.1
//     http://underscorejs.org
//     (c) 2009-2013 Jeremy Ashkenas, DocumentCloud and Investigative Reporters & Editors
//     Underscore may be freely distributed under the MIT license.

//     (c) 2010-2013 Jeremy Ashkenas, DocumentCloud Inc.
//     Backbone may be freely distributed under the MIT license.
//     For all details and documentation:
//     http://backbonejs.org

/**
 * @preserve FastClick: polyfill to remove click delays on browsers with touch UIs.
 *
 * @version 0.6.9
 * @codingstandard ftlabs-jsv2
 * @copyright The Financial Times Limited [All Rights Reserved]
 * @license MIT License (see LICENSE.txt)
 */

/**
 * @license RequireJS text 2.0.10 Copyright (c) 2010-2012, The Dojo Foundation All Rights Reserved.
 * Available via the MIT or new BSD license.
 * see: http://github.com/requirejs/text for details
 */

/**
 * @license RequireJS i18n 2.0.3 Copyright (c) 2010-2012, The Dojo Foundation All Rights Reserved.
 * Available via the MIT or new BSD license.
 * see: http://github.com/requirejs/i18n for details
 */

/*!Extend touch.js*/

/*!Extend zepto.extend.js*/

/*!Extend zepto.highlight.js*/

/*!Extend zepto.iscroll.js*/

/*
 * iScroll v4.2.2 ~ Copyright (c) 2012 Matteo Spinelli, http://cubiq.org
 * Released under MIT license, http://cubiq.org/license
 */

/*!Extend zepto.ui.js*/

/*!Widget slider.js*/

/*!Widget calendar.js*/

/*! piece.js 1.0.1 | piecejs.org/LICENSE.md
 */

function FastClick(e){var t,n=this;this.trackingClick=!1,this.trackingClickStart=0,this.targetElement=null,this.touchStartX=0,this.touchStartY=0,this.lastTouchIdentifier=0,this.touchBoundary=10,this.layer=e;if(!e||!e.nodeType)throw new TypeError("Layer must be a document node");this.onClick=function(){return FastClick.prototype.onClick.apply(n,arguments)},this.onMouse=function(){return FastClick.prototype.onMouse.apply(n,arguments)},this.onTouchStart=function(){return FastClick.prototype.onTouchStart.apply(n,arguments)},this.onTouchEnd=function(){return FastClick.prototype.onTouchEnd.apply(n,arguments)},this.onTouchCancel=function(){return FastClick.prototype.onTouchCancel.apply(n,arguments)};if(FastClick.notNeeded(e))return;this.deviceIsAndroid&&(e.addEventListener("mouseover",this.onMouse,!0),e.addEventListener("mousedown",this.onMouse,!0),e.addEventListener("mouseup",this.onMouse,!0)),e.addEventListener("click",this.onClick,!0),e.addEventListener("touchstart",this.onTouchStart,!1),e.addEventListener("touchend",this.onTouchEnd,!1),e.addEventListener("touchcancel",this.onTouchCancel,!1),Event.prototype.stopImmediatePropagation||(e.removeEventListener=function(t,n,r){var i=Node.prototype.removeEventListener;t==="click"?i.call(e,t,n.hijacked||n,r):i.call(e,t,n,r)},e.addEventListener=function(t,n,r){var i=Node.prototype.addEventListener;t==="click"?i.call(e,t,n.hijacked||(n.hijacked=function(e){e.propagationStopped||n(e)}),r):i.call(e,t,n,r)}),typeof e.onclick=="function"&&(t=e.onclick,e.addEventListener("click",function(e){t(e)},!1),e.onclick=null)}(function(e){String.prototype.trim===e&&(String.prototype.trim=function(){return this.replace(/^\s+|\s+$/g,"")}),Array.prototype.reduce===e&&(Array.prototype.reduce=function(t){if(this===void 0||this===null)throw new TypeError;var n=Object(this),r=n.length>>>0,i=0,s;if(typeof t!="function")throw new TypeError;if(r==0&&arguments.length==1)throw new TypeError;if(arguments.length>=2)s=arguments[1];else do{if(i in n){s=n[i++];break}if(++i>=r)throw new TypeError}while(!0);while(i<r)i in n&&(s=t.call(e,s,n[i],i,n)),i++;return s})})();var Zepto=function(){function O(e){return e==null?String(e):T[N.call(e)]||"object"}function M(e){return O(e)=="function"}function _(e){return e!=null&&e==e.window}function D(e){return e!=null&&e.nodeType==e.DOCUMENT_NODE}function P(e){return O(e)=="object"}function H(e){return P(e)&&!_(e)&&e.__proto__==Object.prototype}function B(e){return e instanceof Array}function j(e){return typeof e.length=="number"}function F(e){return o.call(e,function(e){return e!=null})}function I(e){return e.length>0?n.fn.concat.apply([],e):e}function q(e){return e.replace(/::/g,"/").replace(/([A-Z]+)([A-Z][a-z])/g,"$1_$2").replace(/([a-z\d])([A-Z])/g,"$1_$2").replace(/_/g,"-").toLowerCase()}function R(e){return e in f?f[e]:f[e]=new RegExp("(^|\\s)"+e+"(\\s|$)")}function U(e,t){return typeof t=="number"&&!c[q(e)]?t+"px":t}function z(e){var t,n;return a[e]||(t=u.createElement(e),u.body.appendChild(t),n=l(t,"").getPropertyValue("display"),t.parentNode.removeChild(t),n=="none"&&(n="block"),a[e]=n),a[e]}function W(e){return"children"in e?s.call(e.children):n.map(e.childNodes,function(e){if(e.nodeType==1)return e})}function X(n,r,i){for(t in r)i&&(H(r[t])||B(r[t]))?(H(r[t])&&!H(n[t])&&(n[t]={}),B(r[t])&&!B(n[t])&&(n[t]=[]),X(n[t],r[t],i)):r[t]!==e&&(n[t]=r[t])}function V(t,r){return r===e?n(t):n(t).filter(r)}function $(e,t,n,r){return M(t)?t.call(e,n,r):t}function J(e,t,n){n==null?e.removeAttribute(t):e.setAttribute(t,n)}function K(t,n){var r=t.className,i=r&&r.baseVal!==e;if(n===e)return i?r.baseVal:r;i?r.baseVal=n:t.className=n}function Q(e){var t;try{return e?e=="true"||(e=="false"?!1:e=="null"?null:isNaN(t=Number(e))?/^[\[\{]/.test(e)?n.parseJSON(e):e:t):e}catch(r){return e}}function G(e,t){t(e);for(var n in e.childNodes)G(e.childNodes[n],t)}var e,t,n,r,i=[],s=i.slice,o=i.filter,u=window.document,a={},f={},l=u.defaultView.getComputedStyle,c={"column-count":1,columns:1,"font-weight":1,"line-height":1,opacity:1,"z-index":1,zoom:1},h=/^\s*<(\w+|!)[^>]*>/,p=/<(?!area|br|col|embed|hr|img|input|link|meta|param)(([\w:]+)[^>]*)\/>/ig,d=/^(?:body|html)$/i,v=["val","css","html","text","data","width","height","offset"],m=["after","prepend","before","append"],g=u.createElement("table"),y=u.createElement("tr"),b={tr:u.createElement("tbody"),tbody:g,thead:g,tfoot:g,td:y,th:y,"*":u.createElement("div")},w=/complete|loaded|interactive/,E=/^\.([\w-]+)$/,S=/^#([\w-]*)$/,x=/^[\w-]+$/,T={},N=T.toString,C={},k,L,A=u.createElement("div");return C.matches=function(e,t){if(!e||e.nodeType!==1)return!1;var n=e.webkitMatchesSelector||e.mozMatchesSelector||e.oMatchesSelector||e.matchesSelector;if(n)return n.call(e,t);var r,i=e.parentNode,s=!i;return s&&(i=A).appendChild(e),r=~C.qsa(i,t).indexOf(e),s&&A.removeChild(e),r},k=function(e){return e.replace(/-+(.)?/g,function(e,t){return t?t.toUpperCase():""})},L=function(e){return o.call(e,function(t,n){return e.indexOf(t)==n})},C.fragment=function(t,r,i){t.replace&&(t=t.replace(p,"<$1></$2>")),r===e&&(r=h.test(t)&&RegExp.$1),r in b||(r="*");var o,u,a=b[r];return a.innerHTML=""+t,u=n.each(s.call(a.childNodes),function(){a.removeChild(this)}),H(i)&&(o=n(u),n.each(i,function(e,t){v.indexOf(e)>-1?o[e](t):o.attr(e,t)})),u},C.Z=function(e,t){return e=e||[],e.__proto__=n.fn,e.selector=t||"",e},C.isZ=function(e){return e instanceof C.Z},C.init=function(t,r){if(!t)return C.Z();if(M(t))return n(u).ready(t);if(C.isZ(t))return t;var i;if(B(t))i=F(t);else if(P(t))i=[H(t)?n.extend({},t):t],t=null;else if(h.test(t))i=C.fragment(t.trim(),RegExp.$1,r),t=null;else{if(r!==e)return n(r).find(t);i=C.qsa(u,t)}return C.Z(i,t)},n=function(e,t){return C.init(e,t)},n.extend=function(e){var t,n=s.call(arguments,1);return typeof e=="boolean"&&(t=e,e=n.shift()),n.forEach(function(n){X(e,n,t)}),e},C.qsa=function(e,t){var n;return D(e)&&S.test(t)?(n=e.getElementById(RegExp.$1))?[n]:[]:e.nodeType!==1&&e.nodeType!==9?[]:s.call(E.test(t)?e.getElementsByClassName(RegExp.$1):x.test(t)?e.getElementsByTagName(t):e.querySelectorAll(t))},n.contains=function(e,t){return e!==t&&e.contains(t)},n.type=O,n.isFunction=M,n.isWindow=_,n.isArray=B,n.isPlainObject=H,n.isEmptyObject=function(e){var t;for(t in e)return!1;return!0},n.inArray=function(e,t,n){return i.indexOf.call(t,e,n)},n.camelCase=k,n.trim=function(e){return e.trim()},n.uuid=0,n.support={},n.expr={},n.map=function(e,t){var n,r=[],i,s;if(j(e))for(i=0;i<e.length;i++)n=t(e[i],i),n!=null&&r.push(n);else for(s in e)n=t(e[s],s),n!=null&&r.push(n);return I(r)},n.each=function(e,t){var n,r;if(j(e)){for(n=0;n<e.length;n++)if(t.call(e[n],n,e[n])===!1)return e}else for(r in e)if(t.call(e[r],r,e[r])===!1)return e;return e},n.grep=function(e,t){return o.call(e,t)},window.JSON&&(n.parseJSON=JSON.parse),n.each("Boolean Number String Function Array Date RegExp Object Error".split(" "),function(e,t){T["[object "+t+"]"]=t.toLowerCase()}),n.fn={forEach:i.forEach,reduce:i.reduce,push:i.push,sort:i.sort,indexOf:i.indexOf,concat:i.concat,map:function(e){return n(n.map(this,function(t,n){return e.call(t,n,t)}))},slice:function(){return n(s.apply(this,arguments))},ready:function(e){return w.test(u.readyState)?e(n):u.addEventListener("DOMContentLoaded",function(){e(n)},!1),this},get:function(t){return t===e?s.call(this):this[t>=0?t:t+this.length]},toArray:function(){return this.get()},size:function(){return this.length},remove:function(){return this.each(function(){this.parentNode!=null&&this.parentNode.removeChild(this)})},each:function(e){return i.every.call(this,function(t,n){return e.call(t,n,t)!==!1}),this},filter:function(e){return M(e)?this.not(this.not(e)):n(o.call(this,function(t){return C.matches(t,e)}))},add:function(e,t){return n(L(this.concat(n(e,t))))},is:function(e){return this.length>0&&C.matches(this[0],e)},not:function(t){var r=[];if(M(t)&&t.call!==e)this.each(function(e){t.call(this,e)||r.push(this)});else{var i=typeof t=="string"?this.filter(t):j(t)&&M(t.item)?s.call(t):n(t);this.forEach(function(e){i.indexOf(e)<0&&r.push(e)})}return n(r)},has:function(e){return this.filter(function(){return P(e)?n.contains(this,e):n(this).find(e).size()})},eq:function(e){return e===-1?this.slice(e):this.slice(e,+e+1)},first:function(){var e=this[0];return e&&!P(e)?e:n(e)},last:function(){var e=this[this.length-1];return e&&!P(e)?e:n(e)},find:function(e){var t,r=this;return typeof e=="object"?t=n(e).filter(function(){var e=this;return i.some.call(r,function(t){return n.contains(t,e)})}):this.length==1?t=n(C.qsa(this[0],e)):t=this.map(function(){return C.qsa(this,e)}),t},closest:function(e,t){var r=this[0],i=!1;typeof e=="object"&&(i=n(e));while(r&&!(i?i.indexOf(r)>=0:C.matches(r,e)))r=r!==t&&!D(r)&&r.parentNode;return n(r)},parents:function(e){var t=[],r=this;while(r.length>0)r=n.map(r,function(e){if((e=e.parentNode)&&!D(e)&&t.indexOf(e)<0)return t.push(e),e});return V(t,e)},parent:function(e){return V(L(this.pluck("parentNode")),e)},children:function(e){return V(this.map(function(){return W(this)}),e)},contents:function(){return this.map(function(){return s.call(this.childNodes)})},siblings:function(e){return V(this.map(function(e,t){return o.call(W(t.parentNode),function(e){return e!==t})}),e)},empty:function(){return this.each(function(){this.innerHTML=""})},pluck:function(e){return n.map(this,function(t){return t[e]})},show:function(){return this.each(function(){this.style.display=="none"&&(this.style.display=null),l(this,"").getPropertyValue("display")=="none"&&(this.style.display=z(this.nodeName))})},replaceWith:function(e){return this.before(e).remove()},wrap:function(e){var t=M(e);if(this[0]&&!t)var r=n(e).get(0),i=r.parentNode||this.length>1;return this.each(function(s){n(this).wrapAll(t?e.call(this,s):i?r.cloneNode(!0):r)})},wrapAll:function(e){if(this[0]){n(this[0]).before(e=n(e));var t;while((t=e.children()).length)e=t.first();n(e).append(this)}return this},wrapInner:function(e){var t=M(e);return this.each(function(r){var i=n(this),s=i.contents(),o=t?e.call(this,r):e;s.length?s.wrapAll(o):i.append(o)})},unwrap:function(){return this.parent().each(function(){n(this).replaceWith(n(this).children())}),this},clone:function(){return this.map(function(){return this.cloneNode(!0)})},hide:function(){return this.css("display","none")},toggle:function(t){return this.each(function(){var r=n(this);(t===e?r.css("display")=="none":t)?r.show():r.hide()})},prev:function(e){return n(this.pluck("previousElementSibling")).filter(e||"*")},next:function(e){return n(this.pluck("nextElementSibling")).filter(e||"*")},html:function(t){return t===e?this.length>0?this[0].innerHTML:null:this.each(function(e){var r=this.innerHTML;n(this).empty().append($(this,t,e,r))})},text:function(t){return t===e?this.length>0?this[0].textContent:null:this.each(function(){this.textContent=t})},attr:function(n,r){var i;return typeof n=="string"&&r===e?this.length==0||this[0].nodeType!==1?e:n=="value"&&this[0].nodeName=="INPUT"?this.val():!(i=this[0].getAttribute(n))&&n in this[0]?this[0][n]:i:this.each(function(e){if(this.nodeType!==1)return;if(P(n))for(t in n)J(this,t,n[t]);else J(this,n,$(this,r,e,this.getAttribute(n)))})},removeAttr:function(e){return this.each(function(){this.nodeType===1&&J(this,e)})},prop:function(t,n){return n===e?this[0]&&this[0][t]:this.each(function(e){this[t]=$(this,n,e,this[t])})},data:function(t,n){var r=this.attr("data-"+q(t),n);return r!==null?Q(r):e},val:function(t){return t===e?this[0]&&(this[0].multiple?n(this[0]).find("option").filter(function(e){return this.selected}).pluck("value"):this[0].value):this.each(function(e){this.value=$(this,t,e,this.value)})},offset:function(e){if(e)return this.each(function(t){var r=n(this),i=$(this,e,t,r.offset()),s=r.offsetParent().offset(),o={top:i.top-s.top,left:i.left-s.left};r.css("position")=="static"&&(o.position="relative"),r.css(o)});if(this.length==0)return null;var t=this[0].getBoundingClientRect();return{left:t.left+window.pageXOffset,top:t.top+window.pageYOffset,width:Math.round(t.width),height:Math.round(t.height)}},css:function(e,n){if(arguments.length<2&&typeof e=="string")return this[0]&&(this[0].style[k(e)]||l(this[0],"").getPropertyValue(e));var r="";if(O(e)=="string")!n&&n!==0?this.each(function(){this.style.removeProperty(q(e))}):r=q(e)+":"+U(e,n);else for(t in e)!e[t]&&e[t]!==0?this.each(function(){this.style.removeProperty(q(t))}):r+=q(t)+":"+U(t,e[t])+";";return this.each(function(){this.style.cssText+=";"+r})},index:function(e){return e?this.indexOf(n(e)[0]):this.parent().children().indexOf(this[0])},hasClass:function(e){return i.some.call(this,function(e){return this.test(K(e))},R(e))},addClass:function(e){return this.each(function(t){r=[];var i=K(this),s=$(this,e,t,i);s.split(/\s+/g).forEach(function(e){n(this).hasClass(e)||r.push(e)},this),r.length&&K(this,i+(i?" ":"")+r.join(" "))})},removeClass:function(t){return this.each(function(n){if(t===e)return K(this,"");r=K(this),$(this,t,n,r).split(/\s+/g).forEach(function(e){r=r.replace(R(e)," ")}),K(this,r.trim())})},toggleClass:function(t,r){return this.each(function(i){var s=n(this),o=$(this,t,i,K(this));o.split(/\s+/g).forEach(function(t){(r===e?!s.hasClass(t):r)?s.addClass(t):s.removeClass(t)})})},scrollTop:function(){if(!this.length)return;return"scrollTop"in this[0]?this[0].scrollTop:this[0].scrollY},position:function(){if(!this.length)return;var e=this[0],t=this.offsetParent(),r=this.offset(),i=d.test(t[0].nodeName)?{top:0,left:0}:t.offset();return r.top-=parseFloat(n(e).css("margin-top"))||0,r.left-=parseFloat(n(e).css("margin-left"))||0,i.top+=parseFloat(n(t[0]).css("border-top-width"))||0,i.left+=parseFloat(n(t[0]).css("border-left-width"))||0,{top:r.top-i.top,left:r.left-i.left}},offsetParent:function(){return this.map(function(){var e=this.offsetParent||u.body;while(e&&!d.test(e.nodeName)&&n(e).css("position")=="static")e=e.offsetParent;return e})}},n.fn.detach=n.fn.remove,["width","height"].forEach(function(t){n.fn[t]=function(r){var i,s=this[0],o=t.replace(/./,function(e){return e[0].toUpperCase()});return r===e?_(s)?s["inner"+o]:D(s)?s.documentElement["offset"+o]:(i=this.offset())&&i[t]:this.each(function(e){s=n(this),s.css(t,$(this,r,e,s[t]()))})}}),m.forEach(function(e,t){var r=t%2;n.fn[e]=function(){var e,i=n.map(arguments,function(t){return e=O(t),e=="object"||e=="array"||t==null?t:C.fragment(t)}),s,o=this.length>1;return i.length<1?this:this.each(function(e,u){s=r?u:u.parentNode,u=t==0?u.nextSibling:t==1?u.firstChild:t==2?u:null,i.forEach(function(e){if(o)e=e.cloneNode(!0);else if(!s)return n(e).remove();G(s.insertBefore(e,u),function(e){e.nodeName!=null&&e.nodeName.toUpperCase()==="SCRIPT"&&(!e.type||e.type==="text/javascript")&&!e.src&&window.eval.call(window,e.innerHTML)})})})},n.fn[r?e+"To":"insert"+(t?"Before":"After")]=function(t){return n(t)[e](this),this}}),C.Z.prototype=n.fn,C.uniq=L,C.deserializeValue=Q,n.zepto=C,n}();window.Zepto=Zepto,"$"in window||(window.$=Zepto),function(e){function t(e){var t=this.os={},n=this.browser={},r=e.match(/WebKit\/([\d.]+)/),i=e.match(/(Android)\s+([\d.]+)/),s=e.match(/(iPad).*OS\s([\d_]+)/),o=!s&&e.match(/(iPhone\sOS)\s([\d_]+)/),u=e.match(/(webOS|hpwOS)[\s\/]([\d.]+)/),a=u&&e.match(/TouchPad/),f=e.match(/Kindle\/([\d.]+)/),l=e.match(/Silk\/([\d._]+)/),c=e.match(/(BlackBerry).*Version\/([\d.]+)/),h=e.match(/(BB10).*Version\/([\d.]+)/),p=e.match(/(RIM\sTablet\sOS)\s([\d.]+)/),d=e.match(/PlayBook/),v=e.match(/Chrome\/([\d.]+)/)||e.match(/CriOS\/([\d.]+)/),m=e.match(/Firefox\/([\d.]+)/);if(n.webkit=!!r)n.version=r[1];i&&(t.android=!0,t.version=i[2]),o&&(t.ios=t.iphone=!0,t.version=o[2].replace(/_/g,".")),s&&(t.ios=t.ipad=!0,t.version=s[2].replace(/_/g,".")),u&&(t.webos=!0,t.version=u[2]),a&&(t.touchpad=!0),c&&(t.blackberry=!0,t.version=c[2]),h&&(t.bb10=!0,t.version=h[2]),p&&(t.rimtabletos=!0,t.version=p[2]),d&&(n.playbook=!0),f&&(t.kindle=!0,t.version=f[1]),l&&(n.silk=!0,n.version=l[1]),!l&&t.android&&e.match(/Kindle Fire/)&&(n.silk=!0),v&&(n.chrome=!0,n.version=v[1]),m&&(n.firefox=!0,n.version=m[1]),t.tablet=!!(s||d||i&&!e.match(/Mobile/)||m&&e.match(/Tablet/)),t.phone=!t.tablet&&!!(i||o||u||c||h||v&&e.match(/Android/)||v&&e.match(/CriOS\/([\d.]+)/)||m&&e.match(/Mobile/))}t.call(e,navigator.userAgent),e.__detect=t}(Zepto),function(e){function o(e){return e._zid||(e._zid=r++)}function u(e,t,r,i){t=a(t);if(t.ns)var s=f(t.ns);return(n[o(e)]||[]).filter(function(e){return e&&(!t.e||e.e==t.e)&&(!t.ns||s.test(e.ns))&&(!r||o(e.fn)===o(r))&&(!i||e.sel==i)})}function a(e){var t=(""+e).split(".");return{e:t[0],ns:t.slice(1).sort().join(" ")}}function f(e){return new RegExp("(?:^| )"+e.replace(" "," .* ?")+"(?: |$)")}function l(t,n,r){e.type(t)!="string"?e.each(t,r):t.split(/\s/).forEach(function(e){r(e,n)})}function c(e,t){return e.del&&(e.e=="focus"||e.e=="blur")||!!t}function h(e){return s[e]||e}function p(t,r,i,u,f,p){var d=o(t),v=n[d]||(n[d]=[]);l(r,i,function(n,r){var i=a(n);i.fn=r,i.sel=u,i.e in s&&(r=function(t){var n=t.relatedTarget;if(!n||n!==this&&!e.contains(this,n))return i.fn.apply(this,arguments)}),i.del=f&&f(r,n);var o=i.del||r;i.proxy=function(e){var n=o.apply(t,[e].concat(e.data));return n===!1&&(e.preventDefault(),e.stopPropagation()),n},i.i=v.length,v.push(i),t.addEventListener(h(i.e),i.proxy,c(i,p))})}function d(e,t,r,i,s){var a=o(e);l(t||"",r,function(t,r){u(e,t,r,i).forEach(function(t){delete n[a][t.i],e.removeEventListener(h(t.e),t.proxy,c(t,s))})})}function b(t){var n,r={originalEvent:t};for(n in t)!g.test(n)&&t[n]!==undefined&&(r[n]=t[n]);return e.each(y,function(e,n){r[e]=function(){return this[n]=v,t[e].apply(t,arguments)},r[n]=m}),r}function w(e){if(!("defaultPrevented"in e)){e.defaultPrevented=!1;var t=e.preventDefault;e.preventDefault=function(){this.defaultPrevented=!0,t.call(this)}}}var t=e.zepto.qsa,n={},r=1,i={},s={mouseenter:"mouseover",mouseleave:"mouseout"};i.click=i.mousedown=i.mouseup=i.mousemove="MouseEvents",e.event={add:p,remove:d},e.proxy=function(t,n){if(e.isFunction(t)){var r=function(){return t.apply(n,arguments)};return r._zid=o(t),r}if(typeof n=="string")return e.proxy(t[n],t);throw new TypeError("expected function")},e.fn.bind=function(e,t){return this.each(function(){p(this,e,t)})},e.fn.unbind=function(e,t){return this.each(function(){d(this,e,t)})},e.fn.one=function(e,t){return this.each(function(n,r){p(this,e,t,null,function(e,t){return function(){var n=e.apply(r,arguments);return d(r,t,e),n}})})};var v=function(){return!0},m=function(){return!1},g=/^([A-Z]|layer[XY]$)/,y={preventDefault:"isDefaultPrevented",stopImmediatePropagation:"isImmediatePropagationStopped",stopPropagation:"isPropagationStopped"};e.fn.delegate=function(t,n,r){return this.each(function(i,s){p(s,n,r,t,function(n){return function(r){var i,o=e(r.target).closest(t,s).get(0);if(o)return i=e.extend(b(r),{currentTarget:o,liveFired:s}),n.apply(o,[i].concat([].slice.call(arguments,1)))}})})},e.fn.undelegate=function(e,t,n){return this.each(function(){d(this,t,n,e)})},e.fn.live=function(t,n){return e(document.body).delegate(this.selector,t,n),this},e.fn.die=function(t,n){return e(document.body).undelegate(this.selector,t,n),this},e.fn.on=function(t,n,r){return!n||e.isFunction(n)?this.bind(t,n||r):this.delegate(n,t,r)},e.fn.off=function(t,n,r){return!n||e.isFunction(n)?this.unbind(t,n||r):this.undelegate(n,t,r)},e.fn.trigger=function(t,n){if(typeof t=="string"||e.isPlainObject(t))t=e.Event(t);return w(t),t.data=n,this.each(function(){"dispatchEvent"in this&&this.dispatchEvent(t)})},e.fn.triggerHandler=function(t,n){var r,i;return this.each(function(s,o){r=b(typeof t=="string"?e.Event(t):t),r.data=n,r.target=o,e.each(u(o,t.type||t),function(e,t){i=t.proxy(r);if(r.isImmediatePropagationStopped())return!1})}),i},"focusin focusout load resize scroll unload click dblclick mousedown mouseup mousemove mouseover mouseout mouseenter mouseleave change select keydown keypress keyup error".split(" ").forEach(function(t){e.fn[t]=function(e){return e?this.bind(t,e):this.trigger(t)}}),["focus","blur"].forEach(function(t){e.fn[t]=function(e){return e?this.bind(t,e):this.each(function(){try{this[t]()}catch(e){}}),this}}),e.Event=function(e,t){typeof e!="string"&&(t=e,e=t.type);var n=document.createEvent(i[e]||"Events"),r=!0;if(t)for(var s in t)s=="bubbles"?r=!!t[s]:n[s]=t[s];return n.initEvent(e,r,!0,null,null,null,null,null,null,null,null,null,null,null,null),n.isDefaultPrevented=function(){return this.defaultPrevented},n}}(Zepto),function($){function triggerAndReturn(e,t,n){var r=$.Event(t);return $(e).trigger(r,n),!r.defaultPrevented}function triggerGlobal(e,t,n,r){if(e.global)return triggerAndReturn(t||document,n,r)}function ajaxStart(e){e.global&&$.active++===0&&triggerGlobal(e,null,"ajaxStart")}function ajaxStop(e){e.global&&!--$.active&&triggerGlobal(e,null,"ajaxStop")}function ajaxBeforeSend(e,t){var n=t.context;if(t.beforeSend.call(n,e,t)===!1||triggerGlobal(t,n,"ajaxBeforeSend",[e,t])===!1)return!1;triggerGlobal(t,n,"ajaxSend",[e,t])}function ajaxSuccess(e,t,n){var r=n.context,i="success";n.success.call(r,e,i,t),triggerGlobal(n,r,"ajaxSuccess",[t,n,e]),ajaxComplete(i,t,n)}function ajaxError(e,t,n,r){var i=r.context;r.error.call(i,n,t,e),triggerGlobal(r,i,"ajaxError",[n,r,e]),ajaxComplete(t,n,r)}function ajaxComplete(e,t,n){var r=n.context;n.complete.call(r,t,e),triggerGlobal(n,r,"ajaxComplete",[t,n]),ajaxStop(n)}function empty(){}function mimeToDataType(e){return e&&(e=e.split(";",2)[0]),e&&(e==htmlType?"html":e==jsonType?"json":scriptTypeRE.test(e)?"script":xmlTypeRE.test(e)&&"xml")||"text"}function appendQuery(e,t){return(e+"&"+t).replace(/[&?]{1,2}/,"?")}function serializeData(e){e.processData&&e.data&&$.type(e.data)!="string"&&(e.data=$.param(e.data,e.traditional)),e.data&&(!e.type||e.type.toUpperCase()=="GET")&&(e.url=appendQuery(e.url,e.data))}function parseArguments(e,t,n,r){var i=!$.isFunction(t);return{url:e,data:i?t:undefined,success:i?$.isFunction(n)?n:undefined:t,dataType:i?r||n:n}}function serialize(e,t,n,r){var i,s=$.isArray(t);$.each(t,function(t,o){i=$.type(o),r&&(t=n?r:r+"["+(s?"":t)+"]"),!r&&s?e.add(o.name,o.value):i=="array"||!n&&i=="object"?serialize(e,o,n,t):e.add(t,o)})}var jsonpID=0,document=window.document,key,name,rscript=/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,scriptTypeRE=/^(?:text|application)\/javascript/i,xmlTypeRE=/^(?:text|application)\/xml/i,jsonType="application/json",htmlType="text/html",blankRE=/^\s*$/;$.active=0,$.ajaxJSONP=function(e){if("type"in e){var t="jsonp"+ ++jsonpID,n=document.createElement("script"),r=function(){clearTimeout(o),$(n).remove(),delete window[t]},i=function(n){r();if(!n||n=="timeout")window[t]=empty;ajaxError(null,n||"abort",s,e)},s={abort:i},o;return ajaxBeforeSend(s,e)===!1?(i("abort"),!1):(window[t]=function(t){r(),ajaxSuccess(t,s,e)},n.onerror=function(){i("error")},n.src=e.url.replace(/=\?/,"="+t),$("head").append(n),e.timeout>0&&(o=setTimeout(function(){i("timeout")},e.timeout)),s)}return $.ajax(e)},$.ajaxSettings={type:"GET",beforeSend:empty,success:empty,error:empty,complete:empty,context:null,global:!0,xhr:function(){return new window.XMLHttpRequest},accepts:{script:"text/javascript, application/javascript",json:jsonType,xml:"application/xml, text/xml",html:htmlType,text:"text/plain"},crossDomain:!1,timeout:0,processData:!0,cache:!0},$.ajax=function(options){var settings=$.extend({},options||{});for(key in $.ajaxSettings)settings[key]===undefined&&(settings[key]=$.ajaxSettings[key]);ajaxStart(settings),settings.crossDomain||(settings.crossDomain=/^([\w-]+:)?\/\/([^\/]+)/.test(settings.url)&&RegExp.$2!=window.location.host),settings.url||(settings.url=window.location.toString()),serializeData(settings),settings.cache===!1&&(settings.url=appendQuery(settings.url,"_="+Date.now()));var dataType=settings.dataType,hasPlaceholder=/=\?/.test(settings.url);if(dataType=="jsonp"||hasPlaceholder)return hasPlaceholder||(settings.url=appendQuery(settings.url,"callback=?")),$.ajaxJSONP(settings);var mime=settings.accepts[dataType],baseHeaders={},protocol=/^([\w-]+:)\/\//.test(settings.url)?RegExp.$1:window.location.protocol,xhr=settings.xhr(),abortTimeout;settings.crossDomain||(baseHeaders["X-Requested-With"]="XMLHttpRequest"),mime&&(baseHeaders.Accept=mime,mime.indexOf(",")>-1&&(mime=mime.split(",",2)[0]),xhr.overrideMimeType&&xhr.overrideMimeType(mime));if(settings.contentType||settings.contentType!==!1&&settings.data&&settings.type.toUpperCase()!="GET")baseHeaders["Content-Type"]=settings.contentType||"application/x-www-form-urlencoded";settings.headers=$.extend(baseHeaders,settings.headers||{}),xhr.onreadystatechange=function(){if(xhr.readyState==4){xhr.onreadystatechange=empty,clearTimeout(abortTimeout);var result,error=!1;if(xhr.status>=200&&xhr.status<300||xhr.status==304||xhr.status==0&&protocol=="file:"){dataType=dataType||mimeToDataType(xhr.getResponseHeader("content-type")),result=xhr.responseText;try{dataType=="script"?(1,eval)(result):dataType=="xml"?result=xhr.responseXML:dataType=="json"&&(result=blankRE.test(result)?null:$.parseJSON(result))}catch(e){error=e}error?ajaxError(error,"parsererror",xhr,settings):ajaxSuccess(result,xhr,settings)}else ajaxError(null,xhr.status?"error":"abort",xhr,settings)}};var async="async"in settings?settings.async:!0;xhr.open(settings.type,settings.url,async);for(name in settings.headers)xhr.setRequestHeader(name,settings.headers[name]);return ajaxBeforeSend(xhr,settings)===!1?(xhr.abort(),!1):(settings.timeout>0&&(abortTimeout=setTimeout(function(){xhr.onreadystatechange=empty,xhr.abort(),ajaxError(null,"timeout",xhr,settings)},settings.timeout)),xhr.send(settings.data?settings.data:null),xhr)},$.get=function(e,t,n,r){return $.ajax(parseArguments.apply(null,arguments))},$.post=function(e,t,n,r){var i=parseArguments.apply(null,arguments);return i.type="POST",$.ajax(i)},$.getJSON=function(e,t,n){var r=parseArguments.apply(null,arguments);return r.dataType="json",$.ajax(r)},$.fn.load=function(e,t,n){if(!this.length)return this;var r=this,i=e.split(/\s/),s,o=parseArguments(e,t,n),u=o.success;return i.length>1&&(o.url=i[0],s=i[1]),o.success=function(e){r.html(s?$("<div>").html(e.replace(rscript,"")).find(s):e),u&&u.apply(r,arguments)},$.ajax(o),this};var escape=encodeURIComponent;$.param=function(e,t){var n=[];return n.add=function(e,t){this.push(escape(e)+"="+escape(t))},serialize(n,e,t),n.join("&").replace(/%20/g,"+")}}(Zepto),function(e){e.fn.serializeArray=function(){var t=[],n;return e(Array.prototype.slice.call(this.get(0).elements)).each(function(){n=e(this);var r=n.attr("type");this.nodeName.toLowerCase()!="fieldset"&&!this.disabled&&r!="submit"&&r!="reset"&&r!="button"&&(r!="radio"&&r!="checkbox"||this.checked)&&t.push({name:n.attr("name"),value:n.val()})}),t},e.fn.serialize=function(){var e=[];return this.serializeArray().forEach(function(t){e.push(encodeURIComponent(t.name)+"="+encodeURIComponent(t.value))}),e.join("&")},e.fn.submit=function(t){if(t)this.bind("submit",t);else if(this.length){var n=e.Event("submit");this.eq(0).trigger(n),n.defaultPrevented||this.get(0).submit()}return this}}(Zepto),function(e,t){function y(e){return b(e.replace(/([a-z])([A-Z])/,"$1-$2"))}function b(e){return e.toLowerCase()}function w(e){return r?r+e:b(e)}var n="",r,i,s,o={Webkit:"webkit",Moz:"",O:"o",ms:"MS"},u=window.document,a=u.createElement("div"),f=/^((translate|rotate|scale)(X|Y|Z|3d)?|matrix(3d)?|perspective|skew(X|Y)?)$/i,l,c,h,p,d,v,m,g={};e.each(o,function(e,i){if(a.style[e+"TransitionProperty"]!==t)return n="-"+b(e)+"-",r=i,!1}),l=n+"transform",g[c=n+"transition-property"]=g[h=n+"transition-duration"]=g[p=n+"transition-timing-function"]=g[d=n+"animation-name"]=g[v=n+"animation-duration"]=g[m=n+"animation-timing-function"]="",e.fx={off:r===t&&a.style.transitionProperty===t,speeds:{_default:400,fast:200,slow:600},cssPrefix:n,transitionEnd:w("TransitionEnd"),animationEnd:w("AnimationEnd")},e.fn.animate=function(t,n,r,i){return e.isPlainObject(n)&&(r=n.easing,i=n.complete,n=n.duration),n&&(n=(typeof n=="number"?n:e.fx.speeds[n]||e.fx.speeds._default)/1e3),this.anim(t,n,r,i)},e.fn.anim=function(n,r,i,s){var o,u={},a,b="",w=this,E,S=e.fx.transitionEnd;r===t&&(r=.4),e.fx.off&&(r=0);if(typeof n=="string")u[d]=n,u[v]=r+"s",u[m]=i||"linear",S=e.fx.animationEnd;else{a=[];for(o in n)f.test(o)?b+=o+"("+n[o]+") ":(u[o]=n[o],a.push(y(o)));b&&(u[l]=b,a.push(l)),r>0&&typeof n=="object"&&(u[c]=a.join(", "),u[h]=r+"s",u[p]=i||"linear")}return E=function(t){if(typeof t!="undefined"){if(t.target!==t.currentTarget)return;e(t.target).unbind(S,E)}e(this).css(g),s&&s.call(this)},r>0&&this.bind(S,E),this.size()&&this.get(0).clientLeft,this.css(u),r<=0&&setTimeout(function(){w.each(function(){E.call(this)})},0),this},a=null}(Zepto),define("zepto",function(e){return function(){var t,n;return t||e.$}}(this)),function(){var e=this,t=e._,n={},r=Array.prototype,i=Object.prototype,s=Function.prototype,o=r.push,u=r.slice,a=r.concat,f=i.toString,l=i.hasOwnProperty,c=r.forEach,h=r.map,p=r.reduce,d=r.reduceRight,v=r.filter,m=r.every,g=r.some,y=r.indexOf,b=r.lastIndexOf,w=Array.isArray,E=Object.keys,S=s.bind,x=function(e){if(e instanceof x)return e;if(!(this instanceof x))return new x(e);this._wrapped=e};typeof exports!="undefined"?(typeof module!="undefined"&&module.exports&&(exports=module.exports=x),exports._=x):e._=x,x.VERSION="1.5.1";var T=x.each=x.forEach=function(e,t,r){if(e==null)return;if(c&&e.forEach===c)e.forEach(t,r);else if(e.length===+e.length){for(var i=0,s=e.length;i<s;i++)if(t.call(r,e[i],i,e)===n)return}else for(var o in e)if(x.has(e,o)&&t.call(r,e[o],o,e)===n)return};x.map=x.collect=function(e,t,n){var r=[];return e==null?r:h&&e.map===h?e.map(t,n):(T(e,function(e,i,s){r.push(t.call(n,e,i,s))}),r)};var N="Reduce of empty array with no initial value";x.reduce=x.foldl=x.inject=function(e,t,n,r){var i=arguments.length>2;e==null&&(e=[]);if(p&&e.reduce===p)return r&&(t=x.bind(t,r)),i?e.reduce(t,n):e.reduce(t);T(e,function(e,s,o){i?n=t.call(r,n,e,s,o):(n=e,i=!0)});if(!i)throw new TypeError(N);return n},x.reduceRight=x.foldr=function(e,t,n,r){var i=arguments.length>2;e==null&&(e=[]);if(d&&e.reduceRight===d)return r&&(t=x.bind(t,r)),i?e.reduceRight(t,n):e.reduceRight(t);var s=e.length;if(s!==+s){var o=x.keys(e);s=o.length}T(e,function(u,a,f){a=o?o[--s]:--s,i?n=t.call(r,n,e[a],a,f):(n=e[a],i=!0)});if(!i)throw new TypeError(N);return n},x.find=x.detect=function(e,t,n){var r;return C(e,function(e,i,s){if(t.call(n,e,i,s))return r=e,!0}),r},x.filter=x.select=function(e,t,n){var r=[];return e==null?r:v&&e.filter===v?e.filter(t,n):(T(e,function(e,i,s){t.call(n,e,i,s)&&r.push(e)}),r)},x.reject=function(e,t,n){return x.filter(e,function(e,r,i){return!t.call(n,e,r,i)},n)},x.every=x.all=function(e,t,r){t||(t=x.identity);var i=!0;return e==null?i:m&&e.every===m?e.every(t,r):(T(e,function(e,s,o){if(!(i=i&&t.call(r,e,s,o)))return n}),!!i)};var C=x.some=x.any=function(e,t,r){t||(t=x.identity);var i=!1;return e==null?i:g&&e.some===g?e.some(t,r):(T(e,function(e,s,o){if(i||(i=t.call(r,e,s,o)))return n}),!!i)};x.contains=x.include=function(e,t){return e==null?!1:y&&e.indexOf===y?e.indexOf(t)!=-1:C(e,function(e){return e===t})},x.invoke=function(e,t){var n=u.call(arguments,2),r=x.isFunction(t);return x.map(e,function(e){return(r?t:e[t]).apply(e,n)})},x.pluck=function(e,t){return x.map(e,function(e){return e[t]})},x.where=function(e,t,n){return x.isEmpty(t)?n?void 0:[]:x[n?"find":"filter"](e,function(e){for(var n in t)if(t[n]!==e[n])return!1;return!0})},x.findWhere=function(e,t){return x.where(e,t,!0)},x.max=function(e,t,n){if(!t&&x.isArray(e)&&e[0]===+e[0]&&e.length<65535)return Math.max.apply(Math,e);if(!t&&x.isEmpty(e))return-Infinity;var r={computed:-Infinity,value:-Infinity};return T(e,function(e,i,s){var o=t?t.call(n,e,i,s):e;o>r.computed&&(r={value:e,computed:o})}),r.value},x.min=function(e,t,n){if(!t&&x.isArray(e)&&e[0]===+e[0]&&e.length<65535)return Math.min.apply(Math,e);if(!t&&x.isEmpty(e))return Infinity;var r={computed:Infinity,value:Infinity};return T(e,function(e,i,s){var o=t?t.call(n,e,i,s):e;o<r.computed&&(r={value:e,computed:o})}),r.value},x.shuffle=function(e){var t,n=0,r=[];return T(e,function(e){t=x.random(n++),r[n-1]=r[t],r[t]=e}),r};var k=function(e){return x.isFunction(e)?e:function(t){return t[e]}};x.sortBy=function(e,t,n){var r=k(t);return x.pluck(x.map(e,function(e,t,i){return{value:e,index:t,criteria:r.call(n,e,t,i)}}).sort(function(e,t){var n=e.criteria,r=t.criteria;if(n!==r){if(n>r||n===void 0)return 1;if(n<r||r===void 0)return-1}return e.index<t.index?-1:1}),"value")};var L=function(e,t,n,r){var i={},s=k(t==null?x.identity:t);return T(e,function(t,o){var u=s.call(n,t,o,e);r(i,u,t)}),i};x.groupBy=function(e,t,n){return L(e,t,n,function(e,t,n){(x.has(e,t)?e[t]:e[t]=[]).push(n)})},x.countBy=function(e,t,n){return L(e,t,n,function(e,t){x.has(e,t)||(e[t]=0),e[t]++})},x.sortedIndex=function(e,t,n,r){n=n==null?x.identity:k(n);var i=n.call(r,t),s=0,o=e.length;while(s<o){var u=s+o>>>1;n.call(r,e[u])<i?s=u+1:o=u}return s},x.toArray=function(e){return e?x.isArray(e)?u.call(e):e.length===+e.length?x.map(e,x.identity):x.values(e):[]},x.size=function(e){return e==null?0:e.length===+e.length?e.length:x.keys(e).length},x.first=x.head=x.take=function(e,t,n){return e==null?void 0:t!=null&&!n?u.call(e,0,t):e[0]},x.initial=function(e,t,n){return u.call(e,0,e.length-(t==null||n?1:t))},x.last=function(e,t,n){return e==null?void 0:t!=null&&!n?u.call(e,Math.max(e.length-t,0)):e[e.length-1]},x.rest=x.tail=x.drop=function(e,t,n){return u.call(e,t==null||n?1:t)},x.compact=function(e){return x.filter(e,x.identity)};var A=function(e,t,n){return t&&x.every(e,x.isArray)?a.apply(n,e):(T(e,function(e){x.isArray(e)||x.isArguments(e)?t?o.apply(n,e):A(e,t,n):n.push(e)}),n)};x.flatten=function(e,t){return A(e,t,[])},x.without=function(e){return x.difference(e,u.call(arguments,1))},x.uniq=x.unique=function(e,t,n,r){x.isFunction(t)&&(r=n,n=t,t=!1);var i=n?x.map(e,n,r):e,s=[],o=[];return T(i,function(n,r){if(t?!r||o[o.length-1]!==n:!x.contains(o,n))o.push(n),s.push(e[r])}),s},x.union=function(){return x.uniq(x.flatten(arguments,!0))},x.intersection=function(e){var t=u.call(arguments,1);return x.filter(x.uniq(e),function(e){return x.every(t,function(t){return x.indexOf(t,e)>=0})})},x.difference=function(e){var t=a.apply(r,u.call(arguments,1));return x.filter(e,function(e){return!x.contains(t,e)})},x.zip=function(){var e=x.max(x.pluck(arguments,"length").concat(0)),t=new Array(e);for(var n=0;n<e;n++)t[n]=x.pluck(arguments,""+n);return t},x.object=function(e,t){if(e==null)return{};var n={};for(var r=0,i=e.length;r<i;r++)t?n[e[r]]=t[r]:n[e[r][0]]=e[r][1];return n},x.indexOf=function(e,t,n){if(e==null)return-1;var r=0,i=e.length;if(n){if(typeof n!="number")return r=x.sortedIndex(e,t),e[r]===t?r:-1;r=n<0?Math.max(0,i+n):n}if(y&&e.indexOf===y)return e.indexOf(t,n);for(;r<i;r++)if(e[r]===t)return r;return-1},x.lastIndexOf=function(e,t,n){if(e==null)return-1;var r=n!=null;if(b&&e.lastIndexOf===b)return r?e.lastIndexOf(t,n):e.lastIndexOf(t);var i=r?n:e.length;while(i--)if(e[i]===t)return i;return-1},x.range=function(e,t,n){arguments.length<=1&&(t=e||0,e=0),n=arguments[2]||1;var r=Math.max(Math.ceil((t-e)/n),0),i=0,s=new Array(r);while(i<r)s[i++]=e,e+=n;return s};var O=function(){};x.bind=function(e,t){var n,r;if(S&&e.bind===S)return S.apply(e,u.call(arguments,1));if(!x.isFunction(e))throw new TypeError;return n=u.call(arguments,2),r=function(){if(this instanceof r){O.prototype=e.prototype;var i=new O;O.prototype=null;var s=e.apply(i,n.concat(u.call(arguments)));return Object(s)===s?s:i}return e.apply(t,n.concat(u.call(arguments)))}},x.partial=function(e){var t=u.call(arguments,1);return function(){return e.apply(this,t.concat(u.call(arguments)))}},x.bindAll=function(e){var t=u.call(arguments,1);if(t.length===0)throw new Error("bindAll must be passed function names");return T(t,function(t){e[t]=x.bind(e[t],e)}),e},x.memoize=function(e,t){var n={};return t||(t=x.identity),function(){var r=t.apply(this,arguments);return x.has(n,r)?n[r]:n[r]=e.apply(this,arguments)}},x.delay=function(e,t){var n=u.call(arguments,2);return setTimeout(function(){return e.apply(null,n)},t)},x.defer=function(e){return x.delay.apply(x,[e,1].concat(u.call(arguments,1)))},x.throttle=function(e,t,n){var r,i,s,o=null,u=0;n||(n={});var a=function(){u=n.leading===!1?0:new Date,o=null,s=e.apply(r,i)};return function(){var f=new Date;!u&&n.leading===!1&&(u=f);var l=t-(f-u);return r=this,i=arguments,l<=0?(clearTimeout(o),o=null,u=f,s=e.apply(r,i)):!o&&n.trailing!==!1&&(o=setTimeout(a,l)),s}},x.debounce=function(e,t,n){var r,i=null;return function(){var s=this,o=arguments,u=function(){i=null,n||(r=e.apply(s,o))},a=n&&!i;return clearTimeout(i),i=setTimeout(u,t),a&&(r=e.apply(s,o)),r}},x.once=function(e){var t=!1,n;return function(){return t?n:(t=!0,n=e.apply(this,arguments),e=null,n)}},x.wrap=function(e,t){return function(){var n=[e];return o.apply(n,arguments),t.apply(this,n)}},x.compose=function(){var e=arguments;return function(){var t=arguments;for(var n=e.length-1;n>=0;n--)t=[e[n].apply(this,t)];return t[0]}},x.after=function(e,t){return function(){if(--e<1)return t.apply(this,arguments)}},x.keys=E||function(e){if(e!==Object(e))throw new TypeError("Invalid object");var t=[];for(var n in e)x.has(e,n)&&t.push(n);return t},x.values=function(e){var t=[];for(var n in e)x.has(e,n)&&t.push(e[n]);return t},x.pairs=function(e){var t=[];for(var n in e)x.has(e,n)&&t.push([n,e[n]]);return t},x.invert=function(e){var t={};for(var n in e)x.has(e,n)&&(t[e[n]]=n);return t},x.functions=x.methods=function(e){var t=[];for(var n in e)x.isFunction(e[n])&&t.push(n);return t.sort()},x.extend=function(e){return T(u.call(arguments,1),function(t){if(t)for(var n in t)e[n]=t[n]}),e},x.pick=function(e){var t={},n=a.apply(r,u.call(arguments,1));return T(n,function(n){n in e&&(t[n]=e[n])}),t},x.omit=function(e){var t={},n=a.apply(r,u.call(arguments,1));for(var i in e)x.contains(n,i)||(t[i]=e[i]);return t},x.defaults=function(e){return T(u.call(arguments,1),function(t){if(t)for(var n in t)e[n]===void 0&&(e[n]=t[n])}),e},x.clone=function(e){return x.isObject(e)?x.isArray(e)?e.slice():x.extend({},e):e},x.tap=function(e,t){return t(e),e};var M=function(e,t,n,r){if(e===t)return e!==0||1/e==1/t;if(e==null||t==null)return e===t;e instanceof x&&(e=e._wrapped),t instanceof x&&(t=t._wrapped);var i=f.call(e);if(i!=f.call(t))return!1;switch(i){case"[object String]":return e==String(t);case"[object Number]":return e!=+e?t!=+t:e==0?1/e==1/t:e==+t;case"[object Date]":case"[object Boolean]":return+e==+t;case"[object RegExp]":return e.source==t.source&&e.global==t.global&&e.multiline==t.multiline&&e.ignoreCase==t.ignoreCase}if(typeof e!="object"||typeof t!="object")return!1;var s=n.length;while(s--)if(n[s]==e)return r[s]==t;var o=e.constructor,u=t.constructor;if(o!==u&&!(x.isFunction(o)&&o instanceof o&&x.isFunction(u)&&u instanceof u))return!1;n.push(e),r.push(t);var a=0,l=!0;if(i=="[object Array]"){a=e.length,l=a==t.length;if(l)while(a--)if(!(l=M(e[a],t[a],n,r)))break}else{for(var c in e)if(x.has(e,c)){a++;if(!(l=x.has(t,c)&&M(e[c],t[c],n,r)))break}if(l){for(c in t)if(x.has(t,c)&&!(a--))break;l=!a}}return n.pop(),r.pop(),l};x.isEqual=function(e,t){return M(e,t,[],[])},x.isEmpty=function(e){if(e==null)return!0;if(x.isArray(e)||x.isString(e))return e.length===0;for(var t in e)if(x.has(e,t))return!1;return!0},x.isElement=function(e){return!!e&&e.nodeType===1},x.isArray=w||function(e){return f.call(e)=="[object Array]"},x.isObject=function(e){return e===Object(e)},T(["Arguments","Function","String","Number","Date","RegExp"],function(e){x["is"+e]=function(t){return f.call(t)=="[object "+e+"]"}}),x.isArguments(arguments)||(x.isArguments=function(e){return!!e&&!!x.has(e,"callee")}),typeof /./!="function"&&(x.isFunction=function(e){return typeof e=="function"}),x.isFinite=function(e){return isFinite(e)&&!isNaN(parseFloat(e))},x.isNaN=function(e){return x.isNumber(e)&&e!=+e},x.isBoolean=function(e){return e===!0||e===!1||f.call(e)=="[object Boolean]"},x.isNull=function(e){return e===null},x.isUndefined=function(e){return e===void 0},x.has=function(e,t){return l.call(e,t)},x.noConflict=function(){return e._=t,this},x.identity=function(e){return e},x.times=function(e,t,n){var r=Array(Math.max(0,e));for(var i=0;i<e;i++)r[i]=t.call(n,i);return r},x.random=function(e,t){return t==null&&(t=e,e=0),e+Math.floor(Math.random()*(t-e+1))};var _={escape:{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#x27;","/":"&#x2F;"}};_.unescape=x.invert(_.escape);var D={escape:new RegExp("["+x.keys(_.escape).join("")+"]","g"),unescape:new RegExp("("+x.keys(_.unescape).join("|")+")","g")};x.each(["escape","unescape"],function(e){x[e]=function(t){return t==null?"":(""+t).replace(D[e],function(t){return _[e][t]})}}),x.result=function(e,t){if(e==null)return void 0;var n=e[t];return x.isFunction(n)?n.call(e):n},x.mixin=function(e){T(x.functions(e),function(t){var n=x[t]=e[t];x.prototype[t]=function(){var e=[this._wrapped];return o.apply(e,arguments),F.call(this,n.apply(x,e))}})};var P=0;x.uniqueId=function(e){var t=++P+"";return e?e+t:t},x.templateSettings={evaluate:/<%([\s\S]+?)%>/g,interpolate:/<%=([\s\S]+?)%>/g,escape:/<%-([\s\S]+?)%>/g};var H=/(.)^/,B={"'":"'","\\":"\\","\r":"r","\n":"n","	":"t","\u2028":"u2028","\u2029":"u2029"},j=/\\|'|\r|\n|\t|\u2028|\u2029/g;x.template=function(e,t,n){var r;n=x.defaults({},n,x.templateSettings);var i=new RegExp([(n.escape||H).source,(n.interpolate||H).source,(n.evaluate||H).source].join("|")+"|$","g"),s=0,o="__p+='";e.replace(i,function(t,n,r,i,u){return o+=e.slice(s,u).replace(j,function(e){return"\\"+B[e]}),n&&(o+="'+\n((__t=("+n+"))==null?'':_.escape(__t))+\n'"),r&&(o+="'+\n((__t=("+r+"))==null?'':__t)+\n'"),i&&(o+="';\n"+i+"\n__p+='"),s=u+t.length,t}),o+="';\n",n.variable||(o="with(obj||{}){\n"+o+"}\n"),o="var __t,__p='',__j=Array.prototype.join,print=function(){__p+=__j.call(arguments,'');};\n"+o+"return __p;\n";try{r=new Function(n.variable||"obj","_",o)}catch(u){throw u.source=o,u}if(t)return r(t,x);var a=function(e){return r.call(this,e,x)};return a.source="function("+(n.variable||"obj")+"){\n"+o+"}",a},x.chain=function(e){return x(e).chain()};var F=function(e){return this._chain?x(e).chain():e};x.mixin(x),T(["pop","push","reverse","shift","sort","splice","unshift"],function(e){var t=r[e];x.prototype[e]=function(){var n=this._wrapped;return t.apply(n,arguments),(e=="shift"||e=="splice")&&n.length===0&&delete n[0],F.call(this,n)}}),T(["concat","join","slice"],function(e){var t=r[e];x.prototype[e]=function(){return F.call(this,t.apply(this._wrapped,arguments))}}),x.extend(x.prototype,{chain:function(){return this._chain=!0,this},value:function(){return this._wrapped}})}.call(this),define("underscore",function(e){return function(){var t,n;return t||e._}}(this)),function(){var e=this,t=e.Backbone,n=[],r=n.push,i=n.slice,s=n.splice,o;typeof exports!="undefined"?o=exports:o=e.Backbone={},o.VERSION="1.0.0";var u=e._;!u&&typeof require!="undefined"&&(u=require("underscore")),o.$=e.jQuery||e.Zepto||e.ender||e.$,o.noConflict=function(){return e.Backbone=t,this},o.emulateHTTP=!1,o.emulateJSON=!1;var a=o.Events={on:function(e,t,n){if(!l(this,"on",e,[t,n])||!t)return this;this._events||(this._events={});var r=this._events[e]||(this._events[e]=[]);return r.push({callback:t,context:n,ctx:n||this}),this},once:function(e,t,n){if(!l(this,"once",e,[t,n])||!t)return this;var r=this,i=u.once(function(){r.off(e,i),t.apply(this,arguments)});return i._callback=t,this.on(e,i,n)},off:function(e,t,n){var r,i,s,o,a,f,c,h;if(!this._events||!l(this,"off",e,[t,n]))return this;if(!e&&!t&&!n)return this._events={},this;o=e?[e]:u.keys(this._events);for(a=0,f=o.length;a<f;a++){e=o[a];if(s=this._events[e]){this._events[e]=r=[];if(t||n)for(c=0,h=s.length;c<h;c++)i=s[c],(t&&t!==i.callback&&t!==i.callback._callback||n&&n!==i.context)&&r.push(i);r.length||delete this._events[e]}}return this},trigger:function(e){if(!this._events)return this;var t=i.call(arguments,1);if(!l(this,"trigger",e,t))return this;var n=this._events[e],r=this._events.all;return n&&c(n,t),r&&c(r,arguments),this},stopListening:function(e,t,n){var r=this._listeners;if(!r)return this;var i=!t&&!n;typeof t=="object"&&(n=this),e&&((r={})[e._listenerId]=e);for(var s in r)r[s].off(t,n,this),i&&delete this._listeners[s];return this}},f=/\s+/,l=function(e,t,n,r){if(!n)return!0;if(typeof n=="object"){for(var i in n)e[t].apply(e,[i,n[i]].concat(r));return!1}if(f.test(n)){var s=n.split(f);for(var o=0,u=s.length;o<u;o++)e[t].apply(e,[s[o]].concat(r));return!1}return!0},c=function(e,t){var n,r=-1,i=e.length,s=t[0],o=t[1],u=t[2];switch(t.length){case 0:while(++r<i)(n=e[r]).callback.call(n.ctx);return;case 1:while(++r<i)(n=e[r]).callback.call(n.ctx,s);return;case 2:while(++r<i)(n=e[r]).callback.call(n.ctx,s,o);return;case 3:while(++r<i)(n=e[r]).callback.call(n.ctx,s,o,u);return;default:while(++r<i)(n=e[r]).callback.apply(n.ctx,t)}},h={listenTo:"on",listenToOnce:"once"};u.each(h,function(e,t){a[t]=function(t,n,r){var i=this._listeners||(this._listeners={}),s=t._listenerId||(t._listenerId=u.uniqueId("l"));return i[s]=t,typeof n=="object"&&(r=this),t[e](n,r,this),this}}),a.bind=a.on,a.unbind=a.off,u.extend(o,a);var p=o.Model=function(e,t){var n,r=e||{};t||(t={}),this.cid=u.uniqueId("c"),this.attributes={},u.extend(this,u.pick(t,d)),t.parse&&(r=this.parse(r,t)||{});if(n=u.result(this,"defaults"))r=u.defaults({},r,n);this.set(r,t),this.changed={},this.initialize.apply(this,arguments)},d=["url","urlRoot","collection"];u.extend(p.prototype,a,{changed:null,validationError:null,idAttribute:"id",initialize:function(){},toJSON:function(e){return u.clone(this.attributes)},sync:function(){return o.sync.apply(this,arguments)},get:function(e){return this.attributes[e]},escape:function(e){return u.escape(this.get(e))},has:function(e){return this.get(e)!=null},set:function(e,t,n){var r,i,s,o,a,f,l,c;if(e==null)return this;typeof e=="object"?(i=e,n=t):(i={})[e]=t,n||(n={});if(!this._validate(i,n))return!1;s=n.unset,a=n.silent,o=[],f=this._changing,this._changing=!0,f||(this._previousAttributes=u.clone(this.attributes),this.changed={}),c=this.attributes,l=this._previousAttributes,this.idAttribute in i&&(this.id=i[this.idAttribute]);for(r in i)t=i[r],u.isEqual(c[r],t)||o.push(r),u.isEqual(l[r],t)?delete this.changed[r]:this.changed[r]=t,s?delete c[r]:c[r]=t;if(!a){o.length&&(this._pending=!0);for(var h=0,p=o.length;h<p;h++)this.trigger("change:"+o[h],this,c[o[h]],n)}if(f)return this;if(!a)while(this._pending)this._pending=!1,this.trigger("change",this,n);return this._pending=!1,this._changing=!1,this},unset:function(e,t){return this.set(e,void 0,u.extend({},t,{unset:!0}))},clear:function(e){var t={};for(var n in this.attributes)t[n]=void 0;return this.set(t,u.extend({},e,{unset:!0}))},hasChanged:function(e){return e==null?!u.isEmpty(this.changed):u.has(this.changed,e)},changedAttributes:function(e){if(!e)return this.hasChanged()?u.clone(this.changed):!1;var t,n=!1,r=this._changing?this._previousAttributes:this.attributes;for(var i in e){if(u.isEqual(r[i],t=e[i]))continue;(n||(n={}))[i]=t}return n},previous:function(e){return e==null||!this._previousAttributes?null:this._previousAttributes[e]},previousAttributes:function(){return u.clone(this._previousAttributes)},fetch:function(e){e=e?u.clone(e):{},e.parse===void 0&&(e.parse=!0);var t=this,n=e.success;return e.success=function(r){if(!t.set(t.parse(r,e),e))return!1;n&&n(t,r,e),t.trigger("sync",t,r,e)},j(this,e),this.sync("read",this,e)},save:function(e,t,n){var r,i,s,o=this.attributes;e==null||typeof e=="object"?(r=e,n=t):(r={})[e]=t;if(r&&(!n||!n.wait)&&!this.set(r,n))return!1;n=u.extend({validate:!0},n);if(!this._validate(r,n))return!1;r&&n.wait&&(this.attributes=u.extend({},o,r)),n.parse===void 0&&(n.parse=!0);var a=this,f=n.success;return n.success=function(e){a.attributes=o;var t=a.parse(e,n);n.wait&&(t=u.extend(r||{},t));if(u.isObject(t)&&!a.set(t,n))return!1;f&&f(a,e,n),a.trigger("sync",a,e,n)},j(this,n),i=this.isNew()?"create":n.patch?"patch":"update",i==="patch"&&(n.attrs=r),s=this.sync(i,this,n),r&&n.wait&&(this.attributes=o),s},destroy:function(e){e=e?u.clone(e):{};var t=this,n=e.success,r=function(){t.trigger("destroy",t,t.collection,e)};e.success=function(i){(e.wait||t.isNew())&&r(),n&&n(t,i,e),t.isNew()||t.trigger("sync",t,i,e)};if(this.isNew())return e.success(),!1;j(this,e);var i=this.sync("delete",this,e);return e.wait||r(),i},url:function(){var e=u.result(this,"urlRoot")||u.result(this.collection,"url")||B();return this.isNew()?e:e+(e.charAt(e.length-1)==="/"?"":"/")+encodeURIComponent(this.id)},parse:function(e,t){return e},clone:function(){return new this.constructor(this.attributes)},isNew:function(){return this.id==null},isValid:function(e){return this._validate({},u.extend(e||{},{validate:!0}))},_validate:function(e,t){if(!t.validate||!this.validate)return!0;e=u.extend({},this.attributes,e);var n=this.validationError=this.validate(e,t)||null;return n?(this.trigger("invalid",this,n,u.extend(t||{},{validationError:n})),!1):!0}});var v=["keys","values","pairs","invert","pick","omit"];u.each(v,function(e){p.prototype[e]=function(){var t=i.call(arguments);return t.unshift(this.attributes),u[e].apply(u,t)}});var m=o.Collection=function(e,t){t||(t={}),t.url&&(this.url=t.url),t.model&&(this.model=t.model),t.comparator!==void 0&&(this.comparator=t.comparator),this._reset(),this.initialize.apply(this,arguments),e&&this.reset(e,u.extend({silent:!0},t))},g={add:!0,remove:!0,merge:!0},y={add:!0,merge:!1,remove:!1};u.extend(m.prototype,a,{model:p,initialize:function(){},toJSON:function(e){return this.map(function(t){return t.toJSON(e)})},sync:function(){return o.sync.apply(this,arguments)},add:function(e,t){return this.set(e,u.defaults(t||{},y))},remove:function(e,t){e=u.isArray(e)?e.slice():[e],t||(t={});var n,r,i,s;for(n=0,r=e.length;n<r;n++){s=this.get(e[n]);if(!s)continue;delete this._byId[s.id],delete this._byId[s.cid],i=this.indexOf(s),this.models.splice(i,1),this.length--,t.silent||(t.index=i,s.trigger("remove",s,this,t)),this._removeReference(s)}return this},set:function(e,t){t=u.defaults(t||{},g),t.parse&&(e=this.parse(e,t)),u.isArray(e)||(e=e?[e]:[]);var n,i,o,a,f,l,c=t.at,h=this.comparator&&c==null&&t.sort!==!1,p=u.isString(this.comparator)?this.comparator:null,d=[],v=[],m={};for(n=0,i=e.length;n<i;n++){if(!(o=this._prepareModel(e[n],t)))continue;(f=this.get(o))?(t.remove&&(m[f.cid]=!0),t.merge&&(f.set(o.attributes,t),h&&!l&&f.hasChanged(p)&&(l=!0))):t.add&&(d.push(o),o.on("all",this._onModelEvent,this),this._byId[o.cid]=o,o.id!=null&&(this._byId[o.id]=o))}if(t.remove){for(n=0,i=this.length;n<i;++n)m[(o=this.models[n]).cid]||v.push(o);v.length&&this.remove(v,t)}d.length&&(h&&(l=!0),this.length+=d.length,c!=null?s.apply(this.models,[c,0].concat(d)):r.apply(this.models,d)),l&&this.sort({silent:!0});if(t.silent)return this;for(n=0,i=d.length;n<i;n++)(o=d[n]).trigger("add",o,this,t);return l&&this.trigger("sort",this,t),this},reset:function(e,t){t||(t={});for(var n=0,r=this.models.length;n<r;n++)this._removeReference(this.models[n]);return t.previousModels=this.models,this._reset(),this.add(e,u.extend({silent:!0},t)),t.silent||this.trigger("reset",this,t),this},push:function(e,t){return e=this._prepareModel(e,t),this.add(e,u.extend({at:this.length},t)),e},pop:function(e){var t=this.at(this.length-1);return this.remove(t,e),t},unshift:function(e,t){return e=this._prepareModel(e,t),this.add(e,u.extend({at:0},t)),e},shift:function(e){var t=this.at(0);return this.remove(t,e),t},slice:function(e,t){return this.models.slice(e,t)},get:function(e){return e==null?void 0:this._byId[e.id!=null?e.id:e.cid||e]},at:function(e){return this.models[e]},where:function(e,t){return u.isEmpty(e)?t?void 0:[]:this[t?"find":"filter"](function(t){for(var n in e)if(e[n]!==t.get(n))return!1;return!0})},findWhere:function(e){return this.where(e,!0)},sort:function(e){if(!this.comparator)throw new Error("Cannot sort a set without a comparator");return e||(e={}),u.isString(this.comparator)||this.comparator.length===1?this.models=this.sortBy(this.comparator,this):this.models.sort(u.bind(this.comparator,this)),e.silent||this.trigger("sort",this,e),this},sortedIndex:function(e,t,n){t||(t=this.comparator);var r=u.isFunction(t)?t:function(e){return e.get(t)};return u.sortedIndex(this.models,e,r,n)},pluck:function(e){return u.invoke(this.models,"get",e)},fetch:function(e){e=e?u.clone(e):{},e.parse===void 0&&(e.parse=!0);var t=e.success,n=this;return e.success=function(r){var i=e.reset?"reset":"set";n[i](r,e),t&&t(n,r,e),n.trigger("sync",n,r,e)},j(this,e),this.sync("read",this,e)},create:function(e,t){t=t?u.clone(t):{};if(!(e=this._prepareModel(e,t)))return!1;t.wait||this.add(e,t);var n=this,r=t.success;return t.success=function(i){t.wait&&n.add(e,t),r&&r(e,i,t)},e.save(null,t),e},parse:function(e,t){return e},clone:function(){return new this.constructor(this.models)},_reset:function(){this.length=0,this.models=[],this._byId={}},_prepareModel:function(e,t){if(e instanceof p)return e.collection||(e.collection=this),e;t||(t={}),t.collection=this;var n=new this.model(e,t);return n._validate(e,t)?n:(this.trigger("invalid",this,e,t),!1)},_removeReference:function(e){this===e.collection&&delete e.collection,e.off("all",this._onModelEvent,this)},_onModelEvent:function(e,t,n,r){if((e==="add"||e==="remove")&&n!==this)return;e==="destroy"&&this.remove(t,r),t&&e==="change:"+t.idAttribute&&(delete this._byId[t.previous(t.idAttribute)],t.id!=null&&(this._byId[t.id]=t)),this.trigger.apply(this,arguments)}});var b=["forEach","each","map","collect","reduce","foldl","inject","reduceRight","foldr","find","detect","filter","select","reject","every","all","some","any","include","contains","invoke","max","min","toArray","size","first","head","take","initial","rest","tail","drop","last","without","indexOf","shuffle","lastIndexOf","isEmpty","chain"];u.each(b,function(e){m.prototype[e]=function(){var t=i.call(arguments);return t.unshift(this.models),u[e].apply(u,t)}});var w=["groupBy","countBy","sortBy"];u.each(w,function(e){m.prototype[e]=function(t,n){var r=u.isFunction(t)?t:function(e){return e.get(t)};return u[e](this.models,r,n)}});var E=o.View=function(e){this.cid=u.uniqueId("view"),this._configure(e||{}),this._ensureElement(),this.initialize.apply(this,arguments),this.delegateEvents()},S=/^(\S+)\s*(.*)$/,x=["model","collection","el","id","attributes","className","tagName","events"];u.extend(E.prototype,a,{tagName:"div",$:function(e){return this.$el.find(e)},initialize:function(){},render:function(){return this},remove:function(){return this.$el.remove(),this.stopListening(),this},setElement:function(e,t){return this.$el&&this.undelegateEvents(),this.$el=e instanceof o.$?e:o.$(e),this.el=this.$el[0],t!==!1&&this.delegateEvents(),this},delegateEvents:function(e){if(!e&&!(e=u.result(this,"events")))return this;this.undelegateEvents();for(var t in e){var n=e[t];u.isFunction(n)||(n=this[e[t]]);if(!n)continue;var r=t.match(S),i=r[1],s=r[2];n=u.bind(n,this),i+=".delegateEvents"+this.cid,s===""?this.$el.on(i,n):this.$el.on(i,s,n)}return this},undelegateEvents:function(){return this.$el.off(".delegateEvents"+this.cid),this},_configure:function(e){this.options&&(e=u.extend({},u.result(this,"options"),e)),u.extend(this,u.pick(e,x)),this.options=e},_ensureElement:function(){if(!this.el){var e=u.extend({},u.result(this,"attributes"));this.id&&(e.id=u.result(this,"id")),this.className&&(e["class"]=u.result(this,"className"));var t=o.$("<"+u.result(this,"tagName")+">").attr(e);this.setElement(t,!1)}else this.setElement(u.result(this,"el"),!1)}}),o.sync=function(e,t,n){var r=T[e];u.defaults(n||(n={}),{emulateHTTP:o.emulateHTTP,emulateJSON:o.emulateJSON});var i={type:r,dataType:"json"};n.url||(i.url=u.result(t,"url")||B()),n.data==null&&t&&(e==="create"||e==="update"||e==="patch")&&(i.contentType="application/json",i.data=JSON.stringify(n.attrs||t.toJSON(n))),n.emulateJSON&&(i.contentType="application/x-www-form-urlencoded",i.data=i.data?{model:i.data}:{});if(n.emulateHTTP&&(r==="PUT"||r==="DELETE"||r==="PATCH")){i.type="POST",n.emulateJSON&&(i.data._method=r);var s=n.beforeSend;n.beforeSend=function(e){e.setRequestHeader("X-HTTP-Method-Override",r);if(s)return s.apply(this,arguments)}}i.type!=="GET"&&!n.emulateJSON&&(i.processData=!1),i.type==="PATCH"&&window.ActiveXObject&&(!window.external||!window.external.msActiveXFilteringEnabled)&&(i.xhr=function(){return new ActiveXObject("Microsoft.XMLHTTP")});var a=n.xhr=o.ajax(u.extend(i,n));return t.trigger("request",t,a,n),a};var T={create:"POST",update:"PUT",patch:"PATCH","delete":"DELETE",read:"GET"};o.ajax=function(){return o.$.ajax.apply(o.$,arguments)};var N=o.Router=function(e){e||(e={}),e.routes&&(this.routes=e.routes),this._bindRoutes(),this.initialize.apply(this,arguments)},C=/\((.*?)\)/g,k=/(\(\?)?:\w+/g,L=/\*\w+/g,A=/[\-{}\[\]+?.,\\\^$|#\s]/g;u.extend(N.prototype,a,{initialize:function(){},route:function(e,t,n){u.isRegExp(e)||(e=this._routeToRegExp(e)),u.isFunction(t)&&(n=t,t=""),n||(n=this[t]);var r=this;return o.history.route(e,function(i){var s=r._extractParameters(e,i);n&&n.apply(r,s),r.trigger.apply(r,["route:"+t].concat(s)),r.trigger("route",t,s),o.history.trigger("route",r,t,s)}),this},navigate:function(e,t){return o.history.navigate(e,t),this},_bindRoutes:function(){if(!this.routes)return;this.routes=u.result(this,"routes");var e,t=u.keys(this.routes);while((e=t.pop())!=null)this.route(e,this.routes[e])},_routeToRegExp:function(e){return e=e.replace(A,"\\$&").replace(C,"(?:$1)?").replace(k,function(e,t){return t?e:"([^/]+)"}).replace(L,"(.*?)"),new RegExp("^"+e+"$")},_extractParameters:function(e,t){var n=e.exec(t).slice(1);return u.map(n,function(e){return e?decodeURIComponent(e):null})}});var O=o.History=function(){this.handlers=[],u.bindAll(this,"checkUrl"),typeof window!="undefined"&&(this.location=window.location,this.history=window.history)},M=/^[#\/]|\s+$/g,_=/^\/+|\/+$/g,D=/msie [\w.]+/,P=/\/$/;O.started=!1,u.extend(O.prototype,a,{interval:50,getHash:function(e){var t=(e||this).location.href.match(/#(.*)$/);return t?t[1]:""},getFragment:function(e,t){if(e==null)if(this._hasPushState||!this._wantsHashChange||t){e=this.location.pathname;var n=this.root.replace(P,"");e.indexOf(n)||(e=e.substr(n.length))}else e=this.getHash();return e.replace(M,"")},start:function(e){if(O.started)throw new Error("Backbone.history has already been started");O.started=!0,this.options=u.extend({},{root:"/"},this.options,e),this.root=this.options.root,this._wantsHashChange=this.options.hashChange!==!1,this._wantsPushState=!!this.options.pushState,this._hasPushState=!!(this.options.pushState&&this.history&&this.history.pushState);var t=this.getFragment(),n=document.documentMode,r=D.exec(navigator.userAgent.toLowerCase())&&(!n||n<=7);this.root=("/"+this.root+"/").replace(_,"/"),r&&this._wantsHashChange&&(this.iframe=o.$('<iframe src="javascript:0" tabindex="-1" />').hide().appendTo("body")[0].contentWindow,this.navigate(t)),this._hasPushState?o.$(window).on("popstate",this.checkUrl):this._wantsHashChange&&"onhashchange"in window&&!r?o.$(window).on("hashchange",this.checkUrl):this._wantsHashChange&&(this._checkUrlInterval=setInterval(this.checkUrl,this.interval)),this.fragment=t;var i=this.location,s=i.pathname.replace(/[^\/]$/,"$&/")===this.root;if(this._wantsHashChange&&this._wantsPushState&&!this._hasPushState&&!s)return this.fragment=this.getFragment(null,!0),this.location.replace(this.root+this.location.search+"#"+this.fragment),!0;this._wantsPushState&&this._hasPushState&&s&&i.hash&&(this.fragment=this.getHash().replace(M,""),this.history.replaceState({},document.title,this.root+this.fragment+i.search));if(!this.options.silent)return this.loadUrl()},stop:function(){o.$(window).off("popstate",this.checkUrl).off("hashchange",this.checkUrl),clearInterval(this._checkUrlInterval),O.started=!1},route:function(e,t){this.handlers.unshift({route:e,callback:t})},checkUrl:function(e){var t=this.getFragment();t===this.fragment&&this.iframe&&(t=this.getFragment(this.getHash(this.iframe)));if(t===this.fragment)return!1;this.iframe&&this.navigate(t),this.loadUrl()||this.loadUrl(this.getHash())},loadUrl:function(e){var t=this.fragment=this.getFragment(e),n=u.any(this.handlers,function(e){if(e.route.test(t))return e.callback(t),!0});return n},navigate:function(e,t){if(!O.started)return!1;if(!t||t===!0)t={trigger:t};e=this.getFragment(e||"");if(this.fragment===e)return;this.fragment=e;var n=this.root+e;if(this._hasPushState)this.history[t.replace?"replaceState":"pushState"]({},document.title,n);else{if(!this._wantsHashChange)return this.location.assign(n);this._updateHash(this.location,e,t.replace),this.iframe&&e!==this.getFragment(this.getHash(this.iframe))&&(t.replace||this.iframe.document.open().close(),this._updateHash(this.iframe.location,e,t.replace))}t.trigger&&this.loadUrl(e)},_updateHash:function(e,t,n){if(n){var r=e.href.replace(/(javascript:|#).*$/,"");e.replace(r+"#"+t)}else e.hash="#"+t}}),o.history=new O;var H=function(e,t){var n=this,r;e&&u.has(e,"constructor")?r=e.constructor:r=function(){return n.apply(this,arguments)},u.extend(r,n,t);var i=function(){this.constructor=r};return i.prototype=n.prototype,r.prototype=new i,e&&u.extend(r.prototype,e),r.__super__=n.prototype,r};p.extend=m.extend=N.extend=E.extend=O.extend=H;var B=function(){throw new Error('A "url" property or function must be specified')},j=function(e,t){var n=t.error;t.error=function(r){n&&n(e,r,t),e.trigger("error",e,r,t)}}}.call(this),define("backbone",["underscore"],function(e){return function(){var t,n;return t||e.Backbone}}(this)),FastClick.prototype.deviceIsAndroid=navigator.userAgent.indexOf("Android")>0,FastClick.prototype.deviceIsIOS=/iP(ad|hone|od)/.test(navigator.userAgent),FastClick.prototype.deviceIsIOS4=FastClick.prototype.deviceIsIOS&&/OS 4_\d(_\d)?/.test(navigator.userAgent),FastClick.prototype.deviceIsIOSWithBadTarget=FastClick.prototype.deviceIsIOS&&/OS ([6-9]|\d{2})_\d/.test(navigator.userAgent),FastClick.prototype.needsClick=function(e){switch(e.nodeName.toLowerCase()){case"button":case"select":case"textarea":if(e.disabled)return!0;break;case"input":if(this.deviceIsIOS&&e.type==="file"||e.disabled)return!0;break;case"label":case"video":return!0}return/\bneedsclick\b/.test(e.className)},FastClick.prototype.needsFocus=function(e){switch(e.nodeName.toLowerCase()){case"textarea":case"select":return!0;case"input":switch(e.type){case"button":case"checkbox":case"file":case"image":case"radio":case"submit":return!1}return!e.disabled&&!e.readOnly;default:return/\bneedsfocus\b/.test(e.className)}},FastClick.prototype.sendClick=function(e,t){var n,r;document.activeElement&&document.activeElement!==e&&document.activeElement.blur(),r=t.changedTouches[0],n=document.createEvent("MouseEvents"),n.initMouseEvent("click",!0,!0,window,1,r.screenX,r.screenY,r.clientX,r.clientY,!1,!1,!1,!1,0,null),n.forwardedTouchEvent=!0,e.dispatchEvent(n)},FastClick.prototype.focus=function(e){var t;this.deviceIsIOS&&e.setSelectionRange?(t=e.value.length,e.setSelectionRange(t,t)):e.focus()},FastClick.prototype.updateScrollParent=function(e){var t,n;t=e.fastClickScrollParent;if(!t||!t.contains(e)){n=e;do{if(n.scrollHeight>n.offsetHeight){t=n,e.fastClickScrollParent=n;break}n=n.parentElement}while(n)}t&&(t.fastClickLastScrollTop=t.scrollTop)},FastClick.prototype.getTargetElementFromEventTarget=function(e){return e.nodeType===Node.TEXT_NODE?e.parentNode:e},FastClick.prototype.onTouchStart=function(e){var t,n,r;if(e.targetTouches.length>1)return!0;t=this.getTargetElementFromEventTarget(e.target),n=e.targetTouches[0];if(this.deviceIsIOS){r=window.getSelection();if(r.rangeCount&&!r.isCollapsed)return!0;if(!this.deviceIsIOS4){if(n.identifier===this.lastTouchIdentifier)return e.preventDefault(),!1;this.lastTouchIdentifier=n.identifier,this.updateScrollParent(t)}}return this.trackingClick=!0,this.trackingClickStart=e.timeStamp,this.targetElement=t,this.touchStartX=n.pageX,this.touchStartY=n.pageY,e.timeStamp-this.lastClickTime<200&&e.preventDefault(),!0},FastClick.prototype.touchHasMoved=function(e){var t=e.changedTouches[0],n=this.touchBoundary;return Math.abs(t.pageX-this.touchStartX)>n||Math.abs(t.pageY-this.touchStartY)>n?!0:!1},FastClick.prototype.findControl=function(e){return e.control!==undefined?e.control:e.htmlFor?document.getElementById(e.htmlFor):e.querySelector("button, input:not([type=hidden]), keygen, meter, output, progress, select, textarea")},FastClick.prototype.onTouchEnd=function(e){var t,n,r,i,s,o=this.targetElement;this.touchHasMoved(e)&&(this.trackingClick=!1,this.targetElement=null);if(!this.trackingClick)return!0;if(e.timeStamp-this.lastClickTime<200)return this.cancelNextClick=!0,!0;this.lastClickTime=e.timeStamp,n=this.trackingClickStart,this.trackingClick=!1,this.trackingClickStart=0,this.deviceIsIOSWithBadTarget&&(s=e.changedTouches[0],o=document.elementFromPoint(s.pageX-window.pageXOffset,s.pageY-window.pageYOffset)||o,o.fastClickScrollParent=this.targetElement.fastClickScrollParent),r=o.tagName.toLowerCase();if(r==="label"){t=this.findControl(o);if(t){this.focus(o);if(this.deviceIsAndroid)return!1;o=t}}else if(this.needsFocus(o)){if(e.timeStamp-n>100||this.deviceIsIOS&&window.top!==window&&r==="input")return this.targetElement=null,!1;this.focus(o);if(!this.deviceIsIOS4||r!=="select")this.targetElement=null,e.preventDefault();return!1}if(this.deviceIsIOS&&!this.deviceIsIOS4){i=o.fastClickScrollParent;if(i&&i.fastClickLastScrollTop!==i.scrollTop)return!0}return this.needsClick(o)||(e.preventDefault(),this.sendClick(o,e)),!1},FastClick.prototype.onTouchCancel=function(){this.trackingClick=!1,this.targetElement=null},FastClick.prototype.onMouse=function(e){return this.targetElement?e.forwardedTouchEvent?!0:e.cancelable?!this.needsClick(this.targetElement)||this.cancelNextClick?(e.stopImmediatePropagation?e.stopImmediatePropagation():e.propagationStopped=!0,e.stopPropagation(),e.preventDefault(),!1):!0:!0:!0},FastClick.prototype.onClick=function(e){var t;return this.trackingClick?(this.targetElement=null,this.trackingClick=!1,!0):e.target.type==="submit"&&e.detail===0?!0:(t=this.onMouse(e),t||(this.targetElement=null),t)},FastClick.prototype.destroy=function(){var e=this.layer;this.deviceIsAndroid&&(e.removeEventListener("mouseover",this.onMouse,!0),e.removeEventListener("mousedown",this.onMouse,!0),e.removeEventListener("mouseup",this.onMouse,!0)),e.removeEventListener("click",this.onClick,!0),e.removeEventListener("touchstart",this.onTouchStart,!1),e.removeEventListener("touchend",this.onTouchEnd,!1),e.removeEventListener("touchcancel",this.onTouchCancel,!1)},FastClick.notNeeded=function(e){var t;if(typeof window.ontouchstart=="undefined")return!0;if(/Chrome\/[0-9]+/.test(navigator.userAgent)){if(!FastClick.prototype.deviceIsAndroid)return!0;t=document.querySelector("meta[name=viewport]");if(t&&t.content.indexOf("user-scalable=no")!==-1)return!0}return e.style.msTouchAction==="none"?!0:!1},FastClick.attach=function(e){return new FastClick(e)},typeof define!="undefined"&&define.amd?define("fastclick",[],function(){return FastClick}):typeof module!="undefined"&&module.exports?(module.exports=FastClick.attach,module.exports.FastClick=FastClick):window.FastClick=FastClick,define("text",["module"],function(e){var t,n,r,i,s,o=["Msxml2.XMLHTTP","Microsoft.XMLHTTP","Msxml2.XMLHTTP.4.0"],u=/^\s*<\?xml(\s)+version=[\'\"](\d)*.(\d)*[\'\"](\s)*\?>/im,a=/<body[^>]*>\s*([\s\S]+)\s*<\/body>/im,f=typeof location!="undefined"&&location.href,l=f&&location.protocol&&location.protocol.replace(/\:/,""),c=f&&location.hostname,h=f&&(location.port||undefined),p={},d=e.config&&e.config()||{};t={version:"2.0.10",strip:function(e){if(e){e=e.replace(u,"");var t=e.match(a);t&&(e=t[1])}else e="";return e},jsEscape:function(e){return e.replace(/(['\\])/g,"\\$1").replace(/[\f]/g,"\\f").replace(/[\b]/g,"\\b").replace(/[\n]/g,"\\n").replace(/[\t]/g,"\\t").replace(/[\r]/g,"\\r").replace(/[\u2028]/g,"\\u2028").replace(/[\u2029]/g,"\\u2029")},createXhr:d.createXhr||function(){var e,t,n;if(typeof XMLHttpRequest!="undefined")return new XMLHttpRequest;if(typeof ActiveXObject!="undefined")for(t=0;t<3;t+=1){n=o[t];try{e=new ActiveXObject(n)}catch(r){}if(e){o=[n];break}}return e},parseName:function(e){var t,n,r,i=!1,s=e.indexOf("."),o=e.indexOf("./")===0||e.indexOf("../")===0;return s!==-1&&(!o||s>1)?(t=e.substring(0,s),n=e.substring(s+1,e.length)):t=e,r=n||t,s=r.indexOf("!"),s!==-1&&(i=r.substring(s+1)==="strip",r=r.substring(0,s),n?n=r:t=r),{moduleName:t,ext:n,strip:i}},xdRegExp:/^((\w+)\:)?\/\/([^\/\\]+)/,useXhr:function(e,n,r,i){var s,o,u,a=t.xdRegExp.exec(e);return a?(s=a[2],o=a[3],o=o.split(":"),u=o[1],o=o[0],(!s||s===n)&&(!o||o.toLowerCase()===r.toLowerCase())&&(!u&&!o||u===i)):!0},finishLoad:function(e,n,r,i){r=n?t.strip(r):r,d.isBuild&&(p[e]=r),i(r)},load:function(e,n,r,i){if(i.isBuild&&!i.inlineText){r();return}d.isBuild=i.isBuild;var s=t.parseName(e),o=s.moduleName+(s.ext?"."+s.ext:""),u=n.toUrl(o),a=d.useXhr||t.useXhr;if(u.indexOf("empty:")===0){r();return}!f||a(u,l,c,h)?t.get(u,function(n){t.finishLoad(e,s.strip,n,r)},function(e){r.error&&r.error(e)}):n([o],function(e){t.finishLoad(s.moduleName+"."+s.ext,s.strip,e,r)})},write:function(e,n,r,i){if(p.hasOwnProperty(n)){var s=t.jsEscape(p[n]);r.asModule(e+"!"+n,"define(function () { return '"+s+"';});\n")}},writeFile:function(e,n,r,i,s){var o=t.parseName(n),u=o.ext?"."+o.ext:"",a=o.moduleName+u,f=r.toUrl(o.moduleName+u)+".js";t.load(a,r,function(n){var r=function(e){return i(f,e)};r.asModule=function(e,t){return i.asModule(e,f,t)},t.write(e,a,r,s)},s)}};if(d.env==="node"||!d.env&&typeof process!="undefined"&&process.versions&&!!process.versions.node&&!process.versions["node-webkit"])n=require.nodeRequire("fs"),t.get=function(e,t,r){try{var i=n.readFileSync(e,"utf8");i.indexOf("﻿")===0&&(i=i.substring(1)),t(i)}catch(s){r(s)}};else if(d.env==="xhr"||!d.env&&t.createXhr())t.get=function(e,n,r,i){var s=t.createXhr(),o;s.open("GET",e,!0);if(i)for(o in i)i.hasOwnProperty(o)&&s.setRequestHeader(o.toLowerCase(),i[o]);d.onXhr&&d.onXhr(s,e),s.onreadystatechange=function(t){var i,o;s.readyState===4&&(i=s.status,i>399&&i<600?(o=new Error(e+" HTTP status: "+i),o.xhr=s,r(o)):n(s.responseText),d.onXhrComplete&&d.onXhrComplete(s,e))},s.send(null)};else if(d.env==="rhino"||!d.env&&typeof Packages!="undefined"&&typeof java!="undefined")t.get=function(e,t){var n,r,i="utf-8",s=new java.io.File(e),o=java.lang.System.getProperty("line.separator"),u=new java.io.BufferedReader(new java.io.InputStreamReader(new java.io.FileInputStream(s),i)),a="";try{n=new java.lang.StringBuffer,r=u.readLine(),r&&r.length()&&r.charAt(0)===65279&&(r=r.substring(1)),r!==null&&n.append(r);while((r=u.readLine())!==null)n.append(o),n.append(r);a=String(n.toString())}finally{u.close()}t(a)};else if(d.env==="xpconnect"||!d.env&&typeof Components!="undefined"&&Components.classes&&Components.interfaces)r=Components.classes,i=Components.interfaces,Components.utils["import"]("resource://gre/modules/FileUtils.jsm"),s="@mozilla.org/windows-registry-key;1"in r,t.get=function(e,t){var n,o,u,a={};s&&(e=e.replace(/\//g,"\\")),u=new FileUtils.File(e);try{n=r["@mozilla.org/network/file-input-stream;1"].createInstance(i.nsIFileInputStream),n.init(u,1,0,!1),o=r["@mozilla.org/intl/converter-input-stream;1"].createInstance(i.nsIConverterInputStream),o.init(n,"utf-8",n.available(),i.nsIConverterInputStream.DEFAULT_REPLACEMENT_CHARACTER),o.readString(n.available(),a),o.close(),n.close(),t(a.value)}catch(f){throw new Error((u&&u.path||"")+": "+f)}};return t}),function(){function t(e,t,n,r,i,s){t[e]&&(n.push(e),(t[e]===!0||t[e]===1)&&r.push(i+e+"/"+s))}function n(e,t,n,r,i){var s=r+t+"/"+i;require._fileExists(e.toUrl(s+".js"))&&n.push(s)}function r(e,t,n){var i;for(i in t)t.hasOwnProperty(i)&&(!e.hasOwnProperty(i)||n)?e[i]=t[i]:typeof t[i]=="object"&&(e[i]||(e[i]={}),r(e[i],t[i],n))}var e=/(^.*(^|\/)nls(\/|$))([^\/]*)\/?([^\/]*)/;define("i18n",["module"],function(i){var s=i.config?i.config():{};return{version:"2.0.3",load:function(i,o,u,a){a=a||{},a.locale&&(s.locale=a.locale);var f,l=e.exec(i),c=l[1],h=l[4],p=l[5],d=h.split("-"),v=[],m={},g,y,b="";l[5]?(c=l[1],f=c+p):(f=i,p=l[4],h=s.locale,h||(h=s.locale=typeof navigator=="undefined"?"root":(navigator.language||navigator.userLanguage||"root").toLowerCase()),d=h.split("-"));if(a.isBuild){v.push(f),n(o,"root",v,c,p);for(g=0;g<d.length;g++)y=d[g],b+=(b?"-":"")+y,n(o,b,v,c,p);o(v,function(){u()})}else o([f],function(e){var n=[],i;t("root",e,n,v,c,p);for(g=0;g<d.length;g++)i=d[g],b+=(b?"-":"")+i,t(b,e,n,v,c,p);o(v,function(){var t,i,s;for(t=n.length-1;t>-1&&n[t];t--){s=n[t],i=e[s];if(i===!0||i===1)i=o(c+s+"/"+p);r(m,i)}u(m)})})}}})}(),define("core/mainview",["backbone"],function(e){return e.View.extend({el:"body",currentView:null,changePage:function(e,t){t&&!e.module&&(e.module=t),e.container=this;var n=e.render().el;this.currentView&&this.currentView.remove(),document.body.appendChild(n),this.currentView=e,"onShow"in e&&e.onShow()}})}),function(e){function u(e){return"tagName"in e?e:e.parentNode}function a(e,t,n,r){var i=Math.abs(e-t),s=Math.abs(n-r);return i>=s?e-t>0?"Left":"Right":n-r>0?"Up":"Down"}function f(){o=null,t.last&&(t.el.trigger("longTap"),t={})}function l(){o&&clearTimeout(o),o=null}function c(){n&&clearTimeout(n),r&&clearTimeout(r),i&&clearTimeout(i),o&&clearTimeout(o),n=r=i=o=null,t={}}var t={},n,r,i,s=750,o;e(document).ready(function(){var p,v;e(document.body).bind("touchstart",function(r){p=Date.now(),v=p-(t.last||p),t.el=e(u(r.touches[0].target)),n&&clearTimeout(n),t.x1=r.touches[0].pageX,t.y1=r.touches[0].pageY,v>0&&v<=250&&(t.isDoubleTap=!0),t.last=p,o=setTimeout(f,s)}).bind("touchmove",function(e){l(),t.x2=e.touches[0].pageX,t.y2=e.touches[0].pageY,Math.abs(t.x1-t.x2)>10&&e.preventDefault()}).bind("touchend",function(s){l(),t.x2&&Math.abs(t.x1-t.x2)>30||t.y2&&Math.abs(t.y1-t.y2)>30?i=setTimeout(function(){t.el.trigger("swipe"),t.el.trigger("swipe"+a(t.x1,t.x2,t.y1,t.y2)),t={}},0):"last"in t&&(r=setTimeout(function(){var r=e.Event("tap");r.cancelTouch=c,t.el.trigger(r),t.isDoubleTap?(t.el.trigger("doubleTap"),t={}):n=setTimeout(function(){n=null,t.el.trigger("singleTap"),t={}},250)},0))}).bind("touchcancel",c),e(window).bind("scroll",c)}),["swipe","swipeLeft","swipeRight","swipeUp","swipeDown","doubleTap","tap","singleTap","longTap"].forEach(function(t){e.fn[t]=function(e){return this.bind(t,e)}})}(Zepto),function(e){e.extend(e,{contains:function(e,t){return e.compareDocumentPosition?!!(e.compareDocumentPosition(t)&16):e!==t&&e.contains(t)}})}(Zepto),function(e,t){e.extend(e,{toString:function(e){return Object.prototype.toString.call(e)},slice:function(e,t){return Array.prototype.slice.call(e,t||0)},later:function(e,t,n,r,i){return window["set"+(n?"Interval":"Timeout")](function(){e.apply(r,i)},t||0)},parseTpl:function(e,t){var n="var __p=[],print=function(){__p.push.apply(__p,arguments);};with(obj||{}){__p.push('"+e.replace(/\\/g,"\\\\").replace(/'/g,"\\'").replace(/<%=([\s\S]+?)%>/g,function(e,t){return"',"+t.replace(/\\'/g,"'")+",'"}).replace(/<%([\s\S]+?)%>/g,function(e,t){return"');"+t.replace(/\\'/g,"'").replace(/[\r\n\t]/g," ")+"__p.push('"}).replace(/\r/g,"\\r").replace(/\n/g,"\\n").replace(/\t/g,"\\t")+"');}return __p.join('');",r=new Function("obj",n);return t?r(t):r},throttle:function(n,r,i){function u(){function l(){s=Date.now(),r.apply(e,a)}function h(){o=t}var e=this,u=Date.now()-s,a=arguments;i&&!o&&l(),o&&clearTimeout(o),i===t&&u>n?l():o=setTimeout(i?h:l,i===t?n-u:n)}var s=0,o;return typeof r!="function"&&(i=r,r=n,n=250),u._zid=r._zid=r._zid||e.proxy(r)._zid,u},debounce:function(n,r,i){return r===t?e.throttle(250,n,!1):e.throttle(n,r,i===t?!1:i!==!1)}}),e.each("String Boolean RegExp Number Date Object Null Undefined".split(" "),function(r,i){var s;if("is"+i in e)return;switch(i){case"Null":s=function(e){return e===null};break;case"Undefined":s=function(e){return e===t};break;default:s=function(e){return(new RegExp(i+"]","i")).test(n(e))}}e["is"+i]=s});var n=e.toString}(Zepto),function(e,t){var n=navigator.userAgent,r=navigator.appVersion,i=e.browser;e.extend(i,{qq:/qq/i.test(n),uc:/UC/i.test(n)||/UC/i.test(r)}),i.uc=i.uc||!i.qq&&!i.chrome&&!i.firefox&&!/safari/i.test(n);try{i.version=i.uc?r.match(/UC(?:Browser)?\/([\d.]+)/)[1]:i.qq?n.match(/MQQBrowser\/([\d.]+)/)[1]:i.version}catch(s){}e.support=e.extend(e.support||{},{orientation:!(i.uc||parseFloat(e.os.version)<5&&(i.qq||i.chrome))&&!(e.os.android&&parseFloat(e.os.version)>3)&&"orientation"in window&&"onorientationchange"in window,touch:"ontouchend"in document,cssTransitions:"WebKitTransitionEvent"in window,has3d:"WebKitCSSMatrix"in window&&"m11"in new WebKitCSSMatrix})}(Zepto),function(e){function t(){e(window).on("scroll",e.debounce(80,function(){e(document).trigger("scrollStop")},!1))}function n(){e(window).off("scroll"),t()}e.matchMedia=function(){var t=0,n="gmu-media-detect",r=e.fx.transitionEnd,i=e.fx.cssPrefix,s=e("<style></style>").append("."+n+"{"+i+"transition: width 0.001ms; width: 0; position: absolute; top: -10000px;}\n").appendTo("head");return function(i){var o=n+t++,u=e('<div class="'+n+'" id="'+o+'"></div>').appendTo("body"),a=[],l;return s.append("@media "+i+" { #"+o+" { width: 1px; } }\n"),"matchMedia"in window?window.matchMedia(i):(u.on(r,function(){l.matches=u.width()===1,e.each(a,function(t,n){e.isFunction(n)&&n.call(l,l)})}),l={matches:u.width()===1,media:i,addListener:function(e){return a.push(e),this},removeListener:function(e){var t=a.indexOf(e);return~t&&a.splice(t,1),this}},l)}}(),e(function(){var t=function(t){e(window).trigger("ortchange")};e.mediaQuery={ortchange:"screen and (width: "+window.innerWidth+"px)"},e.matchMedia(e.mediaQuery.ortchange).addListener(t)}),t(),e(window).on("pageshow",function(t){t.persisted&&e(document).off("touchstart",n).one("touchstart",n)})}(Zepto),function(e){var t,n=!1,r,i,s=function(){clearTimeout(r),t&&(i=t.attr("highlight-cls"))&&(t.removeClass(i).attr("highlight-cls",""),t=null)};e.extend(e.fn,{highlight:function(i){return n=n||!!e(document).on("touchend.highlight touchmove.highlight touchcancel.highlight",s),s(),this.each(function(){var n=e(this);n.css("-webkit-tap-highlight-color","rgba(255,255,255,0)").off("touchstart.highlight"),i&&n.on("touchstart.highlight",function(){r=e.later(function(){t=n.attr("highlight-cls",i).addClass(i)},100)})})}})}(Zepto),function(e,t){function A(e){return s===""?e:(e=e.charAt(0).toUpperCase()+e.substr(1),s+e)}var n=Math,r=[],i=t.createElement("div").style,s=function(){var e="webkitT,MozT,msT,OT,t".split(","),t,n=0,r=e.length;for(;n<r;n++){t=e[n]+"ransform";if(t in i)return e[n].substr(0,e[n].length-1)}return!1}(),o=s?"-"+s.toLowerCase()+"-":"",u=A("transform"),a=A("transitionProperty"),f=A("transitionDuration"),l=A("transformOrigin"),c=A("transitionTimingFunction"),h=A("transitionDelay"),p=/android/gi.test(navigator.appVersion),d=/hp-tablet/gi.test(navigator.appVersion),v=A("perspective")in i,m="ontouchstart"in e&&!d,g=!!s,y=A("transition")in i,b="onorientationchange"in e?"orientationchange":"resize",w=m?"touchstart":"mousedown",E=m?"touchmove":"mousemove",S=m?"touchend":"mouseup",x=m?"touchcancel":"mouseup",T=function(){if(s===!1)return!1;var e={"":"transitionend",webkit:"webkitTransitionEnd",Moz:"transitionend",O:"otransitionend",ms:"MSTransitionEnd"};return e[s]}(),N=function(){return e.requestAnimationFrame||e.webkitRequestAnimationFrame||e.mozRequestAnimationFrame||e.oRequestAnimationFrame||e.msRequestAnimationFrame||function(e){return setTimeout(e,1)}}(),C=function(){return e.cancelRequestAnimationFrame||e.webkitCancelAnimationFrame||e.webkitCancelRequestAnimationFrame||e.mozCancelRequestAnimationFrame||e.oCancelRequestAnimationFrame||e.msCancelRequestAnimationFrame||clearTimeout}(),k=v?" translateZ(0)":"",L=function(n,r){var i=this,s;i.wrapper=typeof n=="object"?n:t.getElementById(n),i.wrapper.style.overflow="hidden",i.scroller=i.wrapper.children[0],i.translateZ=k,i.options={hScroll:!0,vScroll:!0,x:0,y:0,bounce:!0,bounceLock:!1,momentum:!0,lockDirection:!0,useTransform:!0,useTransition:!1,topOffset:0,checkDOMChanges:!1,handleClick:!0,onRefresh:null,onBeforeScrollStart:function(e){e.preventDefault()},onScrollStart:null,onBeforeScrollMove:null,onScrollMove:null,onBeforeScrollEnd:null,onScrollEnd:null,onTouchEnd:null,onDestroy:null};for(s in r)i.options[s]=r[s];i.x=i.options.x,i.y=i.options.y,i.options.useTransform=g&&i.options.useTransform,i.options.useTransition=y&&i.options.useTransition,i.scroller.style[a]=i.options.useTransform?o+"transform":"top left",i.scroller.style[f]="0",i.scroller.style[l]="0 0",i.options.useTransition&&(i.scroller.style[c]="cubic-bezier(0.33,0.66,0.66,1)"),i.options.useTransform?i.scroller.style[u]="translate("+i.x+"px,"+i.y+"px)"+k:i.scroller.style.cssText+=";position:absolute;top:"+i.y+"px;left:"+i.x+"px",i.refresh(),i._bind(b,e),i._bind(w),i.options.checkDOMChanges&&(i.checkDOMTime=setInterval(function(){i._checkDOMChanges()},500))};L.prototype={enabled:!0,x:0,y:0,steps:[],scale:1,currPageX:0,currPageY:0,pagesX:[],pagesY:[],aniTime:null,isStopScrollAction:!1,handleEvent:function(e){var t=this;switch(e.type){case w:if(!m&&e.button!==0)return;t._start(e);break;case E:t._move(e);break;case S:case x:t._end(e);break;case b:t._resize();break;case T:t._transitionEnd(e)}},_checkDOMChanges:function(){if(this.moved||this.animating||this.scrollerW==this.scroller.offsetWidth*this.scale&&this.scrollerH==this.scroller.offsetHeight*this.scale)return;this.refresh()},_resize:function(){var e=this;setTimeout(function(){e.refresh()},p?200:0)},_pos:function(e,t){e=this.hScroll?e:0,t=this.vScroll?t:0,this.options.useTransform?this.scroller.style[u]="translate("+e+"px,"+t+"px) scale("+this.scale+")"+k:(e=n.round(e),t=n.round(t),this.scroller.style.left=e+"px",this.scroller.style.top=t+"px"),this.x=e,this.y=t},_start:function(t){var n=this,r=m?t.touches[0]:t,i,s,o,a,f;if(!n.enabled)return;n.options.onBeforeScrollStart&&n.options.onBeforeScrollStart.call(n,t),n.options.useTransition&&n._transitionTime(0),n.moved=!1,n.animating=!1,n.distX=0,n.distY=0,n.absDistX=0,n.absDistY=0,n.dirX=0,n.dirY=0,n.isStopScrollAction=!1;if(n.options.momentum){n.options.useTransform?(i=getComputedStyle(n.scroller,null)[u].replace(/[^0-9\-.,]/g,"").split(","),s=+i[4],o=+i[5]):(s=+getComputedStyle(n.scroller,null).left.replace(/[^0-9-]/g,""),o=+getComputedStyle(n.scroller,null).top.replace(/[^0-9-]/g,""));if(s!=n.x||o!=n.y)n.isStopScrollAction=!0,n.options.useTransition?n._unbind(T):C(n.aniTime),n.steps=[],n._pos(s,o),n.options.onScrollEnd&&n.options.onScrollEnd.call(n)}n.startX=n.x,n.startY=n.y,n.pointX=r.pageX,n.pointY=r.pageY,n.startTime=t.timeStamp||Date.now(),n.options.onScrollStart&&n.options.onScrollStart.call(n,t),n._bind(E,e),n._bind(S,e),n._bind(x,e)},_move:function(e){var t=this,r=m?e.touches[0]:e,i=r.pageX-t.pointX,s=r.pageY-t.pointY,o=t.x+i,u=t.y+s,a=e.timeStamp||Date.now();t.options.onBeforeScrollMove&&t.options.onBeforeScrollMove.call(t,e),t.pointX=r.pageX,t.pointY=r.pageY;if(o>0||o<t.maxScrollX)o=t.options.bounce?t.x+i/2:o>=0||t.maxScrollX>=0?0:t.maxScrollX;if(u>t.minScrollY||u<t.maxScrollY)u=t.options.bounce?t.y+s/2:u>=t.minScrollY||t.maxScrollY>=0?t.minScrollY:t.maxScrollY;t.distX+=i,t.distY+=s,t.absDistX=n.abs(t.distX),t.absDistY=n.abs(t.distY);if(t.absDistX<6&&t.absDistY<6)return;t.options.lockDirection&&(t.absDistX>t.absDistY+5?(u=t.y,s=0):t.absDistY>t.absDistX+5&&(o=t.x,i=0)),t.moved=!0,t._beforePos?t._beforePos(u,s)&&t._pos(o,u):t._pos(o,u),t.dirX=i>0?-1:i<0?1:0,t.dirY=s>0?-1:s<0?1:0,a-t.startTime>300&&(t.startTime=a,t.startX=t.x,t.startY=t.y),t.options.onScrollMove&&t.options.onScrollMove.call(t,e)},_end:function(r){if(m&&r.touches.length!==0)return;var i=this,s=m?r.changedTouches[0]:r,o,u,a={dist:0,time:0},f={dist:0,time:0},l=(r.timeStamp||Date.now())-i.startTime,c=i.x,h=i.y,p;i._unbind(E,e),i._unbind(S,e),i._unbind(x,e),i.options.onBeforeScrollEnd&&i.options.onBeforeScrollEnd.call(i,r);if(!i.moved){m&&this.options.handleClick&&!i.isStopScrollAction&&(i.doubleTapTimer=setTimeout(function(){i.doubleTapTimer=null,o=s.target;while(o.nodeType!=1)o=o.parentNode;o.tagName!="SELECT"&&o.tagName!="INPUT"&&o.tagName!="TEXTAREA"&&(u=t.createEvent("MouseEvents"),u.initMouseEvent("click",!0,!0,r.view,1,s.screenX,s.screenY,s.clientX,s.clientY,r.ctrlKey,r.altKey,r.shiftKey,r.metaKey,0,null),u._fake=!0,o.dispatchEvent(u))},0)),i._resetPos(400),i.options.onTouchEnd&&i.options.onTouchEnd.call(i,r);return}if(l<300&&i.options.momentum){a=c?i._momentum(c-i.startX,l,-i.x,i.scrollerW-i.wrapperW+i.x,i.options.bounce?i.wrapperW:0):a,f=h?i._momentum(h-i.startY,l,-i.y,i.maxScrollY<0?i.scrollerH-i.wrapperH+i.y-i.minScrollY:0,i.options.bounce?i.wrapperH:0):f,c=i.x+a.dist,h=i.y+f.dist;if(i.x>0&&c>0||i.x<i.maxScrollX&&c<i.maxScrollX)a={dist:0,time:0};if(i.y>i.minScrollY&&h>i.minScrollY||i.y<i.maxScrollY&&h<i.maxScrollY)f={dist:0,time:0}}if(a.dist||f.dist){p=n.max(n.max(a.time,f.time),10),i.scrollTo(n.round(c),n.round(h),p),i.options.onTouchEnd&&i.options.onTouchEnd.call(i,r);return}i._resetPos(200),i.options.onTouchEnd&&i.options.onTouchEnd.call(i,r)},_resetPos:function(e){var t=this,n=t.x>=0?0:t.x<t.maxScrollX?t.maxScrollX:t.x,r=t.y>=t.minScrollY||t.maxScrollY>0?t.minScrollY:t.y<t.maxScrollY?t.maxScrollY:t.y;if(n==t.x&&r==t.y){t.moved&&(t.moved=!1,t.options.onScrollEnd&&t.options.onScrollEnd.call(t),t._afterPos&&t._afterPos());return}t.scrollTo(n,r,e||0)},_transitionEnd:function(e){var t=this;if(e.target!=t.scroller)return;t._unbind(T),t._startAni()},_startAni:function(){var e=this,t=e.x,r=e.y,i=Date.now(),s,o,u;if(e.animating)return;if(!e.steps.length){e._resetPos(400);return}s=e.steps.shift(),s.x==t&&s.y==r&&(s.time=0),e.animating=!0,e.moved=!0;if(e.options.useTransition){e._transitionTime(s.time),e._pos(s.x,s.y),e.animating=!1,s.time?e._bind(T):e._resetPos(0);return}u=function(){var a=Date.now(),f,l;if(a>=i+s.time){e._pos(s.x,s.y),e.animating=!1,e.options.onAnimationEnd&&e.options.onAnimationEnd.call(e),e._startAni();return}a=(a-i)/s.time-1,o=n.sqrt(1-a*a),f=(s.x-t)*o+t,l=(s.y-r)*o+r,e._pos(f,l),e.animating&&(e.aniTime=N(u))},u()},_transitionTime:function(e){e+="ms",this.scroller.style[f]=e},_momentum:function(e,t,r,i,s){var o=6e-4,u=n.abs(e)*(this.options.speedScale||1)/t,a=u*u/(2*o),f=0,l=0;return e>0&&a>r?(l=s/(6/(a/u*o)),r+=l,u=u*r/a,a=r):e<0&&a>i&&(l=s/(6/(a/u*o)),i+=l,u=u*i/a,a=i),a*=e<0?-1:1,f=u/o,{dist:a,time:n.round(f)}},_offset:function(e){var t=-e.offsetLeft,n=-e.offsetTop;while(e=e.offsetParent)t-=e.offsetLeft,n-=e.offsetTop;return e!=this.wrapper&&(t*=this.scale,n*=this.scale),{left:t,top:n}},_bind:function(e,t,n){r.concat([t||this.scroller,e,this]),(t||this.scroller).addEventListener(e,this,!!n)},_unbind:function(e,t,n){(t||this.scroller).removeEventListener(e,this,!!n)},destroy:function(){var n=this;n.scroller.style[u]="",n._unbind(b,e),n._unbind(w),n._unbind(E,e),n._unbind(S,e),n._unbind(x,e),n.options.useTransition&&n._unbind(T),n.options.checkDOMChanges&&clearInterval(n.checkDOMTime),n.options.onDestroy&&n.options.onDestroy.call(n);for(var i=0,s=r.length;i<s;)r[i].removeEventListener(r[i+1],r[i+2]),r[i]=null,i+=3;r=[];var o=t.createElement("div");o.appendChild(this.wrapper),o.innerHTML="",n.wrapper=n.scroller=o=null},refresh:function(){var e=this,t;e.wrapperW=e.wrapper.clientWidth||1,e.wrapperH=e.wrapper.clientHeight||1,e.minScrollY=-e.options.topOffset||0,e.scrollerW=n.round(e.scroller.offsetWidth*e.scale),e.scrollerH=n.round((e.scroller.offsetHeight+e.minScrollY)*e.scale),e.maxScrollX=e.wrapperW-e.scrollerW,e.maxScrollY=e.wrapperH-e.scrollerH+e.minScrollY,e.dirX=0,e.dirY=0,e.options.onRefresh&&e.options.onRefresh.call(e),e.hScroll=e.options.hScroll&&e.maxScrollX<0,e.vScroll=e.options.vScroll&&(!e.options.bounceLock&&!e.hScroll||e.scrollerH>e.wrapperH),t=e._offset(e.wrapper),e.wrapperOffsetLeft=-t.left,e.wrapperOffsetTop=-t.top,e.scroller.style[f]="0",e._resetPos(400)},scrollTo:function(e,t,n,r){var i=this,s=e,o,u;i.stop(),s.length||(s=[{x:e,y:t,time:n,relative:r}]);for(o=0,u=s.length;o<u;o++)s[o].relative&&(s[o].x=i.x-s[o].x,s[o].y=i.y-s[o].y),i.steps.push({x:s[o].x,y:s[o].y,time:s[o].time||0});i._startAni()},scrollToElement:function(e,t){var r=this,i;e=e.nodeType?e:r.scroller.querySelector(e);if(!e)return;i=r._offset(e),i.left+=r.wrapperOffsetLeft,i.top+=r.wrapperOffsetTop,i.left=i.left>0?0:i.left<r.maxScrollX?r.maxScrollX:i.left,i.top=i.top>r.minScrollY?r.minScrollY:i.top<r.maxScrollY?r.maxScrollY:i.top,t=t===undefined?n.max(n.abs(i.left)*2,n.abs(i.top)*2):t,r.scrollTo(i.left,i.top,t)},scrollToPage:function(e,t,n){var r=this,i,s;n=n===undefined?400:n,r.options.onScrollStart&&r.options.onScrollStart.call(r),i=-r.wrapperW*e,s=-r.wrapperH*t,i<r.maxScrollX&&(i=r.maxScrollX),s<r.maxScrollY&&(s=r.maxScrollY),r.scrollTo(i,s,n)},disable:function(){this.stop(),this._resetPos(0),this.enabled=!1,this._unbind(E,e),this._unbind(S,e),this._unbind(x,e)},enable:function(){this.enabled=!0},stop:function(){this.options.useTransition?this._unbind(T):C(this.aniTime),this.steps=[],this.moved=!1,this.animating=!1},isReady:function(){return!this.moved&&!this.animating}},i=null,typeof exports!="undefined"?exports.iScroll=L:e.iScroll=L,function(t){function s(e,t){var s="iscroll"+r++;return e.data("_iscroll_",s),i[s]=new n(e[0],t)}if(!t)return;var n=L,r=0,i={};e.iScroll=function(e,n){return s(t(typeof e=="string"?"#"+e:e),n)},t.fn.iScroll=function(e){var n=[];return this.each(function(r,o){if(typeof e=="string"){var u=i[t(o).data("_iscroll_")],a;if(u&&(a=u[e])){var f=t.isFunction(a)?a.apply(u,Array.prototype.slice.call(arguments,1)):a;f!==u&&f!==undefined&&n.push(f)}}else t(o).data("_iscroll_")||s(t(o),e)}),n.length?n:this}}(e.Zepto||null)}(window,document),function(e,t){function o(){return n++}function u(t,n){var r={};return Object.create?r=Object.create(t):r.__proto__=t,e.extend(r,n||{})}function a(t,n){return n&&(f(t,n),e.extend(t.prototype,n)),e.extend(t,{plugins:[],register:function(t){if(e.isObject(t)){e.extend(this.prototype,t);return}this.plugins.push(t)}})}function f(t,n){var r=n.inherit||c,i=r.prototype,s;return s=t.prototype=u(i,{$factory:t,$super:function(t){var n=i[t];return e.isFunction(n)?n.apply(this,e.slice(arguments,1)):n}}),s._data=e.extend({},i._data,n._data),delete n._data,t}function l(n){e.fn[n]=function(r){var i,o,u=e.slice(arguments,1);return e.each(this,function(a,f){o=s(f,n)||e.ui[n](f,e.extend(e.isPlainObject(r)?r:{},{setup:!0}));if(e.isString(r)){if(!e.isFunction(o[r])&&r!=="this")throw new Error(n+"组件没有此方法");i=e.isFunction(o[r])?o[r].apply(o,u):t}if(i!==t&&i!==o||r==="this"&&(i=o))return!1;i=t}),i!==t?i:this}}var n=1,r=function(){},i="<%=name%>-<%=id%>",s=function(){var t={},n=0,r="GMUWidget"+ +(new Date);return function(i,s,o){var u=i[r]||(i[r]=++n),a=t[u]||(t[u]={});return!e.isUndefined(o)&&(a[s]=o),e.isNull(o)&&delete a[s],a[s]}}();e.ui=e.ui||{version:"2.0.5",guid:o,define:function(t,n,r){r&&(n.inherit=r);var s=e.ui[t]=a(function(n,r){var a=u(s.prototype,{_id:e.parseTpl(i,{name:t,id:o()})});return a._createWidget.call(a,n,r,s.plugins),a},n);return l(t,s)},isWidget:function(n,i){return n instanceof(i===t?c:e.ui[i]||r)}};var c=function(){};e.extend(c.prototype,{_data:{status:!0},data:function(t,n){var r=this._data;return e.isObject(t)?e.extend(r,t):e.isUndefined(n)?r[t]:r[t]=n},_createWidget:function(n,r,i){e.isObject(n)&&(r=n||{},n=t);var o=e.extend({},this._data,r);e.extend(this,{_el:n?e(n):t,_data:o});var u=this;e.each(i,function(t,n){var r=n.apply(u);if(r&&e.isPlainObject(r)){var i=u._data.disablePlugin;if(!i||e.isString(i)&&!~i.indexOf(r.pluginName))delete r.pluginName,e.each(r,function(t,n){var r;(r=u[t])&&e.isFunction(n)?u[t]=function(){return u[t+"Org"]=r,n.apply(u,arguments)}:u[t]=n})}}),o.setup?this._setup(n&&n.getAttribute("data-mode")):this._create(),this._init();var u=this,a=this.trigger("init").root();a.on("tap",function(e){(e.bubblesList||(e.bubblesList=[])).push(u)}),s(a[0],u._id.split("-")[0],u)},_create:function(){},_setup:function(e){},root:function(e){return this._el=e||this._el},id:function(e){return this._id=e||this._id},destroy:function(){var t=this,n;n=this.trigger("destroy").off().root(),n.find("*").off(),s(n[0],t._id.split("-")[0],null),n.off().remove(),this.__proto__=null,e.each(this,function(e){delete t[e]})},on:function(t,n){return this.root().on(t,e.proxy(n,this)),this},off:function(e,t){return this.root().off(e,t),this},trigger:function(t,n){t=e.isString(t)?e.Event(t):t;var r=this.data(t.type),i;if(r&&e.isFunction(r)){t.data=n,i=r.apply(this,[t].concat(n));if(i===!1||t.defaultPrevented)return this}return this.root().trigger(t,n),this}})}(Zepto),function(e,t){e.ui.define("slider",{_data:{viewNum:1,imgInit:2,itemRender:null,imgZoom:!1,loop:!1,stopPropagation:!1,springBackDis:15,autoPlay:!0,autoPlayTime:4e3,animationTime:400,showArr:!0,showDot:!0,slide:null,slideend:null,index:0,_stepLength:1,_direction:1},_create:function(){var t=this,n=0,r,i=[],s=t.data("content");t._initConfig(),(t.root()||t.root(e("<div></div>"))).addClass("ui-slider").appendTo(t.data("container")||(t.root().parent().length?"":document.body)).html('<div class="ui-slider-wheel"><div class="ui-slider-group">'+function(){if(t.data("itemRender")){var e=t.data("itemRender");while(r=e.call(t,n++))i.push('<div class="ui-slider-item">'+r+"</div>")}else while(r=s[n++])i.push('<div class="ui-slider-item"><a href="'+r.href+'"><img lazyload="'+r.pic+'"/></a>'+(r.title?"<p>"+r.title+"</p>":"")+"</div>");return i.push(t.data("loop")?'</div><div class="ui-slider-group">'+i.join("")+"</div></div>":"</div></div>"),i.join("")}()),t._addDots()},_setup:function(t){var n=this,r=n.root().addClass("ui-slider");n._initConfig();if(!t){var i=r.children(),s=e('<div class="ui-slider-group"></div>').append(i.addClass("ui-slider-item"));r.empty().append(e('<div class="ui-slider-wheel"></div>').append(s).append(n.data("loop")?s.clone():"")),n._addDots()}else n.data("loop")&&e(".ui-slider-wheel",r).append(e(".ui-slider-group",r).clone())},_init:function(){var t=this,n=t.data("index"),r=t.root(),i=e.proxy(t._eventHandler,t);t._setWidth(),e(t.data("wheel")).on("touchstart touchmove touchend touchcancel webkitTransitionEnd",i),e(window).on("ortchange",i),e(".ui-slider-pre",r).on("tap",function(){t.pre()}),e(".ui-slider-next",r).on("tap",function(){t.next()}),t.on("destroy",function(){clearTimeout(t.data("play")),e(window).off("ortchange",i)}),t.data("autoPlay")&&t._setTimeout()},_initConfig:function(){var e=this._data;e.viewNum>1&&(e.loop=!1,e.showDot=!1,e.imgInit=e.viewNum+1)},_addDots:function(){var t=this,n=t.root(),r=e(".ui-slider-item",n).length/(t.data("loop")?2:1),i=[];if(t.data("showDot")){i.push('<p class="ui-slider-dots">');while(r--)i.push("<b></b>");i.push("</p>")}t.data("showArr")&&i.push('<span class="ui-slider-pre"><b></b></span><span class="ui-slider-next"><b></b></span>'),n.append(i.join(""))},_setWidth:function(){var t=this,n=t._data,r=t.root(),i=Math.ceil(r.width()/n.viewNum),s=r.height(),o=n.loop,u=e(".ui-slider-item",r).toArray(),f=u.length,l=e(".ui-slider-wheel",r).width(i*f)[0],c=e(".ui-slider-dots b",r).toArray(),h=e("img",r).toArray(),p=h.concat(),d={},v,m,g=n.imgInit||f;n.showDot&&(c[0].className="ui-slider-dot-select"),n.imgZoom&&e(p).on("load",function(){var e=this.height,t=this.width,n=Math.min(e,s),r=Math.min(t,i);e/s>t/i?this.style.cssText+="height:"+n+"px;width:"+n/e*t+"px;":this.style.cssText+="height:"+r/t*e+"px;width:"+r+"px",this.onload=null});for(v=0;v<f;v++)u[v].style.cssText+="width:"+i+"px;position:absolute;-webkit-transform:translate3d("+v*i+"px,0,0);z-index:"+(900-v),d[v]=o?v>f/2-1?v-f/2:v:v,v<g&&(m=p.shift(),m&&(m.src=m.getAttribute("lazyload")),n.loop&&(m=h[v+f/2],m&&(m.src=m.getAttribute("lazyload"))));return t.data({root:r[0],wheel:l,items:u,lazyImgs:p,allImgs:h,length:f,width:i,height:s,dots:c,dotIndex:d,dot:c[0]}),t},_eventHandler:function(e){var t=this;switch(e.type){case"touchmove":t._touchMove(e);break;case"touchstart":t._touchStart(e);break;case"touchcancel":case"touchend":t._touchEnd();break;case"webkitTransitionEnd":t._transitionEnd();break;case"ortchange":t._resize.call(t)}},_touchStart:function(e){var t=this;t.data({pageX:e.touches[0].pageX,pageY:e.touches[0].pageY,S:!1,T:!1,X:0}),t.data("wheel").style.webkitTransitionDuration="0ms"},_touchMove:function(e){var t=this._data,n=t.X=e.touches[0].pageX-t.pageX;if(!t.T){var r=t.index,i=t.length,s=Math.abs(n)<Math.abs(e.touches[0].pageY-t.pageY);t.loop&&(t.index=r>0&&r<i-1?r:r===i-1&&n<0?i/2-1:r===0&&n>0?i/2:r),s||clearTimeout(t.play),t.T=!0,t.S=s}t.S||(t.stopPropagation&&e.stopPropagation(),e.preventDefault(),t.wheel.style.webkitTransform="translate3d("+(n-t.index*t.width)+"px,0,0)")},_touchEnd:function(){var e=this,t=e._data;if(!t.S){var n=t.springBackDis,r=t.X<=-n?Math.ceil(-t.X/t.width):t.X>n?-Math.ceil(t.X/t.width):0;t._stepLength=Math.abs(r),e._slide(t.index+r)}},_slide:function(t,n){var r=this,i=r._data,s=i.length,o=s-i.viewNum+1;return-1<t&&t<o?r._move(t):t>=o?i.loop?(i.wheel.style.cssText+="-webkit-transition:0ms;-webkit-transform:translate3d(-"+(s/2-1)*i.width+"px,0,0);",i._direction=1,e.later(function(){r._move(s/2)},20)):(r._move(o-(n?2:1)),i._direction=-1):(i.loop?(i.wheel.style.cssText+="-webkit-transition:0ms;-webkit-transform:translate3d(-"+s/2*i.width+"px,0,0);",e.later(function(){r._move(s/2-1)},20)):r._move(n?1:0),i._direction=1),r},_move:function(e){var t=this._data,n=t.dotIndex[e];this.trigger("slide",n);if(t.lazyImgs.length){var r=t.allImgs[e];r&&r.src||(r.src=r.getAttribute("lazyload"))}t.showDot&&(t.dot.className="",t.dots[n].className="ui-slider-dot-select",t.dot=t.dots[n]),t.index=e,t.wheel.style.cssText+="-webkit-transition:"+t.animationTime+"ms;-webkit-transform:translate3d(-"+e*t.width+"px,0,0);"},_transitionEnd:function(){var e=this,t=e._data;e.trigger("slideend",t.dotIndex[t.index]);if(t.lazyImgs.length){for(var n=t._stepLength,r=0;r<n;r++){var i=t.lazyImgs.shift();i&&(i.src=i.getAttribute("lazyload")),t.loop&&(i=t.allImgs[t.index+t.length/2],i&&!i.src&&(i.src=i.getAttribute("lazyload")))}t._stepLength=1}e._setTimeout()},_setTimeout:function(){var t=this,n=t._data;return n.autoPlay?(clearTimeout(n.play),n.play=e.later(function(){t._slide.call(t,n.index+n._direction,!0)},n.autoPlayTime),t):t},_resize:function(){var e=this,t=e._data,n=t.root.offsetWidth/t.viewNum,r=t.length,i=t.items;if(!n)return e;t.width=n,clearTimeout(t.play);for(var s=0;s<r;s++)i[s].style.cssText+="width:"+n+"px;-webkit-transform:translate3d("+s*n+"px,0,0);";return t.wheel.style.removeProperty("-webkit-transition"),t.wheel.style.cssText+="width:"+n*r+"px;-webkit-transform:translate3d(-"+t.index*n+"px,0,0);",t._direction=1,e._setTimeout(),e},pre:function(){var e=this;return e._slide(e.data("index")-1),e},next:function(){var e=this;return e._slide(e.data("index")+1),e},stop:function(){var e=this;return clearTimeout(e.data("play")),e.data("autoPlay",!1),e},resume:function(){var e=this;return e.data("_direction",1),e.data("autoPlay",!0),e._setTimeout(),e}})}(Zepto),function(e,t){var n=["01月","02月","03月","04月","05月","06月","07月","08月","09月","10月","11月","12月"],r=["日","一","二","三","四","五","六"],i=/^(\+|\-)?(\d+)(M|Y)$/i,s=function(e,t){return 32-(new Date(e,t,32)).getDate()},o=function(e,t){return(new Date(e,t,1)).getDay()},u=function(e,t){var n=""+e;while(n.length<t)n="0"+n;return n},a=function(e){return e.is("select, input")?e.val():e.attr("data-value")},f;e.ui.define("calendar",{_data:{date:null,firstDay:1,maxDate:null,minDate:null,swipeable:!1,monthChangeable:!1,yearChangeable:!1,selectYear:null,selectYearBefore:null,selectYearAfter:null},_create:function(){var t=this.root();t=t||this.root(e("<div></div>")),t.appendTo(this.data("container")||(t.parent().length?"":document.body))},_init:function(){var t=this._data,n=this._container||this.root(),r=e.proxy(this._eventHandler,this);this.minDate(t.minDate).maxDate(t.maxDate).date(t.date||new Date).refresh(),n.addClass("ui-calendar").on("click",r).highlight(),t.swipeable&&n.on("swipeLeft swipeRight",r)},_eventHandler:function(t){var n=this._data,r=(this._container||this.root()).get(0),i,s,o,u,f;switch(t.type){case"swipeLeft":case"swipeRight":return this.switchMonthTo((t.type=="swipeRight"?"-":"+")+"1M");case"change":return f=e(".ui-calendar-header .ui-calendar-year, .ui-calendar-header .ui-calendar-month",this._el),this.switchMonthTo(a(f.eq(1)),a(f.eq(0)));default:s=t.target,(i=e(s).closest(".ui-calendar-calendar tbody a",r))&&i.length?(t.preventDefault(),o=i.parent(),this._option("selectedDate",u=new Date(o.attr("data-year"),o.attr("data-month"),i.text())),this.trigger("select",[u,e.calendar.formatDate(u),this]),this.refresh()):(i=e(s).closest(".ui-calendar-prev, .ui-calendar-next",r))&&i.length&&(t.preventDefault(),this.switchMonthTo((i.is(".ui-calendar-prev")?"-":"+")+"1M"))}},_option:function(n,r){var i=this._data,s,o,u;if(r!==t){switch(n){case"minDate":case"maxDate":i[n]=r?e.calendar.parseDate(r):null;break;case"selectedDate":o=i.minDate,u=i.maxDate,r=e.calendar.parseDate(r),r=o&&o>r?o:u&&u<r?u:r,i._selectedYear=i._drawYear=r.getFullYear(),i._selectedMonth=i._drawMonth=r.getMonth(),i._selectedDay=r.getDate();break;case"date":this._option("selectedDate",r),i[n]=this._option("selectedDate");break;default:i[n]=r}return i._invalid=!0,this}return n=="selectedDate"?new Date(i._selectedYear,i._selectedMonth,i._selectedDay):i[n]},switchToToday:function(){var e=new Date;return this.switchMonthTo(e.getMonth(),e.getFullYear())},switchMonthTo:function(t,n){var r=this._data,s=this.minDate(),o=this.maxDate(),u,a,f;e.isString(t)&&i.test(t)?(u=RegExp.$1=="-"?-parseInt(RegExp.$2,10):parseInt(RegExp.$2,10),a=RegExp.$3.toLowerCase(),t=r._drawMonth+(a=="m"?u:0),n=r._drawYear+(a=="y"?u:0)):(t=parseInt(t,10),n=parseInt(n,10)),f=new Date(n,t,1),f=s&&s>f?s:o&&o<f?o:f,t=f.getMonth(),n=f.getFullYear();if(t!=r._drawMonth||n!=r._drawYear)this.trigger("monthchange",[r._drawMonth=t,r._drawYear=n,this]),r._invalid=!0,this.refresh();return this},refresh:function(){var t=this._data,n=this._container||this.root(),r=e.proxy(this._eventHandler,this);if(!t._invalid)return;return e(".ui-calendar-calendar td:not(.ui-state-disabled), .ui-calendar-header a",n).highlight(),e(".ui-calendar-header select",n).off("change",r),n.empty().append(this._generateHTML()),e(".ui-calendar-calendar td:not(.ui-state-disabled), .ui-calendar-header a",n).highlight("ui-state-hover"),e(".ui-calendar-header select",n).on("change",r),t._invalid=!1,this},destroy:function(){var t=this._container||this.root(),n=this._eventHandler;return e(".ui-calendar-calendar td:not(.ui-state-disabled)",t).highlight(),e(".ui-calendar-header select",t).off("change",n),this.$super("destroy")},_generateHTML:function(){var e=this._data,t=e._drawYear,n=e._drawMonth,i=new Date,u=new Date(i.getFullYear(),i.getMonth(),i.getDate()),a=this.minDate(),f=this.maxDate(),l=this.selectedDate(),c="",h,p,d,v,m,g,y,b;d=isNaN(d=parseInt(e.firstDay,10))?0:d,c+=this._renderHead(e,t,n,a,f)+'<table  class="ui-calendar-calendar"><thead><tr>';for(h=0;h<7;h++)v=(h+d)%7,c+="<th"+((h+d+6)%7>=5?' class="ui-calendar-week-end"':"")+">"+"<span>"+r[v]+"</span></th>";c+='</thead></tr><tbody><tr class="ui-calendar-gap"><td colspan="7">&#xa0;</td></tr>',g=s(t,n),m=(o(t,n)-d+7)%7,y=Math.ceil((m+g)/7),b=new Date(t,n,1-m);for(h=0;h<y;h++){c+="<tr>";for(p=0;p<7;p++)c+=this._renderDay(p,b,d,n,l,u,a,f),b.setDate(b.getDate()+1);c+="</tr>"}return c+="</tbody></table>",c},_renderHead:function(e,t,r,i,s){var o='<div class="ui-calendar-header">',u=new Date(t,r,-1),a=new Date(t,r+1,1),f,l;o+='<a class="ui-calendar-prev'+(i&&i>u?" ui-state-disable":"")+'" href="#">&lt;&lt;</a><div class="ui-calendar-title">';if(e.yearChangeable){o+='<select class="ui-calendar-year">';if(this._data.selectYearBefore!==null||this._data.selectYearAfter!==null){var c=new Date,h=c.getFullYear();for(f=h-parseInt(this._data.selectYearBefore),l=h+parseInt(this._data.selectYearAfter);f<l;f++)o+='<option value="'+f+'" '+(f==t?'selected="selected"':"")+">"+f+"年</option>"}else for(f=Math.max(1970,t-10),l=f+20;f<l;f++)o+='<option value="'+f+'" '+(f==t?'selected="selected"':"")+">"+f+"年</option>";o+="</select>"}else o+='<span class="ui-calendar-year" data-value="'+t+'">'+t+"年"+"</span>";if(e.monthChangeable){o+='<select class="ui-calendar-month">';for(f=0;f<12;f++)o+='<option value="'+f+'" '+(f==r?'selected="selected"':"")+">"+n[f]+"</option>";o+="</select>"}else o+='<span class="ui-calendar-month" data-value="'+r+'">'+n[r]+"</span>";return o+='</div><a class="ui-calendar-next'+(s&&s<a?" ui-state-disable":"")+'" href="#">&gt;&gt;</a></div>',o},_renderDay:function(e,t,n,r,i,s,o,u){var a=t.getMonth()!==r,f;return f=a||o&&t<o||u&&t>u,"<td class='"+((e+n+6)%7>=5?"ui-calendar-week-end":"")+(f?" ui-calendar-unSelectable ui-state-disabled":"")+(a||f?"":(t.getTime()===i.getTime()?" ui-calendar-current-day":"")+(t.getTime()===s.getTime()?" ui-calendar-today":""))+"'"+(f?"":" data-month='"+t.getMonth()+"' data-year='"+t.getFullYear()+"'")+">"+(a?"&#xa0;":f?"<span class='ui-state-default'>"+t.getDate()+"</span>":"<a class='ui-state-default"+(t.getTime()===s.getTime()?" ui-state-highlight":"")+(t.getTime()===i.getTime()?" ui-state-active":"")+"' href='#'>"+t.getDate()+"</a>")+"</td>"}}),f=e.ui.calendar.prototype,e.each(["maxDate","minDate","date","selectedDate"],function(e,t){f[t]=function(e){return this._option(t,e)}}),e.calendar={parseDate:function(t){var n=/^(\d{4})(?:\-|\/)(\d{1,2})(?:\-|\/)(\d{1,2})$/;return e.isDate(t)?t:n.test(t)?new Date(parseInt(RegExp.$1,10),parseInt(RegExp.$2,10)-1,parseInt(RegExp.$3,10)):null},formatDate:function(e){return e.getFullYear()+"-"+u(e.getMonth()+1,2)+"-"+u(e.getDate(),2)}}}(Zepto),define("gmu",["zepto"],function(){}),define("components/cache",[],function(){var e=new function(){};return e.put=function(e,t){window.cache==null&&(window.cache={}),window.cache[e]=t},e.get=function(e){return window.cache==null?null:window.cache[e]},e}),define("components/fixed",["zepto","backbone","gmu","components/cache"],function(e,t,n,r){function u(){}function a(){e(".cube-flight-loader").css({position:"absolute"})}function f(){e(".cube-flight-loader").css({position:"fixed"})}function h(){}function p(){}function d(){}function v(){}var i=function(){e("header").css({width:""}),e("header .title").css({position:"absolute"}),e("header").css({position:"absolute"});var t=e("header").css("width");e("header").css({position:"fixed"}),e("header").css({width:t})},s=function(){e(window).on("orientationchange",u),e(window).on("resize",a),e(window).on("scroll",f)},o=function(){e(window).off("orientationchange",u),e(window).off("resize",a),e(window).off("scroll",f)},l=function(){e(window).on("orientationchange",h),e(window).on("resize",p),e(window).on("scroll",d)},c=function(){e(window).off("orientationchange",h),e(window).off("resize",p),e(window).off("scroll",d)};return{FxHeader:i,FixLoaderOn:s,FixLoaderOff:o,FixPopoverOn:l,FixPopoverOff:c,FixHeaderWithPopoverOffsetTop:v}}),define("components/loader",["zepto","components/fixed"],function(e,t){function s(e){e=e||window.event,e.preventDefault&&e.preventDefault(),e.returnValue=!1}function o(e){for(var t=r.length;t--;)if(e.keyCode===r[t]){s(e);return}}function u(e){s(e)}function a(){window.addEventListener&&(window.addEventListener("DOMMouseScroll",u,!1),window.addEventListener("touchmove",u,!1),window.onmousewheel=document.onmousewheel=u,document.onkeydown=o)}function f(){window.removeEventListener&&(window.removeEventListener("DOMMouseScroll",u,!1),window.removeEventListener("touchmove",u,!1)),window.onmousewheel=document.onmousewheel=document.onkeydown=null}function c(){}function h(){}function p(){}var n,r=[37,38,39,40],i,l=function(t){this.config={autoshow:!0,target:"body",text:"正在加载中...",cancelable:!0},i=!1,t&&(this.config=e.extend(this.config,t)),this.config.autoshow&&this.show()};return l.prototype.show=function(){n=this,a();var r=e(this.config.target),s=this.find();if(s)return;var o=e("<div/>").addClass("cube-loader-mask"),u=e("<div/>").addClass("cube-flight-loader"),f=e("<img/>").addClass("cube-flight-loader-flight");f.attr("src","data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAFAAAABMCAYAAAD6BTBNAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAyBpVFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADw/eHBhY2tldCBiZWdpbj0i77u/IiBpZD0iVzVNME1wQ2VoaUh6cmVTek5UY3prYzlkIj8+IDx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IkFkb2JlIFhNUCBDb3JlIDUuMC1jMDYwIDYxLjEzNDc3NywgMjAxMC8wMi8xMi0xNzozMjowMCAgICAgICAgIj4gPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4gPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIgeG1sbnM6eG1wPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvIiB4bWxuczp4bXBNTT0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL21tLyIgeG1sbnM6c3RSZWY9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9zVHlwZS9SZXNvdXJjZVJlZiMiIHhtcDpDcmVhdG9yVG9vbD0iQWRvYmUgUGhvdG9zaG9wIENTNSBXaW5kb3dzIiB4bXBNTTpJbnN0YW5jZUlEPSJ4bXAuaWlkOjYwREU3RUVEN0NGODExRTI4OENEODE5MUE4NkZCQUREIiB4bXBNTTpEb2N1bWVudElEPSJ4bXAuZGlkOjYwREU3RUVFN0NGODExRTI4OENEODE5MUE4NkZCQUREIj4gPHhtcE1NOkRlcml2ZWRGcm9tIHN0UmVmOmluc3RhbmNlSUQ9InhtcC5paWQ6NjBERTdFRUI3Q0Y4MTFFMjg4Q0Q4MTkxQTg2RkJBREQiIHN0UmVmOmRvY3VtZW50SUQ9InhtcC5kaWQ6NjBERTdFRUM3Q0Y4MTFFMjg4Q0Q4MTkxQTg2RkJBREQiLz4gPC9yZGY6RGVzY3JpcHRpb24+IDwvcmRmOlJERj4gPC94OnhtcG1ldGE+IDw/eHBhY2tldCBlbmQ9InIiPz7Cd8RcAAANlElEQVR42uxcCWwU1xmemZ21vZdv72LwhY1tjDlMADsJoSmGJuSAKJdQEpqqVaVUTXqnUpM0IW2UKoeUpCpKpVZJ2hxCwQokQWniQAjgmBhiQ2LAYIzxhQ2+d9f23rPb99b/W/4dfMyaZHZbM9KvHcPO23++973/fDM8v+FxTuWDV/i9ABfjh//jZzlRRdCYCCAa9HdIJwBOgnMmMQuomgAK8HtaInEgIgiPgPMS8cAnFR/8+6wGkIEXTySBiIGIkYgOgNQAQBQwJxEHkTE4dwGggVgEUVS61meM3C1PsKWrBfASiaQQSSWSDGBqARw3kREiViJD8Mkj8CSii+ogknuIGQZSxiXdc8PipSZ9fP6o053m9komye+PDyqjEVzxWtF+qKnz1PkB2zlgJrONErKRs9IGUpbpKet+fPOKjbesLNo02Zerak7Ub/7L9rcBeAnZQ4mwIRANFk7FDDWdCAXR8MGhpu6pvnx7RfHy4qz0JeQ0i0gGERMsfzGCMOj/CsAABvFfe472uzw+32Rf1sVpNVu3rFtPTrOJmMFW6mECBLCrsw5AFs9xHp/EN5ztHp7qAmIns5flZ5aS07lE0oCFulhj4XcOINgrFuP5mBxobOuf0jhrBOHpLetWkdN5sIwZC+NiiYVqMdAPwHkhVHFWN7T0THfRxmsXWq5flFNCTucgFibAUp6VALogSB6pOdHeOTTi9EypHM/zWx9YVyZjoYEF37HAQjVtoAQZhROyDFvd6c7h6S78wTULMtYvLyidgIWiivpHF0CwgwxAFwNw/zdT20F2PL1l/VJwJmbIYgyQFkbdFqo5g3gZj1L5uL65TcmFxA6m3rW6dCliYSKyhcJsAjDkRKgdPNnRd6Gzz+pQcvEf71+7GLEwZmyhmgDK7SBlof3QqU6rkovL8jOTtlSWlQEL04GFumjbQtV+WGYHQ47k86/PXVA6BmFhqcwWGqPNQrVnDi9junRH//NVc5s/EFBUHCial258eOO1q2Qs1EeThdEA0IcAHOketPef7uofUTrA7+9ZU6QVNbTIYJF55KiwUJRVTLBcQnm8oMhSsistJ8mXsf2Lkx3WRTnmRCUX55iT9b+9c3X581UH6dKnYZAVJsODJkhVBrIqiQbCgngwzkYIWo0wy6z8LhJAZzTbyA56UThj2/d1a1ck4/z6ztUFujgtq9Skgo5RYaGAPhl4RggT0sDOZMB5Mvwfi79mqmwAARj0xp/Un2l3e31+pQNYUowJf9h8YwU4FKpjEip3aaLBQA2wywDKmEE5Oss53HhhUx4+zBREP1rGQUdid7iHjrVesEUyCHEmeakmXY7MI6vOQtajFRH76JLIJJJHpJA6P/jMR0n9lYKI07rRcTvYPhTJAAS8uCfuW8tYmAETr1M7rBHRZ7Bjdv/aZcse2XTdgw63V+/1SXEkxBA0Ai+9vLO2prqh5RsuvKjJCqXMtimyg+TmmB0MOZI9R892PHr3moJIlP/phpXZL733RR7x5L3kz0E6Dozp4VRqQGEnEmQg8Yh8eXHW9ZXL8pffvKKw9JaVRSU3XVO4+LXf3PVgQWbqCvKdBcDEdFwZIaAIES5jHM6M7m9s6xxxur2RKG/SxWuffKCyAlYMYyFL8VQpNIgISGoH40luqm3vHR7Mn5Oajr84Ny3R8O7j9937vUf/sYOwU0ChjgaWoRuYFVA4cXGIyRJhu6vuVJeVlq8iuYEfriub92LVwcLWC0OUgTaYFD+M7SU6+SMYLiATPxfejrjs3jT8gjWC3P5dtyi3eHGu5bIbyUw1JZTmWua9e6BxEAYTZB5cBwzQw+dUYgLGpAF7LLnmZEtlWUFaJABqNRqBzK1xV+3JPjALfqRTAuiiRB8WqjE7qkUTLEwE4NYt60IAamEAGqqYLcmG3FvLi3MmUnhhdoZRnxCXsvfY2THGWgRcIoyRMo0kg6SDF6Uefq5tzJXws9sqsiJdRiQIN+44eNw9aHd4ELv1QIokhfokghjh2gTu0raTiZgaBFBEFA01sD860nxx28OTK/y7u2+Yf7K91/HmZ8eMAMIQOAM3oruSZawD5akNszS2XXT2Do+6aJwXkR3SCMJzP9mw4M4/v+2Cm0+H5exU6NwCsvCKVYtGYBw7/C1f6kEAMXjBizv6rIO0TkfTpgnvnOf5v//yjpKWnkHnl6c6zTB4pADyMMMs2wketU0dw3etLs2MlIW0AbW8YG7nsdaeAohb7RAmSQrAkxd82f6cASJ9kDIKE4AdciI+hHzQK9a3dNsmA5AetPld+9JDq7gYOeikNmx7uPzbGOvC0IiTkGPglZ21+9//sukIIpoPSdDBUBuIUzk92IHUnIzkPOIRzdwsPGh4RBxa0r3fW7I0QOLgg8fbe4CZLlhlwX061AZiWjIWQt/2TA83yw/K6sc2f389MQ2FXHgbIRTGCWj9hzmS4+291n7bmHu2g5gQJ4oP3VZejgopIndpe3JYQRUHkBRIqamzb4S7enDZGUlpKKQRJqtIywuqwry0RN1V+Ig7HnWNcZNs8BQQeCydCxZWaeq2YG6aYbaDR/s1O2tPNEKY5sEeWA6gBpW1dDevKJx7lXsct6u26fh7X5xshLhwTF7pERF4LJ8N5o9rFudlzGbg6AbQ16rrD//i1d0fkD+7IdsaBQAleTUGAxh8BKG8OCtpuh95vupga3X9GSu4fJcg8F7i+RVXP/z+gCj5/XpU2eEevWdN1q2rii0zuenH3/j0TN3pzhHQx0308SjUJ8BzvJ/nOYlc53F7fbZ935xrhSyE1hovonT1MgbihhJ1GvpUky5lYXaGaapfJLPT9djr1Wdo4A7FzFGUyiktaekg2bdAZZl79ZE79DMBj0QM9ud2HOiBm+2V5cJK9GHRR2jrCYxhBWGpoQ+nq/IlHHyKiDAgkwaRk/3SgeNtAz/f9mEdOT2H6I1nR8mhAbang2JxlhRjZlFWunEmAD757z10oxJlTTtMqlVhLszJ6n84rWUVcwcA60He+LKCaii6riwrmNT+ne0ZHLv7mXf2eX1SE/mzDWac9WZ9EQCohbTRA6bDvKmipGSqiZvsIHn78K5DTdTQtyCdGGP8CgHECQXbTetFnnfCR85EFPexGfCuKsqasKhpHXN5Nz39VjXJtY/DbJ+HSsUImm0ly4UH0CTIvyn43rVl+SkzZN8JYF4HkU6wXczgK+2LyCvRcpnwUTNRvv7NyQZv0by0dPkXad/2Ry9WfXK6q78Blm4XYp8TVYOV2j8Gng8AFW8ozY0YQGpOqhtaGkEftlthCHTycZE1lsK+y3ZgKHnUyw+z5bitfKGW5MAXvZJf65P8Iokj+UR9Qtyru+tqdh8+fQBmuAdmmRnqoG1QuuUDGlAaVHY3lOaa52SlJ0WU+dAg96k3936N9BmG1RCsmBB9/Nx3fIioEkOXoP2NTxuOEvkVN96rMMCNekCxAZhh1kJ0RAoeYiBrpQb7I7eXL5wfqfIfHWnuqznRfgq87pDMU6ryOBgGkD0pycFytEECzcP/O0BBVt5myzYi8KDVyHZCMAAT1yzJS49EcbI6/H96+7OjMvbNdEKvCEDcC2DL2Q0AsoYKi49caMl6Z6goBjDU+Ll+UW5qRCnWoaaLR8/2NAP7BmHynWqyD9tACYHnA0U0KEPAtUKJxUIztDF4+VKbZyJpY06yIUGrdADq0J56c089cho25slBL1UBZD/G4hwfd/keQXnD+Ur2CDL2sbTRtGFlUU4kA2zf39jdfH7gLEQBgyiMUpV98jCG42QPBSJ3/q38mMz+hXrJJHxR3Ex3erwSifuOAPsGEPs8arNPXlBV6/cwgEatqEkuL85SHP+9Xt3Q1T1ob5PZPjcXpRdTqA0gL6v6JN66qmh+vFZUpAfdfLT1rb11E9i+qLBPVQDR8sV7Vkzrly/IVjrG3z74sp2kkR0o7mMVIEmNoDkWGBi2fCkDVytM32iH8IWqg4fBcfSjLMirsOLyPw8g3gkbBDDVpEtbOn+Oot35f33/UKvd4e5Cxc1RVsCI5kso1AYwzP5trCjJV1K+Oj9gc76yq/YrVLy1o6A5auxTDUCwf3jPXjD+qyzLV9S4enlnbYvD7T2PUjZm+3zRfgWKmq89EeXx33UlOdPaP1rA3ba7rl4W9+HyGTcbAMT2L+h9CzJTLUr6zi9W1TR7fVL3BOyTYuEFPFFj4O0VC/Omu4g2iv75yVeYfdj2RZ19qgCI7F9Y46qyrGDarXPPbv+cluq7Ie7DjW0pVl7/pCYD2cacoNetKM6esnxFG0Xb9zfWQ71vMNZsXzQAZMUK6aZrCk3mZMOU5ftn3tlXy423D3rB9o1FM2WLhTgwVGvcfOOSKcOXw81dXbsPn6Y5L+v6sVJ9TLEPl7O+6wP3XUbitaK15kT7EafHq3d7pQTJ7w/qoREEX7xW49r2Yd2n3HjbtIcLb9pLscQ+NQFk7KOVk+EtL+zYTj73cuMP9pggvAmAjbOBzcPNq6gUSxXZJhVegzxRE4mClshdejqIvUPVA2wb5S41r1i5KuaWr1qvQQ5w4Z0/du7kLj0vJ3DhG93Zbni2Iz4m2af2Eg55YQDFIQtt8AMsrEiA3yc9qwHE+00YgJe93IIL781gidmDV/jKlqvHJMd/BRgAyXPSvxo2iRUAAAAASUVORK5CYII=");var l=e("<img/>");l.attr("src","data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAC4AAAAuCAYAAABXuSs3AAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAyBpVFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADw/eHBhY2tldCBiZWdpbj0i77u/IiBpZD0iVzVNME1wQ2VoaUh6cmVTek5UY3prYzlkIj8+IDx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IkFkb2JlIFhNUCBDb3JlIDUuMC1jMDYwIDYxLjEzNDc3NywgMjAxMC8wMi8xMi0xNzozMjowMCAgICAgICAgIj4gPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4gPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIgeG1sbnM6eG1wPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvIiB4bWxuczp4bXBNTT0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL21tLyIgeG1sbnM6c3RSZWY9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9zVHlwZS9SZXNvdXJjZVJlZiMiIHhtcDpDcmVhdG9yVG9vbD0iQWRvYmUgUGhvdG9zaG9wIENTNSBXaW5kb3dzIiB4bXBNTTpJbnN0YW5jZUlEPSJ4bXAuaWlkOjc2NUIyNTY4N0NGODExRTI4NTM0QTk5OUJEQjdBQzlGIiB4bXBNTTpEb2N1bWVudElEPSJ4bXAuZGlkOjc2NUIyNTY5N0NGODExRTI4NTM0QTk5OUJEQjdBQzlGIj4gPHhtcE1NOkRlcml2ZWRGcm9tIHN0UmVmOmluc3RhbmNlSUQ9InhtcC5paWQ6NzY1QjI1NjY3Q0Y4MTFFMjg1MzRBOTk5QkRCN0FDOUYiIHN0UmVmOmRvY3VtZW50SUQ9InhtcC5kaWQ6NzY1QjI1Njc3Q0Y4MTFFMjg1MzRBOTk5QkRCN0FDOUYiLz4gPC9yZGY6RGVzY3JpcHRpb24+IDwvcmRmOlJERj4gPC94OnhtcG1ldGE+IDw/eHBhY2tldCBlbmQ9InIiPz4Lar7mAAAG1klEQVR42syaeWxUVRTGv7fM0tnbme60ZRkpS0QMsUnLUpBACxgWlyAkJhCjgVATE0FL3DCKgIKhFMMfgiFxSUQNMVJaqKwiqEhKWCogWDRQWlpaCl2nnRnPfX2DbTPzlmmh3JcvM52+e+6v39z1vHLPfN+IfhYnKVdWJimJNJ4kyL/3k06TakgXSUdkNfWnUS5KcCNpAekF0pwo2y4hfUHaTfLprSwGg7rujyG9SCokpfbzm5oj6zppPWkHqU1rZT4IzVc+6QypmJSqo57alSrHPCO3oeniwRxX1zpSKcmr8f5o5JXbWKflfjEIxb5iI31LyseDK4Xy4H6O1BxNH08n7SE9igdfmFHHSfNIVRHAw5LHkw6QvBi8wgzbT8oh1WkBN8pODyZ0qHhllsl9p0yecffRJlJWmM8HS1kyU6/PxUDvwcn6VgEevlIgL1hl4boK6yLFqisWz2HpYxaM9YiorG3Dp781gjeaIAii9lWPYrz8uAUj40RUVLdi+6km8AajWgzGNjbUZXrOKsvV+jVrcHWOHdlpZunnkR4T3EY/3iyvgcnmgigaNEG/PcmOJ1L/jxFPMdYcvEkxnEoxvDJjEftBGPH0ypDbu0gOpUZfIpdmjLD0+izDbcEwqrWvsl5yjed5Reh3pzjuQYfKMA/F7GjG8ao7MBiN4DheaabZyjZufIAsJy0gpcrvI2pCsjFstKmZCVg7IxGtTQ3o7PSFrUvMYaFDJfcRN27drEF7e5sSA2NcKMVjfZy0RH5V1B/XWiK6OXVUAj6cmYTWOw3oIvie9QSCXpPrjAjNSvmZf9DW2owuX6cax2L2yhyPI81Qc5tp66/1OHqpXhF+3cxkCT7kPHP6PYLOUoDeV3EVb+06CVOMBbwoqHEw1jg2j2czU7TMqX7ehMKyGzh84aYi/Pq8FLTdaQTn78L7U13IGhKjCL24+CeYHW643IkQjWY1DsaaLQYDwVzNe2BOgBhjR2FpNW2ggwSZGBF+A70aaJrUAh3j9MCTlAar3Sm1QUxqKLki2T5G15GJ5lrR6sTrpTckuGkK8EqlG7ocZmc83CnpsDpjpdgBbSebMWxwZmoZmD3FUwMGiwNv7K3GoQu1upfBELSJOZ2cBpvDJcXUwZDJBmeSloHZV8wdgeBXlVzHoT9r9UM7PHBT97AQdMhpHWKDM2jT63hP50WCX1lyTRM8g160pRxGgo5LGgKrfqdDsokBnaflcH3ezJZqGojqNwMmqx1OT1Ivp6MpzPHmaB1nEglm4+xkTB7hUm0sb/xQfLl8CgwC0J82GTP1cdSw2ScaCRyHDXkJyE63anZq+tgUFM0fTluTJlqkuhBl2w3M8YvROv1xXjxy0i26v+YnRydi89x0+FoaaXvQGY3jl/lAIFhJgh6xvcfG/ATkZFgVB+K+01cV4YvmZsDXfFuC18lwljl+RJfTtOPcNCtRFfr5Lfux5LMTOHC+WhF+y7xueH+XLuePsHn8BMmvZf4UCPoTgp6oBl20H6ItDjGeIXhldxUOVtZEhh+TiOL5Q9HRQs4TvAYOxnpCSMwvYPm6bC2n+lWTPJg9yqkKLRC0KyGFprw4OlzEoPRcLTLdIobH28LWG0afm4MdOHypAYLIDhKcEgZLWWwPHSR2anF8YoZFA3QsHPHJ0jGMDpGSgma75PwBBeenZXpwt7Eenb52NY6v5YOEtFXcTbqutq09+NftiNALCZq3xsLuSaEFiRYXXrxXj72nfSsKFOD3nqqCr72VukuXEgNj/Ia9Fzx5K1iCwi8rXynX+MvfjfC6OHgTbGGhHQyatqZsRexbl+gR5A3Ye7YWoz2GXt3mx5NXsGLnMZjssdIqzNOBOQLDO6Tj7L3gmbkiVL+CtIgUF+nrDNCaXUIN2/hO8PDjh9+vYNmOnwnaRU4ndzeqkGLgJHgRJdTnrZyPYgS6Y3x+FAabG9bYBBjoFBShj18mLZWfcIDL3Hi+b7J9j9LICNCppqPlLp1wbqGzo50OC2Y6CLilPQivMbdyL0bTLalPG0wUw6Ea4yk5KdSdMehz2CiRj/+Rs1nkmNHqAM+OWAQgbW9pJqAWEdC6X+K79/M9Y4gGxRjbekJLjns/Ohcu6clSvBMekvTbKTlj61PL1rIbZsnwg52xvSyz+LQm9lk+evogJvZZOSsn9uv0Prz6l5RDKhvAB1VarzK57apIdwiu6cuU/mr2FX1FYtmcSQ/I6fXytOcbiOecq0nHSJvvY79n/fnVvrPHQDznLCGNI71GqhvAblEnxxwnt6Hp4tLWno72kfiz8iPxaB8llsmPxL+L5pE4l/ZBxf34J4QJYebiAf0nhP8EGABO3rRuBVVEBgAAAABJRU5ErkJggg==");var c=e("<a/>").addClass("cube-flight-loader-cancel");c.attr("href","javascript:void(0)"),this.config.cancelable!=0&&c.bind("click",function(){n.hide(),i=!0}),c.append(l);var h=e("<span/>").addClass("cube-loader-text");h.html(this.config.text),u.append(f),u.append(c),u.append(h),e(r).append(o),e(r).append(u),t.FixLoaderOn()},l.prototype.hide=function(){f();var r=n.find();r&&(e(".cube-loader-mask").remove(),e(r).remove()),t.FixLoaderOff()},l.prototype.hideAll=function(){f();var n=e(".cube-flight-loader");n&&n.length>0&&e(n).each(function(){e(this).remove()}),t.FixLoaderOff()},l.prototype.find=function(){var t=e(this.config.target),n,r=t.children();return e(r).each(function(){e(this).hasClass("cube-flight-loader")&&(n=this)}),n},l.prototype.isCanceled=function(){return i},l}),define("components/util",[],function(){var e={versions:function(){var e=navigator.userAgent,t=navigator.appVersion;return{trident:e.indexOf("Trident")>-1,presto:e.indexOf("Presto")>-1,webKit:e.indexOf("AppleWebKit")>-1,gecko:e.indexOf("Gecko")>-1&&e.indexOf("KHTML")==-1,mobile:!!e.match(/AppleWebKit.*Mobile.*/)||!!e.match(/AppleWebKit/),ios:!!e.match(/(i[^;]+\;(U;)? CPU.+Mac OS X)/),android:e.indexOf("Android")>-1||e.indexOf("Linux")>-1,iPhone:e.indexOf("iPhone")>-1||e.indexOf("Mac")>-1,iPad:e.indexOf("iPad")>-1,webApp:e.indexOf("Safari")==-1,apad:(e.indexOf("Android")>-1||e.indexOf("Linux")>-1)&&e.indexOf("Mobile")<0}}(),language:(navigator.browserLanguage||navigator.language).toLowerCase()},t=function(){return Math.round((new Date).getTime()/1e3)};return{generateTimeStamp:t,browser:e}}),define("core/cocrouter",["require","underscore","backbone","core/mainview","components/loader","components/util"],function(e,t,n,r,i,s){var o=n.Router.extend({loadMode:"view",urls:[],routes:{"":"index","*module/*page(?t=:timestamp)":"modularRoute","*page(?t=:timestamp)":"pageRoute"},initialize:function(e){var t=this;e&&(this.delegate=e.delegate,this.loadMode=pieceConfig.loadMode,this.defaultModule=pieceConfig.defaultModule,this.defaultView=pieceConfig.defaultView,this.enablePad=pieceConfig.enablePad)},index:function(){this.modularRoute(this.defaultModule,this.defaultView)},_loadViewByApp:function(t,n,r,i){e([t+"/"+n],function(e){var n=new e;n.module=t,r(n)},function(e){i(e)})},_loadViewByModule:function(t,n,r,i,s){e([t+"/"+n],function(e){var n;r===null||r===""?n=e["default"]:n=e[r];var s=new n;s.module=t,i(s)},function(e){s(e)})},_loadViewByView:function(t,n,r,i){e([t+"/"+n],function(e){var n=new e;n.module=t,r(n)},function(e){i(e)})},modularRoute:function(t,n,r){function h(e){e.type=="portal"?(e.render(),"onShow"in e&&e.onShow()):o.delegate.changePage(e,t),f!==undefined&&f.hide()}function p(e){f!==undefined&&f.hide(),console.log("cube---cocrouter---load fail: "+e.message)}console.info("cube---cocrouter---modularRoute--"+t+"/"+n+"/"+r);var o=this,u=t+"/"+(n===null?"":n),a,f,l,c;switch(this.loadMode){case"app":throw new Error("app scope router not implement yet");case"module":console.info("cube---cocrouter---load by module"),this.enablePad==="true"?(console.info("cube---cocrouter---enablePad === true"),s.browser.versions.apad||s.browser.versions.iPad?(l=e.defined(t+"/modulePad"),c="modulePad"):(l=e.defined(t+"/module"),c="module")):(l=e.defined(t+"/module"),c="module",l||(f=new i({text:"加载中..."}))),this._loadViewByModule(t,c,n,h,p);break;case"view":console.info("cube---cocrouter---load by view");var l=e.defined(t+"/"+n);l||(f=new i({text:"加载中..."})),this._loadViewByView(t,n,h,p);break;default:throw new Error("missing loadMode")}},pageRoute:function(e,t){console.log("page route to:"+e)}});return o}),define("core/app",["zepto","backbone","core/mainview","core/cocrouter"],function(e,t,n,r){var i=function(i){var s=new n,o=new r({delegate:s}),u=window.location.pathname.substr(0,window.location.pathname.lastIndexOf("/"));console.info("cube---app---start watch history, rootPath: "+u),t.history.start({pushState:!1,root:u}),e("#appLoadingIndicator").remove(),e("body,html").css("background-color","white")};return{initialize:i}}),function(e){var t=function(e,t){typeof t=="undefined"&&(t={}),this.init(e,t)},n=t.prototype,r,i=["canvas","vml"],s=["oval","spiral","square","rect","roundRect"],o=/^\#([a-fA-F0-9]{6}|[a-fA-F0-9]{3})$/,u=navigator.appVersion.indexOf("MSIE")!==-1&&parseFloat(navigator.appVersion.split("MSIE")[1])===8?!0:!1,a=!!document.createElement("canvas").getContext,f=!0,l=function(e,t,n){var e=document.createElement(e),r;for(r in n)e[r]=n[r];return typeof t!="undefined"&&t.appendChild(e),e},c=function(e,t){for(var n in t)e.style[n]=t[n];return e},h=function(e,t){for(var n in t)e.setAttribute(n,t[n]);return e},p=function(e,t,n,r){e.save(),e.translate(t,n),e.rotate(r),e.translate(-t,-n),e.beginPath()};n.init=function(e,n){typeof n.safeVML=="boolean"&&(f=n.safeVML);try{this.mum=document.getElementById(e)!==void 0?typeof e=="object"?e:document.getElementById(e):document.body}catch(s){this.mum=document.body}n.id=typeof n.id!="undefined"?n.id:"canvasLoader",this.cont=l("div",this.mum,{id:n.id});if(a)r=i[0],this.can=l("canvas",this.cont),this.con=this.can.getContext("2d"),this.cCan=c(l("canvas",this.cont),{display:"none"}),this.cCon=this.cCan.getContext("2d");else{r=i[1];if(typeof t.vmlSheet=="undefined"){document.getElementsByTagName("head")[0].appendChild(l("style")),t.vmlSheet=document.styleSheets[document.styleSheets.length-1];var o=["group","oval","roundrect","fill"],u;for(u in o)t.vmlSheet.addRule(o[u],"behavior:url(#default#VML); position:absolute;")}this.vml=l("group",this.cont)}this.setColor(this.color),this.draw(),c(this.cont,{display:"none"})},n.cont={},n.can={},n.con={},n.cCan={},n.cCon={},n.timer={},n.activeId=0,n.diameter=40,n.setDiameter=function(e){this.diameter=Math.round(Math.abs(e)),this.redraw()},n.getDiameter=function(){return this.diameter},n.cRGB={},n.color="#000000",n.setColor=function(e){this.color=o.test(e)?e:"#000000",this.cRGB=this.getRGB(this.color),this.redraw()},n.getColor=function(){return this.color},n.shape=s[0],n.setShape=function(e){for(var t in s)if(e===s[t]){this.shape=e,this.redraw();break}},n.getShape=function(){return this.shape},n.density=40,n.setDensity=function(e){this.density=f&&r===i[1]?Math.round(Math.abs(e))<=40?Math.round(Math.abs(e)):40:Math.round(Math.abs(e)),this.density>360&&(this.density=360),this.activeId=0,this.redraw()},n.getDensity=function(){return this.density},n.range=1.3,n.setRange=function(e){this.range=Math.abs(e),this.redraw()},n.getRange=function(){return this.range},n.speed=2,n.setSpeed=function(e){this.speed=Math.round(Math.abs(e))},n.getSpeed=function(){return this.speed},n.fps=24,n.setFPS=function(e){this.fps=Math.round(Math.abs(e)),this.reset()},n.getFPS=function(){return this.fps},n.getRGB=function(e){return e=e.charAt(0)==="#"?e.substring(1,7):e,{r:parseInt(e.substring(0,2),16),g:parseInt(e.substring(2,4),16),b:parseInt(e.substring(4,6),16)}},n.draw=function(){var e=0,t,n,o,a,f,d,g,y=this.density,b=Math.round(y*this.range),w,E,S=0;E=this.cCon;var x=this.diameter;if(r===i[0]){E.clearRect(0,0,1e3,1e3),h(this.can,{width:x,height:x});for(h(this.cCan,{width:x,height:x});e<y;){w=e<=b?1-1/b*e:w=0,d=270-360/y*e,g=d/180*Math.PI,E.fillStyle="rgba("+this.cRGB.r+","+this.cRGB.g+","+this.cRGB.b+","+w.toString()+")";switch(this.shape){case s[0]:case s[1]:t=x*.07,a=x*.47+Math.cos(g)*(x*.47-t)-x*.47,f=x*.47+Math.sin(g)*(x*.47-t)-x*.47,E.beginPath(),this.shape===s[1]?E.arc(x*.5+a,x*.5+f,t*w,0,Math.PI*2,!1):E.arc(x*.5+a,x*.5+f,t,0,Math.PI*2,!1);break;case s[2]:t=x*.12,a=Math.cos(g)*(x*.47-t)+x*.5,f=Math.sin(g)*(x*.47-t)+x*.5,p(E,a,f,g),E.fillRect(a,f-t*.5,t,t);break;case s[3]:case s[4]:n=x*.3,o=n*.27,a=Math.cos(g)*(o+(x-o)*.13)+x*.5,f=Math.sin(g)*(o+(x-o)*.13)+x*.5,p(E,a,f,g),this.shape===s[3]?E.fillRect(a,f-o*.5,n,o):(t=o*.55,E.moveTo(a+t,f-o*.5),E.lineTo(a+n-t,f-o*.5),E.quadraticCurveTo(a+n,f-o*.5,a+n,f-o*.5+t),E.lineTo(a+n,f-o*.5+o-t),E.quadraticCurveTo(a+n,f-o*.5+o,a+n-t,f-o*.5+o),E.lineTo(a+t,f-o*.5+o),E.quadraticCurveTo(a,f-o*.5+o,a,f-o*.5+o-t),E.lineTo(a,f-o*.5+t),E.quadraticCurveTo(a,f-o*.5,a+t,f-o*.5))}E.closePath(),E.fill(),E.restore(),++e}}else{c(this.cont,{width:x,height:x}),c(this.vml,{width:x,height:x});switch(this.shape){case s[0]:case s[1]:g="oval",t=140;break;case s[2]:g="roundrect",t=120;break;case s[3]:case s[4]:g="roundrect",t=300}n=o=t,a=500-o;for(f=-o*.5;e<y;){w=e<=b?1-1/b*e:w=0,d=270-360/y*e;switch(this.shape){case s[1]:n=o=t*w,a=500-t*.5-t*w*.5,f=(t-t*w)*.5;break;case s[0]:case s[2]:u&&(f=0,this.shape===s[2]&&(a=500-o*.5));break;case s[3]:case s[4]:n=t*.95,o=n*.28,u?(a=0,f=500-o*.5):(a=500-n,f=-o*.5),S=this.shape===s[4]?.6:0}E=h(c(l("group",this.vml),{width:1e3,height:1e3,rotation:d}),{coordsize:"1000,1000",coordorigin:"-500,-500"}),E=c(l(g,E,{stroked:!1,arcSize:S}),{width:n,height:o,top:f,left:a}),l("fill",E,{color:this.color,opacity:w}),++e}}this.tick(!0)},n.clean=function(){if(r===i[0])this.con.clearRect(0,0,1e3,1e3);else{var e=this.vml;if(e.hasChildNodes())for(;e.childNodes.length>=1;)e.removeChild(e.firstChild)}},n.redraw=function(){this.clean(),this.draw()},n.reset=function(){typeof this.timer=="number"&&(this.hide(),this.show())},n.tick=function(e){var t=this.con,n=this.diameter;e||(this.activeId+=360/this.density*this.speed),r===i[0]?(t.clearRect(0,0,n,n),p(t,n*.5,n*.5,this.activeId/180*Math.PI),t.drawImage(this.cCan,0,0,n,n),t.restore()):(this.activeId>=360&&(this.activeId-=360),c(this.vml,{rotation:this.activeId}))},n.show=function(){if(typeof this.timer!="number"){var e=this;this.timer=self.setInterval(function(){e.tick()},Math.round(1e3/this.fps)),c(this.cont,{display:"block"})}},n.hide=function(){typeof this.timer=="number"&&(clearInterval(this.timer),delete this.timer,c(this.cont,{display:"none"}))},n.kill=function(){var e=this.cont;typeof this.timer=="number"&&this.hide(),r===i[0]?(e.removeChild(this.can),e.removeChild(this.cCan)):e.removeChild(this.vml);for(var t in this)delete this[t]},e.CanvasLoader=t}(window),define("canvasloader",function(){}),define("components/base64Img",["zepto","underscore","backbone","canvasloader","components/util","components/cache"],function(e,t,n,r,i,s){var o=n.View.extend({initialize:function(){this.render()},render:function(){var t=this,n=e(t.el).attr("width")?e(t.el).attr("width"):30,r=e(t.el).attr("height")?e(t.el).attr("height"):30,o=e(t.el).attr("src"),u=e(t.el).attr("style"),a=e(t.el).attr("isShowLoader")=="true",f,l;s.get("base64ImgClass")?(l=s.get("base64ImgClass")+1,s.put("base64ImgClass",l.toString())):(l="base64Img"+i.generateTimeStamp(),s.put("base64ImgClass",l.toString()));if(a){var c=document.createElement("div");f=e(c),f.attr({style:"margin:auto;width:"+n+"px;height:"+r+"px;","class":l.toString()});var h=new CanvasLoader(c);h.setColor("#cccccc"),h.setDiameter(n<r?n:r),h.setDensity(9),h.setSpeed(1),h.setFPS(27),h.show(),e(t.el).replaceWith(f)}else e(t.el).addClass(l.toString());e.ajax({type:"GET",url:o,dataType:"text",before:function(){},success:function(t,i){var s=e(document.createElement("img"));s.attr({width:n,height:r,style:"display:none",src:""}),e(s).attr({src:t,style:u}),e("."+l).replaceWith(s)},complete:function(){},error:function(e,t,n){console.log("err")}})}},{compile:function(n){var r=this;return t.map(e(n).find("base64"),function(e){var t=new o({el:e});return t})}});return o}),define("components/carousel",["backbone","underscore","zepto","gmu"],function(e,t,n,r){var s=e.View.extend({initialize:function(){function v(){n(e.el).slider("_resize")}var e=this,t=n(e.el).attr("data-viewNum"),r=n(e.el).attr("data-imgInit"),i=n(e.el).attr("data-imgZoom"),s=n(e.el).attr("data-loop"),o=n(e.el).attr("data-springBackDis"),u=n(e.el).attr("data-autoPlay"),a=n(e.el).attr("data-autoPlayTime"),f=n(e.el).attr("data-animationTime"),l=n(e.el).attr("data-showArr"),c=n(e.el).attr("data-showDot"),h=n(e.el).slider({viewNum:t===null?1:t,imgInit:r===null?2:r,imgZoom:i===null||i==="false"?!1:!0,loop:s===null||s==="true"?!0:!1,springBackDis:o===null?15:o,autoPlay:u===null||u==="true"?!0:!1,autoPlayTime:a===null?4e3:a,animationTime:f===null?400:f,showArr:l===null||l==="true"?!1:!1,showDot:c===null||c==="true"?!1:!1}),p=arguments[0].pagerEl,d=arguments[0].container;setTimeout(function(){n(e.el).slider("_resize")},0),n(window).on("resize",v),n(p.find("td")).css({"background-color":"#ffffff"}),n(p.find("td")).css({opacity:"0.3"}),n(p.find("td")[0]).css({"background-color":"#37c1f4"}),n(p.find("td")[0]).css({opacity:"1.0"}),h.on("slide",function(){var e=arguments[0].data;p.find("td").css({"background-color":"#ffffff"}),p.find("td").css({opacity:"0.3"}),n(p.find("td")[e]).css({"background-color":"#37c1f4"}),n(p.find("td")[e]).css({opacity:"1.0"})});var m=p.find("td").length;for(k=0;k<m;k++){var g=k;n(p.find("td")[g]).on("click",function(){n(e.el).slider("_move",n(this).index())})}}},{compile:function(e){var r=this;return t.map(n(e).find("carousel"),function(e){var t=document.createElement("div"),r=n(e).css("width"),o=n(e).attr("id").length>0?n(e).attr("id"):"myCarousel";n(t).attr("id",o),n(t).attr("style","position:relative;top:0;left:0;width:"+r+";"+"overflow:hidden;");var u='<table  border="0" cellpadding="0" cellspacing="0" style="cursor:pointer;width:100%;height:3px;position:absolute;bottom:0px;"></tr>',a=n(e).children().length;for(j=0;j<a;j++)u+='<td style="font-size:5px">&nbsp;</td>';u+="</tr></table>";var f=n(u),l=e.attributes,c=document.createElement("div");for(i=0;i<l.length;i++)c.setAttribute(l[i].name,l[i].value);n(c).css({width:"100%"}),n(c).append(n(e).children());var h=new s({el:c,pagerEl:f,container:t});return t.appendChild(c),n(t).append(f),n(e).replaceWith(t),t})}});return s}),define("components/dialog",["zepto","underscore"],function(e,t){function r(e){e=e||window.event,e.preventDefault&&e.preventDefault(),e.returnValue=!1}function i(e){for(var t=n.length;t--;)if(e.keyCode===n[t]){r(e);return}}function s(e){r(e)}function o(){window.addEventListener&&(window.addEventListener("DOMMouseScroll",s,!1),window.addEventListener("touchmove",s,!1),window.onmousewheel=document.onmousewheel=s,document.onkeydown=i)}function u(){window.removeEventListener&&(window.removeEventListener("DOMMouseScroll",s,!1),window.removeEventListener("touchmove",s,!1)),window.onmousewheel=document.onmousewheel=document.onkeydown=null}var n=[37,38,39,40],a=function(e,n){var r=this;this.config={autoshow:!0,target:"body",title:"提示",content:"提示内容"},this.btnConfigs={configs:[{title:"确定"}]},e&&(this.config=t.extend(this.config,e),this.btnConfigs=t.extend(this.btnConfigs,n)),window.onresize=function(){r.calculatePosition()},this.config.autoshow&&!this.isShow()&&(this.show(),e.disableScroll&&o())},f='<div id="cube-dialog-wrapper"><div class="cube-dialog ui-corner-all" style="z-index: 500;min-width:260px; position: fixed; height:auto;"><div style="margin-bottom: 4px;" class="ui-header ui-bar-b"><div class="ui-title cube-dialog-header" style="padding-top:10px">提示</div></div><div><p class="cube-dialog-subtitle">该航班已经订阅！</p><div class="cube-dialog-controls"></div></div></div><div class="cube-dialog-screen cube-dialog-screen-model" style="z-index: 1000; display: block; "></div>';0/0;var l='<button class="btn cube-dialog-btn ui-shadow ui-btn-corner-all ui-btn-icon-left" eventname="abcd"><span class="ui-btn-inner ui-btn-corner-all"><span class="cube-dialog-btn-title ui-btn-text">确定</span><span class="ui-icon ui-icon-check ui-icon-shadow">&nbsp;</span></span></button>';return a.prototype.isShow=function(){var e=document.getElementById("cube-dialog-wrapper");return e?!0:!1},a.prototype.show=function(){var t=e(this.config.target);e(t).append(f),e(".cube-dialog-header").html(this.config.title),e(".cube-dialog-subtitle").html(this.config.content);var n=e(".cube-dialog");n&&(this.calculatePosition(),this.initBtn(n))},a.prototype.calculatePosition=function(){var t=document.getElementsByTagName("body")[0].scrollHeight;e(".cube-dialog-screen").css("height",t);var n=e(this.config.target),r=e(".cube-dialog"),i=parseInt(n.width()),s=parseInt(n.css("height")),o=parseInt(r.css("width")),u=document.documentElement.clientHeight;if(e.browsers&&e.browser.msie){var a=e(".cube-dialog-screen")[0];e(a).height(u)}var f=r.height()+42;r.css("top","50%"),r.css("margin-top","-"+f/2+"px");var l=(i-o)/2-5;r.css("left",l+"px"),r.css("width",o+"px")},a.prototype.initBtn=function(t){var n=this,r=e(".cube-dialog-controls"),i=e(t).css("width");if(!r)return;for(var s=0;s<this.btnConfigs.configs.length;s++)r.append(l);var o=e(".cube-dialog-btn"),u=(parseInt(i)-10*(o.length-1)-20*o.length)/o.length,a=e(".cube-dialog-btn-title");for(var s=0;s<o.length;s++){var f=e(o[s]),c=this.btnConfigs;e(a[s]).html(this.btnConfigs.configs[s].title),f.attr({eventname:this.btnConfigs.configs[s].eventName}),f.css("padding","4px 0px"),f.css("width",u+"px"),f.css("margin-left","10px"),f.css("margin-right","10px"),f.css("margin-bottom","10px"),f.bind("click",function(){n.hide(),e(this).attr("eventname")&&c[e(this).attr("eventname")]()}),e(t).append(f)}},a.prototype.hide=function(){var t=this.find();t&&(e(t).remove(),u())},a.prototype.find=function(){var t=e(this.config.target),n,r=t.children();return e(r).each(function(){e(this).attr("id")=="cube-dialog-wrapper"&&(n=this)}),n},a}),define("components/form",["zepto","underscore","components/cache","components/loader"],function(e,t,n,r){var i=function(n){this.config={},this.config=t.extend(this.config,n),this.requestParams={},this.jqObject=e("#"+n.id),this.parseConfig(e("#"+n.id))};return i.prototype.serialize=function(){if(this.jqObject)return e(this.jqObject).serialize()},i.prototype.serializeArray=function(){if(this.jqObject)return e(this.jqObject).serializeArray()},i.prototype.setRequestParams=function(e){this.requestParams=t.extend(this.requestParams,e),this.loadPage()},i.prototype.loadPage=function(){var n=new r({text:"查询中..."}),i=this,s=this.config._itemTemplate;e.ajax({block:!0,url:i.config.url,type:"GET",data:i.requestParams,dataType:"json",success:function(r,o,u){n.hide(),console.log("列表数据加载成功："+o+" response:["+r+"]");var a=r;t.each(i.config.jsonRoot.split("."),function(e){a=a[e]});var f=e("#"+s).html();e(document.getElementById(i.config.id)).append(t.template(f,a))},error:function(e,t,r){n.hide(),console.error("列表数据加载失败："+e+"/"+r+"/"+t)}})},i.prototype.parseConfig=function(n){var r=this,i=e(n);this.config.id=i.attr("id"),this.config.itemTemplate=i.attr("itemTemplate"),this.config.url=i.attr("url"),this.config.jsonRoot=i.attr("jsonRoot"),i.children().each(function(e,n){var i=r[n.tagName.toLowerCase()+"TagHandler"];t.isFunction(i)&&i.apply(r,[n])})},i}),define("components/oldloader",["zepto"],function(e){function n(e){e=e||window.event,e.preventDefault&&e.preventDefault(),e.returnValue=!1}function r(e){for(var r=t.length;r--;)if(e.keyCode===t[r]){n(e);return}}function i(e){n(e)}function s(){window.addEventListener&&(window.addEventListener("DOMMouseScroll",i,!1),window.addEventListener("touchmove",i,!1),window.onmousewheel=document.onmousewheel=i,document.onkeydown=r)}function o(){window.removeEventListener&&(window.removeEventListener("DOMMouseScroll",i,!1),window.removeEventListener("touchmove",i,!1)),window.onmousewheel=document.onmousewheel=document.onkeydown=null}var t=[37,38,39,40],u=function(t){this.config={autoshow:!0,target:"body",text:"载入中..."},t&&(this.config=e.extend(this.config,t)),this.config.autoshow&&this.show()};return u.prototype.show=function(){s();var t=e(this.config.target),n=this.find();if(n)return;n=e("<div/>").addClass("cube-loader");var r=e("<div/>").addClass("cube-loader-block"),i=e("<div/>").addClass("cube-loader-icon"),o=e("<p/>").append(this.config.text);r.append(i),r.append(o),n.append(r);var u=e(this.config.target).children();u&&u.length>0?u.first().before(n):e(t).append(n)},u.prototype.hide=function(){o();var t=this.find();t&&e(t).remove()},u.prototype.hideAll=function(){o();var t=e(".cube-loader");t&&t.length>0&&e(t).each(function(){e(this).remove()})},u.prototype.find=function(){var t=e(this.config.target),n,r=t.children();return e(r).each(function(){e(this).hasClass("cube-loader")&&(n=this)}),n},u}),define("date",["jquery","mdatepicker"],function(e){e("date").each(function(){var t=e(this),n={preset:"date",lang:"zh",dateOrder:"yymmdd D",theme:"android-ics light",maxDate:new Date(2015,12,31,59,50)},r=this.attributes,i=r.length,s,o=0;for(;o<i;o++)s=r[o],s.specified&&(n[s.name]=s.value);n.name||(n.name=n.id);var u=e("<input  />").attr("id",n.id).attr("name",n.name);u.appendTo(t.parent()),t.remove(),e(u).scroller("destroy").scroller(n)})}),define("components/date",function(){}),define("components/list",["zepto","underscore","components/loader","components/cache","gmu","backbone"],function(e,t,n,r,i,s){var o=s.View.extend({tagName:"div",elContext:document,events:{"click .cube-list-item":"onItemSelect"},requestParams:{},config:{observers:[],width:"100%",height:"500",autoLoad:"true",pageParam:"page",pageSizeParam:"pageSize",topOffset:40,page:1,pageSize:10,pullDownEnable:!1,isPullDownRefresh:!1,pagingEnable:!0,iScroll:!1,method:"GET",filterStr:null,momentum:!0},request:null,initialize:function(){var t=this;if(arguments&&arguments.length>0){var n=arguments[0],i;for(i in n)i in this&&(this[i]=n[i]);var s={};for(var o in this.config)s[o]=this.config[o];for(var u in n)s[u]=n[u];this.config=s}if(this.config.iScroll!="false"){var a=new iScroll(this.el,{onBeforeScrollStart:function(e){var t=e.target;while(t.nodeType!=1)t=t.parentNode;t.tagName!="TEXTAREA"&&t.tagName!="INPUT"&&t.tagName!="SELECT"&&e.preventDefault()},topOffset:n.topOffset,useTransition:!0,onRefresh:function(){pullUpEl=t.$("#pullUp")[0],pullUpEl!=null&&(pullUpOffset=pullUpEl.offsetHeight,pullUpEl.className.match("loading")&&(pullUpEl.className="",pullUpEl.querySelector(".pullUpLabel").innerHTML="Pull up to load more..."))},onScrollMove:function(){r.put("onScrollMove","true"),pullUpEl=t.$("#pullUp")[0];if(pullUpEl!=null){pullUpOffset=pullUpEl.offsetHeight;var n=5;this.y<this.maxScrollY-n&&!pullUpEl.className.match("flip")?(pullUpEl.className="flip",pullUpEl.querySelector(".pullUpLabel").innerHTML="Release to refresh..."):this.y>this.maxScrollY+n&&pullUpEl.className.match("flip")&&(pullUpEl.className="",pullUpEl.querySelector(".pullUpLabel").innerHTML="Pull up to load more...")}var i=40;pullDownRefreshEl=t.$("#PullDownRefresh")[0],pullDownRefreshEl&&(this.y>i&&this.options.topOffset>0?(this.options.topOffset=0,e(pullDownRefreshEl).find("#pullDownRefreshIcon").attr({"class":"pullDownIn"}),e(pullDownRefreshEl).find("#pullDownRefreshLable").text("Release to reload..."),e(t.$("#pullDownRefreshIconWarp")[0]).addClass("pullDownFlip180")):this.y<i&&this.options.topOffset==0?(this.options.topOffset=parseInt(e(pullDownRefreshEl).css("height")),e(pullDownRefreshEl).find("#pullDownRefreshIcon").removeClass("pullDownOut").addClass("pullDownIn"),e(pullDownRefreshEl).find("#pullDownRefreshLable").text("Pull down to reload..."),r.put("onScrollMove","false"),e(t.$("#pullDownRefreshIconWarp")[0]).removeClass("pullDownFlip180")):this.y>0&&r.put("onScrollMove","false"))},onBeforeScrollEnd:function(){pullDownRefreshEl=t.$("#PullDownRefresh")[0],pullDownRefreshEl!=null&&this.options.topOffset==0&&(e(pullDownRefreshEl).find("#pullDownRefreshIcon").removeClass("pullDownIn").addClass("pullDownOut"),e(pullDownRefreshEl).find("#pullDownRefreshLable").text("Reloading..."),this.refresh())},onScrollEnd:function(){pullUpEl=t.$("#pullUp")[0],pullUpEl!=null&&(pullUpOffset=pullUpEl.offsetHeight,pullUpEl.className.match("flip")&&(pullUpEl.className="loading",pullUpEl.querySelector(".pullUpLabel").innerHTML="Loading...",t.config.page=t.config.page+1,t.loadNextPage(),r.put("onScrollMove","false"))),pullDownRefreshEl=t.$("#PullDownRefresh")[0];if(pullDownRefreshEl!=null&&this.options.topOffset==0){var n=this;e(pullDownRefreshEl).find("#pullDownRefreshIcon").attr({"class":"pullDownOut"}),t.loadNextPage(function(){r.put("onScrollMove","false"),e(pullDownRefreshEl).find("#pullDownRefreshLable").text("Pull down to refresh..."),n.options.topOffset=parseInt(e(pullDownRefreshEl).css("height")),e(pullDownRefreshEl).find("#pullDownRefreshIcon").attr({"class":"pullDownIn"}),e(t.$("#pullDownRefreshIconWarp")[0]).removeClass("pullDownFlip180"),n.refresh()})}}});this.iScroll=a}this.config.autoLoad=="true"&&this.reload()},onItemSelect:function(e){if(r.get("onScrollMove")=="true"){r.put("onScrollMove","false");return}var t=e.currentTarget,n=null,i=t.getAttribute("index"),s="cube-list-"+this.config.id;if(r.get(s)){var o=r.get(s);n=o[i]}var u=e.toElement!=null?e.toElement.nodeName:e.target.nodeName;this.shouldPreventListEvent(u)&&(this.trigger("List:select",this,n,i),this.trigger("select",this,{data:n,index:i,event:e}))},render:function(){return this.reload(),this},reload:function(){this.config.page=1,this.loadNextPage()},setRequestParams:function(e){this.requestParams=t.extend(this.requestParams,e),this.reload()},filterChildren:function(e){var t=this.$(".contentScroller");this.iScroll&&this.iScroll.scrollTo(0,0),e?(t.find("li[filter-keyword]").hide(),this.$("#"+this.config.id+' li[filter-keyword*="'+e.toLowerCase()+'"]').show()):t.find("li[filter-keyword]").show(),this.config.iScroll!="false"&&this.iScroll.refresh()},refreshIscroll:function(){this.config.iScroll!="false"&&this.iScroll.refresh()},shouldPreventListEvent:function(e){return e!="TEXTAREA"&&e!="INPUT"&&e!="SELECT"?!0:!1},loadListByJSONArray:function(n){var i=this;i.config.page==1&&i.clearList();if(n===null||n.length===0){if(i.$(".cube-list-item-more-record").length===0){var s=e("<li/>");s.addClass("cube-list-item-more-record"),s.html("无相关记录"),s.appendTo(i.el.querySelector(".contentScroller .item-content")),e("#pullUp").remove(),console.log("cube---list---list: 没有数据")}return}var o=n,u="cube-list-"+i.config.id;if(r.get(u)&&i.config.page>1){var a=r.get(u);o=a.concat(n)}r.put(u,o);var f,l=this.config._itemTemplate,c=this.config.paging,h;l&&(h=e(this.elContext).find("#"+l).html()),i.config.searchkeys&&(f=i.config.searchkeys.split(","));for(var p=0;p<n.length;p++){var d=n[p];d.index=p,d.mainDatas=n;var s=e("<li/>");s.addClass("cube-list-item"),s.attr("index",(i.config.page-1)*i.config.pageSize+p);if(f){var v="";for(var m=0;m<f.length-1;m++)n[p][f[m]]&&(v=v+n[p][f[m]]+" ");n[p][f[f.length-1]]&&(v+=n[p][f[f.length-1]]),s.attr("filter-keyword",v.toLowerCase())}l&&s.append(t.template(h,d)),s.appendTo(i.el.querySelector(".contentScroller .item-content"))}var g=this.el.querySelector(".cube-list-item-more");g&&this.$(g).remove();if(c=="true"&&i.config["pageSize"]==n.length){var y=e("<li/>");y.addClass("cube-list-item-more"),y.appendTo(i.el.querySelector(".contentScroller"));var b="<div class='' id='pullUp'><span class='pullUpIcon'></span><span class='pullUpLabel'>Pull up to load more...</span></div>",w=e(b);y.append(w)}else if(c!==undefined){var s=e("<li/>");s.addClass("cube-list-item-more-record"),s.html("无更多相关记录"),e("#pullUp").remove(),s.appendTo(i.el.querySelector(".contentScroller .item-content"))}i.trigger("drawed",i,n),i.config.iScroll!="false"&&i.iScroll.refresh()},clearList:function(){var e=this.$(".contentScroller"),t=e.find(".item-content");this.config["page"]==1&&t.find("li").remove()},loadNextPage:function(r){console.log("cube---list---list:load  begin");var i=this,s;i.requestParams[i.config.pageParam]=this.config.page,i.requestParams.pageSize=this.config.pageSize;var o=this.config._itemTemplate;if(!i.config.url)return;i.config.loaderText?s=new n({text:i.config.loaderText}):s=new n({text:"查询中..."}),e.ajax({block:!0,timeout:2e4,traditional:!0,url:i.config.url,type:i.config.method,data:i.requestParams,dataType:"json",beforeSend:function(e,t){console.log("cube---list---list: request data..."),i.request&&i.request.abort(),i.request=e},complete:function(){i.request=null,i.refreshIscroll(i),r&&r()},success:function(e,n,r){console.log("cube---list---列表数据加载成功："+n+" response:["+e+"]"),i.trigger("load",i,e);var u=e;i.config.jsonRoot&&t.each(i.config.jsonRoot.split("."),function(e){u=u[e]});var a;o&&(a=this.$("#"+o).html()),console.log("cube---list---"+u.length+" records in total"),i.loadListByJSONArray(u),i.config.filterStr&&i.filterChildren(i.config.filterStr),i.trigger("loaded",i,e),s.hide(),console.log("cube---list---list:load and draw  end")},error:function(e,t,n){i.config.page=i.config.page-1,console.error("cube---list---列表数据加载失败："+e+"/"+n+"/"+t),s.hide()}})}},{parseConfig:function(t,n){var r=e(t),i={};for(var s=0;s<n.length;s++){var o=n[s],u=r.attr(o);u&&(i[o]=u)}return i},compile:function(n){var i=this;return t.map(e(n).find("list"),function(t){function d(){var t=e(window).height(),n=e(f).offset().top,r=t-n;s.height&&(r=s.height),s.additionHeight&&(r+=parseInt(s.additionHeight)),e("html").css({"min-height":n}),e("body").find(f).css({height:r+"px"}),e(".cube-list-item-more-record").css({"border-bottom":"0px"})}console.log("cube---list---list:compile");var s=i.parseConfig(t,["id","itemTemplate","_itemTemplate","moreItemElement","url","method","jsonRoot","class","paging","iScroll","isPullDownRefresh","autoLoad","pageParam","searching","searchkeys","filterStr","pageSize","skin","loaderText","searchText","width","height","additionHeight"]),u=document.createElement("div");u.setAttribute("id",s.id),u.setAttribute("data-component","list"),s.skin?u.setAttribute("class","cube-list-"+s.skin):u.setAttribute("class","cube-list-nostyle"),this.$(u).css("height","100%");var a=document.createElement("ul");this.$(a).addClass("contentScroller"),u.appendChild(a);var f=document.createElement("div");s.height?e(f).attr("style","height:"+s.height+"px;"):e(f).attr("style","height:600px;");var l;s.isPullDownRefresh=="true"&&(l=document.createElement("div"),e(l).attr("id","PullDownRefresh"),e(l).attr("style","height: 40px;"),e(l).append('<span id="pullDownRefreshIconWarp"><span id="pullDownRefreshIcon"></span></span><span id="pullDownRefreshLable">Pull down to refresh...</span>'));var c=document.createElement("div");this.$(c).addClass("item-content"),a.appendChild(c),e(u).wrap(f),e(u).find("div ul").prepend(l),this.$(t).replaceWith(f),s.el=u;var h=parseInt(e(l).css("height"));s.topOffset=h?h:0,s.elContext=n;var p=new o(s);r.put(s.id+"Onload",0);var v=setInterval(function(){e("body").find(f).length>0&&d();var t=parseInt(r.get(s.id+"Onload"))+1;t==1&&(e(window).on("resize",d),e(f).unload(function(){e(window).off("resize",d)})),t>1&&e("body").find(f).length==0?(clearInterval(v),console.log("cube---list---end")):r.put(s.id+"Onload",t)},500);return p})}});return o}),define("components/extendable-list",["zepto","underscore","components/loader","components/cache","gmu","backbone","components/list"],function(e,t,n,r,i,s,o){var u,a=o.extend({tagName:"div",events:{"click .cube-list-item":"onItemSelect"},requestParams:{},config:{observers:[],autoLoad:"true",pageParam:"page",pageSizeParam:"pageSize",page:1,pageSize:10,pullDownEnable:!1,pagingEnable:!0,iScroll:!1,method:"GET",extendable:!1,extendRoot:"",filterStr:null},request:null,onItemSelect:function(n){var i=this,s=n.currentTarget,o=null,u=s.getAttribute("index"),a="cube-list-"+this.config.id;if(r.get(a)){var f=r.get(a),o=f[u];i.config.extendRoot&&t.each(i.config.extendRoot.split("."),function(e){o=o[e]})}var l=this.$(".cube-extend-view")[u];e(l).css("display")=="none"?(e.each(this.$(".extended"),function(){e(this).removeClass("extended"),e(this).hide()}),e(l).addClass("extended"),e(l).show()):(e(l).removeClass("extended"),e(l).hide()),console.log("on extend:"+u),this.iScroll&&this.iScroll.refresh(),this.trigger("ExtendableList:extend",this,o,u)},loadListByJSONArray:function(n){var i=this;i.clearList();var s=n,o="cube-list-"+i.config.id;if(r.get(o)&&i.config.page>1){var a=r.get(o);s=a.concat(n)}r.put(o,s);var f=this.config._itemTemplate,l=this.config._extendableTemplate,c=this.config.moreItemElement,h=this.config.paging,p;f&&(p=e("#"+f).html()),l&&(extendTemplateStr=e("#"+l).html());for(var d=0;d<n.length;d++){var v=n[d];v.index=d,v.mainDatas=n;var m=e("<li/>");m.addClass("cube-list-item");var g=e("<li/>");g.addClass("cube-extend-view"),m.attr("index",(i.config.page-1)*i.config.pageSize+d),f&&m.append(t.template(p,v));var y=v;i.config.extendRoot&&t.each(i.config.extendRoot.split("."),function(e){y=y[e]});for(var b=0;b<y.length;b++)l&&g.append(t.template(extendTemplateStr,y[b]));var w=e(u.querySelector("#"+i.id)).find(".contentScroller").find(".item-content");m.appendTo(w),g.appendTo(w),g.css("display","none")}this.$("#"+i.config.id+"-more")&&this.$("#"+i.config.id+"-more").remove();if(h=="true"&&i.config["pageSize"]==n.length){var E=e("<li/>");E.addClass("cube-list-item-more"),E.attr("id",i.config.id+"-more"),E.appendTo(e(u.querySelector("#"+i.id)).find(".contentScroller"));if(c!=null)this.$("#"+c).template(c),E.append(e.tmpl(c,null));else{var S=e("<div>更多...</div>");E.append(S)}E.click(function(){i.loadNextPage()})}i.trigger("drawed",i,n),i.config.iScroll!="false"&&i.iScroll.refresh()},loadNextPage:function(){console.log("extendablelist:load  begin");var r=this;r.requestParams[r.config.pageParam]=this.config.page,r.requestParams.pageSize=this.config.pageSize;var i=this.config._itemTemplate,s=this.config._extendableTemplate;if(!r.config.url)return;var o=new n({text:"查询中..."});e.ajax({block:!0,timeout:2e4,traditional:!0,url:r.config.url,type:r.config.method,data:r.requestParams,dataType:"json",beforeSend:function(e,t){console.log("extendablelist component request data..."),r.request&&r.request.abort(),r.request=e},complete:function(){r.request=null},success:function(e,n,i){console.log("列表数据加载成功："+n+" response:["+e+"]"),r.trigger("load",r,e);var s=e;r.config.jsonRoot&&t.each(r.config.jsonRoot.split("."),function(e){s=s[e]});var u;console.log(s.length+" records in total"),r.loadListByJSONArray(s),r.config.iScroll!="false"&&r.iScroll.refresh(),r.config.filterStr&&r.filterChildren(r.config.filterStr),r.config.page=r.config.page+1,r.trigger("loaded",r,e),o.hide(),console.log("extendablelist:load and draw  end")},error:function(e,t,n){console.error("列表数据加载失败："+e+"/"+n+"/"+t),o.hide()}})}},{compile:function(n){var i=this;return t.map(e(n).find("extendablelist"),function(t){function h(){var t=e(window).height(),n=e(o).offset().top,r=t-n;s.height&&(r=s.height),s.additionHeight&&(r+=parseInt(s.additionHeight)),e("html").css({"min-height":n}),e("body").find(o).css({height:r+"px"}),e(".cube-list-item-more-record").css({"border-bottom":"0px"})}console.log("extendablelist:compile  begin");var s=i.parseConfig(t,["id","itemTemplate","_itemTemplate","moreItemElement","url","method","jsonRoot","class","paging","iScroll","autoLoad","pageParam","searching","searchkeys","filterStr","pageSize","_extendableTemplate","extendRoot","skin"]),o=document.createElement("div");o.setAttribute("id",s.id),o.setAttribute("data-component","extendablelist"),s.skin?o.setAttribute("class","cube-list-"+s.skin):o.setAttribute("class","cube-list-nostyle"),this.$(o).css("height","100%");var f=document.createElement("ul");this.$(f).addClass("contentScroller"),o.appendChild(f);var l=document.createElement("div");this.$(l).addClass("item-content"),f.appendChild(l),this.$(t).replaceWith(o),s.el=o,u=n;var c=new a(s);console.log("extendablelist:compile  end"),r.put(s.id+"Onload",0);var p=setInterval(function(){e("body").find(o).length>0&&h();var t=parseInt(r.get(s.id+"Onload"))+1;t==1&&(e(window).on("resize",h),e(o).unload(function(){e(window).off("resize",h)})),t>1&&e("body").find(o).length==0?(clearInterval(p),console.log("enddddd")):r.put(s.id+"Onload",t)},500);return c})}});return a}),define("components/i18n",[],function(){return{setLocale:function(e){window.localStorage.lang=e,requirejs.config({config:{i18n:{locale:window.localStorage.lang}}})},getLocale:function(){return window.localStorage.lang},setLocaleAndReload:function(e){this.setLocale(e),window.location.reload()}}}),define("components/module-panel",["zepto","backbone","gmu"],function(e,t,n){var r=t.View.extend({initialize:function(e){},render:function(e){this.loadRelatedModuleInfo(e)},loadRelatedModuleInfo:function(t){e(".cube-panel").length>0&&(console.info("移除侧边栏"),e(".cube-panel").remove(),e(".cube-panel-masker").remove()),console.info("重新加载侧边栏");var n=this,r=JSON.parse(t),i=[],s=0,o=r.relatesTo.length;_.each(r.relatesTo,function(e){require(["text!"+e+"/CubeModule.json"],function(t){t&&i.push({name:JSON.parse(t).name,pack:e,moduleUrl:"../"+e+"/index.html?cube-action=push",iconUrl:"../"+e+"/icon.png"}),s++,s==o&&n.loadModuleCallBack(i)})})},loadModuleCallBack:function(e){var t='<div id="panel-menu" style="margin-top: 44px;"><div id="panel-scroller" style="height: 100%;"><div><% _.each(ModuleList, function(item) { %><a href="#" hrefUrl="<%= item.moduleUrl %>" class="toOther" name="<%= item.pack %>"><div class="panel-item-content"><img src="<%=item.iconUrl%>"><div class="panel-btn-text"><%= item.name %></div></div></a><% }); %></div></div></div>',n=_.template(t,{ModuleList:e});this.createPanel(n)},createPanel:function(t){var n=this,r=t;if(e("body").find(".cube-panel").length<1){e("body").append(r);var i=e(r).attr("id");e("#"+i).addClass("cube-panel");var s="<div class='cube-panel-masker'></div>";e("body").append(s),e(".cube-panel-masker").click(function(){n.hide()}),e("#"+i+" a").click(function(){n.PanelItemClick(e(this))});var o=new iScroll("panel-scroller")}},PanelItemClick:function(e){window.location.href=e.attr("hrefUrl"),console.info(e),this.hide()},show:function(){if(e(".cube-panel-masker").css("display")=="block"){this.hide();return}e(".cube-panel").removeClass("cube-panel-position-hide"),e(".cube-panel").addClass("cube-panel-position-show"),e(".cube-panel-masker").css("display","block"),e(".cube-panel-masker").removeClass("cube-panel-position-hide"),e(".cube-panel-masker").addClass("cube-panel-position-show")},hide:function(){e(".cube-panel").removeClass("cube-panel-position-show"),e(".cube-panel").addClass("cube-panel-position-hide"),e(".cube-panel-masker").css("display","none"),e(".cube-panel-masker").removeClass("cube-panel-position-show"),e(".cube-panel-masker").addClass("cube-panel-position-hide")}},{render:function(e){r.instance.render(e)},show:function(){r.instance.show()},hide:function(){r.instance.hide()}});return r.instance=new r,r}),define("components/popover",["zepto","backbone","gmu","components/fixed"],function(e,t,n,r){var i=t.View.extend({events:{"click li":"onClick"},initialize:function(t){console.log("popover init");if(arguments&&arguments.length>0){var n=arguments[0],r;for(r in n)r in this&&(this[r]=n[r]);var i={};for(var s in this.config)i[s]=this.config[s];for(var o in n)i[o]=n[o];this.config=i}this.isMaskShow=!1;var u=e(this.config.el).attr("arrowSite"),a=e(this.config.el).attr("maskStyle");this.mask=e('<div class="popver-masker" style="'+a+';display: none;width: 100%;min-height:100%; z-index:100; position: absolute;">'+"<style>"+".popover:before, .popover:after{"+"left:"+u+";"+"}"+"</style>"+"</div>"),this.render()},poperties:{},render:function(){var t=this,n=e(t.el).attr("trigger"),r=e(t.config.parent).find(n)[0],i=e(t.el).attr("target");if(i==""||null)i=n;var s=e(t.el).attr("closeTrigger");if(s==""||null)s="self";this.poperties.closeTrigger=s,this.poperties.closeTrigger!="self"&&e(t.el).find(this.poperties.closeTrigger).click(function(){t.onHide()});var o=e(t.el).attr("horizontalMove");if(o==""||null)o=0;this.poperties.horizontalMove=parseInt(o);var u=e(t.el).attr("verticalMove");if(u==""||null)u=0;return this.poperties.verticalMove=parseInt(u),e(r).bind("click",function(){function n(){var n=e(t.el).attr("position");if(n==""||null)n="absolute";e(t.el).css({position:n});var r=e(t.config.parent).find(i).width(),s=e(t.config.parent).find(i).height(),o=e(t.config.parent).find(i).offset(),u=e(t.el).width(),a=o.top;e(t.el).attr("position")=="fixed"&&(a=10),e(t.el).offset({left:o.left+r/2+t.poperties.horizontalMove,top:a+s-35+t.poperties.verticalMove})}e(t.el).offset({left:0,top:0}),e(t.el).css({left:0,top:0}),t.reposi==null&&(t.reposi=n),n(),t.onShow()}),console.info("======"),this},reposi:null,onShow:function(){var t=this,n=this.el,i=e(n).css("display");this.isMaskShow||(e("body").prepend(this.mask),this.isMaskShow=!0),e(n).removeClass("visible"),i=="none"?(n.style.display="block",this.mask.css("display","block"),e(window).on("orientationchange",t.reposi),e(window).on("resize",t.reposi)):(n.style.display="none",this.mask.css("display","none"),e(window).off("orientationchange",t.reposi),e(window).off("resize",t.reposi)),n.offsetHeight,n.classList.add("visible");var s=new iScroll("popver-scroller",{useTransition:!0});this.iScroll=s,this.iScroll.refresh(),this.mask.bind("click",function(){t.onMaskClick()}),r.FixPopoverOn(),r.FixHeaderWithPopoverOffsetTop()},onClick:function(e){console.log("popover:select"),this.poperties.closeTrigger=="self"&&this.onHide()},onHide:function(){e(this.el).css("display","none"),this.mask.css("display","none")},onMaskClick:function(){console.info("mask click"),e(this.el).css("display","none"),this.mask.css("display","none"),r.FixPopoverOff()}},{compile:function(t){console.log("popover compile");var n=this;return _.map(e(t).find(".popover"),function(e){return new i({el:e,parent:t})})}});return i}),define("components/segment",["zepto","backbone"],function(e,t){var n=t.View.extend({events:{"click li":"onClick"},initialize:function(){console.log("cube---segment---segment init");var t=e(this.el).attr("name");if(t&&!document.getElementById("seginput-"+this.el.id)){var n=e("<input/>");n.attr("id","seginput-"+this.el.id),n.attr("name",t);var r=e("#"+this.el.id+" li").attr("data-value");n.val(r),n.appendTo(this.el),n.hide()}console.log("cube---segment---segment:"+this.el)},render:function(){return this},onClick:function(t){console.log("cube---segment---segment click");var n=this.el.querySelector(".active");n&&e(n).removeClass("active"),e(t.currentTarget).addClass("active"),this.$("#seginput-"+this.el.id).val(e(t.currentTarget).attr("data-value")),this.trigger("Segment:change",this),t.preventDefault(),console.log("cube---segment---segment click end")},getActiveItem:function(){return this.el.querySelector(".active")},getValue:function(){var e=this.getActiveItem();return e?e.getAttribute("data-value"):null},triggerChange:function(){this.trigger("Segment:change",this)}},{compile:function(t){console.log("cube---segment---segment compile");var r=this;return _.map(e(t).find(".segmented-controller"),function(e){return new n({el:e})})}});return n}),define("components/session",["zepto"],function(e){var t=function(){};return t.saveObject=function(e,t){window.sessionStorage[e]=JSON.stringify(t)},t.loadObject=function(e){var t=window.sessionStorage[e];return t==null?null:JSON.parse(t)},t.deleteObject=function(e){window.sessionStorage[e]=null},t}),define("components/store",["zepto"],function(e){var t=function(){};return t.saveObject=function(e,t){window.localStorage[e]=JSON.stringify(t)},t.loadObject=function(e){var t=window.localStorage[e];return t==null?null:JSON.parse(t)},t.deleteObject=function(e){window.localStorage[e]=null},t.clear=function(){window.localStorage.clear()},t}),define("components/validator",["zepto","components/dialog","backbone"],function(e,t,n){var r=n.Model.extend({},{phoneNum:function(e){var n=/^0{0,1}(13[0-9]|15[0-9]|18[0-9])[0-9]{8}$/,r=!1,i=!0;return e===""&&(r="请填写手机号码",i=!1),!e||e.length!=11?(r="手机号码为11位数字！请正确填写！",i=!1):n.test(e)||(r="您的手机号码不正确，请重新输入",i=!1),i||new t({content:r}),i},identityCard:function(e){var t=new Array("验证通过!","身份证号码位数不对!","身份证号码出生日期超出范围或含有非法字符!","身份证号码校验错误!","身份证地区非法!"),n={11:"北京",12:"天津",13:"河北",14:"山西",15:"内蒙古",21:"辽宁",22:"吉林",23:"黑龙江",31:"上海",32:"江苏",33:"浙江",34:"安徽",35:"福建",36:"江西",37:"山东",41:"河南",42:"湖北",43:"湖南",44:"广东",45:"广西",46:"海南",50:"重庆",51:"四川",52:"贵州",53:"云南",54:"西藏",61:"陕西",62:"甘肃",63:"青海",64:"宁夏",65:"xinjiang",71:"台湾",81:"香港",82:"澳门",91:"国外"},e,r,i,s,o,u=new Array;u=e.split("");if(n[parseInt(e.substr(0,2))]==null)return t[4];switch(e.length){case 15:return(parseInt(e.substr(6,2))+1900)%4==0||(parseInt(e.substr(6,2))+1900)%100==0&&(parseInt(e.substr(6,2))+1900)%4==0?ereg=/^[1-9][0-9]{5}[0-9]{2}((01|03|05|07|08|10|12)(0[1-9]|[1-2][0-9]|3[0-1])|(04|06|09|11)(0[1-9]|[1-2][0-9]|30)|02(0[1-9]|[1-2][0-9]))[0-9]{3}$/:ereg=/^[1-9][0-9]{5}[0-9]{2}((01|03|05|07|08|10|12)(0[1-9]|[1-2][0-9]|3[0-1])|(04|06|09|11)(0[1-9]|[1-2][0-9]|30)|02(0[1-9]|1[0-9]|2[0-8]))[0-9]{3}$/,ereg.test(e)?t[0]:t[2];case 18:return parseInt(e.substr(6,4))%4==0||parseInt(e.substr(6,4))%100==0&&parseInt(e.substr(6,4))%4==0?ereg=/^[1-9][0-9]{5}19[0-9]{2}((01|03|05|07|08|10|12)(0[1-9]|[1-2][0-9]|3[0-1])|(04|06|09|11)(0[1-9]|[1-2][0-9]|30)|02(0[1-9]|[1-2][0-9]))[0-9]{3}[0-9Xx]$/:ereg=/^[1-9][0-9]{5}19[0-9]{2}((01|03|05|07|08|10|12)(0[1-9]|[1-2][0-9]|3[0-1])|(04|06|09|11)(0[1-9]|[1-2][0-9]|30)|02(0[1-9]|1[0-9]|2[0-8]))[0-9]{3}[0-9Xx]$/,ereg.test(e)?(s=(parseInt(u[0])+parseInt(u[10]))*7+(parseInt(u[1])+parseInt(u[11]))*9+(parseInt(u[2])+parseInt(u[12]))*10+(parseInt(u[3])+parseInt(u[13]))*5+(parseInt(u[4])+parseInt(u[14]))*8+(parseInt(u[5])+parseInt(u[15]))*4+(parseInt(u[6])+parseInt(u[16]))*2+parseInt(u[7])*1+parseInt(u[8])*6+parseInt(u[9])*3,r=s%11,o="F",i="10X98765432",o=i.substr(r,1),o==u[17]?t[0]:t[3]):t[2];default:return t[1]}},email:function(e){var n=/^(([^<>()[\]\\.,;:\s@\"]+(\.[^<>()[\]\\.,;:\s@\"]+)*)|(\".+\"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;return n.test(e)?!0:(new t({content:"邮箱格式不正确"}),!1)}});return r}),define("components/datepicker",["backbone","underscore","zepto"],function(e,t,n){var r=e.View.extend({initialize:function(){var e=new Date,t=n(this.el).val(),r=n(this.el).attr("data-firstDay"),i=n(this.el).attr("data-minDate"),s=n(this.el).attr("data-maxDate"),o=n(this.el).attr("data-swipeable"),u=n(this.el).attr("data-monthChangeable"),a=n(this.el).attr("data-yearChangeable"),f=n(this.el).attr("data-selectYearBefore"),l=n(this.el).attr("data-selectYearAfter"),c=this,h=n("<div></div>");h=h.calendar({date:t===null?e:t,swipeable:o===null||o==="true"?!0:!1,firstDay:r===null?1:r,minDate:i===null?null:n.calendar.parseDate(i),maxDate:s===null?null:n.calendar.parseDate(s),monthChangeable:u===null||u==="false"?!1:!0,yearChangeable:a===null||a==="false"?!1:!0,selectYearBefore:f,selectYearAfter:l,select:function(e,t,r,i){n(c.el).val(n.calendar.formatDate(t)),h.hide()}}),n(this.el).on("click",function(){h.show()}),h.hide(),n(this.el).parent().append(h)}},{compile:function(e){var i=this;return t.map(n(e).find(".cube-datepicker"),function(e){var t=new r({el:e});return t})}});return r}),define("components/view",["zepto","underscore","backbone","components/list","components/segment","components/carousel","components/extendable-list","components/session","components/base64Img","components/datepicker","components/fixed"],function(e,t,n,r,i,s,o,u,a,f,l){var c=/^(\S+)\s*(.*)$/,h=n.View.extend({className:"page",components:{},compile:function(){var n=this,u=f.compile(this.el),l=r.compile(this.el),c=i.compile(this.el),h=s.compile(this.el),p=o.compile(this.el),d=a.compile(this.el),v=t.union(l,c,h,p);t.each(v,function(e){var t=e.id||e.el.getAttribute("id");n.components[t]=e}),e("a[cube-action]").each(function(t,n){console.log(n);var r=n.getAttribute("href"),i=n.getAttribute("cube-action");r||(r=""),r&&r.indexOf("?")>=0?r=r+"&cube-action="+i:r=r+"?cube-action="+i,e(n).removeAttr("cube-action"),n.setAttribute("href",r)}),this.$el.find(".back").click(function(){return window.history.back(),!1}),this.checkDependences()},bindEvents:function(){if(!this.bindings)return;for(var e in this.bindings){var n=this.bindings[e];t.isFunction(n)||(n=this[n]);if(!n)throw new Error('Method "'+this.bindings[e]+'" does not exist');var r=e.match(c),i=r[1],s=r[2];n=t.bind(n,this);var o=this.component(s);o&&o.on(i,n,this)}},unbindEvents:function(){for(var e in this.bindings){var t=e.match(c),n=t[1],r=t[2],i=this.component(r);i&&i.off(n)}},component:function(e){return this.components[e]},initialize:function(){n.View.prototype.initialize.call(this)},remove:function(){e(window).off("orientationchange",this.onOrientationchange),this.unbindEvents(),n.View.prototype.remove.call(this)},render:function(){var t=this;return e(document).bind("show",function(){t.onShow()}),this.compile(),this.unbindEvents(),this.bindEvents(),this},onShow:function(){e(window).on("orientationchange",this.onOrientationchange),e(window).on("resize",this.onWindowResize),e(window).on("scroll",this.onWindowScroll),e("body").css({width:"100%"}),window.scroll(0,0)},onWindowScroll:function(){},onOrientationchange:function(){e("input").blur()},onWindowResize:function(){l.FxHeader()},navigate:function(e,t){e=this._modularFragment(e),console.log("navigate to: "+e),n.history.navigate(e,t)},_modularFragment:function(e){return this.module&&e[0]!=="/"?e=this.module+"/"+e:this.module&&(e=e.substring(1)),e},checkDependences:function(){if(this.dependences&&e.isArray(this.dependences)){var t=this.dependences;for(var n=0;n<t.length;n++){var r=u.loadObject(t[n]);r||(this.missingDependence(t[n]),window.location.href="../"+t[0])}}}});return h}),define("components/components",["require","components/base64Img","components/cache","components/carousel","components/dialog","components/form","components/loader","components/oldloader","components/date","components/extendable-list","components/i18n","components/list","components/module-panel","components/popover","components/segment","components/session","components/store","components/util","components/validator","components/view","components/datepicker"],function(e){var t=e("components/base64Img"),n=e("components/cache"),r=e("components/carousel"),i=e("components/dialog"),s=e("components/form"),o=e("components/loader"),u=e("components/oldloader"),a=e("components/date"),f=e("components/extendable-list"),l=e("components/i18n"),c=e("components/list"),h=e("components/module-panel"),p=e("components/popover"),d=e("components/segment"),v=e("components/session"),m=e("components/store"),g=e("components/util"),y=e("components/validator"),b=e("components/view"),w=e("components/datepicker");return{Base64Img:t,Cache:n,Carousel:r,Dialog:i,Form:s,Loader:o,Oldloader:u,Date:a,ExtendableList:f,I18n:l,List:c,ModulePanel:h,Popover:p,Segment:d,Session:v,Store:m,Util:g,Validator:y,View:b,Datepicker:w}});var Piece,defaultConfig={loadFrom:"module",defaultModule:null,defaultView:null,loadMode:"view",enablePad:!1,hideAddressBar:!0,enablePhoneGap:!1,preventTouchMove:!1},pieceConfig;typeof pieceConfig=="undefined"&&(pieceConfig=new Object),pieceConfig.enablePhoneGap===undefined&&(pieceConfig.enablePhoneGap=!1),pieceConfig.loadFrom==="root"?require.config({baseUrl:"."}):require.config({baseUrl:"../"}),require.config({paths:{text:"src/vendor/requirejs-text/js/text",domReady:"src/vendor/requirejs-domready/js/domready",i18n:"src/vendor/requirejs-i18n/js/i18n",zepto:"src/vendor/zepto/js/zepto",underscore:"src/vendor/underscore/js/underscore",backbone:"src/vendor/backbone/js/backbone",fastclick:"src/vendor/fastclick/js/fastclick",canvasloader:"src/components/canvasloader",gmu:"src/components/gmu",vendor:"src/vendor",core:"src/core",components:"src/components"},shim:{backbone:{deps:["underscore"],exports:"Backbone"},zepto:{exports:"$"},underscore:{exports:"_"},gmu:{deps:["zepto"]},fastclick:{exports:"FastClick"}}}),window.localStorage.lang===undefined&&(window.localStorage.lang="zh-cn"),requirejs.config({config:{i18n:{locale:window.localStorage.lang}}}),function(){if(pieceConfig.enablePhoneGap){var e=document.createElement("script");e.setAttribute("type","text/javascript"),e.setAttribute("src","../cordova.js"),document.head.appendChild(e)}require(["zepto","underscore","backbone","fastclick","text","i18n","core/app","components/components"],function(e,t,n,r,i,s,o,u){function a(t){window.isDesktop=t,o.initialize(),e("html").css("min-height",window.screen.availHeight-44+"px")}Piece=u,pieceConfig=t.extend(defaultConfig,pieceConfig),r.attach(document.body),pieceConfig.hideAddressBar&&setTimeout(function(){window.scrollTo(0,1)},0),pieceConfig.preventTouchMove&&document.addEventListener("touchmove",function(e){e.preventDefault()},!1),pieceConfig.enablePhoneGap&&navigator.userAgent.match(/(iPad|iPhone|Android)/)?document.addEventListener("deviceready",a,!1):a(!0)})}(),define("src/core/piece.js",function(){});