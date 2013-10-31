#!/usr/bin/env node

var shell = require('shell');
var path = require('path');
var fs = require('fs');
var util = require('./shell_util');
var pkg = require('../package.json'),
    version = pkg.version;

// console.log('__dirname: ' + __dirname);
// console.log('.: ' + path.resolve('.'));

// console.log(process.pid);

// Initialization
var app = new shell( { /*chdir: __dirname,*/ prompt: "Piece.js" + " $ " } );

// Middleware registration
app.configure(function() {
    app.use(function(req, res, next){
        // app.client = require('redis').createClient()
        next();
    });
    // app.use(shell.history({
    //     shell: app
    // }));
    app.use(shell.completer({
        shell: app
    }));
    app.use(shell.router({
        shell: app
    }));
    app.use(shell.help({
        shell: app,
        introduction: true
    }));
});

/*
 * 判断是否Piece的工程
 */
app.isPieceProject = function(){
  var piece_in_app = path.resolve('piece');
  var json = path.resolve('package.json');
  var grunt = path.resolve('Gruntfile.js');
  return fs.existsSync(piece_in_app) && fs.existsSync(json) && fs.existsSync(grunt);
}

// 如果是piece工程，prompt切换为工程名
if (app.isPieceProject()) {
  var projectInfo = require(path.resolve('.', 'package.json'));
  var projectName = projectInfo.name;
  app.styles.magenta('Current folder was identified as a Piece.js project...').ln();
  app.settings.prompt = "[" + projectName + "] $ ";
}

var ScafflodShell = require('./shell_scaffold');
var ChromeShell = require('./shell_chrome');
var ServerShell = require('./shell_server');

ScafflodShell(app);
ChromeShell(app);
ServerShell(app);

app.cmd('update piece', 'update piece framework', function(req, res){
  
});

app.cmd('info', 'print env info', function(req, res){
  res.cyan('piece.js v' + version).ln();
  res.cyan('current path: ' + path.resolve('.')).ln();
  res.cyan('    sdk path: ' + path.resolve(__dirname)).ln();
  util.printIPAddress(res);
  res.prompt();
});

// Event notification
app.on('quit', function(){
  if (app.isShell) {
    ServerShell.quit();
    app.styles.cyan("bye~" + process.pid).ln();
  };
});