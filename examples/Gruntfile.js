/*global module:false*/
module.exports = function(grunt) {

  // Project configuration.
  grunt.initConfig({
    // Metadata.
    pkg: grunt.file.readJSON('package.json'),
    clean: {
      archive: ["archive/"],
      dist: ["dist/"]
    },
    compress: {
      flight: {
        options: {
          archive: 'archive/flight.zip'
        },
        expand: true,
        cwd: 'flight/',
        src: ['**']
      },
      portal: {
        options: {
          archive: 'archive/portal.zip'
        },
        expand: true,
        cwd: 'portal/',
        src: ['**']
      },
      user: {
        options: {
          archive: 'archive/user.zip'
        },
        expand: true,
        cwd: 'user/',
        src: ['**']
      },
      piece: {
        options: {
          archive: 'archive/piece.zip'
        },
        expand: true,
        cwd: 'piece/',
        src: ['**']
      }
    },
    requirejs: {
      piece: {
        options: {
          baseUrl: ".",
          skipDirOptimize: true,
          fileExclusionRegExp: /^node_modules$/,
          dir: "dist",
          removeCombined: true,
          mainConfigFile: "config.js",
          wrap: false,
          inlineText: true,
          locale: "zh-cn",
          modules: [{
            name: "user/module"
          }, {
            name: "flight/module"
          }, {
            name: "flight/modulePad"
          }, {
            name: "portal/module"
          }, {
            name: "piece/js/piece-debug",
          }]
        }
      }
    },
    piece_modulejs: {
      main: {
        options: {
          mode: "project",
          exclude: ["archive", "cube", "node_modules", "piece"]
        }
      }
    }
  });

  // These plugins provide necessary tasks.
  grunt.loadNpmTasks('grunt-contrib-concat');
  grunt.loadNpmTasks('grunt-contrib-uglify');
  grunt.loadNpmTasks('grunt-contrib-jshint');
  grunt.loadNpmTasks('grunt-contrib-compress');
  grunt.loadNpmTasks('grunt-contrib-requirejs');
  grunt.loadNpmTasks('grunt-contrib-clean');

  grunt.loadNpmTasks('grunt-piece-modulejs');

  grunt.registerTask('clean-builded', ['clean:archive', 'clean:dist']);
  grunt.registerTask('build', ['compress', 'piece_modulejs', 'requirejs']);

  grunt.registerTask('default', ['clean-builded', 'build']);



};