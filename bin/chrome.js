var exec        = require("child_process").exec;

module.exports = function(program){
	program
	.command('chrome')
	.description('start chrome browser with --disable-web-security option')
	.action(function() {
	  exec('open -a Google\\ Chrome --args --disable-web-security', function(error, stdout, stderr) {
	    if (error) throw error;
	  });
	});
};