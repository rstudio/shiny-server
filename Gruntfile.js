module.exports = function(grunt) {

  // Project configuration.
  grunt.initConfig({
    pkg: grunt.file.readJSON('package.json'),
    copy:{
      main: {
        files: [
          {
            src: ['assets/*.css', 'assets/sockjs-*.min.js'], 
            dest: 'build/'
          },
          {
            src: ['lib/**/*.js'],
            dest: 'build/'
          }
        ]
      }
    },
    uglify: {
      options: {
        banner: '/*! <%= pkg.name %> <%= pkg.version %> */\n'
      },
      build: {
        src: 'assets/shiny-server.js',
        dest: 'build/assets/shiny-server.min.js'
      }
    },
    typescript: {
      base: {
        src: ['lib/**/*.ts'],
        dest: 'build/',
        module: 'commonjs',
        options: {
          target: 'es5'
        }
      }
    },
    watch: {
      files: 'lib/**/*.ts',
      tasks: ['default']
    }
  });

  grunt.loadNpmTasks('grunt-contrib-uglify');
  grunt.loadNpmTasks('grunt-contrib-copy');
  grunt.loadNpmTasks('grunt-typescript');
  grunt.loadNpmTasks('grunt-contrib-watch');

  // Default task(s).
  grunt.registerTask('default', ['typescript', 'copy', 'uglify']);
};