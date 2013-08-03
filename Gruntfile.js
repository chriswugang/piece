module.exports = function(grunt) {

	grunt.initConfig({
		pkg: grunt.file.readJSON('package.json'),
		stylus: {
			compile: {
				files: {
					'dist/css/piece.css': 'src/stylus/piece.styl'
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
		//copy the src/images and vendor to dist
		copy: {
			main: {
				files: [{
					expand: true,
					flatten: true,
					filter: 'isFile',
					src: ['src/images/**'],
					dest: 'dist/images/'
				}]
			}
		},
		//claen the dist folder before copy & compile files
		clean: ["dist/"]
	});

	grunt.loadNpmTasks('grunt-contrib-stylus');
	grunt.loadNpmTasks('grunt-contrib-requirejs');
	grunt.loadNpmTasks('grunt-bower-task');
	grunt.loadNpmTasks('grunt-contrib-copy');
	grunt.loadNpmTasks('grunt-contrib-clean');

	grunt.registerTask('default', ["stylus", "bower", "clean", 'copy']);
};