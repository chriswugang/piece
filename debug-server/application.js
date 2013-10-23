function AppCtrl($scope, $http) {
	$scope.modules = [
		{name: "aaa", version: "1.0"},
		{name: 'bbb', version: '2.0'}
	];

	$http.get('application.json').success(function(data){
		$scope.modules = data.modules;
	});

	$scope.click = function(){
		alert('test' + $http);
	}

	$scope.update = function(name){
		alert('update' + name);
	}
	$scope.navigate = function(name){
		window.location.href= name + "/index.html";
	}
}