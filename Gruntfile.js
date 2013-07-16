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
        }
    });

    grunt.loadNpmTasks('grunt-sass');
    grunt.loadNpmTasks('grunt-exec');

    grunt.registerTask('default', ['exec', 'sass']);
};
