module.exports = function(grunt) {

	grunt.initConfig({
		pkg: grunt.file.readJSON('package.json'),
		stylus: {
			compile: {
				files: {
					'dest/css/piece.css': 'src/stylus/piece.styl'
				}
			}
		},
		bower: {
			install: {
				//just run 'grunt bower:install' and you'll see files from your Bower packages in lib directory
				options: {
					targetDir: './vendor',
					layout: 'byComponent',
					install: true,
					verbose: true,
					cleanTargetDir: true,
					cleanBowerDir: true
				}
			}
		},
	});

	grunt.loadNpmTasks('grunt-contrib-stylus');
	grunt.loadNpmTasks('grunt-contrib-requirejs');
	grunt.loadNpmTasks('grunt-bower-task');

	grunt.registerTask('default', ['stylus', 'bower']);
};