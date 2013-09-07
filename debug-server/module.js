function ModulesCtrl($scope, $http) {
	$scope.modules = [
		{name: "aaa", version: "1.0"},
		{name: 'bbb', version: '2.0'}
	];

	// $http.get('packages.json').success(function(data){
	// 	$scope.modules = data;
	// });

	$scope.click = function(){
		alert('test' + $http);
	}

	$scope.update = function(name){
		alert('update' + name);
	}
}