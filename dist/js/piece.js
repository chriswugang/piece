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

function FastClick(e){var t,n=this;this.trackingClick=!1,this.trackingClickStart=0,this.targetElement=null,this.touchStartX=0,this.touchStartY=0,this.lastTouchIdentifier=0,this.touchBoundary=10,this.layer=e;if(!e||!e.nodeType)throw new TypeError("Layer must be a document node");this.onClick=function(){return FastClick.prototype.onClick.apply(n,arguments)},this.onMouse=function(){return FastClick.prototype.onMouse.apply(n,arguments)},this.onTouchStart=function(){return FastClick.prototype.onTouchStart.apply(n,arguments)},this.onTouchEnd=function(){return FastClick.prototype.onTouchEnd.apply(n,arguments)},this.onTouchCancel=function(){return FastClick.prototype.onTouchCancel.apply(n,arguments)};if(FastClick.notNeeded(e))return;this.deviceIsAndroid&&(e.addEventListener("mouseover",this.onMouse,!0),e.addEventListener("mousedown",this.onMouse,!0),e.addEventListener("mouseup",this.onMouse,!0)),e.addEventListener("click",this.onClick,!0),e.addEventListener("touchstart",this.onTouchStart,!1),e.addEventListener("touchend",this.onTouchEnd,!1),e.addEventListener("touchcancel",this.onTouchCancel,!1),Event.prototype.stopImmediatePropagation||(e.removeEventListener=function(t,n,r){var i=Node.prototype.removeEventListener;t==="click"?i.call(e,t,n.hijacked||n,r):i.call(e,t,n,r)},e.addEventListener=function(t,n,r){var i=Node.prototype.addEventListener;t==="click"?i.call(e,t,n.hijacked||(n.hijacked=function(e){e.propagationStopped||n(e)}),r):i.call(e,t,n,r)}),typeof e.onclick=="function"&&(t=e.onclick,e.addEventListener("click",function(e){t(e)},!1),e.onclick=null)}(function(e){String.prototype.trim===e&&(String.prototype.trim=function(){return this.replace(/^\s+|\s+$/g,"")}),Array.prototype.reduce===e&&(Array.prototype.reduce=function(t){if(this===void 0||this===null)throw new TypeError;var n=Object(this),r=n.length>>>0,i=0,s;if(typeof t!="function")throw new TypeError;if(r==0&&arguments.length==1)throw new TypeError;if(arguments.length>=2)s=arguments[1];else do{if(i in n){s=n[i++];break}if(++i>=r)throw new TypeError}while(!0);while(i<r)i in n&&(s=t.call(e,s,n[i],i,n)),i++;return s})})();var Zepto=function(){function O(e){return e==null?String(e):T[N.call(e)]||"object"}function M(e){return O(e)=="function"}function _(e){return e!=null&&e==e.window}function D(e){return e!=null&&e.nodeType==e.DOCUMENT_NODE}function P(e){return O(e)=="object"}function H(e){return P(e)&&!_(e)&&e.__proto__==Object.prototype}function B(e){return e instanceof Array}function j(e){return typeof e.length=="number"}function F(e){return o.call(e,function(e){return e!=null})}function I(e){return e.length>0?n.fn.concat.apply([],e):e}function q(e){return e.replace(/::/g,"/").replace(/([A-Z]+)([A-Z][a-z])/g,"$1_$2").replace(/([a-z\d])([A-Z])/g,"$1_$2").replace(/_/g,"-").toLowerCase()}function R(e){return e in f?f[e]:f[e]=new RegExp("(^|\\s)"+e+"(\\s|$)")}function U(e,t){return typeof t=="number"&&!c[q(e)]?t+"px":t}function z(e){var t,n;return a[e]||(t=u.createElement(e),u.body.appendChild(t),n=l(t,"").getPropertyValue("display"),t.parentNode.removeChild(t),n=="none"&&(n="block"),a[e]=n),a[e]}function W(e){return"children"in e?s.call(e.children):n.map(e.childNodes,function(e){if(e.nodeType==1)return e})}function X(n,r,i){for(t in r)i&&(H(r[t])||B(r[t]))?(H(r[t])&&!H(n[t])&&(n[t]={}),B(r[t])&&!B(n[t])&&(n[t]=[]),X(n[t],r[t],i)):r[t]!==e&&(n[t]=r[t])}function V(t,r){return r===e?n(t):n(t).filter(r)}function $(e,t,n,r){return M(t)?t.call(e,n,r):t}function J(e,t,n){n==null?e.removeAttribute(t):e.setAttribute(t,n)}function K(t,n){var r=t.className,i=r&&r.baseVal!==e;if(n===e)return i?r.baseVal:r;i?r.baseVal=n:t.className=n}function Q(e){var t;try{return e?e=="true"||(e=="false"?!1:e=="null"?null:isNaN(t=Number(e))?/^[\[\{]/.test(e)?n.parseJSON(e):e:t):e}catch(r){return e}}function G(e,t){t(e);for(var n in e.childNodes)G(e.childNodes[n],t)}var e,t,n,r,i=[],s=i.slice,o=i.filter,u=window.document,a={},f={},l=u.defaultView.getComputedStyle,c={"column-count":1,columns:1,"font-weight":1,"line-height":1,opacity:1,"z-index":1,zoom:1},h=/^\s*<(\w+|!)[^>]*>/,p=/<(?!area|br|col|embed|hr|img|input|link|meta|param)(([\w:]+)[^>]*)\/>/ig,d=/^(?:body|html)$/i,v=["val","css","html","text","data","width","height","offset"],m=["after","prepend","before","append"],g=u.createElement("table"),y=u.createElement("tr"),b={tr:u.createElement("tbody"),tbody:g,thead:g,tfoot:g,td:y,th:y,"*":u.createElement("div")},w=/complete|loaded|interactive/,E=/^\.([\w-]+)$/,S=/^#([\w-]*)$/,x=/^[\w-]+$/,T={},N=T.toString,C={},k,L,A=u.createElement("div");return C.matches=function(e,t){if(!e||e.nodeType!==1)return!1;var n=e.webkitMatchesSelector||e.mozMatchesSelector||e.oMatchesSelector||e.matchesSelector;if(n)return n.call(e,t);var r,i=e.parentNode,s=!i;return s&&(i=A).appendChild(e),r=~C.qsa(i,t).indexOf(e),s&&A.removeChild(e),r},k=function(e){return e.replace(/-+(.)?/g,function(e,t){return t?t.toUpperCase():""})},L=function(e){return o.call(e,function(t,n){return e.indexOf(t)==n})},C.fragment=function(t,r,i){t.replace&&(t=t.replace(p,"<$1></$2>")),r===e&&(r=h.test(t)&&RegExp.$1),r in b||(r="*");var o,u,a=b[r];return a.innerHTML=""+t,u=n.each(s.call(a.childNodes),function(){a.removeChild(this)}),H(i)&&(o=n(u),n.each(i,function(e,t){v.indexOf(e)>-1?o[e](t):o.attr(e,t)})),u},C.Z=function(e,t){return e=e||[],e.__proto__=n.fn,e.selector=t||"",e},C.isZ=function(e){return e instanceof C.Z},C.init=function(t,r){if(!t)return C.Z();if(M(t))return n(u).ready(t);if(C.isZ(t))return t;var i;if(B(t))i=F(t);else if(P(t))i=[H(t)?n.extend({},t):t],t=null;else if(h.test(t))i=C.fragment(t.trim(),RegExp.$1,r),t=null;else{if(r!==e)return n(r).find(t);i=C.qsa(u,t)}return C.Z(i,t)},n=function(e,t){return C.init(e,t)},n.extend=function(e){var t,n=s.call(arguments,1);return typeof e=="boolean"&&(t=e,e=n.shift()),n.forEach(function(n){X(e,n,t)}),e},C.qsa=function(e,t){var n;return D(e)&&S.test(t)?(n=e.getElementById(RegExp.$1))?[n]:[]:e.nodeType!==1&&e.nodeType!==9?[]:s.call(E.test(t)?e.getElementsByClassName(RegExp.$1):x.test(t)?e.getElementsByTagName(t):e.querySelectorAll(t))},n.contains=function(e,t){return e!==t&&e.contains(t)},n.type=O,n.isFunction=M,n.isWindow=_,n.isArray=B,n.isPlainObject=H,n.isEmptyObject=function(e){var t;for(t in e)return!1;return!0},n.inArray=function(e,t,n){return i.indexOf.call(t,e,n)},n.camelCase=k,n.trim=function(e){return e.trim()},n.uuid=0,n.support={},n.expr={},n.map=function(e,t){var n,r=[],i,s;if(j(e))for(i=0;i<e.length;i++)n=t(e[i],i),n!=null&&r.push(n);else for(s in e)n=t(e[s],s),n!=null&&r.push(n);return I(r)},n.each=function(e,t){var n,r;if(j(e)){for(n=0;n<e.length;n++)if(t.call(e[n],n,e[n])===!1)return e}else for(r in e)if(t.call(e[r],r,e[r])===!1)return e;return e},n.grep=function(e,t){return o.call(e,t)},window.JSON&&(n.parseJSON=JSON.parse),n.each("Boolean Number String Function Array Date RegExp Object Error".split(" "),function(e,t){T["[object "+t+"]"]=t.toLowerCase()}),n.fn={forEach:i.forEach,reduce:i.reduce,push:i.push,sort:i.sort,indexOf:i.indexOf,concat:i.concat,map:function(e){return n(n.map(this,function(t,n){return e.call(t,n,t)}))},slice:function(){return n(s.apply(this,arguments))},ready:function(e){return w.test(u.readyState)?e(n):u.addEventListener("DOMContentLoaded",function(){e(n)},!1),this},get:function(t){return t===e?s.call(this):this[t>=0?t:t+this.length]},toArray:function(){return this.get()},size:function(){return this.length},remove:function(){return this.each(function(){this.parentNode!=null&&this.parentNode.removeChild(this)})},each:function(e){return i.every.call(this,function(t,n){return e.call(t,n,t)!==!1}),this},filter:function(e){return M(e)?this.not(this.not(e)):n(o.call(this,function(t){return C.matches(t,e)}))},add:function(e,t){return n(L(this.concat(n(e,t))))},is:function(e){return this.length>0&&C.matches(this[0],e)},not:function(t){var r=[];if(M(t)&&t.call!==e)this.each(function(e){t.call(this,e)||r.push(this)});else{var i=typeof t=="string"?this.filter(t):j(t)&&M(t.item)?s.call(t):n(t);this.forEach(function(e){i.indexOf(e)<0&&r.push(e)})}return n(r)},has:function(e){return this.filter(function(){return P(e)?n.contains(this,e):n(this).find(e).size()})},eq:function(e){return e===-1?this.slice(e):this.slice(e,+e+1)},first:function(){var e=this[0];return e&&!P(e)?e:n(e)},last:function(){var e=this[this.length-1];return e&&!P(e)?e:n(e)},find:function(e){var t,r=this;return typeof e=="object"?t=n(e).filter(function(){var e=this;return i.some.call(r,function(t){return n.contains(t,e)})}):this.length==1?t=n(C.qsa(this[0],e)):t=this.map(function(){return C.qsa(this,e)}),t},closest:function(e,t){var r=this[0],i=!1;typeof e=="object"&&(i=n(e));while(r&&!(i?i.indexOf(r)>=0:C.matches(r,e)))r=r!==t&&!D(r)&&r.parentNode;return n(r)},parents:function(e){var t=[],r=this;while(r.length>0)r=n.map(r,function(e){if((e=e.parentNode)&&!D(e)&&t.indexOf(e)<0)return t.push(e),e});return V(t,e)},parent:function(e){return V(L(this.pluck("parentNode")),e)},children:function(e){return V(this.map(function(){return W(this)}),e)},contents:function(){return this.map(function(){return s.call(this.childNodes)})},siblings:function(e){return V(this.map(function(e,t){return o.call(W(t.parentNode),function(e){return e!==t})}),e)},empty:function(){return this.each(function(){this.innerHTML=""})},pluck:function(e){return n.map(this,function(t){return t[e]})},show:function(){return this.each(function(){this.style.display=="none"&&(this.style.display=null),l(this,"").getPropertyValue("display")=="none"&&(this.style.display=z(this.nodeName))})},replaceWith:function(e){return this.before(e).remove()},wrap:function(e){var t=M(e);if(this[0]&&!t)var r=n(e).get(0),i=r.parentNode||this.length>1;return this.each(function(s){n(this).wrapAll(t?e.call(this,s):i?r.cloneNode(!0):r)})},wrapAll:function(e){if(this[0]){n(this[0]).before(e=n(e));var t;while((t=e.children()).length)e=t.first();n(e).append(this)}return this},wrapInner:function(e){var t=M(e);return this.each(function(r){var i=n(this),s=i.contents(),o=t?e.call(this,r):e;s.length?s.wrapAll(o):i.append(o)})},unwrap:function(){return this.parent().each(function(){n(this).replaceWith(n(this).children())}),this},clone:function(){return this.map(function(){return this.cloneNode(!0)})},hide:function(){return this.css("display","none")},toggle:function(t){return this.each(function(){var r=n(this);(t===e?r.css("display")=="none":t)?r.show():r.hide()})},prev:function(e){return n(this.pluck("previousElementSibling")).filter(e||"*")},next:function(e){return n(this.pluck("nextElementSibling")).filter(e||"*")},html:function(t){return t===e?this.length>0?this[0].innerHTML:null:this.each(function(e){var r=this.innerHTML;n(this).empty().append($(this,t,e,r))})},text:function(t){return t===e?this.length>0?this[0].textContent:null:this.each(function(){this.textContent=t})},attr:function(n,r){var i;return typeof n=="string"&&r===e?this.length==0||this[0].nodeType!==1?e:n=="value"&&this[0].nodeName=="INPUT"?this.val():!(i=this[0].getAttribute(n))&&n in this[0]?this[0][n]:i:this.each(function(e){if(this.nodeType!==1)return;if(P(n))for(t in n)J(this,t,n[t]);else J(this,n,$(this,r,e,this.getAttribute(n)))})},removeAttr:function(e){return this.each(function(){this.nodeType===1&&J(this,e)})},prop:function(t,n){return n===e?this[0]&&this[0][t]:this.each(function(e){this[t]=$(this,n,e,this[t])})},data:function(t,n){var r=this.attr("data-"+q(t),n);return r!==null?Q(r):e},val:function(t){return t===e?this[0]&&(this[0].multiple?n(this[0]).find("option").filter(function(e){return this.selected}).pluck("value"):this[0].value):this.each(function(e){this.value=$(this,t,e,this.value)})},offset:function(e){if(e)return this.each(function(t){var r=n(this),i=$(this,e,t,r.offset()),s=r.offsetParent().offset(),o={top:i.top-s.top,left:i.left-s.left};r.css("position")=="static"&&(o.position="relative"),r.css(o)});if(this.length==0)return null;var t=this[0].getBoundingClientRect();return{left:t.left+window.pageXOffset,top:t.top+window.pageYOffset,width:Math.round(t.width),height:Math.round(t.height)}},css:function(e,n){if(arguments.length<2&&typeof e=="string")return this[0]&&(this[0].style[k(e)]||l(this[0],"").getPropertyValue(e));var r="";if(O(e)=="string")!n&&n!==0?this.each(function(){this.style.removeProperty(q(e))}):r=q(e)+":"+U(e,n);else for(t in e)!e[t]&&e[t]!==0?this.each(function(){this.style.removeProperty(q(t))}):r+=q(t)+":"+U(t,e[t])+";";return this.each(function(){this.style.cssText+=";"+r})},index:function(e){return e?this.indexOf(n(e)[0]):this.parent().children().indexOf(this[0])},hasClass:function(e){return i.some.call(this,function(e){return this.test(K(e))},R(e))},addClass:function(e){return this.each(function(t){r=[];var i=K(this),s=$(this,e,t,i);s.split(/\s+/g).forEach(function(e){n(this).hasClass(e)||r.push(e)},this),r.length&&K(this,i+(i?" ":"")+r.join(" "))})},removeClass:function(t){return this.each(function(n){if(t===e)return K(this,"");r=K(this),$(this,t,n,r).split(/\s+/g).forEach(function(e){r=r.replace(R(e)," ")}),K(this,r.trim())})},toggleClass:function(t,r){return this.each(function(i){var s=n(this),o=$(this,t,i,K(this));o.split(/\s+/g).forEach(function(t){(r===e?!s.hasClass(t):r)?s.addClass(t):s.removeClass(t)})})},scrollTop:function(){if(!this.length)return;return"scrollTop"in this[0]?this[0].scrollTop:this[0].scrollY},position:function(){if(!this.length)return;var e=this[0],t=this.offsetParent(),r=this.offset(),i=d.test(t[0].nodeName)?{top:0,left:0}:t.offset();return r.top-=parseFloat(n(e).css("margin-top"))||0,r.left-=parseFloat(n(e).css("margin-left"))||0,i.top+=parseFloat(n(t[0]).css("border-top-width"))||0,i.left+=parseFloat(n(t[0]).css("border-left-width"))||0,{top:r.top-i.top,left:r.left-i.left}},offsetParent:function(){return this.map(function(){var e=this.offsetParent||u.body;while(e&&!d.test(e.nodeName)&&n(e).css("position")=="static")e=e.offsetParent;return e})}},n.fn.detach=n.fn.remove,["width","height"].forEach(function(t){n.fn[t]=function(r){var i,s=this[0],o=t.replace(/./,function(e){return e[0].toUpperCase()});return r===e?_(s)?s["inner"+o]:D(s)?s.documentElement["offset"+o]:(i=this.offset())&&i[t]:this.each(function(e){s=n(this),s.css(t,$(this,r,e,s[t]()))})}}),m.forEach(function(e,t){var r=t%2;n.fn[e]=function(){var e,i=n.map(arguments,function(t){return e=O(t),e=="object"||e=="array"||t==null?t:C.fragment(t)}),s,o=this.length>1;return i.length<1?this:this.each(function(e,u){s=r?u:u.parentNode,u=t==0?u.nextSibling:t==1?u.firstChild:t==2?u:null,i.forEach(function(e){if(o)e=e.cloneNode(!0);else if(!s)return n(e).remove();G(s.insertBefore(e,u),function(e){e.nodeName!=null&&e.nodeName.toUpperCase()==="SCRIPT"&&(!e.type||e.type==="text/javascript")&&!e.src&&window.eval.call(window,e.innerHTML)})})})},n.fn[r?e+"To":"insert"+(t?"Before":"After")]=function(t){return n(t)[e](this),this}}),C.Z.prototype=n.fn,C.uniq=L,C.deserializeValue=Q,n.zepto=C,n}();window.Zepto=Zepto,"$"in window||(window.$=Zepto),function(e){function t(e){var t=this.os={},n=this.browser={},r=e.match(/WebKit\/([\d.]+)/),i=e.match(/(Android)\s+([\d.]+)/),s=e.match(/(iPad).*OS\s([\d_]+)/),o=!s&&e.match(/(iPhone\sOS)\s([\d_]+)/),u=e.match(/(webOS|hpwOS)[\s\/]([\d.]+)/),a=u&&e.match(/TouchPad/),f=e.match(/Kindle\/([\d.]+)/),l=e.match(/Silk\/([\d._]+)/),c=e.match(/(BlackBerry).*Version\/([\d.]+)/),h=e.match(/(BB10).*Version\/([\d.]+)/),p=e.match(/(RIM\sTablet\sOS)\s([\d.]+)/),d=e.match(/PlayBook/),v=e.match(/Chrome\/([\d.]+)/)||e.match(/CriOS\/([\d.]+)/),m=e.match(/Firefox\/([\d.]+)/);if(n.webkit=!!r)n.version=r[1];i&&(t.android=!0,t.version=i[2]),o&&(t.ios=t.iphone=!0,t.version=o[2].replace(/_/g,".")),s&&(t.ios=t.ipad=!0,t.version=s[2].replace(/_/g,".")),u&&(t.webos=!0,t.version=u[2]),a&&(t.touchpad=!0),c&&(t.blackberry=!0,t.version=c[2]),h&&(t.bb10=!0,t.version=h[2]),p&&(t.rimtabletos=!0,t.version=p[2]),d&&(n.playbook=!0),f&&(t.kindle=!0,t.version=f[1]),l&&(n.silk=!0,n.version=l[1]),!l&&t.android&&e.match(/Kindle Fire/)&&(n.silk=!0),v&&(n.chrome=!0,n.version=v[1]),m&&(n.firefox=!0,n.version=m[1]),t.tablet=!!(s||d||i&&!e.match(/Mobile/)||m&&e.match(/Tablet/)),t.phone=!t.tablet&&!!(i||o||u||c||h||v&&e.match(/Android/)||v&&e.match(/CriOS\/([\d.]+)/)||m&&e.match(/Mobile/))}t.call(e,navigator.userAgent),e.__detect=t}(Zepto),function(e){function o(e){return e._zid||(e._zid=r++)}function u(e,t,r,i){t=a(t);if(t.ns)var s=f(t.ns);return(n[o(e)]||[]).filter(function(e){return e&&(!t.e||e.e==t.e)&&(!t.ns||s.test(e.ns))&&(!r||o(e.fn)===o(r))&&(!i||e.sel==i)})}function a(e){var t=(""+e).split(".");return{e:t[0],ns:t.slice(1).sort().join(" ")}}function f(e){return new RegExp("(?:^| )"+e.replace(" "," .* ?")+"(?: |$)")}function l(t,n,r){e.type(t)!="string"?e.each(t,r):t.split(/\s/).forEach(function(e){r(e,n)})}function c(e,t){return e.del&&(e.e=="focus"||e.e=="blur")||!!t}function h(e){return s[e]||e}function p(t,r,i,u,f,p){var d=o(t),v=n[d]||(n[d]=[]);l(r,i,function(n,r){var i=a(n);i.fn=r,i.sel=u,i.e in s&&(r=function(t){var n=t.relatedTarget;if(!n||n!==this&&!e.contains(this,n))return i.fn.apply(this,arguments)}),i.del=f&&f(r,n);var o=i.del||r;i.proxy=function(e){var n=o.apply(t,[e].concat(e.data));return n===!1&&(e.preventDefault(),e.stopPropagation()),n},i.i=v.length,v.push(i),t.addEventListener(h(i.e),i.proxy,c(i,p))})}function d(e,t,r,i,s){var a=o(e);l(t||"",r,function(t,r){u(e,t,r,i).forEach(function(t){delete n[a][t.i],e.removeEventListener(h(t.e),t.proxy,c(t,s))})})}function b(t){var n,r={originalEvent:t};for(n in t)!g.test(n)&&t[n]!==undefined&&(r[n]=t[n]);return e.each(y,function(e,n){r[e]=function(){return this[n]=v,t[e].apply(t,arguments)},r[n]=m}),r}function w(e){if(!("defaultPrevented"in e)){e.defaultPrevented=!1;var t=e.preventDefault;e.preventDefault=function(){this.defaultPrevented=!0,t.call(this)}}}var t=e.zepto.qsa,n={},r=1,i={},s={mouseenter:"mouseover",mouseleave:"mouseout"};i.click=i.mousedown=i.mouseup=i.mousemove="MouseEvents",e.event={add:p,remove:d},e.proxy=function(t,n){if(e.isFunction(t)){var r=function(){return t.apply(n,arguments)};return r._zid=o(t),r}if(typeof n=="string")return e.proxy(t[n],t);throw new TypeError("expected function")},e.fn.bind=function(e,t){return this.each(function(){p(this,e,t)})},e.fn.unbind=function(e,t){return this.each(function(){d(this,e,t)})},e.fn.one=function(e,t){return this.each(function(n,r){p(this,e,t,null,function(e,t){return function(){var n=e.apply(r,arguments);return d(r,t,e),n}})})};var v=function(){return!0},m=function(){return!1},g=/^([A-Z]|layer[XY]$)/,y={preventDefault:"isDefaultPrevented",stopImmediatePropagation:"isImmediatePropagationStopped",stopPropagation:"isPropagationStopped"};e.fn.delegate=function(t,n,r){return this.each(function(i,s){p(s,n,r,t,function(n){return function(r){var i,o=e(r.target).closest(t,s).get(0);if(o)return i=e.extend(b(r),{currentTarget:o,liveFired:s}),n.apply(o,[i].concat([].slice.call(arguments,1)))}})})},e.fn.undelegate=function(e,t,n){return this.each(function(){d(this,t,n,e)})},e.fn.live=function(t,n){return e(document.body).delegate(this.selector,t,n),this},e.fn.die=function(t,n){return e(document.body).undelegate(this.selector,t,n),this},e.fn.on=function(t,n,r){return!n||e.isFunction(n)?this.bind(t,n||r):this.delegate(n,t,r)},e.fn.off=function(t,n,r){return!n||e.isFunction(n)?this.unbind(t,n||r):this.undelegate(n,t,r)},e.fn.trigger=function(t,n){if(typeof t=="string"||e.isPlainObject(t))t=e.Event(t);return w(t),t.data=n,this.each(function(){"dispatchEvent"in this&&this.dispatchEvent(t)})},e.fn.triggerHandler=function(t,n){var r,i;return this.each(function(s,o){r=b(typeof t=="string"?e.Event(t):t),r.data=n,r.target=o,e.each(u(o,t.type||t),function(e,t){i=t.proxy(r);if(r.isImmediatePropagationStopped())return!1})}),i},"focusin focusout load resize scroll unload click dblclick mousedown mouseup mousemove mouseover mouseout mouseenter mouseleave change select keydown keypress keyup error".split(" ").forEach(function(t){e.fn[t]=function(e){return e?this.bind(t,e):this.trigger(t)}}),["focus","blur"].forEach(function(t){e.fn[t]=function(e){return e?this.bind(t,e):this.each(function(){try{this[t]()}catch(e){}}),this}}),e.Event=function(e,t){typeof e!="string"&&(t=e,e=t.type);var n=document.createEvent(i[e]||"Events"),r=!0;if(t)for(var s in t)s=="bubbles"?r=!!t[s]:n[s]=t[s];return n.initEvent(e,r,!0,null,null,null,null,null,null,null,null,null,null,null,null),n.isDefaultPrevented=function(){return this.defaultPrevented},n}}(Zepto),function($){function triggerAndReturn(e,t,n){var r=$.Event(t);return $(e).trigger(r,n),!r.defaultPrevented}function triggerGlobal(e,t,n,r){if(e.global)return triggerAndReturn(t||document,n,r)}function ajaxStart(e){e.global&&$.active++===0&&triggerGlobal(e,null,"ajaxStart")}function ajaxStop(e){e.global&&!--$.active&&triggerGlobal(e,null,"ajaxStop")}function ajaxBeforeSend(e,t){var n=t.context;if(t.beforeSend.call(n,e,t)===!1||triggerGlobal(t,n,"ajaxBeforeSend",[e,t])===!1)return!1;triggerGlobal(t,n,"ajaxSend",[e,t])}function ajaxSuccess(e,t,n){var r=n.context,i="success";n.success.call(r,e,i,t),triggerGlobal(n,r,"ajaxSuccess",[t,n,e]),ajaxComplete(i,t,n)}function ajaxError(e,t,n,r){var i=r.context;r.error.call(i,n,t,e),triggerGlobal(r,i,"ajaxError",[n,r,e]),ajaxComplete(t,n,r)}function ajaxComplete(e,t,n){var r=n.context;n.complete.call(r,t,e),triggerGlobal(n,r,"ajaxComplete",[t,n]),ajaxStop(n)}function empty(){}function mimeToDataType(e){return e&&(e=e.split(";",2)[0]),e&&(e==htmlType?"html":e==jsonType?"json":scriptTypeRE.test(e)?"script":xmlTypeRE.test(e)&&"xml")||"text"}function appendQuery(e,t){return(e+"&"+t).replace(/[&?]{1,2}/,"?")}function serializeData(e){e.processData&&e.data&&$.type(e.data)!="string"&&(e.data=$.param(e.data,e.traditional)),e.data&&(!e.type||e.type.toUpperCase()=="GET")&&(e.url=appendQuery(e.url,e.data))}function parseArguments(e,t,n,r){var i=!$.isFunction(t);return{url:e,data:i?t:undefined,success:i?$.isFunction(n)?n:undefined:t,dataType:i?r||n:n}}function serialize(e,t,n,r){var i,s=$.isArray(t);$.each(t,function(t,o){i=$.type(o),r&&(t=n?r:r+"["+(s?"":t)+"]"),!r&&s?e.add(o.name,o.value):i=="array"||!n&&i=="object"?serialize(e,o,n,t):e.add(t,o)})}var jsonpID=0,document=window.document,key,name,rscript=/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,scriptTypeRE=/^(?:text|application)\/javascript/i,xmlTypeRE=/^(?:text|application)\/xml/i,jsonType="application/json",htmlType="text/html",blankRE=/^\s*$/;$.active=0,$.ajaxJSONP=function(e){if("type"in e){var t="jsonp"+ ++jsonpID,n=document.createElement("script"),r=function(){clearTimeout(o),$(n).remove(),delete window[t]},i=function(n){r();if(!n||n=="timeout")window[t]=empty;ajaxError(null,n||"abort",s,e)},s={abort:i},o;return ajaxBeforeSend(s,e)===!1?(i("abort"),!1):(window[t]=function(t){r(),ajaxSuccess(t,s,e)},n.onerror=function(){i("error")},n.src=e.url.replace(/=\?/,"="+t),$("head").append(n),e.timeout>0&&(o=setTimeout(function(){i("timeout")},e.timeout)),s)}return $.ajax(e)},$.ajaxSettings={type:"GET",beforeSend:empty,success:empty,error:empty,complete:empty,context:null,global:!0,xhr:function(){return new window.XMLHttpRequest},accepts:{script:"text/javascript, application/javascript",json:jsonType,xml:"application/xml, text/xml",html:htmlType,text:"text/plain"},crossDomain:!1,timeout:0,processData:!0,cache:!0},$.ajax=function(options){var settings=$.extend({},options||{});for(key in $.ajaxSettings)settings[key]===undefined&&(settings[key]=$.ajaxSettings[key]);ajaxStart(settings),settings.crossDomain||(settings.crossDomain=/^([\w-]+:)?\/\/([^\/]+)/.test(settings.url)&&RegExp.$2!=window.location.host),settings.url||(settings.url=window.location.toString()),serializeData(settings),settings.cache===!1&&(settings.url=appendQuery(settings.url,"_="+Date.now()));var dataType=settings.dataType,hasPlaceholder=/=\?/.test(settings.url);if(dataType=="jsonp"||hasPlaceholder)return hasPlaceholder||(settings.url=appendQuery(settings.url,"callback=?")),$.ajaxJSONP(settings);var mime=settings.accepts[dataType],baseHeaders={},protocol=/^([\w-]+:)\/\//.test(settings.url)?RegExp.$1:window.location.protocol,xhr=settings.xhr(),abortTimeout;settings.crossDomain||(baseHeaders["X-Requested-With"]="XMLHttpRequest"),mime&&(baseHeaders.Accept=mime,mime.indexOf(",")>-1&&(mime=mime.split(",",2)[0]),xhr.overrideMimeType&&xhr.overrideMimeType(mime));if(settings.contentType||settings.contentType!==!1&&settings.data&&settings.type.toUpperCase()!="GET")baseHeaders["Content-Type"]=settings.contentType||"application/x-www-form-urlencoded";settings.headers=$.extend(baseHeaders,settings.headers||{}),xhr.onreadystatechange=function(){if(xhr.readyState==4){xhr.onreadystatechange=empty,clearTimeout(abortTimeout);var result,error=!1;if(xhr.status>=200&&xhr.status<300||xhr.status==304||xhr.status==0&&protocol=="file:"){dataType=dataType||mimeToDataType(xhr.getResponseHeader("content-type")),result=xhr.responseText;try{dataType=="script"?(1,eval)(result):dataType=="xml"?result=xhr.responseXML:dataType=="json"&&(result=blankRE.test(result)?null:$.parseJSON(result))}catch(e){error=e}error?ajaxError(error,"parsererror",xhr,settings):ajaxSuccess(result,xhr,settings)}else ajaxError(null,xhr.status?"error":"abort",xhr,settings)}};var async="async"in settings?settings.async:!0;xhr.open(settings.type,settings.url,async);for(name in settings.headers)xhr.setRequestHeader(name,settings.headers[name]);return ajaxBeforeSend(xhr,settings)===!1?(xhr.abort(),!1):(settings.timeout>0&&(abortTimeout=setTimeout(function(){xhr.onreadystatechange=empty,xhr.abort(),ajaxError(null,"timeout",xhr,settings)},settings.timeout)),xhr.send(settings.data?settings.data:null),xhr)},$.get=function(e,t,n,r){return $.ajax(parseArguments.apply(null,arguments))},$.post=function(e,t,n,r){var i=parseArguments.apply(null,arguments);return i.type="POST",$.ajax(i)},$.getJSON=function(e,t,n){var r=parseArguments.apply(null,arguments);return r.dataType="json",$.ajax(r)},$.fn.load=function(e,t,n){if(!this.length)return this;var r=this,i=e.split(/\s/),s,o=parseArguments(e,t,n),u=o.success;return i.length>1&&(o.url=i[0],s=i[1]),o.success=function(e){r.html(s?$("<div>").html(e.replace(rscript,"")).find(s):e),u&&u.apply(r,arguments)},$.ajax(o),this};var escape=encodeURIComponent;$.param=function(e,t){var n=[];return n.add=function(e,t){this.push(escape(e)+"="+escape(t))},serialize(n,e,t),n.join("&").replace(/%20/g,"+")}}(Zepto),function(e){e.fn.serializeArray=function(){var t=[],n;return e(Array.prototype.slice.call(this.get(0).elements)).each(function(){n=e(this);var r=n.attr("type");this.nodeName.toLowerCase()!="fieldset"&&!this.disabled&&r!="submit"&&r!="reset"&&r!="button"&&(r!="radio"&&r!="checkbox"||this.checked)&&t.push({name:n.attr("name"),value:n.val()})}),t},e.fn.serialize=function(){var e=[];return this.serializeArray().forEach(function(t){e.push(encodeURIComponent(t.name)+"="+encodeURIComponent(t.value))}),e.join("&")},e.fn.submit=function(t){if(t)this.bind("submit",t);else if(this.length){var n=e.Event("submit");this.eq(0).trigger(n),n.defaultPrevented||this.get(0).submit()}return this}}(Zepto),function(e,t){function y(e){return b(e.replace(/([a-z])([A-Z])/,"$1-$2"))}function b(e){return e.toLowerCase()}function w(e){return r?r+e:b(e)}var n="",r,i,s,o={Webkit:"webkit",Moz:"",O:"o",ms:"MS"},u=window.document,a=u.createElement("div"),f=/^((translate|rotate|scale)(X|Y|Z|3d)?|matrix(3d)?|perspective|skew(X|Y)?)$/i,l,c,h,p,d,v,m,g={};e.each(o,function(e,i){if(a.style[e+"TransitionProperty"]!==t)return n="-"+b(e)+"-",r=i,!1}),l=n+"transform",g[c=n+"transition-property"]=g[h=n+"transition-duration"]=g[p=n+"transition-timing-function"]=g[d=n+"animation-name"]=g[v=n+"animation-duration"]=g[m=n+"animation-timing-function"]="",e.fx={off:r===t&&a.style.transitionProperty===t,speeds:{_default:400,fast:200,slow:600},cssPrefix:n,transitionEnd:w("TransitionEnd"),animationEnd:w("AnimationEnd")},e.fn.animate=function(t,n,r,i){return e.isPlainObject(n)&&(r=n.easing,i=n.complete,n=n.duration),n&&(n=(typeof n=="number"?n:e.fx.speeds[n]||e.fx.speeds._default)/1e3),this.anim(t,n,r,i)},e.fn.anim=function(n,r,i,s){var o,u={},a,b="",w=this,E,S=e.fx.transitionEnd;r===t&&(r=.4),e.fx.off&&(r=0);if(typeof n=="string")u[d]=n,u[v]=r+"s",u[m]=i||"linear",S=e.fx.animationEnd;else{a=[];for(o in n)f.test(o)?b+=o+"("+n[o]+") ":(u[o]=n[o],a.push(y(o)));b&&(u[l]=b,a.push(l)),r>0&&typeof n=="object"&&(u[c]=a.join(", "),u[h]=r+"s",u[p]=i||"linear")}return E=function(t){if(typeof t!="undefined"){if(t.target!==t.currentTarget)return;e(t.target).unbind(S,E)}e(this).css(g),s&&s.call(this)},r>0&&this.bind(S,E),this.size()&&this.get(0).clientLeft,this.css(u),r<=0&&setTimeout(function(){w.each(function(){E.call(this)})},0),this},a=null}(Zepto),define("zepto",function(e){return function(){var t,n;return t||e.$}}(this)),function(){var e=this,t=e._,n={},r=Array.prototype,i=Object.prototype,s=Function.prototype,o=r.push,u=r.slice,a=r.concat,f=i.toString,l=i.hasOwnProperty,c=r.forEach,h=r.map,p=r.reduce,d=r.reduceRight,v=r.filter,m=r.every,g=r.some,y=r.indexOf,b=r.lastIndexOf,w=Array.isArray,E=Object.keys,S=s.bind,x=function(e){if(e instanceof x)return e;if(!(this instanceof x))return new x(e);this._wrapped=e};typeof exports!="undefined"?(typeof module!="undefined"&&module.exports&&(exports=module.exports=x),exports._=x):e._=x,x.VERSION="1.5.1";var T=x.each=x.forEach=function(e,t,r){if(e==null)return;if(c&&e.forEach===c)e.forEach(t,r);else if(e.length===+e.length){for(var i=0,s=e.length;i<s;i++)if(t.call(r,e[i],i,e)===n)return}else for(var o in e)if(x.has(e,o)&&t.call(r,e[o],o,e)===n)return};x.map=x.collect=function(e,t,n){var r=[];return e==null?r:h&&e.map===h?e.map(t,n):(T(e,function(e,i,s){r.push(t.call(n,e,i,s))}),r)};var N="Reduce of empty array with no initial value";x.reduce=x.foldl=x.inject=function(e,t,n,r){var i=arguments.length>2;e==null&&(e=[]);if(p&&e.reduce===p)return r&&(t=x.bind(t,r)),i?e.reduce(t,n):e.reduce(t);T(e,function(e,s,o){i?n=t.call(r,n,e,s,o):(n=e,i=!0)});if(!i)throw new TypeError(N);return n},x.reduceRight=x.foldr=function(e,t,n,r){var i=arguments.length>2;e==null&&(e=[]);if(d&&e.reduceRight===d)return r&&(t=x.bind(t,r)),i?e.reduceRight(t,n):e.reduceRight(t);var s=e.length;if(s!==+s){var o=x.keys(e);s=o.length}T(e,function(u,a,f){a=o?o[--s]:--s,i?n=t.call(r,n,e[a],a,f):(n=e[a],i=!0)});if(!i)throw new TypeError(N);return n},x.find=x.detect=function(e,t,n){var r;return C(e,function(e,i,s){if(t.call(n,e,i,s))return r=e,!0}),r},x.filter=x.select=function(e,t,n){var r=[];return e==null?r:v&&e.filter===v?e.filter(t,n):(T(e,function(e,i,s){t.call(n,e,i,s)&&r.push(e)}),r)},x.reject=function(e,t,n){return x.filter(e,function(e,r,i){return!t.call(n,e,r,i)},n)},x.every=x.all=function(e,t,r){t||(t=x.identity);var i=!0;return e==null?i:m&&e.every===m?e.every(t,r):(T(e,function(e,s,o){if(!(i=i&&t.call(r,e,s,o)))return n}),!!i)};var C=x.some=x.any=function(e,t,r){t||(t=x.identity);var i=!1;return e==null?i:g&&e.some===g?e.some(t,r):(T(e,function(e,s,o){if(i||(i=t.call(r,e,s,o)))return n}),!!i)};x.contains=x.include=function(e,t){return e==null?!1:y&&e.indexOf===y?e.indexOf(t)!=-1:C(e,function(e){return e===t})},x.invoke=function(e,t){var n=u.call(arguments,2),r=x.isFunction(t);return x.map(e,function(e){return(r?t:e[t]).apply(e,n)})},x.pluck=function(e,t){return x.map(e,function(e){return e[t]})},x.where=function(e,t,n){return x.isEmpty(t)?n?void 0:[]:x[n?"find":"filter"](e,function(e){for(var n in t)if(t[n]!==e[n])return!1;return!0})},x.findWhere=function(e,t){return x.where(e,t,!0)},x.max=function(e,t,n){if(!t&&x.isArray(e)&&e[0]===+e[0]&&e.length<65535)return Math.max.apply(Math,e);if(!t&&x.isEmpty(e))return-Infinity;var r={computed:-Infinity,value:-Infinity};return T(e,function(e,i,s){var o=t?t.call(n,e,i,s):e;o>r.computed&&(r={value:e,computed:o})}),r.value},x.min=function(e,t,n){if(!t&&x.isArray(e)&&e[0]===+e[0]&&e.length<65535)return Math.min.apply(Math,e);if(!t&&x.isEmpty(e))return Infinity;var r={computed:Infinity,value:Infinity};return T(e,function(e,i,s){var o=t?t.call(n,e,i,s):e;o<r.computed&&(r={value:e,computed:o})}),r.value},x.shuffle=function(e){var t,n=0,r=[];return T(e,function(e){t=x.random(n++),r[n-1]=r[t],r[t]=e}),r};var k=function(e){return x.isFunction(e)?e:function(t){return t[e]}};x.sortBy=function(e,t,n){var r=k(t);return x.pluck(x.map(e,function(e,t,i){return{value:e,index:t,criteria:r.call(n,e,t,i)}}).sort(function(e,t){var n=e.criteria,r=t.criteria;if(n!==r){if(n>r||n===void 0)return 1;if(n<r||r===void 0)return-1}return e.index<t.index?-1:1}),"value")};var L=function(e,t,n,r){var i={},s=k(t==null?x.identity:t);return T(e,function(t,o){var u=s.call(n,t,o,e);r(i,u,t)}),i};x.groupBy=function(e,t,n){return L(e,t,n,function(e,t,n){(x.has(e,t)?e[t]:e[t]=[]).push(n)})},x.countBy=function(e,t,n){return L(e,t,n,function(e,t){x.has(e,t)||(e[t]=0),e[t]++})},x.sortedIndex=function(e,t,n,r){n=n==null?x.identity:k(n);var i=n.call(r,t),s=0,o=e.length;while(s<o){var u=s+o>>>1;n.call(r,e[u])<i?s=u+1:o=u}return s},x.toArray=function(e){return e?x.isArray(e)?u.call(e):e.length===+e.length?x.map(e,x.identity):x.values(e):[]},x.size=function(e){return e==null?0:e.length===+e.length?e.length:x.keys(e).length},x.first=x.head=x.take=function(e,t,n){return e==null?void 0:t!=null&&!n?u.call(e,0,t):e[0]},x.initial=function(e,t,n){return u.call(e,0,e.length-(t==null||n?1:t))},x.last=function(e,t,n){return e==null?void 0:t!=null&&!n?u.call(e,Math.max(e.length-t,0)):e[e.length-1]},x.rest=x.tail=x.drop=function(e,t,n){return u.call(e,t==null||n?1:t)},x.compact=function(e){return x.filter(e,x.identity)};var A=function(e,t,n){return t&&x.every(e,x.isArray)?a.apply(n,e):(T(e,function(e){x.isArray(e)||x.isArguments(e)?t?o.apply(n,e):A(e,t,n):n.push(e)}),n)};x.flatten=function(e,t){return A(e,t,[])},x.without=function(e){return x.difference(e,u.call(arguments,1))},x.uniq=x.unique=function(e,t,n,r){x.isFunction(t)&&(r=n,n=t,t=!1);var i=n?x.map(e,n,r):e,s=[],o=[];return T(i,function(n,r){if(t?!r||o[o.length-1]!==n:!x.contains(o,n))o.push(n),s.push(e[r])}),s},x.union=function(){return x.uniq(x.flatten(arguments,!0))},x.intersection=function(e){var t=u.call(arguments,1);return x.filter(x.uniq(e),function(e){return x.every(t,function(t){return x.indexOf(t,e)>=0})})},x.difference=function(e){var t=a.apply(r,u.call(arguments,1));return x.filter(e,function(e){return!x.contains(t,e)})},x.zip=function(){var e=x.max(x.pluck(arguments,"length").concat(0)),t=new Array(e);for(var n=0;n<e;n++)t[n]=x.pluck(arguments,""+n);return t},x.object=function(e,t){if(e==null)return{};var n={};for(var r=0,i=e.length;r<i;r++)t?n[e[r]]=t[r]:n[e[r][0]]=e[r][1];return n},x.indexOf=function(e,t,n){if(e==null)return-1;var r=0,i=e.length;if(n){if(typeof n!="number")return r=x.sortedIndex(e,t),e[r]===t?r:-1;r=n<0?Math.max(0,i+n):n}if(y&&e.indexOf===y)return e.indexOf(t,n);for(;r<i;r++)if(e[r]===t)return r;return-1},x.lastIndexOf=function(e,t,n){if(e==null)return-1;var r=n!=null;if(b&&e.lastIndexOf===b)return r?e.lastIndexOf(t,n):e.lastIndexOf(t);var i=r?n:e.length;while(i--)if(e[i]===t)return i;return-1},x.range=function(e,t,n){arguments.length<=1&&(t=e||0,e=0),n=arguments[2]||1;var r=Math.max(Math.ceil((t-e)/n),0),i=0,s=new Array(r);while(i<r)s[i++]=e,e+=n;return s};var O=function(){};x.bind=function(e,t){var n,r;if(S&&e.bind===S)return S.apply(e,u.call(arguments,1));if(!x.isFunction(e))throw new TypeError;return n=u.call(arguments,2),r=function(){if(this instanceof r){O.prototype=e.prototype;var i=new O;O.prototype=null;var s=e.apply(i,n.concat(u.call(arguments)));return Object(s)===s?s:i}return e.apply(t,n.concat(u.call(arguments)))}},x.partial=function(e){var t=u.call(arguments,1);return function(){return e.apply(this,t.concat(u.call(arguments)))}},x.bindAll=function(e){var t=u.call(arguments,1);if(t.length===0)throw new Error("bindAll must be passed function names");return T(t,function(t){e[t]=x.bind(e[t],e)}),e},x.memoize=function(e,t){var n={};return t||(t=x.identity),function(){var r=t.apply(this,arguments);return x.has(n,r)?n[r]:n[r]=e.apply(this,arguments)}},x.delay=function(e,t){var n=u.call(arguments,2);return setTimeout(function(){return e.apply(null,n)},t)},x.defer=function(e){return x.delay.apply(x,[e,1].concat(u.call(arguments,1)))},x.throttle=function(e,t,n){var r,i,s,o=null,u=0;n||(n={});var a=function(){u=n.leading===!1?0:new Date,o=null,s=e.apply(r,i)};return function(){var f=new Date;!u&&n.leading===!1&&(u=f);var l=t-(f-u);return r=this,i=arguments,l<=0?(clearTimeout(o),o=null,u=f,s=e.apply(r,i)):!o&&n.trailing!==!1&&(o=setTimeout(a,l)),s}},x.debounce=function(e,t,n){var r,i=null;return function(){var s=this,o=arguments,u=function(){i=null,n||(r=e.apply(s,o))},a=n&&!i;return clearTimeout(i),i=setTimeout(u,t),a&&(r=e.apply(s,o)),r}},x.once=function(e){var t=!1,n;return function(){return t?n:(t=!0,n=e.apply(this,arguments),e=null,n)}},x.wrap=function(e,t){return function(){var n=[e];return o.apply(n,arguments),t.apply(this,n)}},x.compose=function(){var e=arguments;return function(){var t=arguments;for(var n=e.length-1;n>=0;n--)t=[e[n].apply(this,t)];return t[0]}},x.after=function(e,t){return function(){if(--e<1)return t.apply(this,arguments)}},x.keys=E||function(e){if(e!==Object(e))throw new TypeError("Invalid object");var t=[];for(var n in e)x.has(e,n)&&t.push(n);return t},x.values=function(e){var t=[];for(var n in e)x.has(e,n)&&t.push(e[n]);return t},x.pairs=function(e){var t=[];for(var n in e)x.has(e,n)&&t.push([n,e[n]]);return t},x.invert=function(e){var t={};for(var n in e)x.has(e,n)&&(t[e[n]]=n);return t},x.functions=x.methods=function(e){var t=[];for(var n in e)x.isFunction(e[n])&&t.push(n);return t.sort()},x.extend=function(e){return T(u.call(arguments,1),function(t){if(t)for(var n in t)e[n]=t[n]}),e},x.pick=function(e){var t={},n=a.apply(r,u.call(arguments,1));return T(n,function(n){n in e&&(t[n]=e[n])}),t},x.omit=function(e){var t={},n=a.apply(r,u.call(arguments,1));for(var i in e)x.contains(n,i)||(t[i]=e[i]);return t},x.defaults=function(e){return T(u.call(arguments,1),function(t){if(t)for(var n in t)e[n]===void 0&&(e[n]=t[n])}),e},x.clone=function(e){return x.isObject(e)?x.isArray(e)?e.slice():x.extend({},e):e},x.tap=function(e,t){return t(e),e};var M=function(e,t,n,r){if(e===t)return e!==0||1/e==1/t;if(e==null||t==null)return e===t;e instanceof x&&(e=e._wrapped),t instanceof x&&(t=t._wrapped);var i=f.call(e);if(i!=f.call(t))return!1;switch(i){case"[object String]":return e==String(t);case"[object Number]":return e!=+e?t!=+t:e==0?1/e==1/t:e==+t;case"[object Date]":case"[object Boolean]":return+e==+t;case"[object RegExp]":return e.source==t.source&&e.global==t.global&&e.multiline==t.multiline&&e.ignoreCase==t.ignoreCase}if(typeof e!="object"||typeof t!="object")return!1;var s=n.length;while(s--)if(n[s]==e)return r[s]==t;var o=e.constructor,u=t.constructor;if(o!==u&&!(x.isFunction(o)&&o instanceof o&&x.isFunction(u)&&u instanceof u))return!1;n.push(e),r.push(t);var a=0,l=!0;if(i=="[object Array]"){a=e.length,l=a==t.length;if(l)while(a--)if(!(l=M(e[a],t[a],n,r)))break}else{for(var c in e)if(x.has(e,c)){a++;if(!(l=x.has(t,c)&&M(e[c],t[c],n,r)))break}if(l){for(c in t)if(x.has(t,c)&&!(a--))break;l=!a}}return n.pop(),r.pop(),l};x.isEqual=function(e,t){return M(e,t,[],[])},x.isEmpty=function(e){if(e==null)return!0;if(x.isArray(e)||x.isString(e))return e.length===0;for(var t in e)if(x.has(e,t))return!1;return!0},x.isElement=function(e){return!!e&&e.nodeType===1},x.isArray=w||function(e){return f.call(e)=="[object Array]"},x.isObject=function(e){return e===Object(e)},T(["Arguments","Function","String","Number","Date","RegExp"],function(e){x["is"+e]=function(t){return f.call(t)=="[object "+e+"]"}}),x.isArguments(arguments)||(x.isArguments=function(e){return!!e&&!!x.has(e,"callee")}),typeof /./!="function"&&(x.isFunction=function(e){return typeof e=="function"}),x.isFinite=function(e){return isFinite(e)&&!isNaN(parseFloat(e))},x.isNaN=function(e){return x.isNumber(e)&&e!=+e},x.isBoolean=function(e){return e===!0||e===!1||f.call(e)=="[object Boolean]"},x.isNull=function(e){return e===null},x.isUndefined=function(e){return e===void 0},x.has=function(e,t){return l.call(e,t)},x.noConflict=function(){return e._=t,this},x.identity=function(e){return e},x.times=function(e,t,n){var r=Array(Math.max(0,e));for(var i=0;i<e;i++)r[i]=t.call(n,i);return r},x.random=function(e,t){return t==null&&(t=e,e=0),e+Math.floor(Math.random()*(t-e+1))};var _={escape:{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#x27;","/":"&#x2F;"}};_.unescape=x.invert(_.escape);var D={escape:new RegExp("["+x.keys(_.escape).join("")+"]","g"),unescape:new RegExp("("+x.keys(_.unescape).join("|")+")","g")};x.each(["escape","unescape"],function(e){x[e]=function(t){return t==null?"":(""+t).replace(D[e],function(t){return _[e][t]})}}),x.result=function(e,t){if(e==null)return void 0;var n=e[t];return x.isFunction(n)?n.call(e):n},x.mixin=function(e){T(x.functions(e),function(t){var n=x[t]=e[t];x.prototype[t]=function(){var e=[this._wrapped];return o.apply(e,arguments),F.call(this,n.apply(x,e))}})};var P=0;x.uniqueId=function(e){var t=++P+"";return e?e+t:t},x.templateSettings={evaluate:/<%([\s\S]+?)%>/g,interpolate:/<%=([\s\S]+?)%>/g,escape:/<%-([\s\S]+?)%>/g};var H=/(.)^/,B={"'":"'","\\":"\\","\r":"r","\n":"n","	":"t","\u2028":"u2028","\u2029":"u2029"},j=/\\|'|\r|\n|\t|\u2028|\u2029/g;x.template=function(e,t,n){var r;n=x.defaults({},n,x.templateSettings);var i=new RegExp([(n.escape||H).source,(n.interpolate||H).source,(n.evaluate||H).source].join("|")+"|$","g"),s=0,o="__p+='";e.replace(i,function(t,n,r,i,u){return o+=e.slice(s,u).replace(j,function(e){return"\\"+B[e]}),n&&(o+="'+\n((__t=("+n+"))==null?'':_.escape(__t))+\n'"),r&&(o+="'+\n((__t=("+r+"))==null?'':__t)+\n'"),i&&(o+="';\n"+i+"\n__p+='"),s=u+t.length,t}),o+="';\n",n.variable||(o="with(obj||{}){\n"+o+"}\n"),o="var __t,__p='',__j=Array.prototype.join,print=function(){__p+=__j.call(arguments,'');};\n"+o+"return __p;\n";try{r=new Function(n.variable||"obj","_",o)}catch(u){throw u.source=o,u}if(t)return r(t,x);var a=function(e){return r.call(this,e,x)};return a.source="function("+(n.variable||"obj")+"){\n"+o+"}",a},x.chain=function(e){return x(e).chain()};var F=function(e){return this._chain?x(e).chain():e};x.mixin(x),T(["pop","push","reverse","shift","sort","splice","unshift"],function(e){var t=r[e];x.prototype[e]=function(){var n=this._wrapped;return t.apply(n,arguments),(e=="shift"||e=="splice")&&n.length===0&&delete n[0],F.call(this,n)}}),T(["concat","join","slice"],function(e){var t=r[e];x.prototype[e]=function(){return F.call(this,t.apply(this._wrapped,arguments))}}),x.extend(x.prototype,{chain:function(){return this._chain=!0,this},value:function(){return this._wrapped}})}.call(this),define("underscore",function(e){return function(){var t,n;return t||e._}}(this)),function(){var e=this,t=e.Backbone,n=[],r=n.push,i=n.slice,s=n.splice,o;typeof exports!="undefined"?o=exports:o=e.Backbone={},o.VERSION="1.0.0";var u=e._;!u&&typeof require!="undefined"&&(u=require("underscore")),o.$=e.jQuery||e.Zepto||e.ender||e.$,o.noConflict=function(){return e.Backbone=t,this},o.emulateHTTP=!1,o.emulateJSON=!1;var a=o.Events={on:function(e,t,n){if(!l(this,"on",e,[t,n])||!t)return this;this._events||(this._events={});var r=this._events[e]||(this._events[e]=[]);return r.push({callback:t,context:n,ctx:n||this}),this},once:function(e,t,n){if(!l(this,"once",e,[t,n])||!t)return this;var r=this,i=u.once(function(){r.off(e,i),t.apply(this,arguments)});return i._callback=t,this.on(e,i,n)},off:function(e,t,n){var r,i,s,o,a,f,c,h;if(!this._events||!l(this,"off",e,[t,n]))return this;if(!e&&!t&&!n)return this._events={},this;o=e?[e]:u.keys(this._events);for(a=0,f=o.length;a<f;a++){e=o[a];if(s=this._events[e]){this._events[e]=r=[];if(t||n)for(c=0,h=s.length;c<h;c++)i=s[c],(t&&t!==i.callback&&t!==i.callback._callback||n&&n!==i.context)&&r.push(i);r.length||delete this._events[e]}}return this},trigger:function(e){if(!this._events)return this;var t=i.call(arguments,1);if(!l(this,"trigger",e,t))return this;var n=this._events[e],r=this._events.all;return n&&c(n,t),r&&c(r,arguments),this},stopListening:function(e,t,n){var r=this._listeners;if(!r)return this;var i=!t&&!n;typeof t=="object"&&(n=this),e&&((r={})[e._listenerId]=e);for(var s in r)r[s].off(t,n,this),i&&delete this._listeners[s];return this}},f=/\s+/,l=function(e,t,n,r){if(!n)return!0;if(typeof n=="object"){for(var i in n)e[t].apply(e,[i,n[i]].concat(r));return!1}if(f.test(n)){var s=n.split(f);for(var o=0,u=s.length;o<u;o++)e[t].apply(e,[s[o]].concat(r));return!1}return!0},c=function(e,t){var n,r=-1,i=e.length,s=t[0],o=t[1],u=t[2];switch(t.length){case 0:while(++r<i)(n=e[r]).callback.call(n.ctx);return;case 1:while(++r<i)(n=e[r]).callback.call(n.ctx,s);return;case 2:while(++r<i)(n=e[r]).callback.call(n.ctx,s,o);return;case 3:while(++r<i)(n=e[r]).callback.call(n.ctx,s,o,u);return;default:while(++r<i)(n=e[r]).callback.apply(n.ctx,t)}},h={listenTo:"on",listenToOnce:"once"};u.each(h,function(e,t){a[t]=function(t,n,r){var i=this._listeners||(this._listeners={}),s=t._listenerId||(t._listenerId=u.uniqueId("l"));return i[s]=t,typeof n=="object"&&(r=this),t[e](n,r,this),this}}),a.bind=a.on,a.unbind=a.off,u.extend(o,a);var p=o.Model=function(e,t){var n,r=e||{};t||(t={}),this.cid=u.uniqueId("c"),this.attributes={},u.extend(this,u.pick(t,d)),t.parse&&(r=this.parse(r,t)||{});if(n=u.result(this,"defaults"))r=u.defaults({},r,n);this.set(r,t),this.changed={},this.initialize.apply(this,arguments)},d=["url","urlRoot","collection"];u.extend(p.prototype,a,{changed:null,validationError:null,idAttribute:"id",initialize:function(){},toJSON:function(e){return u.clone(this.attributes)},sync:function(){return o.sync.apply(this,arguments)},get:function(e){return this.attributes[e]},escape:function(e){return u.escape(this.get(e))},has:function(e){return this.get(e)!=null},set:function(e,t,n){var r,i,s,o,a,f,l,c;if(e==null)return this;typeof e=="object"?(i=e,n=t):(i={})[e]=t,n||(n={});if(!this._validate(i,n))return!1;s=n.unset,a=n.silent,o=[],f=this._changing,this._changing=!0,f||(this._previousAttributes=u.clone(this.attributes),this.changed={}),c=this.attributes,l=this._previousAttributes,this.idAttribute in i&&(this.id=i[this.idAttribute]);for(r in i)t=i[r],u.isEqual(c[r],t)||o.push(r),u.isEqual(l[r],t)?delete this.changed[r]:this.changed[r]=t,s?delete c[r]:c[r]=t;if(!a){o.length&&(this._pending=!0);for(var h=0,p=o.length;h<p;h++)this.trigger("change:"+o[h],this,c[o[h]],n)}if(f)return this;if(!a)while(this._pending)this._pending=!1,this.trigger("change",this,n);return this._pending=!1,this._changing=!1,this},unset:function(e,t){return this.set(e,void 0,u.extend({},t,{unset:!0}))},clear:function(e){var t={};for(var n in this.attributes)t[n]=void 0;return this.set(t,u.extend({},e,{unset:!0}))},hasChanged:function(e){return e==null?!u.isEmpty(this.changed):u.has(this.changed,e)},changedAttributes:function(e){if(!e)return this.hasChanged()?u.clone(this.changed):!1;var t,n=!1,r=this._changing?this._previousAttributes:this.attributes;for(var i in e){if(u.isEqual(r[i],t=e[i]))continue;(n||(n={}))[i]=t}return n},previous:function(e){return e==null||!this._previousAttributes?null:this._previousAttributes[e]},previousAttributes:function(){return u.clone(this._previousAttributes)},fetch:function(e){e=e?u.clone(e):{},e.parse===void 0&&(e.parse=!0);var t=this,n=e.success;return e.success=function(r){if(!t.set(t.parse(r,e),e))return!1;n&&n(t,r,e),t.trigger("sync",t,r,e)},j(this,e),this.sync("read",this,e)},save:function(e,t,n){var r,i,s,o=this.attributes;e==null||typeof e=="object"?(r=e,n=t):(r={})[e]=t;if(r&&(!n||!n.wait)&&!this.set(r,n))return!1;n=u.extend({validate:!0},n);if(!this._validate(r,n))return!1;r&&n.wait&&(this.attributes=u.extend({},o,r)),n.parse===void 0&&(n.parse=!0);var a=this,f=n.success;return n.success=function(e){a.attributes=o;var t=a.parse(e,n);n.wait&&(t=u.extend(r||{},t));if(u.isObject(t)&&!a.set(t,n))return!1;f&&f(a,e,n),a.trigger("sync",a,e,n)},j(this,n),i=this.isNew()?"create":n.patch?"patch":"update",i==="patch"&&(n.attrs=r),s=this.sync(i,this,n),r&&n.wait&&(this.attributes=o),s},destroy:function(e){e=e?u.clone(e):{};var t=this,n=e.success,r=function(){t.trigger("destroy",t,t.collection,e)};e.success=function(i){(e.wait||t.isNew())&&r(),n&&n(t,i,e),t.isNew()||t.trigger("sync",t,i,e)};if(this.isNew())return e.success(),!1;j(this,e);var i=this.sync("delete",this,e);return e.wait||r(),i},url:function(){var e=u.result(this,"urlRoot")||u.result(this.collection,"url")||B();return this.isNew()?e:e+(e.charAt(e.length-1)==="/"?"":"/")+encodeURIComponent(this.id)},parse:function(e,t){return e},clone:function(){return new this.constructor(this.attributes)},isNew:function(){return this.id==null},isValid:function(e){return this._validate({},u.extend(e||{},{validate:!0}))},_validate:function(e,t){if(!t.validate||!this.validate)return!0;e=u.extend({},this.attributes,e);var n=this.validationError=this.validate(e,t)||null;return n?(this.trigger("invalid",this,n,u.extend(t||{},{validationError:n})),!1):!0}});var v=["keys","values","pairs","invert","pick","omit"];u.each(v,function(e){p.prototype[e]=function(){var t=i.call(arguments);return t.unshift(this.attributes),u[e].apply(u,t)}});var m=o.Collection=function(e,t){t||(t={}),t.url&&(this.url=t.url),t.model&&(this.model=t.model),t.comparator!==void 0&&(this.comparator=t.comparator),this._reset(),this.initialize.apply(this,arguments),e&&this.reset(e,u.extend({silent:!0},t))},g={add:!0,remove:!0,merge:!0},y={add:!0,merge:!1,remove:!1};u.extend(m.prototype,a,{model:p,initialize:function(){},toJSON:function(e){return this.map(function(t){return t.toJSON(e)})},sync:function(){return o.sync.apply(this,arguments)},add:function(e,t){return this.set(e,u.defaults(t||{},y))},remove:function(e,t){e=u.isArray(e)?e.slice():[e],t||(t={});var n,r,i,s;for(n=0,r=e.length;n<r;n++){s=this.get(e[n]);if(!s)continue;delete this._byId[s.id],delete this._byId[s.cid],i=this.indexOf(s),this.models.splice(i,1),this.length--,t.silent||(t.index=i,s.trigger("remove",s,this,t)),this._removeReference(s)}return this},set:function(e,t){t=u.defaults(t||{},g),t.parse&&(e=this.parse(e,t)),u.isArray(e)||(e=e?[e]:[]);var n,i,o,a,f,l,c=t.at,h=this.comparator&&c==null&&t.sort!==!1,p=u.isString(this.comparator)?this.comparator:null,d=[],v=[],m={};for(n=0,i=e.length;n<i;n++){if(!(o=this._prepareModel(e[n],t)))continue;(f=this.get(o))?(t.remove&&(m[f.cid]=!0),t.merge&&(f.set(o.attributes,t),h&&!l&&f.hasChanged(p)&&(l=!0))):t.add&&(d.push(o),o.on("all",this._onModelEvent,this),this._byId[o.cid]=o,o.id!=null&&(this._byId[o.id]=o))}if(t.remove){for(n=0,i=this.length;n<i;++n)m[(o=this.models[n]).cid]||v.push(o);v.length&&this.remove(v,t)}d.length&&(h&&(l=!0),this.length+=d.length,c!=null?s.apply(this.models,[c,0].concat(d)):r.apply(this.models,d)),l&&this.sort({silent:!0});if(t.silent)return this;for(n=0,i=d.length;n<i;n++)(o=d[n]).trigger("add",o,this,t);return l&&this.trigger("sort",this,t),this},reset:function(e,t){t||(t={});for(var n=0,r=this.models.length;n<r;n++)this._removeReference(this.models[n]);return t.previousModels=this.models,this._reset(),this.add(e,u.extend({silent:!0},t)),t.silent||this.trigger("reset",this,t),this},push:function(e,t){return e=this._prepareModel(e,t),this.add(e,u.extend({at:this.length},t)),e},pop:function(e){var t=this.at(this.length-1);return this.remove(t,e),t},unshift:function(e,t){return e=this._prepareModel(e,t),this.add(e,u.extend({at:0},t)),e},shift:function(e){var t=this.at(0);return this.remove(t,e),t},slice:function(e,t){return this.models.slice(e,t)},get:function(e){return e==null?void 0:this._byId[e.id!=null?e.id:e.cid||e]},at:function(e){return this.models[e]},where:function(e,t){return u.isEmpty(e)?t?void 0:[]:this[t?"find":"filter"](function(t){for(var n in e)if(e[n]!==t.get(n))return!1;return!0})},findWhere:function(e){return this.where(e,!0)},sort:function(e){if(!this.comparator)throw new Error("Cannot sort a set without a comparator");return e||(e={}),u.isString(this.comparator)||this.comparator.length===1?this.models=this.sortBy(this.comparator,this):this.models.sort(u.bind(this.comparator,this)),e.silent||this.trigger("sort",this,e),this},sortedIndex:function(e,t,n){t||(t=this.comparator);var r=u.isFunction(t)?t:function(e){return e.get(t)};return u.sortedIndex(this.models,e,r,n)},pluck:function(e){return u.invoke(this.models,"get",e)},fetch:function(e){e=e?u.clone(e):{},e.parse===void 0&&(e.parse=!0);var t=e.success,n=this;return e.success=function(r){var i=e.reset?"reset":"set";n[i](r,e),t&&t(n,r,e),n.trigger("sync",n,r,e)},j(this,e),this.sync("read",this,e)},create:function(e,t){t=t?u.clone(t):{};if(!(e=this._prepareModel(e,t)))return!1;t.wait||this.add(e,t);var n=this,r=t.success;return t.success=function(i){t.wait&&n.add(e,t),r&&r(e,i,t)},e.save(null,t),e},parse:function(e,t){return e},clone:function(){return new this.constructor(this.models)},_reset:function(){this.length=0,this.models=[],this._byId={}},_prepareModel:function(e,t){if(e instanceof p)return e.collection||(e.collection=this),e;t||(t={}),t.collection=this;var n=new this.model(e,t);return n._validate(e,t)?n:(this.trigger("invalid",this,e,t),!1)},_removeReference:function(e){this===e.collection&&delete e.collection,e.off("all",this._onModelEvent,this)},_onModelEvent:function(e,t,n,r){if((e==="add"||e==="remove")&&n!==this)return;e==="destroy"&&this.remove(t,r),t&&e==="change:"+t.idAttribute&&(delete this._byId[t.previous(t.idAttribute)],t.id!=null&&(this._byId[t.id]=t)),this.trigger.apply(this,arguments)}});var b=["forEach","each","map","collect","reduce","foldl","inject","reduceRight","foldr","find","detect","filter","select","reject","every","all","some","any","include","contains","invoke","max","min","toArray","size","first","head","take","initial","rest","tail","drop","last","without","indexOf","shuffle","lastIndexOf","isEmpty","chain"];u.each(b,function(e){m.prototype[e]=function(){var t=i.call(arguments);return t.unshift(this.models),u[e].apply(u,t)}});var w=["groupBy","countBy","sortBy"];u.each(w,function(e){m.prototype[e]=function(t,n){var r=u.isFunction(t)?t:function(e){return e.get(t)};return u[e](this.models,r,n)}});var E=o.View=function(e){this.cid=u.uniqueId("view"),this._configure(e||{}),this._ensureElement(),this.initialize.apply(this,arguments),this.delegateEvents()},S=/^(\S+)\s*(.*)$/,x=["model","collection","el","id","attributes","className","tagName","events"];u.extend(E.prototype,a,{tagName:"div",$:function(e){return this.$el.find(e)},initialize:function(){},render:function(){return this},remove:function(){return this.$el.remove(),this.stopListening(),this},setElement:function(e,t){return this.$el&&this.undelegateEvents(),this.$el=e instanceof o.$?e:o.$(e),this.el=this.$el[0],t!==!1&&this.delegateEvents(),this},delegateEvents:function(e){if(!e&&!(e=u.result(this,"events")))return this;this.undelegateEvents();for(var t in e){var n=e[t];u.isFunction(n)||(n=this[e[t]]);if(!n)continue;var r=t.match(S),i=r[1],s=r[2];n=u.bind(n,this),i+=".delegateEvents"+this.cid,s===""?this.$el.on(i,n):this.$el.on(i,s,n)}return this},undelegateEvents:function(){return this.$el.off(".delegateEvents"+this.cid),this},_configure:function(e){this.options&&(e=u.extend({},u.result(this,"options"),e)),u.extend(this,u.pick(e,x)),this.options=e},_ensureElement:function(){if(!this.el){var e=u.extend({},u.result(this,"attributes"));this.id&&(e.id=u.result(this,"id")),this.className&&(e["class"]=u.result(this,"className"));var t=o.$("<"+u.result(this,"tagName")+">").attr(e);this.setElement(t,!1)}else this.setElement(u.result(this,"el"),!1)}}),o.sync=function(e,t,n){var r=T[e];u.defaults(n||(n={}),{emulateHTTP:o.emulateHTTP,emulateJSON:o.emulateJSON});var i={type:r,dataType:"json"};n.url||(i.url=u.result(t,"url")||B()),n.data==null&&t&&(e==="create"||e==="update"||e==="patch")&&(i.contentType="application/json",i.data=JSON.stringify(n.attrs||t.toJSON(n))),n.emulateJSON&&(i.contentType="application/x-www-form-urlencoded",i.data=i.data?{model:i.data}:{});if(n.emulateHTTP&&(r==="PUT"||r==="DELETE"||r==="PATCH")){i.type="POST",n.emulateJSON&&(i.data._method=r);var s=n.beforeSend;n.beforeSend=function(e){e.setRequestHeader("X-HTTP-Method-Override",r);if(s)return s.apply(this,arguments)}}i.type!=="GET"&&!n.emulateJSON&&(i.processData=!1),i.type==="PATCH"&&window.ActiveXObject&&(!window.external||!window.external.msActiveXFilteringEnabled)&&(i.xhr=function(){return new ActiveXObject("Microsoft.XMLHTTP")});var a=n.xhr=o.ajax(u.extend(i,n));return t.trigger("request",t,a,n),a};var T={create:"POST",update:"PUT",patch:"PATCH","delete":"DELETE",read:"GET"};o.ajax=function(){return o.$.ajax.apply(o.$,arguments)};var N=o.Router=function(e){e||(e={}),e.routes&&(this.routes=e.routes),this._bindRoutes(),this.initialize.apply(this,arguments)},C=/\((.*?)\)/g,k=/(\(\?)?:\w+/g,L=/\*\w+/g,A=/[\-{}\[\]+?.,\\\^$|#\s]/g;u.extend(N.prototype,a,{initialize:function(){},route:function(e,t,n){u.isRegExp(e)||(e=this._routeToRegExp(e)),u.isFunction(t)&&(n=t,t=""),n||(n=this[t]);var r=this;return o.history.route(e,function(i){var s=r._extractParameters(e,i);n&&n.apply(r,s),r.trigger.apply(r,["route:"+t].concat(s)),r.trigger("route",t,s),o.history.trigger("route",r,t,s)}),this},navigate:function(e,t){return o.history.navigate(e,t),this},_bindRoutes:function(){if(!this.routes)return;this.routes=u.result(this,"routes");var e,t=u.keys(this.routes);while((e=t.pop())!=null)this.route(e,this.routes[e])},_routeToRegExp:function(e){return e=e.replace(A,"\\$&").replace(C,"(?:$1)?").replace(k,function(e,t){return t?e:"([^/]+)"}).replace(L,"(.*?)"),new RegExp("^"+e+"$")},_extractParameters:function(e,t){var n=e.exec(t).slice(1);return u.map(n,function(e){return e?decodeURIComponent(e):null})}});var O=o.History=function(){this.handlers=[],u.bindAll(this,"checkUrl"),typeof window!="undefined"&&(this.location=window.location,this.history=window.history)},M=/^[#\/]|\s+$/g,_=/^\/+|\/+$/g,D=/msie [\w.]+/,P=/\/$/;O.started=!1,u.extend(O.prototype,a,{interval:50,getHash:function(e){var t=(e||this).location.href.match(/#(.*)$/);return t?t[1]:""},getFragment:function(e,t){if(e==null)if(this._hasPushState||!this._wantsHashChange||t){e=this.location.pathname;var n=this.root.replace(P,"");e.indexOf(n)||(e=e.substr(n.length))}else e=this.getHash();return e.replace(M,"")},start:function(e){if(O.started)throw new Error("Backbone.history has already been started");O.started=!0,this.options=u.extend({},{root:"/"},this.options,e),this.root=this.options.root,this._wantsHashChange=this.options.hashChange!==!1,this._wantsPushState=!!this.options.pushState,this._hasPushState=!!(this.options.pushState&&this.history&&this.history.pushState);var t=this.getFragment(),n=document.documentMode,r=D.exec(navigator.userAgent.toLowerCase())&&(!n||n<=7);this.root=("/"+this.root+"/").replace(_,"/"),r&&this._wantsHashChange&&(this.iframe=o.$('<iframe src="javascript:0" tabindex="-1" />').hide().appendTo("body")[0].contentWindow,this.navigate(t)),this._hasPushState?o.$(window).on("popstate",this.checkUrl):this._wantsHashChange&&"onhashchange"in window&&!r?o.$(window).on("hashchange",this.checkUrl):this._wantsHashChange&&(this._checkUrlInterval=setInterval(this.checkUrl,this.interval)),this.fragment=t;var i=this.location,s=i.pathname.replace(/[^\/]$/,"$&/")===this.root;if(this._wantsHashChange&&this._wantsPushState&&!this._hasPushState&&!s)return this.fragment=this.getFragment(null,!0),this.location.replace(this.root+this.location.search+"#"+this.fragment),!0;this._wantsPushState&&this._hasPushState&&s&&i.hash&&(this.fragment=this.getHash().replace(M,""),this.history.replaceState({},document.title,this.root+this.fragment+i.search));if(!this.options.silent)return this.loadUrl()},stop:function(){o.$(window).off("popstate",this.checkUrl).off("hashchange",this.checkUrl),clearInterval(this._checkUrlInterval),O.started=!1},route:function(e,t){this.handlers.unshift({route:e,callback:t})},checkUrl:function(e){var t=this.getFragment();t===this.fragment&&this.iframe&&(t=this.getFragment(this.getHash(this.iframe)));if(t===this.fragment)return!1;this.iframe&&this.navigate(t),this.loadUrl()||this.loadUrl(this.getHash())},loadUrl:function(e){var t=this.fragment=this.getFragment(e),n=u.any(this.handlers,function(e){if(e.route.test(t))return e.callback(t),!0});return n},navigate:function(e,t){if(!O.started)return!1;if(!t||t===!0)t={trigger:t};e=this.getFragment(e||"");if(this.fragment===e)return;this.fragment=e;var n=this.root+e;if(this._hasPushState)this.history[t.replace?"replaceState":"pushState"]({},document.title,n);else{if(!this._wantsHashChange)return this.location.assign(n);this._updateHash(this.location,e,t.replace),this.iframe&&e!==this.getFragment(this.getHash(this.iframe))&&(t.replace||this.iframe.document.open().close(),this._updateHash(this.iframe.location,e,t.replace))}t.trigger&&this.loadUrl(e)},_updateHash:function(e,t,n){if(n){var r=e.href.replace(/(javascript:|#).*$/,"");e.replace(r+"#"+t)}else e.hash="#"+t}}),o.history=new O;var H=function(e,t){var n=this,r;e&&u.has(e,"constructor")?r=e.constructor:r=function(){return n.apply(this,arguments)},u.extend(r,n,t);var i=function(){this.constructor=r};return i.prototype=n.prototype,r.prototype=new i,e&&u.extend(r.prototype,e),r.__super__=n.prototype,r};p.extend=m.extend=N.extend=E.extend=O.extend=H;var B=function(){throw new Error('A "url" property or function must be specified')},j=function(e,t){var n=t.error;t.error=function(r){n&&n(e,r,t),e.trigger("error",e,r,t)}}}.call(this),define("backbone",["underscore"],function(e){return function(){var t,n;return t||e.Backbone}}(this)),FastClick.prototype.deviceIsAndroid=navigator.userAgent.indexOf("Android")>0,FastClick.prototype.deviceIsIOS=/iP(ad|hone|od)/.test(navigator.userAgent),FastClick.prototype.deviceIsIOS4=FastClick.prototype.deviceIsIOS&&/OS 4_\d(_\d)?/.test(navigator.userAgent),FastClick.prototype.deviceIsIOSWithBadTarget=FastClick.prototype.deviceIsIOS&&/OS ([6-9]|\d{2})_\d/.test(navigator.userAgent),FastClick.prototype.needsClick=function(e){switch(e.nodeName.toLowerCase()){case"button":case"select":case"textarea":if(e.disabled)return!0;break;case"input":if(this.deviceIsIOS&&e.type==="file"||e.disabled)return!0;break;case"label":case"video":return!0}return/\bneedsclick\b/.test(e.className)},FastClick.prototype.needsFocus=function(e){switch(e.nodeName.toLowerCase()){case"textarea":case"select":return!0;case"input":switch(e.type){case"button":case"checkbox":case"file":case"image":case"radio":case"submit":return!1}return!e.disabled&&!e.readOnly;default:return/\bneedsfocus\b/.test(e.className)}},FastClick.prototype.sendClick=function(e,t){var n,r;document.activeElement&&document.activeElement!==e&&document.activeElement.blur(),r=t.changedTouches[0],n=document.createEvent("MouseEvents"),n.initMouseEvent("click",!0,!0,window,1,r.screenX,r.screenY,r.clientX,r.clientY,!1,!1,!1,!1,0,null),n.forwardedTouchEvent=!0,e.dispatchEvent(n)},FastClick.prototype.focus=function(e){var t;this.deviceIsIOS&&e.setSelectionRange?(t=e.value.length,e.setSelectionRange(t,t)):e.focus()},FastClick.prototype.updateScrollParent=function(e){var t,n;t=e.fastClickScrollParent;if(!t||!t.contains(e)){n=e;do{if(n.scrollHeight>n.offsetHeight){t=n,e.fastClickScrollParent=n;break}n=n.parentElement}while(n)}t&&(t.fastClickLastScrollTop=t.scrollTop)},FastClick.prototype.getTargetElementFromEventTarget=function(e){return e.nodeType===Node.TEXT_NODE?e.parentNode:e},FastClick.prototype.onTouchStart=function(e){var t,n,r;if(e.targetTouches.length>1)return!0;t=this.getTargetElementFromEventTarget(e.target),n=e.targetTouches[0];if(this.deviceIsIOS){r=window.getSelection();if(r.rangeCount&&!r.isCollapsed)return!0;if(!this.deviceIsIOS4){if(n.identifier===this.lastTouchIdentifier)return e.preventDefault(),!1;this.lastTouchIdentifier=n.identifier,this.updateScrollParent(t)}}return this.trackingClick=!0,this.trackingClickStart=e.timeStamp,this.targetElement=t,this.touchStartX=n.pageX,this.touchStartY=n.pageY,e.timeStamp-this.lastClickTime<200&&e.preventDefault(),!0},FastClick.prototype.touchHasMoved=function(e){var t=e.changedTouches[0],n=this.touchBoundary;return Math.abs(t.pageX-this.touchStartX)>n||Math.abs(t.pageY-this.touchStartY)>n?!0:!1},FastClick.prototype.findControl=function(e){return e.control!==undefined?e.control:e.htmlFor?document.getElementById(e.htmlFor):e.querySelector("button, input:not([type=hidden]), keygen, meter, output, progress, select, textarea")},FastClick.prototype.onTouchEnd=function(e){var t,n,r,i,s,o=this.targetElement;this.touchHasMoved(e)&&(this.trackingClick=!1,this.targetElement=null);if(!this.trackingClick)return!0;if(e.timeStamp-this.lastClickTime<200)return this.cancelNextClick=!0,!0;this.lastClickTime=e.timeStamp,n=this.trackingClickStart,this.trackingClick=!1,this.trackingClickStart=0,this.deviceIsIOSWithBadTarget&&(s=e.changedTouches[0],o=document.elementFromPoint(s.pageX-window.pageXOffset,s.pageY-window.pageYOffset)||o,o.fastClickScrollParent=this.targetElement.fastClickScrollParent),r=o.tagName.toLowerCase();if(r==="label"){t=this.findControl(o);if(t){this.focus(o);if(this.deviceIsAndroid)return!1;o=t}}else if(this.needsFocus(o)){if(e.timeStamp-n>100||this.deviceIsIOS&&window.top!==window&&r==="input")return this.targetElement=null,!1;this.focus(o);if(!this.deviceIsIOS4||r!=="select")this.targetElement=null,e.preventDefault();return!1}if(this.deviceIsIOS&&!this.deviceIsIOS4){i=o.fastClickScrollParent;if(i&&i.fastClickLastScrollTop!==i.scrollTop)return!0}return this.needsClick(o)||(e.preventDefault(),this.sendClick(o,e)),!1},FastClick.prototype.onTouchCancel=function(){this.trackingClick=!1,this.targetElement=null},FastClick.prototype.onMouse=function(e){return this.targetElement?e.forwardedTouchEvent?!0:e.cancelable?!this.needsClick(this.targetElement)||this.cancelNextClick?(e.stopImmediatePropagation?e.stopImmediatePropagation():e.propagationStopped=!0,e.stopPropagation(),e.preventDefault(),!1):!0:!0:!0},FastClick.prototype.onClick=function(e){var t;return this.trackingClick?(this.targetElement=null,this.trackingClick=!1,!0):e.target.type==="submit"&&e.detail===0?!0:(t=this.onMouse(e),t||(this.targetElement=null),t)},FastClick.prototype.destroy=function(){var e=this.layer;this.deviceIsAndroid&&(e.removeEventListener("mouseover",this.onMouse,!0),e.removeEventListener("mousedown",this.onMouse,!0),e.removeEventListener("mouseup",this.onMouse,!0)),e.removeEventListener("click",this.onClick,!0),e.removeEventListener("touchstart",this.onTouchStart,!1),e.removeEventListener("touchend",this.onTouchEnd,!1),e.removeEventListener("touchcancel",this.onTouchCancel,!1)},FastClick.notNeeded=function(e){var t;if(typeof window.ontouchstart=="undefined")return!0;if(/Chrome\/[0-9]+/.test(navigator.userAgent)){if(!FastClick.prototype.deviceIsAndroid)return!0;t=document.querySelector("meta[name=viewport]");if(t&&t.content.indexOf("user-scalable=no")!==-1)return!0}return e.style.msTouchAction==="none"?!0:!1},FastClick.attach=function(e){return new FastClick(e)},typeof define!="undefined"&&define.amd?define("fastclick",[],function(){return FastClick}):typeof module!="undefined"&&module.exports?(module.exports=FastClick.attach,module.exports.FastClick=FastClick):window.FastClick=FastClick,define("text",["module"],function(e){var t,n,r,i,s,o=["Msxml2.XMLHTTP","Microsoft.XMLHTTP","Msxml2.XMLHTTP.4.0"],u=/^\s*<\?xml(\s)+version=[\'\"](\d)*.(\d)*[\'\"](\s)*\?>/im,a=/<body[^>]*>\s*([\s\S]+)\s*<\/body>/im,f=typeof location!="undefined"&&location.href,l=f&&location.protocol&&location.protocol.replace(/\:/,""),c=f&&location.hostname,h=f&&(location.port||undefined),p={},d=e.config&&e.config()||{};t={version:"2.0.10",strip:function(e){if(e){e=e.replace(u,"");var t=e.match(a);t&&(e=t[1])}else e="";return e},jsEscape:function(e){return e.replace(/(['\\])/g,"\\$1").replace(/[\f]/g,"\\f").replace(/[\b]/g,"\\b").replace(/[\n]/g,"\\n").replace(/[\t]/g,"\\t").replace(/[\r]/g,"\\r").replace(/[\u2028]/g,"\\u2028").replace(/[\u2029]/g,"\\u2029")},createXhr:d.createXhr||function(){var e,t,n;if(typeof XMLHttpRequest!="undefined")return new XMLHttpRequest;if(typeof ActiveXObject!="undefined")for(t=0;t<3;t+=1){n=o[t];try{e=new ActiveXObject(n)}catch(r){}if(e){o=[n];break}}return e},parseName:function(e){var t,n,r,i=!1,s=e.indexOf("."),o=e.indexOf("./")===0||e.indexOf("../")===0;return s!==-1&&(!o||s>1)?(t=e.substring(0,s),n=e.substring(s+1,e.length)):t=e,r=n||t,s=r.indexOf("!"),s!==-1&&(i=r.substring(s+1)==="strip",r=r.substring(0,s),n?n=r:t=r),{moduleName:t,ext:n,strip:i}},xdRegExp:/^((\w+)\:)?\/\/([^\/\\]+)/,useXhr:function(e,n,r,i){var s,o,u,a=t.xdRegExp.exec(e);return a?(s=a[2],o=a[3],o=o.split(":"),u=o[1],o=o[0],(!s||s===n)&&(!o||o.toLowerCase()===r.toLowerCase())&&(!u&&!o||u===i)):!0},finishLoad:function(e,n,r,i){r=n?t.strip(r):r,d.isBuild&&(p[e]=r),i(r)},load:function(e,n,r,i){if(i.isBuild&&!i.inlineText){r();return}d.isBuild=i.isBuild;var s=t.parseName(e),o=s.moduleName+(s.ext?"."+s.ext:""),u=n.toUrl(o),a=d.useXhr||t.useXhr;if(u.indexOf("empty:")===0){r();return}!f||a(u,l,c,h)?t.get(u,function(n){t.finishLoad(e,s.strip,n,r)},function(e){r.error&&r.error(e)}):n([o],function(e){t.finishLoad(s.moduleName+"."+s.ext,s.strip,e,r)})},write:function(e,n,r,i){if(p.hasOwnProperty(n)){var s=t.jsEscape(p[n]);r.asModule(e+"!"+n,"define(function () { return '"+s+"';});\n")}},writeFile:function(e,n,r,i,s){var o=t.parseName(n),u=o.ext?"."+o.ext:"",a=o.moduleName+u,f=r.toUrl(o.moduleName+u)+".js";t.load(a,r,function(n){var r=function(e){return i(f,e)};r.asModule=function(e,t){return i.asModule(e,f,t)},t.write(e,a,r,s)},s)}};if(d.env==="node"||!d.env&&typeof process!="undefined"&&process.versions&&!!process.versions.node&&!process.versions["node-webkit"])n=require.nodeRequire("fs"),t.get=function(e,t,r){try{var i=n.readFileSync(e,"utf8");i.indexOf("﻿")===0&&(i=i.substring(1)),t(i)}catch(s){r(s)}};else if(d.env==="xhr"||!d.env&&t.createXhr())t.get=function(e,n,r,i){var s=t.createXhr(),o;s.open("GET",e,!0);if(i)for(o in i)i.hasOwnProperty(o)&&s.setRequestHeader(o.toLowerCase(),i[o]);d.onXhr&&d.onXhr(s,e),s.onreadystatechange=function(t){var i,o;s.readyState===4&&(i=s.status,i>399&&i<600?(o=new Error(e+" HTTP status: "+i),o.xhr=s,r(o)):n(s.responseText),d.onXhrComplete&&d.onXhrComplete(s,e))},s.send(null)};else if(d.env==="rhino"||!d.env&&typeof Packages!="undefined"&&typeof java!="undefined")t.get=function(e,t){var n,r,i="utf-8",s=new java.io.File(e),o=java.lang.System.getProperty("line.separator"),u=new java.io.BufferedReader(new java.io.InputStreamReader(new java.io.FileInputStream(s),i)),a="";try{n=new java.lang.StringBuffer,r=u.readLine(),r&&r.length()&&r.charAt(0)===65279&&(r=r.substring(1)),r!==null&&n.append(r);while((r=u.readLine())!==null)n.append(o),n.append(r);a=String(n.toString())}finally{u.close()}t(a)};else if(d.env==="xpconnect"||!d.env&&typeof Components!="undefined"&&Components.classes&&Components.interfaces)r=Components.classes,i=Components.interfaces,Components.utils["import"]("resource://gre/modules/FileUtils.jsm"),s="@mozilla.org/windows-registry-key;1"in r,t.get=function(e,t){var n,o,u,a={};s&&(e=e.replace(/\//g,"\\")),u=new FileUtils.File(e);try{n=r["@mozilla.org/network/file-input-stream;1"].createInstance(i.nsIFileInputStream),n.init(u,1,0,!1),o=r["@mozilla.org/intl/converter-input-stream;1"].createInstance(i.nsIConverterInputStream),o.init(n,"utf-8",n.available(),i.nsIConverterInputStream.DEFAULT_REPLACEMENT_CHARACTER),o.readString(n.available(),a),o.close(),n.close(),t(a.value)}catch(f){throw new Error((u&&u.path||"")+": "+f)}};return t}),function(){function t(e,t,n,r,i,s){t[e]&&(n.push(e),(t[e]===!0||t[e]===1)&&r.push(i+e+"/"+s))}function n(e,t,n,r,i){var s=r+t+"/"+i;require._fileExists(e.toUrl(s+".js"))&&n.push(s)}function r(e,t,n){var i;for(i in t)t.hasOwnProperty(i)&&(!e.hasOwnProperty(i)||n)?e[i]=t[i]:typeof t[i]=="object"&&(e[i]||(e[i]={}),r(e[i],t[i],n))}var e=/(^.*(^|\/)nls(\/|$))([^\/]*)\/?([^\/]*)/;define("i18n",["module"],function(i){var s=i.config?i.config():{};return{version:"2.0.3",load:function(i,o,u,a){a=a||{},a.locale&&(s.locale=a.locale);var f,l=e.exec(i),c=l[1],h=l[4],p=l[5],d=h.split("-"),v=[],m={},g,y,b="";l[5]?(c=l[1],f=c+p):(f=i,p=l[4],h=s.locale,h||(h=s.locale=typeof navigator=="undefined"?"root":(navigator.language||navigator.userLanguage||"root").toLowerCase()),d=h.split("-"));if(a.isBuild){v.push(f),n(o,"root",v,c,p);for(g=0;g<d.length;g++)y=d[g],b+=(b?"-":"")+y,n(o,b,v,c,p);o(v,function(){u()})}else o([f],function(e){var n=[],i;t("root",e,n,v,c,p);for(g=0;g<d.length;g++)i=d[g],b+=(b?"-":"")+i,t(b,e,n,v,c,p);o(v,function(){var t,i,s;for(t=n.length-1;t>-1&&n[t];t--){s=n[t],i=e[s];if(i===!0||i===1)i=o(c+s+"/"+p);r(m,i)}u(m)})})}}})}(),define("core/mainview",["backbone"],function(e){return e.View.extend({el:"body",currentView:null,changePage:function(e,t){t&&!e.module&&(e.module=t),e.container=this;var n=e.render().el;this.currentView&&this.currentView.remove(),document.body.appendChild(n),this.currentView=e,"onShow"in e&&e.onShow()}})}),define("core/cocrouter",["require","backbone","core/mainview"],function(e,t,n){var r=t.Router.extend({urls:[],routes:{"":"index","*module/*page(?t=:timestamp)":"modularRoute","*page(?t=:timestamp)":"pageRoute"},initialize:function(e){var t=this;this.delegate=e.delegate,this.loadMode=pieceConfig.loadMode,this.defaultModule=pieceConfig.defaultModule,this.defaultView=pieceConfig.defaultView,this.enablePad=pieceConfig.enablePad},index:function(){this.modularRoute(this.defaultModule,this.defaultView)},_loadViewByApp:function(t,n,r,i){e([t+"/"+n],function(e){var n=new e;n.module=t,r(n)},function(e){i(e)})},_loadViewByModule:function(t,n,r,i,s){e([t+"/"+n],function(e){var n;r===null||r===""?n=e["default"]:n=e[r];var s=new n;s.module=t,i(s)},function(e){s(e)})},_loadViewByView:function(t,n,r,i){e([t+"/"+n],function(e){var n=new e;n.module=t,r(n)},function(e){i(e)})},modularRoute:function(t,n,r){function u(e){e.type=="portal"?e.render():i.delegate.changePage(e,t)}function a(e){console.log("cube---cocrouter---load fail: "+e.message)}console.info("cube---cocrouter---modularRoute--"+t+"/"+n+"/"+r);var i=this,s,o;switch(this.loadMode){case"app":throw new Error("app scope router not implement yet");case"module":console.info("cube---cocrouter---load by module"),this.enablePad==="true"?(console.info("cube---cocrouter---enablePad === true"),s=e.defined(t+"/module"),o="module"):(s=e.defined(t+"/module"),o="module",!s),this._loadViewByModule(t,o,n,u,a);break;case"view":console.info("cube---cocrouter---load by view");var s=e.defined(t+"/"+n);!s,this._loadViewByView(t,n,u,a);break;default:throw new Error("missing loadMode")}},pageRoute:function(e,t){console.log("page route to:"+e)}});return r}),define("core/app",["zepto","backbone","core/mainview","core/cocrouter"],function(e,t,n,r){var i=function(i){var s=new n,o=new r({delegate:s}),u=window.location.pathname.substr(0,window.location.pathname.lastIndexOf("/"));console.info("cube---app---start watch history, rootPath: "+u),t.history.start({pushState:!1,root:u}),e("#appLoadingIndicator").remove(),e("body,html").css("background-color","white")};return{initialize:i}});var defaultConfig={loadFrom:"root",defaultModule:null,defaultView:null,loadMode:"view",enablePad:!1,hideAddressBar:!0},pieceConfig;typeof pieceConfig=="undefined"&&(pieceConfig=new Object),pieceConfig.loadFrom!=="module"?require.config({baseUrl:"."}):require.config({baseUrl:"../"}),require.config({paths:{text:"src/vendor/requirejs-text/js/text",domReady:"src/vendor/requirejs-domready/js/domready",i18n:"src/vendor/requirejs-i18n/js/i18n",zepto:"src/vendor/zepto/js/zepto",underscore:"src/vendor/underscore/js/underscore",backbone:"src/vendor/backbone/js/backbone",fastclick:"src/vendor/fastclick/js/fastclick",vendor:"src/vendor",core:"src/core"},shim:{backbone:{deps:["underscore"],exports:"Backbone"},zepto:{exports:"$"},underscore:{exports:"_"},fastclick:{exports:"FastClick"}}}),window.localStorage.lang===undefined&&(window.localStorage.lang="zh-cn"),requirejs.config({config:{i18n:{locale:window.localStorage.lang}}}),function(){require(["zepto","underscore","backbone","fastclick","text","i18n","core/app"],function(e,t,n,r,i,s,o){pieceConfig=t.extend(defaultConfig,pieceConfig),r.attach(document.body),o.initialize()})}(),define("src/core/piece.js",function(){});