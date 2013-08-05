var mkdirp      = require('mkdirp');

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