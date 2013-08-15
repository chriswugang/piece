#!/usr/bin/env node

var program 	= require('commander'),
		color 		= require('./clicolors'),
		path      = require('path'),
		pkg       = require('../package.json'),
  	version   = pkg.version;

var ServerProgram	= require('./server');
var ChromeProgram	= require('./chrome');
var ScafflodProgram	= require('./scaffold');

program
	.command('info')
	.description('print framework info')
	.action(function(){
		console.log(color.blue + 'piece.js v' + version + color.reset);
	  console.log(color.blue + 'current path: %s' + color.reset, path.resolve('.'));
	  console.log(color.blue + '    sdk path: %s' + color.reset, path.resolve(__dirname));
	});

//加载模块
ServerProgram(program);
ChromeProgram(program);
ScafflodProgram(program);

program.parse(process.argv);