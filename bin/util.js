var mkdirp    = require('mkdirp'),
		path			= require('path'),
		fs				= require('fs'),
		ncp       = require('ncp').ncp;

/**
 * Mkdir -p.
 *
 * @param {String} path
 * @param {Function} fn
 */

function mkdir(path, fn) {
  mkdirp(path, 0755, function(err) {
    if (err) throw err;
    console.log('   \033[36mcreate\033[0m : ' + path);
    fn && fn();
  });
}

/**
 * copy directory recursive
 */

function cp(src, dest, fn) {
  ncp(src, dest, function(err) {
    if (err) throw err;
    console.log('   \033[36mcreate\033[0m : ' + dest);
    fn && fn();
  });
}

module.exports.cp = cp;
module.exports.mkdir = mkdir;