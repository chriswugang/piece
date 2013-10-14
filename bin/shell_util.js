var mkdirp    = require('mkdirp'),
		path			= require('path'),
		fs				= require('fs'),
		ncp       = require('ncp').ncp;

module.exports.printIPAddress = function(response){
  var os=require('os');
  var ifaces=os.networkInterfaces();
  for (var dev in ifaces) {
    var alias=0;
    ifaces[dev].forEach(function(details){
      if (details.family=='IPv4') {
      	response.cyan(dev + (alias?':'+alias:'') + ' :').magenta(details.address).ln();
        ++alias;
      }
    });
  }
}