/*jslint node: true, stupid: true, es5: true */
"use strict";

var spawn = require('child_process').spawn;

module.exports = function (grunt) {
    grunt.initConfig({
        exec: {
            build: {
                cmd: function (input) {
                    input = input || 'input.js';
                    return 'node rustdoc.js ' + input;
                }
            }
        },
        copy: {
            all: {
                files: [
                    {expand: true, src: ['js/**'], dest: 'build/'}
                ]
            }
        },
        sass: {
            dist: {
                options: {
                    includePaths: [
                        'node_modules/'
                    ]
                },
                files: {
                    'build/main.css': 'scss/main.scss'
                }
            }
        },
        connect: {
            server: {
                options: {
                    port: 8000,
                    base: './build',
                    keepalive: true
                }
            }
        }
    });

    grunt.loadNpmTasks('grunt-sass');
    grunt.loadNpmTasks('grunt-exec');
    grunt.loadNpmTasks('grunt-contrib-copy');
    grunt.loadNpmTasks('grunt-contrib-connect');

    grunt.registerTask('default', ['exec', 'sass', 'copy']);
    grunt.registerTask('browse', ['connect']);
    grunt.registerTask('server', ['connect']);
};
