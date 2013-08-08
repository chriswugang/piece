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
		clean: ["dist/", ".sass-cache/"],
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
		},
		concat: {
			options: {
				separator: ';',
			},
			dist: {
				src: ['src/vendor/requirejs/js/require.js', 'dist/js/piece.js'],
				dest: 'dist/js/piece.js',
			},
		},
		compass: { // Task
			dist: { // Target
				options: { // Target options
					sassDir: 'src/sass',
					cssDir: 'dist/css',
					environment: 'production'
				}
			}
		}
	});

	grunt.loadNpmTasks('grunt-contrib-stylus');
	grunt.loadNpmTasks('grunt-contrib-requirejs');
	grunt.loadNpmTasks('grunt-bower-task');
	grunt.loadNpmTasks('grunt-contrib-copy');
	grunt.loadNpmTasks('grunt-contrib-clean');
	grunt.loadNpmTasks('grunt-contrib-concat');
	grunt.loadNpmTasks('grunt-contrib-uglify');

	grunt.loadNpmTasks('grunt-contrib-compass');

	grunt.registerTask('default', ["clean", "compass", 'copy', 'requirejs', 'concat']);
	// grunt.registerTask('default', ["clean", "compass", "bower", 'copy', 'requirejs', 'concat']);

	// grunt.registerTask('default', ["requirejs"]);

};