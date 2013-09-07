var express     = require('express'),
		path        = require('path'),
		fs					= require('fs')
		_ 					= require('underscore'),
		async				= require('async'),
    AdmZip      = require('adm-zip'),
    rimraf      = require('rimraf')
    util        = require('./util');

module.exports = function(program){
	program
  	.command('server')
  	.description('run a http server at port 3000')
  	.action(runServer);
};

function runServer() {
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
          files = _.reject(files, function(e){return e[0] == '.'});
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
          });
        });
      });
    });


  });
  //
  app.get('/packages.json', function(req, res){
  	fs.readdir(path.resolve('.'), function(err, files){
  		if (err) {throw err};
  		
  		files = _.reject(files, function(e){return e[0] == '.'});
  		configs = _.map(files, function(e){return path.resolve('.', e, 'package.json')});
  		async.map(configs, fs.readFile, function(err, results){
  			if (err) {throw err};
  			res.send(_.map(results, function(e){
  				return JSON.parse(e);
  			}));
  		});

  		// res.send(_.object(files, values));
  	});
  });
  app.get('/packages/:name', function(req, res){
    //zip and send file
  });
  app.listen(3000);
  console.log('piece.js Server Started, listening at 3000...');
}