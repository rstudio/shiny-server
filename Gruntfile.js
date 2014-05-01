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
    }
  });

  grunt.loadNpmTasks('grunt-contrib-uglify');
  grunt.loadNpmTasks('grunt-contrib-copy');
  
  // Default task(s).
  grunt.registerTask('default', ['copy', 'uglify']);
};