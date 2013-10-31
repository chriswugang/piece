#!/usr/bin/env node

var express     = require('express'),
		path        = require('path'),
		fs					= require('fs')
		_ 					= require('underscore'),
		async				= require('async'),
    AdmZip      = require('adm-zip'),
    rimraf      = require('rimraf')
    util        = require('./util'),
    color       = require('./clicolors');

var app = express();
// app.use(express.cookieParser('secret-piece-js'));
// app.use(express.cookieSession());
app.use(express.static(path.resolve('.')));
app.use(express.static(path.resolve(__dirname, '..', 'debug-server')));

//index page
app.get('/', function(req, res){
	res.redirect('index.html');
});

app.get('/app.zip', function(req, res){
  var debugTempPath = path.resolve('.', '.debug-tmp');

  //remove debug directory
  rimraf(debugTempPath, function(error){
    if(error) throw error;

    //create debug directory
    util.mkdir(debugTempPath, function(error){
      if(error) throw error;

      //read recursively
      fs.readdir(path.resolve('.'), function(err, files){
        //filter '.'
        files = _.reject(files, function(e){return e[0] == '.' || e == 'node_modules'});
        //map to full paths
        // files_full = _.map(files, function(e){return path.resolve('.', e)});
        //add index page
        // files_full.push(path.resolve(__dirname, '..', 'debug-server'));

        console.log('copy module folders: ' + files);
        async.each(files, function(item, callback){
          util.cp(path.resolve('.', item), path.resolve(debugTempPath, item), function(){
            callback(null);
          });
        }, function(err){
          if(err) throw err;

          console.log('copy finish, zip up...');
          var zip = new AdmZip();
          zip.addLocalFolder(debugTempPath);

          console.log('send response');
          res.set("Content-Disposition", "attachment; filename=debug.zip");
          res.set('Content-Type', 'application/zip');
          res.send(zip.toBuffer());
        });//parallel copy
      });//readdir
    });//mkdir
  });//rimraf
});


app.get('/application.json', function(req, res){
	fs.readdir(path.resolve('.'), function(err, files){
		if (err) {throw err};
		
    //remove .
		files = _.reject(files, function(e){return e[0] == '.' });
    //we only take direcotry(module)
    files = _.filter(files, function(e){
      return fs.existsSync(path.resolve('.', e, 'package.json')) 
      //deprecated
      || fs.existsSync(path.resolve('.', e, 'CubeModule.json'))
      && fs.statSync(path.resolve('.', e)).isDirectory();
    });

		configs = _.map(files, function(e){ return path.resolve('.', e, 'package.json'); });

		async.map(configs, fs.readFile, function(err, results){
			if (err) {throw err};

      var arr = _.map(results, function(e){
        return JSON.parse(e);
      });
			res.send({
        "modules": arr
      });
		});

		// res.send(_.object(files, values));
	});
});

app.get('/docs', function(req, res){

});

app.listen(3000);

console.log(color.blue + 'local ip address:' + color.reset);
util.printIPAddress();
console.log('piece.js Server Started, listening at 3000...');