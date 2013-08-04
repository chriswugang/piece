#!/usr/bin/env node

var program 	= require('commander'),
	path      	= require('path'),
	pkg       	= require('../package.json'),
  	version   	= pkg.version;

var ServerProgram	= require('./server');
var ChromeProgram	= require('./chrome');

console.log('piece.js v' + version);
console.log('current path: %s', path.resolve('.'));
console.log('sdk path: %s', path.resolve(__dirname));

//加载模块
ServerProgram(program);
ChromeProgram(program);

program.parse(process.argv);