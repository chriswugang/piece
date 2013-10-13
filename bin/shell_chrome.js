var exec = require("child_process").exec;

module.exports = function(app) {
	app.cmd('chrome', 
		'start chrome browser with --disable-web-security option', function(req, res, next){
			res.magenta('Tips: the command only works on OSX currently.').ln();
			exec('open -a Google\\ Chrome --args --disable-web-security', function(error, stdout, stderr) {
		    if (error) throw error;
		  });
		  res.prompt();
	});
}