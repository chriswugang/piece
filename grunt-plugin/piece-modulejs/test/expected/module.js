define(function(require) {
     var v1 = require('test/expected/custom_options');
     var v2 = require('test/expected/default_options');
     return {
         'custom_options': v1,
         'default_options': v2
      }
});