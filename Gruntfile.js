module.exports = function(grunt) {

	grunt.initConfig({
		pkg: grunt.file.readJSON('package.json'),
		//compile stylus to css
		stylus: {
			compile: {
				files: {
					'dist/css/piece.css': 'src/stylus/piece.styl'
				}
			}
		},
		//just run 'grunt bower:install' and you'll see files from your Bower packages in lib directory
		bower: {
			install: {
				options: {
					targetDir: 'src/vendor',
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
		//claen the dist before copy & compile files
		clean: ["dist/"],
		requirejs: {
			compile: {
				options: {
					baseUrl: ".",
					mainConfigFile: "config.js",
					name: "src/core/piece.js",
					out: "dist/js/piece.js",
					wrap: false
				}
			}
		}
	});

	grunt.loadNpmTasks('grunt-contrib-stylus');
	grunt.loadNpmTasks('grunt-contrib-requirejs');
	grunt.loadNpmTasks('grunt-bower-task');
	grunt.loadNpmTasks('grunt-contrib-copy');
	grunt.loadNpmTasks('grunt-contrib-clean');

	grunt.registerTask('default', ["clean", "stylus", "bower", 'copy', 'requirejs']);
	// grunt.registerTask('default', ["requirejs"]);

};