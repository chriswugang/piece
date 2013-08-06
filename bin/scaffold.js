var mkdirp      = require('mkdirp'),
	path		= require('path'),
	fs			= require('fs'),
	ncp         = require('ncp').ncp;

module.exports = function(program){
	
	program
	.command('create <name>')
	.description('create a new application')
	.action(createProject);

	program
	.command('module <name>')
	.description('create module')
	.action(createModule);
};

function createProject(name) {

	var app_fullpath = path.resolve('.', name);

	if(fs.existsSync(path)){
		console.log('folder not empty.');
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
		//todo
	});
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
