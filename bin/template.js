var Handlebars 	= require('handlebars'),
	path 		= require('path'),
	fs 			= require('fs'),
	c  			= require('./clicolors');

module.exports = function(src, dest, data){
	console.log(c.blue + '   create : ' + c.reset + dest);
	var filePath = path.resolve(__dirname, '..', 'templates', src);
	//read
	var fileData = fs.readFileSync(filePath, {encoding: 'utf-8'});
	//compile
	var template = Handlebars.compile(fileData);
	//write
  fs.writeFileSync(dest, template(data), {encoding: 'utf-8'});
}