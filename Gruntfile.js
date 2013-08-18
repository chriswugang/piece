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
			src: {
				files: [{
					expand: true,
					cwd: 'src/',
					src: ['js/**', 'images/**'],
					dest: 'dist/'
				}]
			},
			sass: {
				files: [{
					expand: true,
					flatten: true,
					filter: 'isFile',
					src: ['temp/css/piece.css'],
					dest: 'dist/css/'
				}]
			},
			examples: {
				files: [{
					expand: true,
					cwd: 'dist/',
					src: ['**'],
					dest: 'examples/piece/'
				}]
			}
		},
		rename: {
			pieceInExamples: {
				src: 'examples/dist/',
				dest: 'examples/piece'
			}
		},

		//claen the dist before copy & compile files
		clean: {
			dist: ["dist/"],
			examples: ["examples/piece"],
			cache: [".sass-cache/", "temp/"]
		},
		requirejs: {
			piece: {
				options: {
					baseUrl: ".",
					mainConfigFile: "config.js",
					name: "dist/js/piece.js",
					out: "dist/js/piece.js",
					wrap: false,
					locale: "zh-cn"
				}
			}
		},
		concat: {
			options: {
				separator: ';',
			},
			pieceDebug: {
				src: ['src/js/vendor/requirejs/js/require.js', 'dist/js/piece-debug.js'],
				dest: 'dist/js/piece-debug.js',
			},
			piece: {
				src: ['src/js/vendor/requirejs/js/require.js', 'dist/js/piece.js'],
				dest: 'dist/js/piece.js',
			}
		},

		compass: { // Task
			dist: { // Target
				options: { // Target options
					sassDir: 'src/sass',
					cssDir: 'temp/css',
					environment: 'production'
				}
			}
		},
		uglify: {
			options: {
				mangle: true,
				beautify:false
			},
			piece: {
				files: {
					'dist/js/piece.js': ['dist/js/piece.js']
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
	grunt.loadNpmTasks('grunt-rename');


	grunt.registerTask('clean-builded', ['clean:dist', 'clean:examples']);
	grunt.registerTask('build-sass', ['compass:dist', 'copy:sass']);
	grunt.registerTask('build-piece', ['copy:src', 'requirejs:piece', 'concat:piece', 'concat:pieceDebug', 'uglify:piece']);
	grunt.registerTask('build-examples', ['copy:examples']);
	grunt.registerTask('clean-cache', ['clean:cache']);

	grunt.registerTask('default', ['clean-builded', 'build-sass', 'build-piece', 'build-examples', 'clean-cache']);

};