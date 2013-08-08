var Handlebars 	= require('handlebars'),
	path 		= require('path'),
	fs 			= require('fs');

module.exports = function(src, dest, data){
	var filePath = path.resolve(__dirname, '..', 'templates', src);
	fs.readFile(filePath, {encoding: 'utf-8'}, function(err, fileData) {
    	if (err) throw err;
    	var template = Handlebars.compile(fileData);
    	//write
	    fs.writeFile(dest, template(data), {encoding: 'utf-8'});
  });
}