var express     = require('express'),
	path        = require('path');

module.exports = function(program){
	program
  	.command('server')
  	.description('run a http server at port 3000')
  	.action(runServer);
};

function runServer() {
  var app = express();
  app.use(express.static(path.resolve('.')));
  app.listen(3000);
  console.log('piece.js Server Started, listening at 3000...');
}