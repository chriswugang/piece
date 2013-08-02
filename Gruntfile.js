module.exports = function(grunt) {

	grunt.initConfig({
		pkg: grunt.file.readJSON('package.json'),
		stylus: {
			files: {
				'dest/css/piece.css': 'src/stylus/ratchet.styl'
			}
		}
	});

	grunt.loadNpmTasks('grunt-contrib-stylus');

	grunt.registerTask('default', ['stylus']);
};