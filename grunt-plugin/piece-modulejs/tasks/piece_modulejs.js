/*
 * grunt-piece-modulejs
 * https://github.com/yezhiming/piece
 *
 * Copyright (c) 2013 juno5460
 * Licensed under the MIT license.
 */

'use strict';

module.exports = function(grunt) {

    var fs = require('fs');
    var path = require('path');

    function generateModuleJs(dirpath, excludefile) {
        var moduleHead = "define(function(require) {\n";
        var moduleEnd = "});";
        var i = 1;
        var moduleRequireContent = "";
        var moduleReturnContent = "     return {\n";
        var flist = fs.readdirSync(dirpath);
        flist.forEach(function(filename) {
            var flistItemPath = dirpath + "/" + filename;
            if ((!fs.statSync(flistItemPath).isDirectory()) && (!grunt.util._.contains(excludefile, flistItemPath))) {
                var extname = path.extname(flistItemPath);
                var name = path.basename(flistItemPath, extname);
                var abspath = dirpath + "/" + name;
                if (extname !== ".js") {
                    return false;
                } else if (filename === "module.js" || filename === "modulePad.js") {
                    return false;
                } else {
                    moduleRequireContent = moduleRequireContent + "     var v" + i + " = require('" + abspath + "');\n";
                    moduleReturnContent = moduleReturnContent + "         '" + name + "': v" + i + ",\n";
                }
                i++;
            }
        });

        moduleReturnContent = moduleReturnContent.substring(0, moduleReturnContent.length - 2) + "\n      };\n";
        grunt.file.write(dirpath + "/" + "module.js", moduleHead + moduleRequireContent + moduleReturnContent + moduleEnd);
    }

    var detectDestType = function(dest) {
        if (grunt.util._.endsWith(dest, '/')) {
            return 'directory';
        } else {
            return 'file';
        }
    };

    grunt.registerMultiTask('piece_modulejs', 'generate modulejs file', function() {

        var options = this.options({
            mode: "module",
            exclude: []
        });

        //如果是project模式，则遍历当前所有文件夹，下面的所有js文件
        if (options.mode === "project") {
            var flist = fs.readdirSync("./");
            flist.forEach(function(filename) {
                if (fs.statSync(filename).isDirectory()) {
                    if (!grunt.util._.contains(options.exclude, filename)) {
                        generateModuleJs(filename, options.exclude);
                    }
                }
            });
        } else {
            // Iterate over all specified file groups.
            this.files.forEach(function(f) {
                var src = f.src.filter(function(dirpath) {
                    if (f.exclude === undefined) {
                        f.exclude = [];
                    }
                    generateModuleJs(dirpath, f.exclude);
                });
            });
        }

    });
};