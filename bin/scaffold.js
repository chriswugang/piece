var mkdirp      = require('mkdirp'),
	path		= require('path'),
	fs			= require('fs'),
	ncp         = require('ncp').ncp,
	template	= require('./template');

var red, blue, reset;
red = '\033[31m';
blue = '\033[34m';
reset = '\033[0m';

module.exports = function(program){
	
	program
	.command('create <name>')
	.description('create a new application')
	.action(createProject);

	program
	.command('module <name>')
	.description('create module')
	.action(createModule);

	program
	.command('view <module> <name>')
	.description('create view')
	.action(createView);
};

function createProject(name) {

	var app_fullpath = path.resolve('.', name);

	if(fs.existsSync(app_fullpath)){
		console.log(red + 'folder not empty.' + reset);
		return;
	}
	//create project folder
	mkdir(app_fullpath, function() {
		//copy framework from sdk to project folder
		cp(path.resolve(__dirname, '..', 'dist'), path.resolve(app_fullpath, 'piece'), function(){

			console.log('%s created.', name);
		});
	});
}

function createModule(name) {
	mkdir(path.resolve('.', name), function() {
		template('portalview.html', path.resolve('.', name, 'index.html'), {module: name, view: 'index'});
		template('portalview.js', path.resolve('.', name, 'index.js'), {module: name, view: 'index'});
	});
}

function createView (module, view) {

	template('view.html', path.resolve('.', name, view + '.html'), {module: name, view: view});
	template('view.js', path.resolve('.', name, view + '.js'), {module: name, view: view});
}

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
    console.log('    \033[36m copy\033[0m : %s \033[36mto\033[0m : %s', src, dest);
    fn && fn();
  });
}
