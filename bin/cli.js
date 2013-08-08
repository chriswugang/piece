#!/usr/bin/env node

var program 	= require('commander'),
	path      	= require('path'),
	pkg       	= require('../package.json'),
  	version   	= pkg.version;

var red, blue, reset;
red = '\033[31m';
blue = '\033[34m';
reset = '\033[0m';

var ServerProgram	= require('./server');
var ChromeProgram	= require('./chrome');
var ScafflodProgram	= require('./scaffold');

program
  	.command('info')
  	.description('print framework info')
  	.action(function(){
  		console.log(blue + 'piece.js v' + version + reset);
		  console.log(blue + 'current path: %s' + reset, path.resolve('.'));
		  console.log(blue + '    sdk path: %s' + reset, path.resolve(__dirname));
  	});

//加载模块
ServerProgram(program);
ChromeProgram(program);
ScafflodProgram(program);

program.parse(process.argv);