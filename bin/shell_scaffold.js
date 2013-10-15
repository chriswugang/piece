var mkdirp = require('mkdirp'),
	path = require('path'),
	fs = require('fs'),
	ncp = require('ncp').ncp,
	template = require('./template'),
	color = require('./clicolors');

module.exports = function(app) {

	app.cmd('create :app', "Create a Piece project", function (req, res, next){

		var name = req.params.app;

	  var app_fullpath = path.resolve('.', name);

		if (fs.existsSync(app_fullpath)) {
			res.red('folder not empty. Project alredy exist.').ln();
			res.prompt();
			return;
		}

		//create project folder
		res.ln();
		mkdir(app_fullpath, function() {

			//copy Gruntfile
			template('Gruntfile.js', path.resolve('.', app_fullpath, 'Gruntfile.js'));

			//copy package
			template('package.json', path.resolve('.', app_fullpath, 'package.json'));

			//copy framework from sdk to project folder
			cp(path.resolve(__dirname, '..', 'dist'), path.resolve(app_fullpath, 'piece'), function() {
				// res.ln().magenta('['+ name +'] created.').ln();
				process.chdir(name);
				app.settings.prompt = "[" + name + "] $ ";
				res.prompt();
			});
		});
	  
	});

	app.cmd('module :module', "Create a Module", function(req, res, next){

		var name = req.params.module;

		//判断是否piece工程
		if(!app.isPieceProject()){
			res.red('Working folder is not a piece.js project, Abort.').ln();
			res.prompt();
			return;
		}

		//判断模块是否已经存在
		var module_path = path.resolve('.', name);
		if (fs.existsSync(module_path)) {
			res.red('Module exists, Abort.').ln();
			res.prompt();
			return;
		}

		mkdir(path.resolve('.', name), function() {
			template('portalview.html', path.resolve('.', name, 'index.html'), {
				module: name,
				view: 'index'
			});
			template('portalview.js', path.resolve('.', name, 'index.js'), {
				module: name,
				view: 'index'
			});

			res.prompt();
		}); //mkdir
	});

	app.cmd('view :module :view', 'Create a Views', function(req, res, next){

		var name = req.params.module;
		var view = req.params.view;

		if(!app.isPieceProject()){
			res.red('Working folder is not a piece.js project, Abort.').ln();
			res.prompt();
			return;
		}

		//判断模块是否已经存在（创建视图前，模块必须存在）
		var module_path = path.resolve('.', name);
		if (!fs.existsSync(module_path)) {
			res.red('Module not exist, Abort.').ln();
			res.prompt();
			return;
		}

		template('view.html', path.resolve('.', name, view + '.html'), {
			module: name,
			view: view
		});

		template('view.js', path.resolve('.', name, view + '.js'), {
			module: name,
			view: view
		});

		res.prompt();
	});
};

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