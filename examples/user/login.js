define(['text!user/login.html'],
	function(viewTemplate) {

		return Piece.View.extend({

			id: 'login_login',

			events: {
				"click #login_login": "sayHello"
			},

			sayHello: function() {
				alert("=.=");
			},
			render: function() {
				$(this.el).html(viewTemplate);

				Piece.View.prototype.render.call(this);
				return this;
			},
			onShow: function() {
				$("#login_login").off();
				//write your business logic here 
			}
		}); //view define

	});