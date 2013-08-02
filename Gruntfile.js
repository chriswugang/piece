module.exports = function(grunt) {

	grunt.initConfig({
		pkg: grunt.file.readJSON('package.json'),
		stylus: {
			compile: {
				files: {
					'dest/css/piece.css': 'src/stylus/piece.styl' 
				}
			}
		}
	});

	grunt.loadNpmTasks('grunt-contrib-stylus');
	grunt.loadNpmTasks('grunt-contrib-requirejs');

	grunt.registerTask('default', ['stylus']);
};